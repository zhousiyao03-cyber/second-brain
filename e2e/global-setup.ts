import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import path from "path";
import { createClient } from "@libsql/client";
import {
  PLAYWRIGHT_DB_PATH,
  PLAYWRIGHT_PNPM_BIN,
  PLAYWRIGHT_RUNTIME_PATH,
} from "./test-db";

const BILLING_DB_PATH = path.join(
  process.cwd(),
  "data",
  "second-brain.billing.e2e.db",
);

function removeIfExists(filePath: string) {
  rmSync(filePath, { force: true });
}

async function prepareDb(
  dbPath: string,
  users: Array<{ id: string; name: string; email: string }>,
) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  removeIfExists(dbPath);
  removeIfExists(`${dbPath}-shm`);
  removeIfExists(`${dbPath}-wal`);

  execFileSync(PLAYWRIGHT_PNPM_BIN, ["db:push"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: PLAYWRIGHT_RUNTIME_PATH,
      SQLITE_DB_PATH: dbPath,
      TURSO_DATABASE_URL: `file:${dbPath}`,
    },
    stdio: "inherit",
  });

  const client = createClient({ url: `file:${dbPath}` });
  const now = Math.floor(Date.now() / 1000);
  for (const user of users) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`,
      args: [user.id, user.name, user.email, now],
    });
  }
  client.close();
}

export default async function globalSetup() {
  // Default project DB (non-hosted mode, Pro-by-default)
  await prepareDb(PLAYWRIGHT_DB_PATH, [
    { id: "test-user", name: "E2E Test User", email: "e2e@test.local" },
  ]);

  // Billing project DB (hosted mode; per-test backdating drives entitlement branches)
  await prepareDb(BILLING_DB_PATH, [
    {
      id: "billing-test-user",
      name: "E2E Billing Test User",
      email: "billing-e2e@test.local",
    },
  ]);
}
