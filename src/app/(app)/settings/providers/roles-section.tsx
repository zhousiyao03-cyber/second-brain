"use client";

import { trpc } from "@/lib/trpc";
import { RoleRow } from "./role-row";

const DESCRIPTIONS: Record<"chat" | "task" | "embedding", string> = {
  chat: "Used by Ask AI, Council, Drifter",
  task: "Used by tag/summary/structured generation",
  embedding: "Used by RAG indexing",
};

export function RolesSection() {
  const { data: providers } = trpc.aiSettings.listProviders.useQuery();
  const { data: roles } = trpc.aiSettings.getRoleAssignments.useQuery();
  if (!providers || !roles)
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
        <div className="text-sm text-stone-500">Loading…</div>
      </section>
    );
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">AI Roles</h2>
        <p className="text-sm text-stone-500">
          Pick a provider + model for each role. Add providers above first.
        </p>
      </div>
      <div className="space-y-3">
        {(["chat", "task", "embedding"] as const).map((role) => (
          <RoleRow
            key={role}
            role={role}
            providers={providers}
            current={roles[role]}
            description={DESCRIPTIONS[role]}
          />
        ))}
      </div>
    </section>
  );
}
