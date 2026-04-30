# 2026-04-30 — Learning Module Migration & Card Authoring

## Goal

Turn the dormant learning module into the home for study material (interview prep, theory analyses) so it can be reviewed by topic, view count, and three-tier mastery. Concurrently make the bagu skill (and any future MCP-driven content producers) write directly into learning instead of into notes.

## Architecture

Schema delta on `learning_notes`: three new columns (`view_count`, `mastery`, `last_viewed_at`) and a semantic upgrade of `content` from plain text to Tiptap JSON. `learning_topics` and `learning_reviews` untouched. Notes table unchanged.

Router lives at `src/server/routers/learning-notebook.ts` (now wired into `appRouter`, previously orphaned). Procedures added: `incrementView`, `updateMastery`. `listTopics` augmented with `masteredCount` + `lastReviewedAt` aggregates. `listNotes` augmented with `sort` and `filter` params.

MCP tool `create_learning_card` registered alongside `create_note`. Backed by a new `src/server/integrations/learning-card.ts` integration helper that get-or-creates a topic by name, runs `markdownToTiptap` (already in `src/lib`), and inserts a fresh card. Designed to replace the bagu skill's current `create_note` call.

Migration script `scripts/migrate-notes-to-learning.ts` does one-shot relocation. Reads a JSON config (`{ userId, topics: [{ topicName, source: { kind, ... } }], deleteSourceNotes }`), supports `kind: folder | noteIds | tag` for picking source notes, dry-runs by default, requires `--apply` and a same-day Turso dump (`backups/turso-YYYY-MM-DD.sql`) before writing prod. Hard-deletes source notes when `deleteSourceNotes` is true (no soft-delete column on notes; backup file is the safety net).

UI: four new routes under `/learn` — home grid, topic detail, card detail, new card form. Tiptap editor reused in `editable: false` for the read view and `editable: true` for the edit/create flow. View count increments on mount with a 5-minute sessionStorage debounce so reloads don't inflate the counter. Three-tier mastery uses an optimistic mutation with rollback on error. Sidebar nav updated to surface "Learning".

## Files touched

### New
- `docs/superpowers/specs/2026-04-30-learning-migration-design.md`
- `drizzle/0040_marvelous_stepford_cuckoos.sql`
- `drizzle/meta/0040_snapshot.json`
- `scripts/migrate-notes-to-learning.ts`
- `src/server/integrations/learning-card.ts`
- `src/app/(app)/learn/[topicId]/page.tsx`
- `src/app/(app)/learn/[topicId]/[noteId]/page.tsx`
- `src/app/(app)/learn/[topicId]/new/page.tsx`
- `src/components/learn/learn-home-client.tsx`
- `src/components/learn/learn-topic-client.tsx`
- `src/components/learn/learn-note-client.tsx`
- `src/components/learn/learn-new-note-client.tsx`

### Modified
- `.gitignore` — exclude `scripts/migrate-config*.json` and `backups/`
- `drizzle/meta/_journal.json`
- `e2e/learning-notebook.spec.ts` — replaced placeholder spec with real coverage
- `src/app/(app)/learn/page.tsx` — was redirect to /notes, now home page
- `src/components/layout/navigation.ts` — add "Learning" entry
- `src/server/db/schema/learning.ts` — three new columns on learning_notes
- `src/server/integrations/mcp-tools.ts` — register `create_learning_card`
- `src/server/routers/_app.ts` — wire `learningNotebookRouter` into appRouter
- `src/server/routers/learning-notebook.ts` — `listTopics` aggregates, `listNotes` sort/filter, new procedures

## Verification

- `pnpm build` — pass; TypeScript clean; `/learn`, `/learn/[topicId]`, `/learn/[topicId]/[noteId]`, `/learn/[topicId]/new` all surface in the route table.
- `pnpm lint` — same 25 problems (11 errors, 14 warnings) as the pre-change baseline. The new code introduced no lint errors. (The 11 errors are all in pre-existing files: `tiptap-editor.tsx`, `excalidraw-block.tsx`, `image-row-block.tsx`, etc.)
- `pnpm test:e2e --grep "Learning module"` — both new tests pass: (1) full create-topic → add-card → view-detail → set-mastery → 5-min-debounce flow; (2) home grid mastered-count updates after a card is set to mastered.
- Full `pnpm test:e2e` — could not be evaluated cleanly because a concurrent agent's worktree was driving its own playwright session against the same `localhost:3100` while this run was happening, producing `SQLITE_READONLY_DBMOVED` on shared writes from focus/portfolio specs. The Learning-module specs themselves pass when run in isolation; no Learning-related code path is implicated in the cross-worktree noise. Re-run the full suite when no other agent worktree is active.

## Schema rollout (production)

**NOT YET RUN.** Three `ALTER TABLE learning_notes ADD COLUMN ...` statements live in `drizzle/0040_marvelous_stepford_cuckoos.sql`. Before merging to main:

1. `turso db dump <db> > backups/turso-$(date +%Y-%m-%d).sql`
2. Apply the migration SQL via `turso db shell` or `drizzle-kit push` against prod (see `.claude/rules/production-turso.md`).
3. Verify with `SELECT name FROM pragma_table_info('learning_notes') WHERE name IN ('view_count','mastery','last_viewed_at')` — expect 3 rows.

The migration is non-destructive (three additive columns with sensible defaults). The actual data migration (notes → learning) is a separate, opt-in step the user runs against a config file.

## Remaining risks / follow-ups

- **bagu skill not yet rewired.** The new `create_learning_card` MCP tool exists, but `~/.claude/skills/bagu/SKILL.md` (outside this repo) still calls `create_note` with `folder: "八股文"`. Hand-edit needed to flip it to `create_learning_card({ topicName, title, body, tags })`. This work is intentionally split: the backend tool is the dependency, the skill change is downstream.
- **Production schema not pushed yet.** See above.
- **Migration config undefined.** User has to author `scripts/migrate-config.json` with the real userId and the exact `topics: [...]` mapping (which folder names / tags / IDs become which topic). The script can dry-run safely without it.
- **Existing pre-existing lint errors** in editor blocks (callout, excalidraw, image-row, tiptap-editor) are not addressed; out of scope for this change.
- **Tiptap custom blocks via markdown ingest.** `markdownToTiptap` covers the common ground (headings, lists, code, tables, links, inline marks, mermaid via fenced code). It does not produce callout, toggle, image-row, excalidraw, or TOC nodes. The bagu skill's six-section template doesn't need those, so this is fine for the present use case.
