import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { resolveAiCall } from "./provider/resolve";
import { MissingAiRoleError } from "./provider/types";
import { TRANSFORMERS_DEFAULT_MODEL } from "./provider/presets";

type EmbedKind = "passage" | "query";

let transformersPipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getTransformersPipeline(modelId: string) {
  if (!transformersPipelinePromise) {
    transformersPipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", modelId, { dtype: "q8" });
    })();
  }
  return transformersPipelinePromise;
}

function normalizeVector(vector: number[]) {
  const m = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (!Number.isFinite(m) || m <= 0) return vector;
  return vector.map((v) => v / m);
}

async function embedWithTransformers(
  texts: string[],
  kind: EmbedKind,
  modelId: string,
) {
  const extractor = await getTransformersPipeline(modelId);
  const prefix = kind === "query" ? "query: " : "passage: ";
  const tensor = await extractor(texts.map((t) => prefix + t), {
    pooling: "mean",
    normalize: true,
  });
  const dims = tensor.dims[1] ?? 0;
  const flat = Array.from(tensor.data as Float32Array);
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(flat.slice(i * dims, (i + 1) * dims));
  }
  return { model: modelId, vectors };
}

export async function embedTexts(
  texts: string[],
  opts: { userId: string; kind?: EmbedKind },
) {
  if (texts.length === 0) return null;
  const kind: EmbedKind = opts.kind ?? "passage";

  let provider;
  try {
    provider = await resolveAiCall("embedding", opts.userId);
  } catch (e) {
    // No embedding role configured → keyword-only retrieval; not an error.
    if (e instanceof MissingAiRoleError) return null;
    throw e;
  }

  if (provider.kind === "transformers") {
    return embedWithTransformers(
      texts,
      kind,
      provider.modelId || TRANSFORMERS_DEFAULT_MODEL,
    );
  }
  if (provider.kind === "claude-code-daemon") {
    // resolveAiCall already trips this; defensive double-check.
    throw new Error("daemon kind cannot serve embedding");
  }

  const sdk = createOpenAI({
    name: provider.label,
    baseURL: provider.baseURL,
    apiKey: provider.kind === "openai-compatible" ? provider.apiKey : "local",
  });
  const model = sdk.embeddingModel(provider.modelId);
  const { embeddings } = await embedMany({ model, values: texts });
  return {
    model: provider.modelId,
    vectors: embeddings.map((e) => normalizeVector(e)),
  };
}

export function vectorBufferToArray(buffer: Buffer | Uint8Array | null) {
  if (!buffer) return [];
  const u8 = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const v = new Float32Array(
    u8.buffer,
    u8.byteOffset,
    u8.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(v);
}

export function vectorArrayToBuffer(vector: number[]) {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function dotProduct(left: number[], right: number[]) {
  const n = Math.min(left.length, right.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += left[i]! * right[i]!;
  return s;
}
