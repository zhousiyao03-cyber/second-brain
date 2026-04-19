import {
  AutoProcessor,
  Gemma4ForCausalLM,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
} from "@huggingface/transformers";
import { expose, proxy } from "comlink";
import type {
  LocalChatMessage,
  LocalGenerateRequest,
  LocalGenerateResult,
  LocalLlmWorkerAPI,
  LocalModelCacheStatus,
  LocalModelStatus,
  LocalStreamChunk,
  LocalStreamListener,
  ModelCacheSource,
} from "@/lib/local-ai/contracts";

const MODEL_ID = "onnx-community/gemma-4-E2B-it-ONNX";
const TOKENIZER_PROGRESS_SHARE = 0.12;
const FOLDER_PREFIX = "huggingface.co";
const MODEL_FILES = [
  "chat_template.jinja",
  "config.json",
  "generation_config.json",
  "processor_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/decoder_model_merged_q4f16.onnx",
  "onnx/decoder_model_merged_q4f16.onnx_data",
  "onnx/embed_tokens_q4f16.onnx",
  "onnx/embed_tokens_q4f16.onnx_data",
] as const;

const interruptCriteria = new InterruptableStoppingCriteria();

let processorPromise: Promise<
  Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
> | null = null;
let modelPromise: Promise<
  Awaited<ReturnType<typeof Gemma4ForCausalLM.from_pretrained>>
> | null = null;
let status: LocalModelStatus = { phase: "idle", detail: "Model idle." };
let activeCacheSource: ModelCacheSource | null = null;
let modelCacheFolder: FileSystemDirectoryHandle | null = null;
let modelCachePermission: PermissionState | "unknown" = "unknown";
let modelCacheDownloadBytes = 0;
let browserCachePromise: Promise<Cache | null> | null = null;

type LoadingProgressEvent = {
  file?: string;
  progress?: number;
  status?: string;
};

function setStatus(next: LocalModelStatus): void {
  status = next;
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, progress));
}

function scaleProgress(
  progress: number | undefined,
  start: number,
  end: number
): number {
  const normalized = clampProgress(progress ?? 0);
  return start + (end - start) * (normalized / 100);
}

function toFileLabel(file?: string): string | null {
  if (!file) return null;
  const segments = file.split("/");
  return segments.at(-1) ?? file;
}

function updateLoadingStatus(
  stage: "tokenizer" | "model",
  event?: LoadingProgressEvent
): void {
  const [start, end] =
    stage === "tokenizer"
      ? [0, TOKENIZER_PROGRESS_SHARE * 100]
      : [TOKENIZER_PROGRESS_SHARE * 100, 100];
  const label =
    stage === "tokenizer"
      ? "Preparing processor assets"
      : activeCacheSource === "folder"
        ? "Loading model weights from folder"
        : "Downloading model weights";
  const fileLabel = toFileLabel(event?.file);
  const progress =
    event?.status === "done" ? end : scaleProgress(event?.progress, start, end);
  const detail =
    typeof event?.progress === "number"
      ? `${label}${fileLabel ? ` (${fileLabel})` : ""} (${Math.round(progress)}%).`
      : `${label}${fileLabel ? ` (${fileLabel})` : ""}.`;

  setStatus({
    phase: "loading",
    detail,
    progress: clampProgress(progress),
  });
}

function normalizeKey(request: string): string {
  return request.replace(/^https?:\/\//, "");
}

function toFolderPath(request: string): string {
  const url = new URL(request);
  return `${FOLDER_PREFIX}${url.pathname}`;
}

async function getBrowserCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;

  if (!browserCachePromise) {
    browserCachePromise = caches.open(env.cacheKey).catch(() => null);
  }

  return browserCachePromise;
}

async function queryFolderPermission(
  handle: FileSystemDirectoryHandle | null
): Promise<PermissionState | "unknown"> {
  if (!handle) return "unknown";

  try {
    return await handle.queryPermission({
      mode: "readwrite",
      name: "file-system",
    });
  } catch {
    return "unknown";
  }
}

