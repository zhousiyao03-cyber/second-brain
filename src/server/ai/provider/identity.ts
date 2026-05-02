import { resolveAiCall } from "./resolve";
import { MissingAiRoleError } from "./types";

export function getAIErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof MissingAiRoleError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function getAISetupHint(userId: string): Promise<string> {
  try {
    const p = await resolveAiCall("chat", userId);
    if (p.kind === "claude-code-daemon") {
      return "请确认本机 Claude CLI 已登录（claude login），并启动 Ask AI daemon 队列。";
    }
    if (p.kind === "openai-compatible" || p.kind === "local") {
      return `当前 Chat 路由到 "${p.label}" (${p.baseURL})，模型 ${p.modelId}。请检查 base URL / API key / 模型 id 是否有效。`;
    }
    return "Embedding-only kind 不能用于 Chat — 请到 Settings 重新分配。";
  } catch (e) {
    if (e instanceof MissingAiRoleError) {
      return "尚未在 Settings 中为 Chat 分配 Provider 与 Model。";
    }
    throw e;
  }
}

export async function getChatAssistantIdentity(userId: string): Promise<string> {
  try {
    const p = await resolveAiCall("chat", userId);
    return `你是 Second Brain 的 AI 助手，当前运行在 ${p.label}（${p.modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明当前模型。`;
  } catch {
    return "你是 Second Brain 的 AI 助手。";
  }
}
