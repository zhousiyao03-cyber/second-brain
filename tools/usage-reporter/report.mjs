#!/usr/bin/env node

/**
 * Usage Daemon — 扫描本机 Claude Code / Codex 日志，自动同步到线上 Second Brain
 *
 * 用法：
 *   pnpm usage:daemon                          # 常驻后台，每 5 分钟自动同步
 *   pnpm usage:report                          # 单次同步
 *
 * 环境变量（可选）：
 *   SECOND_BRAIN_URL — 线上地址（默认 https://www.knosi.xyz）
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { execSync, spawn as cpSpawn } from "child_process";
import { homedir, tmpdir } from "os";
import { join } from "path";
import {
  getDelayUntilNextDailyPing,
  getNextDailyPingAt,
} from "./daily-ping-scheduler.mjs";

const SERVER_URL = process.env.SECOND_BRAIN_URL || "https://www.knosi.xyz";
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const IS_ONCE = process.argv.includes("--once");

const ANALYSIS_POLL_INTERVAL_MS = 60 * 1000; // 60 seconds — Hobby plan invocation budget
const MAX_CONCURRENT_ANALYSIS = 5;
let analysisRunning = 0;

const ANALYSIS_BASE_DIR = join(tmpdir(), "source-readings");
const ANALYSIS_PROVIDER = process.env.ANALYSIS_PROVIDER || "claude"; // "claude" | "codex"

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
// Analysis — Helpers
// ---------------------------------------------------------------------------

function repoSlug(repoUrl) {
  try {
    const url = new URL(repoUrl);
    return url.pathname
      .replace(/^\//, "")
      .replace(/\//g, "__")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
  } catch {
    return repoUrl.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  }
}

/**
 * Clone (or update) a repo into the analysis cache and return:
 *   { dir, commitSha, commitDate }
 *
 * If the destination already exists, we fetch + hard-reset to the remote HEAD
 * so re-analysis always sees the latest code rather than a stale snapshot.
 */
function cloneRepo(repoUrl) {
  const dest = join(ANALYSIS_BASE_DIR, repoSlug(repoUrl));
  if (!existsSync(dest)) {
    execSync(`mkdir -p "${ANALYSIS_BASE_DIR}"`);
    execSync(`git clone --depth=1 "${repoUrl}" "${dest}"`, {
      timeout: 180_000,
      stdio: "pipe",
    });
  } else {
    // Update to latest. --depth=1 keeps it cheap; we discard local changes.
    try {
      execSync(`git -C "${dest}" fetch --depth=1 origin`, {
        timeout: 120_000,
        stdio: "pipe",
      });
      execSync(`git -C "${dest}" reset --hard FETCH_HEAD`, { stdio: "pipe" });
    } catch {
      // If fetch/reset fails (network, deleted branch, etc.) we keep the
      // existing checkout and continue — better stale than no analysis.
    }
  }

  // Capture the exact commit we're about to analyse
  let commitSha = "";
  let commitDate = "";
  try {
    commitSha = execSync(`git -C "${dest}" rev-parse HEAD`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    commitDate = execSync(`git -C "${dest}" log -1 --format=%cI`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Not a fatal error — we'll just analyse without a commit stamp
  }

  return { dir: dest, commitSha, commitDate };
}

function getToolSummary(tool, input) {
  if (!input) return tool;
  if (tool === "Read" || tool === "Edit" || tool === "Write") {
    const fp = input.file_path || input.path || "";
    const parts = fp.split("/");
    return parts.slice(-3).join("/");
  }
  if (tool === "Grep") {
    const pattern = input.pattern || "";
    const path = input.path || "";
    const shortPath = path.split("/").slice(-2).join("/");
    return `"${pattern.slice(0, 60)}" in ${shortPath || "."}`;
  }
  if (tool === "Glob") return input.pattern || tool;
  if (tool === "Bash") return input.description || (input.command || "").slice(0, 80);
  return tool;
}

function spawnAgent(prompt, cwd, onMessage, provider) {
  if (provider === "codex") {
    return spawnCodex(prompt, cwd, onMessage);
  }
  return spawnClaudeCli(prompt, cwd, onMessage);
}

function spawnClaudeCli(prompt, cwd, onMessage) {
  return new Promise((resolve, reject) => {
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const child = cpSpawn(
      claudeBin,
      ["-p", prompt, "--allowedTools", "Read,Grep,Glob,Bash", "--output-format", "stream-json", "--verbose"],
      { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    const stderrChunks = [];
    let finalResult = "";
    let lineBuf = "";

    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "tool_use") {
                onMessage({
                  type: "tool_use",
                  tool: block.name,
                  summary: getToolSummary(block.name, block.input),
                });
              } else if (block.type === "text" && block.text) {
                onMessage({
                  type: "text",
                  summary: block.text.slice(0, 120),
                });
              }
            }
          }

          if (event.type === "result" && event.result) {
            finalResult = event.result;
          }
        } catch {
          // skip unparseable lines
        }
      }
    });

    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`claude exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve(finalResult);
    });
  });
}

function spawnCodex(prompt, cwd, onMessage) {
  return new Promise((resolve, reject) => {
    const codexBin = process.env.CODEX_BIN || "codex";
    const child = cpSpawn(
      codexBin,
      ["exec", "--json", "-s", "read-only", "-C", cwd, prompt],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    const stderrChunks = [];
    let lastAgentMessage = "";
    let lineBuf = "";

    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString("utf8");
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === "item.completed" && event.item) {
            if (event.item.type === "command_execution") {
              const cmd = event.item.command || "";
              // Extract the actual command from "/bin/zsh -lc ..."
              const match = cmd.match(/"(.+)"/);
              onMessage({
                type: "tool_use",
                tool: "Bash",
                summary: (match ? match[1] : cmd).slice(0, 80),
              });
            } else if (event.item.type === "agent_message" && event.item.text) {
              lastAgentMessage = event.item.text;
              onMessage({
                type: "text",
                summary: event.item.text.slice(0, 120),
              });
            }
          }
        } catch {
          // skip unparseable lines
        }
      }
    });

    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        reject(new Error(`codex exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      resolve(lastAgentMessage);
    });
  });
}

