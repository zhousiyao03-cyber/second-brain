import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**", "src/server/ops/**"],
    environment: "node",
    globals: false,
  },
});
