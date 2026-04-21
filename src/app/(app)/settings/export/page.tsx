// src/app/(app)/settings/export/page.tsx
//
// Data export landing page — two buttons wired to /api/export.
//
// Per billing spec §8.4 this is available to every user on every plan with
// no gating. Keep the UI deliberately minimal so it's obvious the only thing
// that can happen here is a download.
export default function ExportPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Export your data</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Available on every plan. Download a full backup whenever you want.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/api/export?format=json"
          className="rounded-lg border px-4 py-2 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          Download JSON (all data)
        </a>
        <a
          href="/api/export?format=markdown"
          className="rounded-lg border px-4 py-2 font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          Download Markdown (notes only)
        </a>
      </div>
      <p className="mt-6 text-xs text-neutral-500">
        Your export includes notes, bookmarks, todos, portfolio holdings,
        learning notebook entries, open-source project notes, and focus
        sessions. Images are referenced by URL rather than embedded — hosted
        storage remains accessible while your account is active.
      </p>
    </div>
  );
}
