import { execFileSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import { createClient } from "@libsql/client";

const PLAYWRIGHT_DB_PATH = path.join(
  process.cwd(),
  "data",
  "test",
  "second-brain.e2e.db"
);

const PNPM_CANDIDATES = [process.env.PNPM_BIN, "/usr/local/bin/pnpm", "/opt/homebrew/bin/pnpm"]
  .filter(Boolean);

const PLAYWRIGHT_PNPM_BIN =
  PNPM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "pnpm";

const PLAYWRIGHT_RUNTIME_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  process.env.PATH,
]
  .filter(Boolean)
  .join(":");

function removeIfExists(filePath) {
  rmSync(filePath, { force: true });
}

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

const client = createClient({ url: `file:${PLAYWRIGHT_DB_PATH}` });
await client.execute({
  sql: `INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)`,
  args: ["test-user", "E2E Test User", "e2e@test.local"],
});
client.close();
