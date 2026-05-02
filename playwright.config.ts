import { defineConfig } from "@playwright/test";
import path from "path";
import {
  PLAYWRIGHT_DB_PATH,
  PLAYWRIGHT_PNPM_BIN,
  PLAYWRIGHT_RUNTIME_PATH,
} from "./e2e/test-db";

const BILLING_DB_PATH = path.join(
  process.cwd(),
  "data",
  "second-brain.billing.e2e.db",
);

const BILLING_BASE_URL = "http://localhost:3101";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  globalSetup: "./e2e/global-setup.ts",
  reporter: "html",
  projects: [
    {
      name: "default",
      testIgnore: /billing\.spec\.ts/,
      use: {
        baseURL: "http://localhost:3100",
        trace: "on-first-retry",
      },
    },
    {
      name: "billing",
      testMatch: /billing\.spec\.ts/,
      fullyParallel: false,
      use: {
        baseURL: BILLING_BASE_URL,
        trace: "on-first-retry",
      },
    },
  ],
  // Each webServer gets its own KNOSI_NEXT_DIST_DIR so the two `next dev`
  // processes don't race on the same `.next/dev/lock`. They also stay
  // isolated from a developer's running `pnpm dev` (which uses `.next`).
  webServer: [
    {
      command: `${PLAYWRIGHT_PNPM_BIN} db:push && ${PLAYWRIGHT_PNPM_BIN} exec next dev --port 3100`,
      env: {
        ...process.env,
        PATH: PLAYWRIGHT_RUNTIME_PATH,
        KNOSI_NEXT_DIST_DIR: ".next-e2e",
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
        DRIFTER_E2E_MOCK: "1",
      },
      url: "http://localhost:3100/",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: `${PLAYWRIGHT_PNPM_BIN} db:push && ${PLAYWRIGHT_PNPM_BIN} exec next dev --port 3101`,
      env: {
        ...process.env,
        PATH: PLAYWRIGHT_RUNTIME_PATH,
        KNOSI_NEXT_DIST_DIR: ".next-e2e-billing",
        NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS: "1000",
        SQLITE_DB_PATH: BILLING_DB_PATH,
        TURSO_DATABASE_URL: `file:${BILLING_DB_PATH}`,
        AUTH_SECRET: "playwright-billing-auth-secret",
        AUTH_BYPASS: "true",
        AUTH_BYPASS_USER_ID: "billing-test-user",
        AUTH_BYPASS_EMAIL: "billing-e2e@test.local",
        OPS_OWNER_EMAIL: "billing-e2e@test.local",
        ENABLE_TOKEN_USAGE: "false",
        NEXT_PUBLIC_ENABLE_TOKEN_USAGE: "false",
        KNOSI_HOSTED_MODE: "true",
        // Intentionally no KNOSI_BILLING_LAUNCH_DATE — the grandfather path
        // must stay dormant so the "expired trial" assertion holds.
      },
      url: `${BILLING_BASE_URL}/`,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
