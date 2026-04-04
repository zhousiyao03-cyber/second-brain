#!/usr/bin/env node

/**
 * Usage Daemon — 扫描本机 Claude Code / Codex 日志，自动同步到线上 Second Brain
 *
 * 用法：
 *   pnpm usage:daemon                          # 常驻后台，每 5 分钟自动同步
 *   pnpm usage:report                          # 单次同步
 *
 * 环境变量（可选）：
 *   SECOND_BRAIN_URL — 线上地址（默认 https://second-brain-self-alpha.vercel.app）
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const SERVER_URL = process.env.SECOND_BRAIN_URL || "https://second-brain-self-alpha.vercel.app";
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IS_ONCE = process.argv.includes("--once");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeToken(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function toDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

// ---------------------------------------------------------------------------
// Scan & Aggregate
// ---------------------------------------------------------------------------

function listJsonlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listJsonlFiles(p));
    else if (entry.name.endsWith(".jsonl")) results.push(p);
  }
  return results;
}

function scan() {
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
        date, provider, model,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
      });
    }
  }

  // --- Claude Code ---
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
          } catch { continue; }
        }
      } catch { continue; }
    }
  }

  // --- Codex (skip silently if better-sqlite3 unavailable) ---
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
  } catch { /* skip */ }

  return [...aggMap.values()];
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

async function upload(entries) {
  const BATCH_SIZE = 200;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${SERVER_URL}/api/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: batch }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Single sync cycle
// ---------------------------------------------------------------------------

async function syncOnce() {
  const entries = scan();
  if (entries.length === 0) {
    console.log(`[${timestamp()}] 没有 usage 数据`);
    return;
  }
  await upload(entries);
  console.log(`[${timestamp()}] ✅ 同步 ${entries.length} 条记录 → ${SERVER_URL}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (IS_ONCE) {
  // Single run: pnpm usage:report
  console.log("🔍 扫描本机 usage 数据...");
  await syncOnce();
} else {
  // Daemon mode: pnpm usage:daemon (default)
  const pidFile = join(homedir(), ".second-brain-usage.pid");
  writeFileSync(pidFile, String(process.pid));

  console.log(`🚀 Usage daemon 已启动 (PID: ${process.pid})`);
  console.log(`   服务器: ${SERVER_URL}`);
  console.log(`   同步间隔: ${SCAN_INTERVAL_MS / 1000}s`);
  console.log("");

  // Initial sync
  await syncOnce().catch((err) => console.error(`[${timestamp()}] ❌`, err.message));

  // Recurring sync
  setInterval(async () => {
    await syncOnce().catch((err) => console.error(`[${timestamp()}] ❌`, err.message));
  }, SCAN_INTERVAL_MS);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n[${timestamp()}] daemon 退出`);
      try { unlinkSync(pidFile); } catch {}
      process.exit(0);
    });
  }
}
