#!/usr/bin/env node

/**
 * Usage Reporter — 扫描本机 Claude Code / Codex 日志，上报到线上 Second Brain
 *
 * 用法：
 *   node tools/usage-reporter/report.mjs
 *
 * 环境变量：
 *   SECOND_BRAIN_URL    — 线上地址（默认 http://localhost:3200）
 *   USAGE_REPORT_SECRET — 上报密钥（需要和 .env 中的一致）
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const SERVER_URL = process.env.SECOND_BRAIN_URL || "http://localhost:3200";
const SECRET = process.env.USAGE_REPORT_SECRET;

if (!SECRET) {
  console.error("❌ 请设置 USAGE_REPORT_SECRET 环境变量");
  process.exit(1);
}

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

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Claude Code Scanner
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

function scanClaude() {
  const root = join(homedir(), ".claude", "projects");
  if (!existsSync(root)) {
    console.log("⚠️  Claude Code 日志目录不存在:", root);
    return;
  }

  const files = listJsonlFiles(root);
  console.log(`📂 扫描 ${files.length} 个 Claude Code session 文件...`);

  let totalEntries = 0;
  for (const filePath of files) {
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
          totalEntries++;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  console.log(`   ✅ 提取到 ${totalEntries} 条 usage 记录`);
}

// ---------------------------------------------------------------------------
// Codex Scanner (optional — needs better-sqlite3)
// ---------------------------------------------------------------------------

async function scanCodex() {
  const codexDir = join(homedir(), ".codex");
  if (!existsSync(codexDir)) {
    console.log("⚠️  Codex 目录不存在:", codexDir);
    return;
  }

  let Database;
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
    console.log("⚠️  better-sqlite3 不可用，跳过 Codex 扫描");
    return;
  }

  const dbFiles = readdirSync(codexDir)
    .filter((name) => /^state(?:_\d+)?\.sqlite$/.test(name))
    .map((name) => join(codexDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (dbFiles.length === 0) {
    console.log("⚠️  没有找到 Codex SQLite 数据库");
    return;
  }

  try {
    const sqlite = new Database(dbFiles[0], { readonly: true, fileMustExist: true });
    const rows = sqlite
      .prepare("SELECT model, tokens_used, updated_at FROM threads WHERE tokens_used > 0")
      .all();
    sqlite.close();

    let totalEntries = 0;
    for (const row of rows) {
      const date = toDateKey(normalizeToken(row.updated_at) * 1000);
      const model = row.model ?? "unknown";
      merge(date, "codex", model, 0, normalizeToken(row.tokens_used), 0, 0);
      totalEntries++;
    }
    console.log(`📂 Codex: 提取到 ${totalEntries} 条 usage 记录`);
  } catch (err) {
    console.log("⚠️  Codex 扫描失败:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Report to server
// ---------------------------------------------------------------------------

async function report() {
  console.log("\n🔍 开始扫描本机 usage 数据...\n");

  scanClaude();
  await scanCodex();

  const entries = [...aggMap.values()];
  console.log(`\n📊 聚合后共 ${entries.length} 条记录（按 date+provider+model）`);

  if (entries.length === 0) {
    console.log("没有数据需要上报");
    return;
  }

  // 分批上报（每批最多 200 条）
  const BATCH_SIZE = 200;
  let uploaded = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${SERVER_URL}/api/usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify({ entries: batch }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ 上报失败 (${res.status}):`, text);
      return;
    }

    uploaded += batch.length;
    console.log(`   ⬆️  已上报 ${uploaded}/${entries.length}`);
  }

  console.log(`\n✅ 全部上报完成！共 ${entries.length} 条记录 → ${SERVER_URL}`);
}

report().catch((err) => {
  console.error("❌ 上报失败:", err);
  process.exit(1);
});
