"use client";

// Phase 4.10 stub: this section used legacy billing.* AI procedures that
// are now removed. Phase 7.x replaces it with the new <ProvidersSection>
// + <RolesSection> two-card layout backed by ai_providers + ai_role_assignments.
export function AiProviderSection() {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-2">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          AI Provider
        </h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          New providers + roles configuration is rolling out. The old
          single-provider picker has been removed; the rewritten Settings
          UI lands in Phase 7 of the model-provider refactor.
        </p>
      </div>
    </section>
  );
}