// ---------------------------------------------------------------------------
// Analysis — Prompts
// ---------------------------------------------------------------------------

function buildAnalysisPrompt(repoUrl) {
  return `对本目录中的开源项目（${repoUrl}）进行系统性源码阅读，产出一篇结构化的学习笔记。

## 阅读流程

按以下顺序逐层深入：

### 第一层：项目全貌
1. 读 README、CONTRIBUTING、ARCHITECTURE（如有）
2. 读依赖清单，识别核心依赖和技术选型
3. 画出顶层目录树（2-3 层深度），标注每个目录的职责
4. 回答：这个项目解决什么问题？面向谁？核心入口在哪？

### 第二层：架构与数据流
1. 找到程序入口，追踪启动流程
2. 识别核心抽象（关键 interface / trait / class / type），画出依赖关系
3. 追踪一个最典型的用户操作，完整走通数据流
4. 识别分层策略：哪些是对外 API、哪些是内部模块
5. 回答：架构上最重要的设计决策是什么？

### 第三层：核心模块深挖
针对 2-3 个最核心的模块：
1. 逐文件阅读，理解内部实现
2. 标注巧妙的设计模式、性能优化手法、错误处理策略
3. 分析 trade-off：为什么这样写而不是更简单的写法
4. 识别防御性编程、边界处理、并发控制等细节

### 第四层：测试与工程化
1. 测试策略：单元 / 集成 / E2E 比例
2. CI/CD 和发布流程
3. 代码质量工具和规范

## 输出格式

输出一篇 Markdown 文章，结构如下：

# [项目名] 源码阅读笔记

## 一句话总结
> 用一句话概括这个项目的本质

## 项目画像
- 解决的问题：
- 目标用户：
- 技术栈：
- 仓库规模：约 X 文件 / X 行代码

## 架构概览
（附目录结构图 + 核心模块关系图，用 mermaid）

## 核心数据流
（追踪一个典型操作的完整路径，附代码引用）

## 难点与亮点

### 难点 1：[标题]
- 问题是什么
- 他们怎么解决的
- 关键代码位置

### 亮点 1：[标题]
- 这个设计好在哪
- 对比常规做法的优势

（难点和亮点各列 3-5 个）

## 设计决策清单
| 决策 | 选择 | 备选方案 | 为什么选这个 |
|------|------|----------|-------------|

## 值得偷师的模式
（可迁移的具体 pattern，附代码片段）

## 疑问
（没想通的点，留待研究）

## 阅读原则
- 每个结论附带具体文件路径和行号
- 重 Why 轻 What
- 没看懂的标注为疑问，不编造`;
}

function buildFollowupPrompt(originalAnalysis, question) {
  return `你之前对这个项目生成了以下源码分析文章：

---
${originalAnalysis}
---

用户的追问：${question}

请基于项目源码回答这个问题。直接阅读源码文件来给出准确回答，附带具体文件路径和行号。输出 Markdown 格式。`;
}

// ---------------------------------------------------------------------------
// Analysis — Task handler
// ---------------------------------------------------------------------------

