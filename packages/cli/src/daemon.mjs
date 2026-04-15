import { execSync } from "node:child_process";
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

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function checkClaude(claudeBinArg) {
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
  const MAX_CONCURRENT_CHAT = 3;
  const MAX_CONCURRENT_STRUCTURED = 5;

  if (!config?.accessToken) {
    console.error("✗ Not authenticated. Run `knosi auth login` first.");
    process.exit(1);
  }

  configure(serverUrl);
  setAuthToken(config.accessToken);
  setClaudeBin(claudeBinArg);

  if (!checkClaude(claudeBinArg)) process.exit(1);

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
            handleChatTask(task)
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

  if (isOnce) {
    console.log("🔍 Single-run mode...");
    await drainTaskType("chat");
    await drainTaskType("structured");
    console.log("Done.");
    return;
  }

  console.log("");
  console.log("🚀 Knosi AI Daemon");
  console.log(`   Server: ${serverUrl}`);
  console.log(
    `   Claim fallback: chat=${CHAT_FALLBACK_MS / 1000}s structured=${STRUCTURED_FALLBACK_MS / 1000}s`
  );
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
  requestDrain("chat");
  requestDrain("structured");

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      stopped = true;
      notificationsAbortController?.abort();
      console.log(`\n[${ts()}] daemon stopped`);
      process.exit(0);
    });
  }
}
