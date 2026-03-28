import { execFileSync } from "child_process";
import { mkdirSync, rmSync, existsSync } from "fs";
import path from "path";

const PLAYWRIGHT_AUTH_DB_PATH = path.join(
  process.cwd(),
  "data",
  "test",
  "second-brain-auth.e2e.db"
);

const PNPM_CANDIDATES = [process.env.PNPM_BIN, "/usr/local/bin/pnpm", "/opt/homebrew/bin/pnpm"]
  .filter(Boolean);

const PLAYWRIGHT_AUTH_PNPM_BIN =
  PNPM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "pnpm";

const PLAYWRIGHT_AUTH_RUNTIME_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  process.env.PATH,
]
  .filter(Boolean)
  .join(":");

function removeIfExists(filePath) {
  rmSync(filePath, { force: true });
}

mkdirSync(path.dirname(PLAYWRIGHT_AUTH_DB_PATH), { recursive: true });
removeIfExists(PLAYWRIGHT_AUTH_DB_PATH);
removeIfExists(`${PLAYWRIGHT_AUTH_DB_PATH}-shm`);
removeIfExists(`${PLAYWRIGHT_AUTH_DB_PATH}-wal`);

execFileSync(PLAYWRIGHT_AUTH_PNPM_BIN, ["db:push"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PATH: PLAYWRIGHT_AUTH_RUNTIME_PATH,
    SQLITE_DB_PATH: PLAYWRIGHT_AUTH_DB_PATH,
    TURSO_DATABASE_URL: `file:${PLAYWRIGHT_AUTH_DB_PATH}`,
  },
  stdio: "inherit",
});
