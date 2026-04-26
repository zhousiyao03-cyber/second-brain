import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  deploymentId: process.env.NEXT_DEPLOYMENT_ID,
  // Optional override so multiple Next instances (e.g. the two playwright
  // dev servers, or an ad-hoc smoke server alongside `pnpm dev`) can run
  // from the same project without racing on `.next/dev/lock`. Each consumer
  // sets its own value; production builds and normal local dev leave it
  // unset and keep the default `.next` location.
  distDir: process.env.KNOSI_NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "better-sqlite3",
    "@libsql/client",
    "@huggingface/transformers",
    "onnxruntime-node",
    "@opentelemetry/api",
    "@opentelemetry/sdk-trace-node",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@langfuse/core",
    "langfuse",
    "@zilliz/milvus2-sdk-node",
    "@dsnp/parquetjs",
    "thrift",
  ],
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default nextConfig;
