import { defineConfig } from "@playwright/test";
import {
  PLAYWRIGHT_AUTH_DB_PATH,
  PLAYWRIGHT_AUTH_PNPM_BIN,
  PLAYWRIGHT_AUTH_RUNTIME_PATH,
} from "./e2e/auth-test-db";

const AUTH_DB_URL = `file:${PLAYWRIGHT_AUTH_DB_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3200",
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      "node e2e/auth-prepare-db.mjs &&",
      `SQLITE_DB_PATH=${JSON.stringify(PLAYWRIGHT_AUTH_DB_PATH)}`,
      `TURSO_DATABASE_URL=${JSON.stringify(AUTH_DB_URL)}`,
      "AUTH_SECRET=playwright-auth-secret",
      "AUTH_GITHUB_ID=playwright-github-id",
      "AUTH_GITHUB_SECRET=playwright-github-secret",
      "AUTH_GOOGLE_ID=playwright-google-id",
      "AUTH_GOOGLE_SECRET=playwright-google-secret",
      "ENABLE_TOKEN_USAGE=false",
      "NEXT_PUBLIC_ENABLE_TOKEN_USAGE=false",
      "NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS=1000",
      PLAYWRIGHT_AUTH_PNPM_BIN,
      "dev --port 3200",
    ].join(" "),
    env: {
      ...process.env,
      PATH: PLAYWRIGHT_AUTH_RUNTIME_PATH,
    },
    url: "http://localhost:3200/",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
