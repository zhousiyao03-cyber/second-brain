#!/usr/bin/env node
/**
 * @knosi/cli — Local Claude Code daemon for Second Brain
 *
 * Usage:
 *   npx @knosi/cli --url https://your-instance.vercel.app
 *   npx @knosi/cli --once
 */
import { execSync } from "node:child_process";
import { configure, claimTask, sendHeartbeat } from "./api.mjs";
import { setClaudeBin } from "./spawn-claude.mjs";
import { handleChatTask } from "./handler-chat.mjs";
import { handleStructuredTask } from "./handler-structured.mjs";

// ── Parse args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const serverUrl = getArg("--url") || "https://www.knosi.xyz";
const isOnce = args.includes("--once");
const claudeBinArg = getArg("--claude-bin") || "claude";

const CHAT_POLL_MS = 2_000;
const STRUCTURED_POLL_MS = 1_000;
const HEARTBEAT_MS = 120_000;
const MAX_CONCURRENT_CHAT = 3;
const MAX_CONCURRENT_STRUCTURED = 5;

// ── Preflight ───────────────────────────────────────────────────────────
function checkClaude() {
  try {
    const version = execSync(`${claudeBinArg} --version`, { encoding: "utf8" }).trim();
    console.log(`✓ Claude CLI: ${version}`);
    return true;
  } catch {
    console.error(`✗ Claude CLI not found at "${claudeBinArg}"`);
    console.error("  Install: npm install -g @anthropic-ai/claude-code");
    console.error("  Or specify: --claude-bin /path/to/claude");
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────
configure(serverUrl);
setClaudeBin(claudeBinArg);

if (!checkClaude()) process.exit(1);

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

let chatRunning = 0;
let structuredRunning = 0;

async function pollChat() {
  if (chatRunning >= MAX_CONCURRENT_CHAT) return;
  try {
    const task = await claimTask("chat");
    if (!task) return;
    chatRunning++;
    handleChatTask(task)
      .catch(() => {})
      .finally(() => { chatRunning--; });
  } catch {
    // server unreachable
  }
}

async function pollStructured() {
  if (structuredRunning >= MAX_CONCURRENT_STRUCTURED) return;
  try {
    const task = await claimTask("structured");
    if (!task) return;
    structuredRunning++;
    handleStructuredTask(task)
      .catch(() => {})
      .finally(() => { structuredRunning--; });
  } catch {
    // server unreachable
  }
}

if (isOnce) {
  console.log("🔍 Single-run mode...");
  await pollChat();
  await pollStructured();
  console.log("Done.");
} else {
  console.log("");
  console.log("🚀 Knosi AI Daemon");
  console.log(`   Server: ${serverUrl}`);
  console.log(`   Chat poll: ${CHAT_POLL_MS / 1000}s | Structured poll: ${STRUCTURED_POLL_MS / 1000}s`);
  console.log(`   Max concurrent: chat=${MAX_CONCURRENT_CHAT} structured=${MAX_CONCURRENT_STRUCTURED}`);
  console.log("");
  console.log("   Waiting for tasks... (Ctrl+C to stop)");
  console.log("");

  // Heartbeat
  await sendHeartbeat("daemon");
  setInterval(() => sendHeartbeat("daemon"), HEARTBEAT_MS);

  // Poll loops
  setInterval(pollChat, CHAT_POLL_MS);
  setInterval(pollStructured, STRUCTURED_POLL_MS);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`\n[${ts()}] daemon stopped`);
      process.exit(0);
    });
  }
}
