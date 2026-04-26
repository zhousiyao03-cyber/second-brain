import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { embedMany } from "ai";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

type EmbeddingProviderMode =
  | "none"
  | "openai"
  | "google"
  | "local"
  | "transformers";

const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_LOCAL_EMBEDDING_MODEL = "nomic-embed-text";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_TRANSFORMERS_MODEL_ID = "Xenova/multilingual-e5-small";

function resolveValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function getEmbeddingProviderMode(): EmbeddingProviderMode {
  const explicitMode = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

  if (explicitMode === "none") return "none";
  if (explicitMode === "openai") return "openai";
  if (explicitMode === "google" || explicitMode === "gemini") return "google";
  if (explicitMode === "local") return "local";
  if (explicitMode === "transformers" || explicitMode === "huggingface") {
    return "transformers";
  }

  // Default to in-process Transformers.js: no API quota, no external
  // dependency, works offline. Other providers require explicit opt-in via
  // EMBEDDING_PROVIDER, so a stray GOOGLE_GENERATIVE_AI_API_KEY (used for
  // chat) doesn't silently re-route embeddings through a quota-limited API.
  return "transformers";
}

function getEmbeddingModelId(mode: Exclude<EmbeddingProviderMode, "none">) {
  if (mode === "google") {
    return (
      resolveValue(
        process.env.GOOGLE_EMBEDDING_MODEL,
        process.env.EMBEDDING_MODEL
      ) ?? DEFAULT_GOOGLE_EMBEDDING_MODEL
    );
  }

  if (mode === "openai") {
    return (
      resolveValue(
        process.env.OPENAI_EMBEDDING_MODEL,
        process.env.EMBEDDING_MODEL
      ) ?? DEFAULT_OPENAI_EMBEDDING_MODEL
    );
  }

  if (mode === "transformers") {
    return (
      resolveValue(
        process.env.TRANSFORMERS_EMBEDDING_MODEL,
        process.env.EMBEDDING_MODEL
      ) ?? DEFAULT_TRANSFORMERS_MODEL_ID
    );
  }

  return (
    resolveValue(
      process.env.AI_EMBEDDING_MODEL,
      process.env.LOCAL_AI_EMBEDDING_MODEL,
      process.env.EMBEDDING_MODEL
    ) ?? DEFAULT_LOCAL_EMBEDDING_MODEL
  );
}

function createEmbeddingModel(
  mode: Exclude<EmbeddingProviderMode, "none" | "transformers">
) {
  const modelId = getEmbeddingModelId(mode);

  if (mode === "google") {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY for embeddings.");
    }

    const provider = createGoogleGenerativeAI({ apiKey });
    return provider.textEmbeddingModel(modelId);
  }

  if (mode === "openai") {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("Missing OPENAI_API_KEY for embeddings.");
    }

    const provider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: resolveValue(process.env.OPENAI_BASE_URL),
      organization: resolveValue(process.env.OPENAI_ORGANIZATION),
      project: resolveValue(process.env.OPENAI_PROJECT),
    });
    return provider.embeddingModel(modelId);
  }

  // local
  const provider = createOpenAI({
    name: "local-ai",
    baseURL:
      resolveValue(process.env.AI_BASE_URL, process.env.LOCAL_AI_BASE_URL) ??
      DEFAULT_LOCAL_BASE_URL,
    apiKey:
      resolveValue(process.env.AI_API_KEY, process.env.LOCAL_AI_API_KEY) ??
      "local",
  });
  return provider.embeddingModel(modelId);
}

/**
 * Lazy-loaded singleton for the in-process Transformers.js feature-extraction
 * pipeline. The model files (~120MB Q8) are downloaded on first use and cached
 * to `~/.cache/huggingface/`. Subsequent calls reuse the same pipeline
 * instance — model weights stay resident in memory for the process lifetime.
 *
 * In Next.js dev with HMR, this module-scope cache survives reloads because
 * Next reuses the same Node worker.
 */
let transformersPipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getTransformersPipeline() {
  if (!transformersPipelinePromise) {
    transformersPipelinePromise = (async () => {
      // Dynamic import: transformers.js is ESM, ~10MB on disk, and we only
      // want to pay the load cost when this provider is actually used.
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline(
        "feature-extraction",
        getEmbeddingModelId("transformers"),
        { dtype: "q8" }
      );
    })();
  }
  return transformersPipelinePromise;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(
    vector.reduce((sum, value) => sum + value * value, 0)
  );

  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

export function isEmbeddingEnabled() {
  return getEmbeddingProviderMode() !== "none";
}

export function getEmbeddingSetupHint() {
  const mode = getEmbeddingProviderMode();

  if (mode === "google") {
    return "请检查 GOOGLE_GENERATIVE_AI_API_KEY 和 GOOGLE_EMBEDDING_MODEL 是否配置正确。";
  }

  if (mode === "openai") {
    return "请检查 OPENAI_API_KEY 和 OPENAI_EMBEDDING_MODEL 是否配置正确。";
  }

  if (mode === "local") {
    return "请检查 AI_BASE_URL / LOCAL_AI_BASE_URL 与 embedding 模型是否可用。";
  }

  if (mode === "transformers") {
    return "进程内 Transformers.js — 首次启动会下载 ~120MB 模型文件，后续从本地缓存加载。";
  }

  return "当前未配置 embedding provider，将退化为纯关键词检索。";
}

export function getEmbeddingModelLabel() {
  const mode = getEmbeddingProviderMode();
  return mode === "none" ? null : getEmbeddingModelId(mode);
}

/**
 * Kind affects nothing for OpenAI/Google/local providers, but the Transformers.js
 * path uses it to apply the e5-family prefix convention:
 *   - "passage: " for indexed text (documents)
 *   - "query: " for retrieval queries
 * Mismatched prefixes degrade similarity scores noticeably (e5 was trained
 * with these as anchors), so callers should pass the right kind.
 */
type EmbedKind = "passage" | "query";

async function embedWithTransformers(texts: string[], kind: EmbedKind) {
  const extractor = await getTransformersPipeline();
  const prefix = kind === "query" ? "query: " : "passage: ";
  const prefixed = texts.map((t) => prefix + t);

  const tensor = await extractor(prefixed, {
    pooling: "mean",
    normalize: true,
  });

  const dims = tensor.dims[1] ?? 0;
  const flat = Array.from(tensor.data as Float32Array);
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(flat.slice(i * dims, (i + 1) * dims));
  }

  return {
    model: getEmbeddingModelId("transformers"),
    vectors,
  };
}

export async function embedTexts(
  texts: string[],
  kind: EmbedKind = "passage"
) {
  const mode = getEmbeddingProviderMode();
  if (mode === "none" || texts.length === 0) {
    return null;
  }

  if (mode === "transformers") {
    return embedWithTransformers(texts, kind);
  }

  const model = createEmbeddingModel(mode);
  const { embeddings } = await embedMany({
    model,
    values: texts,
  });

  return {
    model: getEmbeddingModelId(mode),
    vectors: embeddings.map((embedding) => normalizeVector(embedding)),
  };
}

export function vectorBufferToArray(buffer: Buffer | Uint8Array | null) {
  if (!buffer) return [];

  const uint8Array = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const view = new Float32Array(
    uint8Array.buffer,
    uint8Array.byteOffset,
    uint8Array.byteLength / Float32Array.BYTES_PER_ELEMENT
  );

  return Array.from(view);
}

export function vectorArrayToBuffer(vector: number[]) {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function dotProduct(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  let score = 0;

  for (let index = 0; index < size; index += 1) {
    score += left[index]! * right[index]!;
  }

  return score;
}
