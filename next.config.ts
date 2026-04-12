import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "better-sqlite3",
    "@libsql/client",
    "@opentelemetry/api",
    "@opentelemetry/sdk-trace-node",
    "@vercel/otel",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@langfuse/core",
    "langfuse",
  ],
  transpilePackages: ["@excalidraw/excalidraw"],
};

export default nextConfig;