async function getDirectoryHandleAtPath(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean
): Promise<FileSystemDirectoryHandle> {
  const segments = path.split("/").filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create });
  }

  return current;
}

async function readFolderFile(relativePath: string): Promise<File | null> {
  if (!modelCacheFolder || modelCachePermission !== "granted") return null;

  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return null;

  try {
    const directory = await getDirectoryHandleAtPath(
      modelCacheFolder,
      segments.join("/"),
      false
    );
    const fileHandle = await directory.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

async function writeFolderFile(
  relativePath: string,
  response: Response
): Promise<Response> {
  if (!modelCacheFolder || modelCachePermission !== "granted") return response;

  const payload = await response.arrayBuffer();
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) return response;

  const directory = await getDirectoryHandleAtPath(
    modelCacheFolder,
    segments.join("/"),
    true
  );
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writer = await fileHandle.createWritable();

  try {
    await writer.write(payload);
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }

  modelCacheDownloadBytes += payload.byteLength;

  return new Response(payload.slice(0), {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

async function isManifestComplete(): Promise<boolean> {
  if (!modelCacheFolder || modelCachePermission !== "granted") return false;

  let foundDecoder = false;
  let foundEmbedTokens = false;

  for (const file of MODEL_FILES) {
    const relativePath = `${MODEL_ID}/resolve/main/${file}`;
    const resolved = await readFolderFile(`${FOLDER_PREFIX}/${relativePath}`);

    if (!resolved) {
      if (
        file === "onnx/decoder_model_merged_q4f16.onnx_data" ||
        file === "onnx/embed_tokens_q4f16.onnx_data"
      ) {
        continue;
      }
      return false;
    }

    if (file === "onnx/decoder_model_merged_q4f16.onnx_data") {
      foundDecoder = true;
    }
    if (file === "onnx/embed_tokens_q4f16.onnx_data") {
      foundEmbedTokens = true;
    }
  }

  return foundDecoder && foundEmbedTokens;
}

function buildCacheStatus(detail = "Browser cache only."): LocalModelCacheStatus {
  return {
    configured: modelCacheFolder !== null,
    detail,
    downloadBytes: modelCacheDownloadBytes || undefined,
    folderName: modelCacheFolder?.name ?? null,
    isReady:
      activeCacheSource === "folder"
        ? true
        : modelCacheFolder !== null && modelCachePermission === "granted",
    manifestComplete: false,
    permission: modelCachePermission,
    source: activeCacheSource,
  };
}

const folderBackedCache = {
  async match(request: string) {
    const cacheKey = normalizeKey(request);
    const folderPath = toFolderPath(request);
    const folderFile = await readFolderFile(folderPath);

    if (folderFile) {
      activeCacheSource = "folder";
      return new Response(await folderFile.arrayBuffer(), {
        headers: new Headers({
          "content-length": String(folderFile.size),
          "content-type": folderFile.type || "application/octet-stream",
        }),
        status: 200,
      });
    }

    if (!modelCacheFolder || modelCachePermission !== "granted") {
      const browserCache = await getBrowserCache();
      const browserResponse = browserCache
        ? await browserCache.match(cacheKey)
        : undefined;

      if (browserResponse) {
        activeCacheSource = "browser-cache";
        return browserResponse;
      }
    }

    return undefined;
  },
  async put(request: string, response: Response) {
    const cacheKey = normalizeKey(request);
    let nextResponse = response;

    if (modelCacheFolder && modelCachePermission === "granted") {
      activeCacheSource = "network";
      nextResponse = await writeFolderFile(toFolderPath(request), response);
    }

    const browserCache = await getBrowserCache();
    if (browserCache) {
      await browserCache.put(cacheKey, nextResponse.clone());
    }
  },
};

function configureEnvironment(): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = folderBackedCache;
}

function loadProcessor() {
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback(info: unknown) {
        updateLoadingStatus("tokenizer", info as LoadingProgressEvent);
      },
    }).catch((error) => {
      processorPromise = null;
      throw error;
    });
  }

  return processorPromise;
}

