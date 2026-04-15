import { defineConfig } from "@playwright/test";
import {
  PLAYWRIGHT_DB_PATH,
  PLAYWRIGHT_PNPM_BIN,
  PLAYWRIGHT_RUNTIME_PATH,
} from "./e2e/test-db";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  globalSetup: "./e2e/global-setup.ts",
  reporter: "html",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: `${PLAYWRIGHT_PNPM_BIN} db:push && ${PLAYWRIGHT_PNPM_BIN} exec next dev --port 3100`,
    env: {
      ...process.env,
      PATH: PLAYWRIGHT_RUNTIME_PATH,
      NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS: "1000",
      SQLITE_DB_PATH: PLAYWRIGHT_DB_PATH,
      TURSO_DATABASE_URL: `file:${PLAYWRIGHT_DB_PATH}`,
      AUTH_SECRET: "playwright-auth-secret",
      AUTH_BYPASS: "true",
      AUTH_BYPASS_USER_ID: "test-user",
      AUTH_BYPASS_EMAIL: "e2e@test.local",
      OPS_OWNER_EMAIL: "e2e@test.local",
      ENABLE_TOKEN_USAGE: "false",
      NEXT_PUBLIC_ENABLE_TOKEN_USAGE: "false",
    },
    url: "http://localhost:3100/",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
