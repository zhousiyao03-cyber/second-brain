import { spawnSync, spawn as cpSpawn } from "node:child_process";
import {
  claimTask,
  configure,
  connectDaemonTaskNotifications,
  sendHeartbeat,
  setAuthToken,
} from "./api.mjs";
import { getDefaultBaseUrl, loadConfig } from "./config.mjs";
import { setClaudeBin } from "./spawn-claude.mjs";
import { handleChatTask } from "./handler-chat.mjs";
import { handleStructuredTask } from "./handler-structured.mjs";
import { ChatWorkerPool } from "./chat-worker-pool.mjs";
import { setChatWorkerClaudeBin } from "./chat-worker.mjs";
import { runUsageSync } from "./usage-reporter.mjs";
import {
  getDelayUntilNextDailyPing,
  getNextDailyPingAt,
} from "./daily-ping-scheduler.mjs";

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function checkClaude(claudeBinArg) {
  // Use spawnSync without a shell so we don't go through cmd.exe — on
  // Chinese-codepage Windows, cmd.exe's GBK output mangles when Node tries
  // to UTF-8 decode it, and the .cmd shim itself sometimes fails the round
  // trip for reasons unrelated to whether Claude is actually installed.
  // Reading stdout as a Buffer dodges the encoding question entirely; the
  // version string is ASCII (e.g. "2.1.76 (Claude Code)") so any encoding
  // would round-trip it.
  const result = spawnSync(claudeBinArg, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // shell: true would re-introduce the cmd.exe path; explicitly false.
    shell: false,
  });
  if (result.status === 0 && result.stdout) {
    const version = result.stdout.toString("utf8").trim() ||
      result.stdout.toString("latin1").trim() ||
      "(unknown version)";
    console.log(`✓ Claude CLI: ${version}`);
    return true;
  }
  console.error(`✗ Claude CLI not found at "${claudeBinArg}"`);
  if (result.error) {
    console.error(`  ${result.error.code ?? ""} ${result.error.message ?? ""}`.trim());
  }
  console.error("  Install: npm install -g @anthropic-ai/claude-code");
  console.error("  Or specify: --claude-bin /path/to/claude.exe");
  console.error("  On Windows, prefer the native .exe over the .cmd shim.");
  return false;
}

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDaemon(args) {
  const config = await loadConfig();
  const serverUrl = getArg(args, "--url") || config?.baseUrl || getDefaultBaseUrl();
  const isOnce = args.includes("--once");
  const claudeBinArg = getArg(args, "--claude-bin") || "claude";

  const CHAT_FALLBACK_MS = 30_000;
  const STRUCTURED_FALLBACK_MS = 15_000;
  const HEARTBEAT_MS = 60_000;
  const NOTIFICATION_RETRY_MS = 3_000;
  const USAGE_SYNC_MS = 5 * 60_000;
  const MAX_CONCURRENT_CHAT = 3;
  const MAX_CONCURRENT_STRUCTURED = 5;

  if (!config?.accessToken) {
    console.error("✗ Not authenticated. Run `knosi auth login` first.");
    process.exit(1);
  }

  configure(serverUrl);
  setAuthToken(config.accessToken);
  setClaudeBin(claudeBinArg);
  setChatWorkerClaudeBin(claudeBinArg);

  if (!checkClaude(claudeBinArg)) process.exit(1);

  const chatPool = new ChatWorkerPool({ idleTimeoutMs: 30 * 60 * 1000 });

  let chatRunning = 0;
  let structuredRunning = 0;
  let stopped = false;
  let notificationsAbortController = null;
  const wakeRequested = {
    chat: true,
    structured: true,
  };
  const draining = {
    chat: false,
    structured: false,
  };

  let authFailureLogged = false;
  function onPollError(err) {
    if (err?.message === "AUTH_FAILED") {
      if (!authFailureLogged) {
        console.error(`[${ts()}] ✗ Authentication failed. Run \`knosi auth login\` to re-authenticate.`);
        authFailureLogged = true;
      }
    }
  }

  function requestDrain(taskType) {
    wakeRequested[taskType] = true;
    void drainTaskType(taskType);
  }

  async function drainTaskType(taskType) {
    if (draining[taskType]) {
      wakeRequested[taskType] = true;
      return;
    }

    draining[taskType] = true;
    try {
      while (!stopped) {
        wakeRequested[taskType] = false;

        while (
          !stopped &&
          (taskType === "chat"
            ? chatRunning < MAX_CONCURRENT_CHAT
            : structuredRunning < MAX_CONCURRENT_STRUCTURED)
        ) {
          let task = null;
          try {
            task = await claimTask(taskType);
          } catch (err) {
            onPollError(err);
            return;
          }

          if (!task) break;
          authFailureLogged = false;

          if (taskType === "chat") {
            chatRunning++;
            handleChatTask(task, chatPool)
              .catch(() => {})
              .finally(() => {
                chatRunning--;
                requestDrain("chat");
              });
            continue;
          }

          structuredRunning++;
          handleStructuredTask(task)
            .catch(() => {})
            .finally(() => {
              structuredRunning--;
              requestDrain("structured");
            });
        }

        if (
          taskType === "chat"
            ? chatRunning >= MAX_CONCURRENT_CHAT
            : structuredRunning >= MAX_CONCURRENT_STRUCTURED
        ) {
          return;
        }

        if (!wakeRequested[taskType]) {
          return;
        }
      }
    } finally {
      draining[taskType] = false;
      if (wakeRequested[taskType] && !stopped) {
        void drainTaskType(taskType);
      }
    }
  }

  async function syncUsageOnce() {
    try {
      const { count } = await runUsageSync(serverUrl, config.accessToken);
      if (count > 0) {
        console.log(`[${ts()}] ✓ synced ${count} usage records`);
      }
    } catch (err) {
      if (err?.message === "AUTH_FAILED") {
        onPollError(err);
      } else {
        console.error(`[${ts()}] ✗ usage sync failed: ${err?.message ?? err}`);
      }
    }
  }

  async function runDailyPing() {
    console.log(`[${ts()}] 🌅 daily claude ping firing`);
    try {
      const child = cpSpawn(
        claudeBinArg,
        ["-p", "hello", "--output-format", "stream-json", "--verbose"],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
      );
      let outputText = "";
      child.stdout.on("data", (chunk) => {
        outputText += chunk.toString("utf8");
      });
      await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== 0) reject(new Error(`claude exited with code ${code}`));
          else resolve(undefined);
        });
      });
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
      console.log(`[${ts()}] ✓ daily claude ping ok: ${firstText.slice(0, 80) || "(no text)"}`);
    } catch (err) {
      console.error(`[${ts()}] ✗ daily claude ping failed: ${err?.message ?? err}`);
    }
  }

  function scheduleDailyPing() {
    if (stopped) return;
    const now = new Date();
    const nextAt = getNextDailyPingAt(now);
    const delayMs = getDelayUntilNextDailyPing(now);
    console.log(
      `[${ts()}] 🌅 next daily claude ping scheduled for ${nextAt.toLocaleString("en-GB", { hour12: false })}`
    );
    setTimeout(() => {
      runDailyPing()
        .catch(() => {})
        .finally(() => scheduleDailyPing());
    }, delayMs);
  }

  if (isOnce) {
    console.log("🔍 Single-run mode...");
    await drainTaskType("chat");
    await drainTaskType("structured");
    await syncUsageOnce();
    console.log("Done.");
    return;
  }

  console.log("");
  console.log("🚀 Knosi AI Daemon");
  console.log(`   Server: ${serverUrl}`);
  console.log(
    `   Claim fallback: chat=${CHAT_FALLBACK_MS / 1000}s structured=${STRUCTURED_FALLBACK_MS / 1000}s`
  );
  console.log(`   Usage sync interval: ${USAGE_SYNC_MS / 1000}s`);
  console.log(
    `   Max concurrent: chat=${MAX_CONCURRENT_CHAT} structured=${MAX_CONCURRENT_STRUCTURED}`
  );
  console.log("");
  console.log("   Waiting for tasks... (Ctrl+C to stop)");
  console.log("");

  async function runNotificationLoop() {
    while (!stopped) {
      notificationsAbortController = new AbortController();
      try {
        await connectDaemonTaskNotifications(
          { signal: notificationsAbortController.signal },
          (message) => {
            authFailureLogged = false;

            if (message.event === "snapshot") {
              const queuedTaskTypes = Array.isArray(message.data?.queuedTaskTypes)
                ? message.data.queuedTaskTypes
                : [];
              if (queuedTaskTypes.includes("chat")) {
                requestDrain("chat");
              }
              if (queuedTaskTypes.includes("structured")) {
                requestDrain("structured");
              }
              return;
            }

            if (
              message.event === "wake" &&
              (message.data?.taskType === "chat" || message.data?.taskType === "structured")
            ) {
              requestDrain(message.data.taskType);
            }
          }
        );
      } catch (err) {
        onPollError(err);
      }

      if (!stopped) {
        await sleep(NOTIFICATION_RETRY_MS);
      }
    }
  }

  await sendHeartbeat("daemon");
  void runNotificationLoop();
  setInterval(() => sendHeartbeat("daemon"), HEARTBEAT_MS);
  setInterval(() => requestDrain("chat"), CHAT_FALLBACK_MS);
  setInterval(() => requestDrain("structured"), STRUCTURED_FALLBACK_MS);
  setInterval(() => void syncUsageOnce(), USAGE_SYNC_MS);
  requestDrain("chat");
  requestDrain("structured");
  void syncUsageOnce();
  scheduleDailyPing();

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      stopped = true;
      notificationsAbortController?.abort();
      chatPool.shutdown();
      console.log(`\n[${ts()}] daemon stopped`);
      process.exit(0);
    });
  }
}
