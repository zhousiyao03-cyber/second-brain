import path from "path";

const DEFAULT_SQLITE_DB_PATH = path.join("data", "second-brain.db");

export function getSqliteDbPath() {
  return process.env.SQLITE_DB_PATH ?? DEFAULT_SQLITE_DB_PATH;
}

export function getDatabaseUrl() {
  if (process.env.SQLITE_DB_PATH) {
    return `file:${getSqliteDbPath()}`;
  }

  return process.env.TURSO_DATABASE_URL ?? `file:${DEFAULT_SQLITE_DB_PATH}`;
}

export function isTursoDatabaseUrl(url: string) {
  return url.startsWith("libsql://");
}