function loadModel() {
  if (!modelPromise) {
    modelPromise = Gemma4ForCausalLM.from_pretrained(MODEL_ID, {
      device: "webgpu",
      dtype: "q4f16",
      progress_callback(info: unknown) {
        updateLoadingStatus("model", info as LoadingProgressEvent);
      },
    }).catch((error) => {
      modelPromise = null;
      throw error;
    });
  }

  return modelPromise;
}

async function loadResources() {
  configureEnvironment();
  modelCacheDownloadBytes = 0;
  activeCacheSource = null;

  const processor = await loadProcessor();

  setStatus({
    phase: "loading",
    detail: "Processor ready. Preparing model weights.",
    progress: TOKENIZER_PROGRESS_SHARE * 100,
  });

  const model = await loadModel();
  setStatus({
    phase: "ready",
    detail:
      activeCacheSource === "folder"
        ? "Gemma ready on WebGPU (folder cache)."
        : activeCacheSource === "browser-cache"
          ? "Gemma ready on WebGPU (browser cache)."
          : "Gemma ready on WebGPU.",
    progress: 100,
  });

  return { processor, model };
}

function renderChatPrompt(
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>,
  request: LocalGenerateRequest
): string {
  const messages: LocalChatMessage[] = [];
  if (request.system.trim()) {
    messages.push({ role: "system", content: request.system });
  }
  for (const m of request.messages) {
    messages.push(m);
  }

  const templateOptions: Record<string, unknown> = {
    add_generation_prompt: true,
    tokenize: false,
    enable_thinking: false,
  };
  return processor.apply_chat_template(
    messages,
    templateOptions as Parameters<typeof processor.apply_chat_template>[1]
  ) as string;
}

async function runGeneration(
  prompt: string,
  onStream?: LocalStreamListener
): Promise<LocalGenerateResult> {
  const { processor, model } = await loadResources();
  const inputs = processor.tokenizer!(prompt, {
    add_special_tokens: false,
    return_tensor: true,
  });

  interruptCriteria.reset();
  setStatus({
    phase: "generating",
    detail: "Thinking…",
    progress: 100,
  });

  let streamed = "";
  const streamer =
    onStream === undefined
      ? undefined
      : new TextStreamer(processor.tokenizer!, {
          callback_function(text) {
            streamed += text;
            onStream({ type: "text", text } satisfies LocalStreamChunk);
          },
          skip_prompt: true,
          skip_special_tokens: false,
        });

  try {
    const output = await model.generate({
      ...inputs,
      do_sample: false,
      max_new_tokens: 1024,
      temperature: 1.0,
      top_p: 0.95,
      top_k: 64,
      stopping_criteria: [interruptCriteria],
      streamer,
    });

    if (interruptCriteria.interrupted) {
      throw new Error("Generation interrupted.");
    }

    if (streamed.trim()) {
      setStatus({
        phase: "ready",
        detail: "Gemma ready on WebGPU.",
        progress: 100,
      });
      return { output: stripTrailingSpecials(streamed) };
    }

    const promptLength = inputs.input_ids.dims.at(-1) ?? 0;
    const sequences =
      "slice" in output
        ? output
        : (
            output as {
              sequences: typeof inputs.input_ids;
            }
          ).sequences;
    const decoded =
      processor.tokenizer!.batch_decode(
        sequences.slice(null, [promptLength, null]),
        { skip_special_tokens: false }
      )[0] ?? "";

    setStatus({
      phase: "ready",
      detail: "Gemma ready on WebGPU.",
      progress: 100,
    });

    return { output: stripTrailingSpecials(decoded) };
  } catch (error) {
    if (error instanceof Error && error.message === "Generation interrupted.") {
      setStatus({
        phase: "ready",
        detail: "Generation cancelled.",
        progress: 100,
      });
      throw error;
    }

    if (isDeviceLostError(error)) {
      resetGpuResources();
      setStatus({
        phase: "error",
        detail:
          "WebGPU device lost — freed model handles. Try again; weights will reload from cache.",
        error: error instanceof Error ? error.message : String(error),
        progress: undefined,
      });
      throw error;
    }

    setStatus({
      phase: "error",
      detail: "Model generation failed.",
      error: error instanceof Error ? error.message : String(error),
      progress: undefined,
    });
    throw error;
  }
}