async function handleAnalysisTask(task) {
  console.log(`[${timestamp()}] 🔬 开始分析: ${task.repoUrl} (${task.taskType}, ${task.provider || "claude"})`);

  try {
    const { dir: repoDir, commitSha, commitDate } = cloneRepo(task.repoUrl);
    const commitShort = commitSha ? commitSha.slice(0, 7) : "unknown";

    // The server pre-renders the prompt template with REPO_URL filled and
    // ships it inside `task.promptTemplate`. We just substitute the commit
    // placeholders that weren't known until after `git clone`.
    // Fall back to the legacy local builders if the server is too old to
    // send promptTemplate (defensive — shouldn't happen after this rollout).
    let prompt = task.promptTemplate;
    if (prompt) {
      prompt = prompt
        .replace(/\{\{COMMIT_SHA\}\}/g, commitSha || "unknown")
        .replace(/\{\{COMMIT_SHORT\}\}/g, commitShort)
        .replace(/\{\{COMMIT_DATE\}\}/g, commitDate || "unknown");
    } else {
      prompt =
        task.taskType === "analysis"
          ? buildAnalysisPrompt(task.repoUrl)
          : buildFollowupPrompt(task.originalAnalysis || "", task.question || "");
    }

    // Collect messages and flush periodically
    let seq = 0;
    const pendingMessages = [];
    let flushTimer = null;

    async function flushMessages() {
      if (pendingMessages.length === 0) return;
      const batch = pendingMessages.splice(0);
      try {
        await fetch(`${SERVER_URL}/api/analysis/progress`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id, messages: batch }),
        });
      } catch {
        // skip — non-critical
      }
    }

    function onMessage(msg) {
      seq++;
      pendingMessages.push({ seq, ...msg });
      // Flush every 5 messages or schedule a timer
      if (pendingMessages.length >= 5) {
        flushMessages();
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushMessages();
        }, 2000);
      }
    }

    const provider = task.provider || ANALYSIS_PROVIDER;
    const result = await spawnAgent(prompt, repoDir, onMessage, provider);

    // Final flush
    if (flushTimer) clearTimeout(flushTimer);
    await flushMessages();

    // Report success — include commit snapshot so the server can stamp the
    // project with exactly which version of the repo was analysed.
    const res = await fetch(`${SERVER_URL}/api/analysis/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        result,
        commitSha: commitSha || undefined,
        commitDate: commitDate || undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Complete API returned ${res.status}: ${await res.text()}`);
    }

    console.log(`[${timestamp()}] ✅ 分析完成: ${task.repoUrl}`);
  } catch (err) {
    console.error(`[${timestamp()}] ❌ 分析失败: ${task.repoUrl}`, err.message);

    await fetch(`${SERVER_URL}/api/analysis/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, error: err.message }),
    }).catch(() => {});
  } finally {
    analysisRunning--;
  }
}

// ---------------------------------------------------------------------------
// Analysis — Poll loop
// ---------------------------------------------------------------------------

async function pollAnalysisTasks() {
  if (analysisRunning >= MAX_CONCURRENT_ANALYSIS) return;

  try {
    const res = await fetch(`${SERVER_URL}/api/analysis/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.task) return;

    analysisRunning++;
    // Fire and forget — don't block the poll loop
    handleAnalysisTask(data.task).catch(() => {});
  } catch {
    // Silently skip — server may be unreachable
  }
}

// ---------------------------------------------------------------------------
// Daily Claude ping — keeps local Claude CLI warm / sanity-check at 05:59 local
// ---------------------------------------------------------------------------

async function runDailyPing() {
  console.log(`[${timestamp()}] 🌅 daily claude ping firing`);

  try {
    const claudeBin = process.env.CLAUDE_BIN || "claude";
    const child = cpSpawn(
      claudeBin,
      ["-p", "hello", "--output-format", "stream-json", "--verbose"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let outputText = "";
    child.stdout.on("data", (chunk) => {
      outputText += chunk.toString("utf8");
    });

    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited with code ${code}`));
        } else {
          resolve(undefined);
        }
      });
    });

    // Extract the assistant text for a friendly log line
    let firstText = "";
    for (const line of outputText.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "text" && typeof block.text === "string") {
              firstText = block.text;
              break;
            }
          }
        }
        if (firstText) break;
      } catch {}
    }

    console.log(
      `[${timestamp()}] ✅ daily claude ping ok: ${firstText.slice(0, 80) || "(no text)"}`
    );
  } catch (err) {
    console.error(`[${timestamp()}] ❌ daily claude ping failed:`, err.message);
    // Intentionally accept one miss for this day's scheduled slot.
  }
}

function scheduleDailyPing() {
  const now = new Date();
  const nextAt = getNextDailyPingAt(now);
  const delayMs = getDelayUntilNextDailyPing(now);

  console.log(
    `[${timestamp()}] 🌅 next daily claude ping scheduled for ${nextAt.toLocaleString("en-GB", {
      hour12: false,
    })} (local)`
  );

  setTimeout(() => {
    runDailyPing()
      .catch(() => {})
      .finally(() => {
        scheduleDailyPing();
      });
  }, delayMs);
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
  console.log(`   分析任务轮询间隔: ${ANALYSIS_POLL_INTERVAL_MS / 1000}s`);
  console.log(`   分析 Provider: ${ANALYSIS_PROVIDER}`);
  console.log("");

  // Initial sync
  await syncOnce().catch((err) => console.error(`[${timestamp()}] ❌`, err.message));

  // Recurring sync
  setInterval(async () => {
    await syncOnce().catch((err) => console.error(`[${timestamp()}] ❌`, err.message));
  }, SCAN_INTERVAL_MS);

  // Analysis task polling
  setInterval(async () => {
    await pollAnalysisTasks();
  }, ANALYSIS_POLL_INTERVAL_MS);

  // Daily claude ping — fires at the next 05:59 local slot, then reschedules itself
  scheduleDailyPing();

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n[${timestamp()}] daemon 退出`);
      try { unlinkSync(pidFile); } catch {}
      process.exit(0);
    });
  }
}
