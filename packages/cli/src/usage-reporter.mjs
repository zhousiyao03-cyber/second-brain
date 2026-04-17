/**
 * Usage reporter — scans local Claude Code / Codex logs and uploads to
 * /api/usage on the configured Knosi server. Runs inside the knosi daemon
 * on an interval, or one-shot via `knosi usage report`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function normalizeToken(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function toDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function listJsonlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listJsonlFiles(p));
    else if (entry.name.endsWith(".jsonl")) results.push(p);
  }
  return results;
}

export function scanUsage() {
  const aggMap = new Map();

  function merge(date, provider, model, input, output, cacheRead, cacheWrite) {
    const key = `${date}|${provider}|${model}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.input_tokens += input;
      existing.output_tokens += output;
      existing.cache_read_tokens += cacheRead;
      existing.cache_write_tokens += cacheWrite;
    } else {
      aggMap.set(key, {
        date,
        provider,
        model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
      });
    }
  }

  // Claude Code
  const claudeRoot = join(homedir(), ".claude", "projects");
  if (existsSync(claudeRoot)) {
    for (const filePath of listJsonlFiles(claudeRoot)) {
      try {
        const raw = readFileSync(filePath, "utf8");
        const fallbackTs = statSync(filePath).mtimeMs;
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const item = JSON.parse(line);
            const usage = item.message?.usage;
            if (!usage) continue;
            const input = normalizeToken(usage.input_tokens);
            const output = normalizeToken(usage.output_tokens);
            const cacheRead = normalizeToken(usage.cache_read_input_tokens);
            const cacheWrite = normalizeToken(usage.cache_creation_input_tokens);
            if (input + output + cacheRead + cacheWrite === 0) continue;
            const ts = item.timestamp ? Date.parse(item.timestamp) : fallbackTs;
            const date = toDateKey(Number.isFinite(ts) ? ts : fallbackTs);
            let model = item.message?.model ?? "unknown";
            if (model.startsWith("anthropic.")) model = model.slice(10);
            merge(date, "claude-code", model, input, output, cacheRead, cacheWrite);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  }

  // Codex (optional — skips silently if better-sqlite3 unavailable)
  try {
    const codexDir = join(homedir(), ".codex");
    if (existsSync(codexDir)) {
      const runtimeRequire = new Function("specifier", "return require(specifier)");
      const Database = runtimeRequire("better-sqlite3");
      const dbFiles = readdirSync(codexDir)
        .filter((name) => /^state(?:_\d+)?\.sqlite$/.test(name))
        .map((name) => join(codexDir, name))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (dbFiles.length > 0) {
        const sqlite = new Database(dbFiles[0], { readonly: true, fileMustExist: true });
        const rows = sqlite
          .prepare("SELECT model, tokens_used, updated_at FROM threads WHERE tokens_used > 0")
          .all();
        sqlite.close();
        for (const row of rows) {
          const date = toDateKey(normalizeToken(row.updated_at) * 1000);
          merge(date, "codex", row.model ?? "unknown", 0, normalizeToken(row.tokens_used), 0, 0);
        }
      }
    }
  } catch {
    // skip
  }

  return [...aggMap.values()];
}

export async function uploadUsage(serverUrl, authToken, entries) {
  const BATCH_SIZE = 200;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${serverUrl}/api/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ entries: batch }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("AUTH_FAILED");
      }
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  }
}

export async function runUsageSync(serverUrl, authToken) {
  const entries = scanUsage();
  if (entries.length === 0) {
    return { count: 0 };
  }
  await uploadUsage(serverUrl, authToken, entries);
  return { count: entries.length };
}