function isDeviceLostError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = `${error.message} ${error.stack ?? ""}`;
  return (
    msg.includes("A valid external Instance reference no longer exists") ||
    msg.includes("Device was lost") ||
    msg.includes("device is lost") ||
    msg.includes("GPUDevice was destroyed") ||
    msg.includes("OrtRun") ||
    msg.includes("mapAsync")
  );
}

function resetGpuResources(): void {
  processorPromise = null;
  modelPromise = null;
  activeCacheSource = null;
}

function stripTrailingSpecials(text: string): string {
  return text
    .replace(/<\|tool_response>$/g, "")
    .replace(/<turn\|>$/g, "")
    .replace(/<end_of_turn>$/g, "")
    .replace(/<eos>$/g, "")
    .trim();
}

const llmApi: LocalLlmWorkerAPI = {
  async getStatus() {
    return status;
  },

  async loadModel() {
    if (status.phase === "ready") return status;

    setStatus({
      phase: "loading",
      detail: "Preparing processor and model.",
      progress: 0,
    });

    try {
      await loadResources();
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isDeviceLostError(error)) {
        resetGpuResources();
        setStatus({
          phase: "error",
          detail:
            "WebGPU device lost during load — freed model handles. Try again.",
          error: message,
          progress: undefined,
        });
      } else {
        setStatus({
          phase: "error",
          detail: "Model failed to load.",
          error: message,
          progress: undefined,
        });
      }
      throw error;
    }
  },

  async generateChat(request, onStream) {
    const { processor } = await loadResources();
    const prompt = renderChatPrompt(processor, request);
    return runGeneration(prompt, onStream);
  },

  async abortGeneration() {
    interruptCriteria.interrupt();
  },

  async configureModelCache(directoryHandle) {
    modelCacheFolder = directoryHandle;
    modelCachePermission = await queryFolderPermission(directoryHandle);
    modelCacheDownloadBytes = 0;
    processorPromise = null;
    modelPromise = null;

    const manifestComplete = await isManifestComplete();
    const detail = !directoryHandle
      ? "Browser cache only."
      : modelCachePermission !== "granted"
        ? "Model folder selected, but permission must be reconnected."
        : manifestComplete
          ? "Model folder cache is ready."
          : "Model folder selected. Missing Gemma files will be downloaded on first load.";

    activeCacheSource = directoryHandle && manifestComplete ? "folder" : null;

    return {
      configured: directoryHandle !== null,
      detail,
      downloadBytes: undefined,
      folderName: directoryHandle?.name ?? null,
      isReady: manifestComplete,
      manifestComplete,
      permission: modelCachePermission,
      source: activeCacheSource,
    };
  },

  async clearModelCachePreference() {
    return llmApi.configureModelCache(null);
  },

  async getModelCacheStatus() {
    const manifestComplete = await isManifestComplete();
    const detail = !modelCacheFolder
      ? "Browser cache only."
      : modelCachePermission !== "granted"
        ? "Model folder selected, but permission must be reconnected."
        : manifestComplete
          ? "Model folder cache is ready."
          : "Model folder is selected but still needs model files.";

    const source =
      modelCacheFolder && manifestComplete ? "folder" : activeCacheSource;

    return {
      ...buildCacheStatus(detail),
      source,
      manifestComplete,
      isReady: manifestComplete,
    };
  },
};

expose(llmApi);

// Keep the proxy import so comlink re-exports it for callers who need to wrap
// callbacks. Prevents "unused" lint.
export { proxy };
