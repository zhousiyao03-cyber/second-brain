# 2026-04-09 — Share links for notes and project notes

## Date

- 2026-04-09

## Task / Goal

- Keep regular `Notes` shareable.
- Make single `Project` notes shareable too.
- Ensure shared links open as public read-only pages without requiring login.

## Key Changes

- Allowed `/share/*` to bypass the global auth proxy redirect so public share pages no longer bounce to `/login`.
- Reworked regular note share rendering to fetch shared note data server-side, avoiding client-side auth-gated data fetching for public viewers.
- Added project-note sharing support instead of project-level sharing:
  - `os_project_notes.share_token`
  - `os_project_notes.shared_at`
  - protected `enableNoteShare` / `disableNoteShare` mutations in `ossProjects`
  - share button + copy-link popover on the single project note editor page
  - new public project-note share page at `/share/project-note/[token]`
- Removed the mistaken whole-project share implementation and kept sharing scoped to individual notes only.
- Added a server-side share data helper for both regular notes and project notes.
- Added auth-flow Playwright coverage for:
  - regular note share links opening without login
  - project-note share links opening without login
- Removed the nested-button hydration warning in the project note list while touching the project pages.

## Files Touched

- `src/proxy.ts`
- `src/server/db/schema.ts`
- `src/server/routers/oss-projects.ts`
- `src/server/shares.ts`
- `src/app/share/[token]/page.tsx`
- `src/app/share/project-note/[token]/page.tsx`
- `src/components/share/shared-note-view.tsx`
- `src/components/share/shared-project-note-view.tsx`
- `src/app/(app)/projects/[id]/page.tsx`
- `src/app/(app)/projects/[id]/notes/[noteId]/page.tsx`
- `e2e/share-links.spec.ts`
- `drizzle/0021_curly_orphan.sql`
- `drizzle/meta/0021_snapshot.json`
- `drizzle/meta/_journal.json`
- `README.md`
- `README.zh-CN.md`
- `docs/changelog/2026-04-09-share-links-for-notes-and-project-notes.md`

## Verification Commands And Results

- `pnpm exec playwright test e2e/share-links.spec.ts --config=playwright.auth.config.ts --reporter=line`
  - Passed: `2 passed`
- `pnpm exec playwright test e2e/oss-projects.spec.ts --reporter=line`
  - Passed: `3 passed`
- `pnpm exec eslint 'src/proxy.ts' 'src/server/db/schema.ts' 'src/server/routers/oss-projects.ts' 'src/server/shares.ts' 'src/app/share/[token]/page.tsx' 'src/app/share/project-note/[token]/page.tsx' 'src/components/share/shared-note-view.tsx' 'src/components/share/shared-project-note-view.tsx' 'src/app/(app)/projects/[id]/page.tsx' 'src/app/(app)/projects/[id]/notes/[noteId]/page.tsx' 'e2e/share-links.spec.ts'`
  - Passed
- `pnpm build`
  - Passed
- `pnpm db:generate`
  - Passed, regenerated the final `0021` migration for project-note sharing
- `SQLITE_DB_PATH=data/second-brain.db TURSO_DATABASE_URL=file:data/second-brain.db pnpm db:push`
  - Passed, local schema changes applied
- `node --input-type=module -e "import { createClient } from '@libsql/client'; const db=createClient({url:'file:data/second-brain.db'}); const projectNoteCols=await db.execute('PRAGMA table_info(os_project_notes)'); const projectCols=await db.execute('PRAGMA table_info(os_projects)'); console.log(JSON.stringify({ os_project_notes: projectNoteCols.rows.filter(r => r.name === 'share_token' || r.name === 'shared_at'), os_projects: projectCols.rows.filter(r => r.name === 'share_token' || r.name === 'shared_at') }, null, 2)); db.close();"`
  - Passed, confirmed `share_token` and `shared_at` exist on local `os_project_notes`, and no longer exist on local `os_projects`
- `set -a && source .env.turso-prod.local && set +a && node --input-type=module - <<'EOF' ... PRAGMA table_info(os_project_notes) / PRAGMA table_info(os_projects) / sqlite_master share index check ... EOF`
  - Passed, confirmed production `os_project_notes` initially had no `share_token` / `shared_at`, production `os_projects` had no share columns, and no share index existed yet
- `set -a && source .env.turso-prod.local && set +a && node --input-type=module - <<'EOF' ... ALTER TABLE os_project_notes ADD COLUMN share_token text; ALTER TABLE os_project_notes ADD COLUMN shared_at integer; CREATE UNIQUE INDEX os_project_notes_share_token_unique ON os_project_notes (share_token); ... EOF`
  - Passed, production Turso rollout applied successfully:
    - `ALTER TABLE os_project_notes ADD COLUMN share_token text`
    - `ALTER TABLE os_project_notes ADD COLUMN shared_at integer`
    - `CREATE UNIQUE INDEX os_project_notes_share_token_unique ON os_project_notes (share_token)`
- `set -a && source .env.turso-prod.local && set +a && node --input-type=module - <<'EOF' ... PRAGMA table_info(os_project_notes) / sqlite_master index check / SELECT id, project_id, title, share_token, shared_at FROM os_project_notes ORDER BY updated_at DESC LIMIT 1 ... EOF`
  - Passed, confirmed production `os_project_notes` now contains `share_token` and `shared_at`, `os_projects` still has no share columns, `os_project_notes_share_token_unique` exists, and a real `SELECT ... share_token, shared_at ...` query returns successfully
- `pnpm lint`
  - Failed due pre-existing unrelated repo issues in:
    - `src/components/editor/knowledge-note-editor.tsx`
    - `src/components/editor/mermaid-block.tsx`
    - `src/components/editor/search-replace.tsx`
    - `src/components/editor/toc-block.tsx`
    - `src/components/editor/toc-sidebar.tsx`
  - Plus existing warnings in:
    - `e2e/editor.spec.ts`
    - `src/components/editor/excalidraw-block.tsx`
    - `src/components/editor/image-row-block.tsx`
    - `src/components/editor/slash-command.tsx`

## Remaining Risks Or Follow-up Items

- Existing repository-wide lint blockers remain outside the scope of this share-link task.
