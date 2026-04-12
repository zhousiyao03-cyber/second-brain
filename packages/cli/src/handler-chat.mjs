import { pushChatProgress, completeTask } from "./api.mjs";
import { spawnClaudeForChat } from "./spawn-claude.mjs";

function getMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function flattenMessagesToPrompt(messages) {
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
      const text = getMessageText(m.content).trim();
      return text ? `**${role}：** ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return `## 之前的对话历史\n\n${historyBlock}\n\n---\n\n## 当前问题\n\n${currentQuestion}`;
}

function ts() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export async function handleChatTask(task) {
  console.log(`[${ts()}] 🗨️  chat: ${task.id} (${task.model})`);

  let seq = 0;
  const pending = [];
  let flushTimer = null;

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try {
      await pushChatProgress(task.id, batch);
    } catch {
      // non-critical
    }
  }

  function onText(delta) {
    seq++;
    pending.push({ seq, type: "text_delta", delta });
    if (pending.length >= 8) {
      flush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, 150);
    }
  }

  try {
    const prompt = flattenMessagesToPrompt(task.messages);
    if (!prompt) throw new Error("Empty prompt from chat task messages");

    const totalText = await spawnClaudeForChat({
      prompt,
      systemPrompt: task.systemPrompt || "",
      model: task.model,
      onText,
    });

    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    await flush();

    await completeTask(task.id, { totalText });
    console.log(`[${ts()}] ✅ chat done: ${task.id}`);
  } catch (err) {
    console.error(`[${ts()}] ❌ chat failed: ${task.id}`, err.message);
    await completeTask(task.id, { error: err.message }).catch(() => {});
  }
}
