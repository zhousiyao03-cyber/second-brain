import { existsSync } from "fs";
import path from "path";

export const PLAYWRIGHT_DB_PATH = path.join(
  process.cwd(),
  "data",
  "second-brain.e2e.db"
);

const PNPM_CANDIDATES = [process.env.PNPM_BIN, "/usr/local/bin/pnpm", "/opt/homebrew/bin/pnpm"]
  .filter((candidate): candidate is string => Boolean(candidate));

export const PLAYWRIGHT_PNPM_BIN =
  PNPM_CANDIDATES.find((candidate) => existsSync(candidate)) ?? "pnpm";

export const PLAYWRIGHT_RUNTIME_PATH = [
  "/usr/local/bin",
  "/opt/homebrew/bin",
  process.env.PATH,
]
  .filter((segment): segment is string => Boolean(segment))
  .join(":");
