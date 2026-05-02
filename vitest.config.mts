import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**", "src/server/ops/**"],
    environment: "node",
    globals: false,
    // Use an in-memory libsql DB for unit tests so integration-style tests
    // (e.g. webhook handlers) can create a fresh schema per run without
    // touching the local dev DB. Must be set before `@/server/db` loads.
    env: {
      TURSO_DATABASE_URL: "file::memory:?cache=shared",
      KNOSI_SECRET_KEY: "0".repeat(64),
    },
  },
});
