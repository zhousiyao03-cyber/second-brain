import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import path from "path";
import { createClient } from "@libsql/client";
import {
  PLAYWRIGHT_DB_PATH,
  PLAYWRIGHT_PNPM_BIN,
  PLAYWRIGHT_RUNTIME_PATH,
} from "./test-db";

function removeIfExists(filePath: string) {
  rmSync(filePath, { force: true });
}

export default async function globalSetup() {
  mkdirSync(path.dirname(PLAYWRIGHT_DB_PATH), { recursive: true });
  removeIfExists(PLAYWRIGHT_DB_PATH);
  removeIfExists(`${PLAYWRIGHT_DB_PATH}-shm`);
  removeIfExists(`${PLAYWRIGHT_DB_PATH}-wal`);

  execFileSync(PLAYWRIGHT_PNPM_BIN, ["db:push"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: PLAYWRIGHT_RUNTIME_PATH,
      SQLITE_DB_PATH: PLAYWRIGHT_DB_PATH,
      TURSO_DATABASE_URL: `file:${PLAYWRIGHT_DB_PATH}`,
    },
    stdio: "inherit",
  });

  // Seed the test user so foreign key constraints pass when AUTH_BYPASS=true
  const client = createClient({ url: `file:${PLAYWRIGHT_DB_PATH}` });
  await client.execute({
    sql: `INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)`,
    args: ["test-user", "E2E Test User", "e2e@test.local"],
  });
  client.close();
}
