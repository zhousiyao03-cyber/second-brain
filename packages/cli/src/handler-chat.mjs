import {
  pushChatProgress,
  completeTask,
  getDaemonConversation,
  setDaemonConversation,
} from "./api.mjs";

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p && p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
}

function getLatestUserContent(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      return getMessageText(messages[i].content);
    }
  }
  return "";
}

/**
 * Flatten the full conversation into a single user-message string. Used as
 * the fallback when session resume failed or there is no prior session yet —
 * Claude needs to "see" the prior turns somehow on a fresh spawn.
 */
function flattenAllMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return "";
  const history = messages.slice(0, lastUserIdx);
  const lastUser = messages[lastUserIdx];
  const currentQuestion = getMessageText(lastUser.content).trim();
  if (history.length === 0) return currentQuestion;
  const historyBlock = history
    .map((m) => {
      const role = m.role === "user" ? "用户" : "助手";
      const t = getMessageText(m.content).trim();
      return t ? `**${role}：** ${t}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return `## 之前的对话历史\n\n${historyBlock}\n\n---\n\n## 当前问题\n\n${currentQuestion}`;
}

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function handleChatTask(task, pool) {
  console.log(`[${ts()}] 🗨️  chat: ${task.id} (${task.model})`);

  const userId = task.userId;
  const sourceScope = task.sourceScope || "all";
  // structuredFlag is not threaded through the chat queue today; kept as
  // false until the inline editor's Ask AI also routes through daemon mode.
  const structuredFlag = false;
  const workerKey = `${userId}|${sourceScope}|${structuredFlag ? "tip" : "plain"}`;

  let seq = 0;
  const pending = [];
  let flushTimer = null;
  async function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try {
      await pushChatProgress(task.id, batch);
    } catch {}
  }
  function onText(delta) {
    seq++;
    pending.push({ seq, type: "text_delta", delta });
    if (pending.length >= 8) flush();
    else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 150);
    }
  }

  // Look up any persisted session id for resume. Server failures are
  // non-fatal — we just spawn fresh in that case.
  let cliSessionId = null;
  try {
    const conv = await getDaemonConversation(workerKey);
    cliSessionId = conv.cliSessionId;
  } catch {}

  const onSessionId = (id) => {
    void setDaemonConversation(workerKey, id).catch(() => {});
  };

  async function runOnce(useResume) {
    const worker = pool.getOrCreate({
      userId,
      sourceScope,
      structuredFlag,
      systemPrompt: task.systemPrompt || "",
      model: task.model,
      cliSessionId: useResume ? cliSessionId : null,
      onSessionId,
    });
    // With resume, claude has prior context → only send the latest user turn.
    // Without resume (first ever, or after a stale-session miss), claude has
    // no history → flatten everything into one user message as a fallback.
    const userMessageContent = useResume
      ? getLatestUserContent(task.messages)
      : flattenAllMessages(task.messages);
    if (!userMessageContent) {
      throw new Error("Empty user message from chat task");
    }
    return worker.enqueue({ userMessageContent, onText });
  }

  try {
    let result;
    try {
      result = await runOnce(Boolean(cliSessionId));
    } catch (err) {
      // If we tried to resume and the CLI rejected the session, fall back
      // to a fresh spawn with full history. The detection here is the
      // generous "anything mentioning session/conversation in the error"
      // form — the worker also sets resumeMissed() but the worker has been
      // killed by now and we don't have a handle to it.
      if (cliSessionId && /session|conversation/i.test(err.message ?? "")) {
        try {
          await setDaemonConversation(workerKey, null);
        } catch {}
        cliSessionId = null;
        result = await runOnce(false);
      } else {
        throw err;
      }
    }

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flush();

    await completeTask(task.id, { totalText: result.totalText });
    console.log(`[${ts()}] ✅ chat done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ chat failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
