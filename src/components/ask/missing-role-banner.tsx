"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

/**
 * Renders a yellow banner above the chat input when the user has not yet
 * assigned a provider+model to the `chat` role. The /api/chat handler
 * returns 412 MISSING_AI_ROLE in that case, so without this banner the
 * UX would just look "broken" until the user opens Settings.
 */
export function MissingChatRoleBanner() {
  const { data: roles, isLoading } =
    trpc.aiSettings.getRoleAssignments.useQuery();

  if (isLoading) return null;
  if (roles?.chat) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">AI is not configured yet</p>
      <p className="mt-1.5 text-amber-700 dark:text-amber-300">
        Pick a Chat provider and model in{" "}
        <Link
          href="/settings"
          className="font-medium underline underline-offset-2"
        >
          Settings
        </Link>{" "}
        before sending a message. You can use OpenAI, DeepSeek, any
        OpenAI-compatible API, a local Ollama / LM Studio server, or the
        Claude Code daemon.
      </p>
    </div>
  );
}
