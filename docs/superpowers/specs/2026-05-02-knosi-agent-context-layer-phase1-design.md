# Knosi Agent Context Layer — Phase 1 (Preferences) Design

**Date**: 2026-05-02
**Status**: Draft for review
**Phase**: 1 of 4 (Preferences)

---

## 1. Background and Problem

User maintains multiple AI agents in daily work:

- **Claude Code (local Mac)** — primary coding driver
- **Claude Code Web (claude.ai/code)** — sandboxed, browser-based
- **Hermes Agent (Hetzner server)** — 24/7 Telegram automation hub

Each agent has its own settings, preferences, and constraints, scattered across:

- `~/.claude/CLAUDE.md` — global instructions for Claude Code
- `~/.claude/projects/-Users-bytedance/memory/*.md` — Claude Code auto-memory
- `/Users/bytedance/knosi/CLAUDE.md` — project-level instructions
- Hermes server config and skill files
- (Web has none of the above on local disk)

**Result**: When the user changes a preference (e.g. "always use pnpm"), it only takes effect in one agent. Other agents stay out of sync. The same constraint may need to be repeated 3–4 times in different formats. Over time, the systems drift, and the user re-explains the same things repeatedly.

Knosi (self-hosted Next.js + tRPC + Drizzle knowledge platform on Hetzner; local libsql/SQLite in dev, Turso in production) already exposes 6 MCP tools. It is the natural home for cross-agent context.

## 2. Goals and Non-goals

### Goals (Phase 1)

- Provide a **single source of truth** for agent preferences (constraints / settings / habits)
- Allow Knosi to act as an **agent context layer** accessible from any MCP-capable agent
- Validate that cross-agent sync works end-to-end with the smallest possible surface area
- Establish the **mental model** of "Knosi as structured agent context layer", not "Knosi as a brain"

### Non-goals (Phase 1)

- Episodic memories (Phase 2)
- Skill content distribution (Phase 3)
- Project workspaces and cross-agent handoffs (Phase 4)
- Auto-trigger semantics (agents read/write on hooks); Phase 1 keeps everything explicit, agent-driven
- Vector search / embeddings — out of scope; preferences are small and exact-match keyed
- A CLI client — MCP is the only access path in Phase 1
- Cursor integration — user does not use Cursor; will not be supported

## 3. Mental Model

> **Knosi is the agent context layer, not the agent brain.**

Human knowledge (notes, learning cards) and agent context (preferences, memories, skills) coexist in Knosi but use **different data models** and **different MCP tools**. They share the backend, not the schema.

```
                   Knosi (Agent Context Layer)

       Human knowledge          Agent context
       ─────────────             ─────────────
       Notes (existing)          Preferences  ← Phase 1
       Learning cards (existing) Memories     ← Phase 2
                                 Skills       ← Phase 3
                                 Projects     (cross-cutting)
                                  ↑ MCP
              ┌───────────────────┼───────────────────┐
        Claude Code        Claude Code Web        Hermes
        (local)            (claude.ai sandbox)    (Hetzner)
```

## 4. Scope of Phase 1

### In scope

- New `preferences` table in Knosi (Drizzle schema + migration; libsql in dev, Turso in production)
- 3 new MCP tools: `knosi_pref_list`, `knosi_pref_set`, `knosi_pref_delete`
- Minimal UI: a `/preferences` page with an inline-editable table
- Integration with **local Claude Code** (CLAUDE.md update, MCP config sanity check)
- Integration with **Hermes** (skill file + cluster-internal MCP connection)
- Migration step: move qualifying preferences from existing `~/.claude/CLAUDE.md` and `~/.claude/projects/.../memory/*.md` into Knosi, then delete the originals to enforce single source

### Out of scope (deferred)

- Claude Code Web connector setup → **Phase 1.5** (configuration-only, no code changes)
- Memories table and tools → **Phase 2**
- Skills table and bidirectional sync → **Phase 3**
- Projects table as first-class entity → **Phase 4** (Phase 1 uses project slug as a string only)

## 5. Data Model

### 5.1 `preferences` table

```sql
CREATE TABLE preferences (
  id          TEXT PRIMARY KEY,        -- crypto.randomUUID()
  scope       TEXT NOT NULL,           -- 'global' | 'project:<slug>'
  key         TEXT NOT NULL,           -- snake_case identifier
  value       TEXT NOT NULL,           -- free-form string (natural language constraint)
  description TEXT,                    -- optional human-readable note for the UI
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (scope, key)
);

CREATE INDEX idx_preferences_scope ON preferences(scope);
```

### 5.2 Field semantics

- **scope**: lowercase string, exactly two forms allowed:
  - `global` — applies to all agent activity
  - `project:<slug>` — applies only when agent is operating in the named project (slug must match `[a-z0-9._-]+`)
- **key**: snake_case, agent-readable identifier. Examples: `package_manager`, `response_language`, `commit_style`
- **value**: free-form string. Agents read it as a natural-language constraint. Multi-line allowed.
- **description**: optional UI-only field. Lets the user remind themselves what the preference is for. Agents may but need not read it.
- **(scope, key) UNIQUE**: enforces single-row-per-preference. `set` operation upserts.

### 5.3 Why string-only for `value`

- Preferences are natural-language constraints, not structured config
- Every agent (Claude, Hermes) trivially parses strings; no JSON parser required
- Real structured data belongs in Phase 2 memories or a dedicated table
- Schema change to JSON later is non-breaking (TEXT can hold JSON if needed)

### 5.4 Why no `type` field

Considered (`string|bool|int|json`) and rejected. No agent has expressed need to "parse" a preference; they read and apply. Adding type complicates UI, MCP tool, and migration with zero current benefit.

## 6. MCP Tools

All three tools live alongside existing 6 Knosi tools, served by `src/app/api/mcp/`.

### 6.1 `knosi_pref_list`

```ts
args: {
  scope?: 'global' | `project:${string}`  // optional; omit to fetch all
}
returns: Array<{
  id: string;
  scope: string;
  key: string;
  value: string;
  description: string | null;
  updated_at: number;  // unix ms
}>
```

**Semantics**:

- No `scope` arg → return all rows
- `scope='global'` → return only global rows
- `scope='project:knosi'` → return only that project's rows
- **No automatic merging** of global + project rows; agent decides how to apply

**Typical caller flow**:

- Agent at session start: `pref_list()` once — get everything, hold in conversation context
- Agent entering a project directory: `pref_list({ scope: 'project:<slug>' })` — get project-specific overrides

### 6.2 `knosi_pref_set`

```ts
args: {
  scope: 'global' | `project:${string}`;
  key: string;          // must match /^[a-z][a-z0-9_]*$/
  value: string;        // non-empty after trim
  description?: string;
}
returns: {
  id: string;
  created: boolean;     // true if new row, false if existing row updated
}
```

**Semantics**:

- Upsert by `(scope, key)`
- Validates key format and non-empty value
- Updates `updated_at` on every call

### 6.3 `knosi_pref_delete`

```ts
args: {
  scope: 'global' | `project:${string}`;
  key: string;
}
returns: {
  deleted: boolean;     // false if row didn't exist
}
```

## 7. UI

### 7.1 New route: `/preferences`

Sidebar entry between existing entries (placement TBD during implementation but should sit near settings, not in the notes/learning sections).

### 7.2 Layout

A single page containing one table:

| Scope | Key | Value | Description | Updated | Actions |
|---|---|---|---|---|---|
| global | response_language | Always reply in Chinese | Affects all agents | 5 mins ago | Edit / Delete |
| project:knosi | package_manager | pnpm | — | 2 days ago | Edit / Delete |

- **Inline edit**: click any cell (except Updated, Actions) → editable.
  Scope/Key use `<input>`, Value/Description use `<textarea>` (multi-line)
- **Add**: button at top "Add preference" → row appears with empty fields, scope dropdown defaulting to `global`
- **Delete**: icon in Actions column, confirms before delete
- **Sort**: by scope (global first), then by key alphabetically
- **Search**: optional in v1; can defer to v2 if data stays small

### 7.3 No Tiptap involvement

The value field is plain text (multi-line `<textarea>`). Tiptap is for human notes, not for short agent constraints.

## 8. Agent Integration

### 8.1 Local Claude Code

**MCP**: Knosi MCP server is already registered (6 existing tools work). The 3 new tools surface automatically once deployed.

**Instructions** — append to `~/.claude/CLAUDE.md`:

```markdown
## Knosi Agent Context Layer

**Single source of truth for cross-agent preferences.** All preferences
listed below are pulled from Knosi at session start, not from this file.

### Calling rules

At session start (at most once):
- Call `knosi_pref_list` (no args) to load global preferences
- When entering a known project directory, call
  `knosi_pref_list({ scope: "project:<slug>" })` for project-specific ones
- Project slug = directory basename for ttec/knosi/leetcode-review repos
  (see BE repo index above)

When user instructs a new constraint:
- Phrases like "from now on", "always", "never", "use X instead of Y"
- → call `knosi_pref_set` with appropriate scope and key
- Confirm with user before writing

When user revokes a constraint:
- Phrases like "stop doing X", "forget that"
- → call `knosi_pref_delete`
```

**Migration step (one-time)**: When this section is added, also remove
preference-style entries from `~/.claude/CLAUDE.md` and
`~/.claude/projects/-Users-bytedance/memory/*.md`. See Section 11.

### 8.2 Hermes

**Network**: Cluster-internal direct connection (Knosi Service DNS within
the K3s cluster). Avoids public HTTPS hop and saves resources on the 2vCPU /
3.7G server.

**Auth**: Cluster-internal token (separate from public token). Stored in
Hermes config file under `~/.hermes/`.

**Skill file**: New skill at Hermes' skill directory.

```yaml
---
name: knosi-preferences
description: Apply Knosi preferences when handling messages
when_to_use:
  - At conversation start
  - User mentions a project name (knosi, ttec.*, leetcode-review)
  - User says "always", "never", "from now on", "remember"
---

At conversation start: call knosi_pref_list once.

If user mentions a known project: also call
knosi_pref_list({ scope: "project:<slug>" }).

If user instructs a new persistent constraint:
- Confirm with user
- Call knosi_pref_set with appropriate scope and key

Apply the returned preferences to subsequent responses
(language, tooling choices, formatting, etc.).
```

### 8.3 Claude Code Web (deferred to Phase 1.5)

**Why deferred**: Web setup is configuration-only (claude.ai → Connectors →
add Knosi MCP endpoint + paste system prompt into project instructions).
No Knosi backend code involved. Decoupling lets Phase 1 ship faster.

**Phase 1.5 plan** (one-page sub-spec to be written separately):

1. Create dedicated claude.ai project "Knosi-aware coding"
2. Add Knosi MCP connector with public token
3. Paste the same calling-rules block as Section 8.1 into project
   system prompt
4. Verify cross-agent sync: change a preference in Knosi UI → Web project
   sees it immediately

## 9. Network and Auth

```
                   Knosi (Hetzner CX21)
                           ↑
       ┌───────────────────┼───────────────────────┐
       │ HTTPS public      │ HTTPS public           │ Cluster-internal
       │ + token A         │ + token B              │ + token C
       │                   │                        │
  Claude Code         Claude Code Web           Hermes
  (local Mac)         (Anthropic sandbox)       (same Hetzner box)
```

- **Three separate tokens**, one per agent. Lets the user revoke selectively.
- Token storage: each agent's normal MCP config location.
- Knosi backend: extends existing OAuth/auth code in
  `src/server/integrations/oauth-clients.ts` to accept personal access
  tokens for the new tools (and existing ones uniformly).

## 10. Performance and Limits

- **Expected table size**: ≤ 500 rows lifetime upper bound. Realistic: 30–80.
- **Query pattern**: `pref_list` is a small SELECT, returns ≤ 5 KB JSON.
- **No caching in Phase 1**. Every agent call hits the DB. Re-evaluate if
  Hermes processes high-frequency Telegram traffic and `pref_list` becomes
  hot. Likely not within Phase 1 scope.
- **Concurrency**: Knosi already runs libsql/Turso. Three agents writing
  preferences is rare (mostly user-initiated); no special locking needed.

## 11. Migration: Deduplicating Existing Memory Systems

The user has multiple existing places where preference-like content lives:

- `~/.claude/CLAUDE.md` (language preference, package manager preference)
- `~/.claude/projects/-Users-bytedance/memory/*.md`:
  - `user_claude_code_no_flicker.md`
  - `cli_tools.md`
  - `feedback_credentials_in_chat.md`
  - `feedback_multi_repo_bash_cwd.md`
- `~/.claude/projects/-Users-bytedance/memory/MEMORY.md` (index)

**Risk if not migrated cleanly**: dual-source. Agent reads both Knosi and
local files, gets contradictory or duplicated context. User edits one, the
other goes stale. Phase 1 fails its own goal.

### Migration plan (executed manually as part of Phase 1 ship)

1. **Audit** — go through the files above, classify each entry as one of:
   - **Type A** — true preference → migrate to Knosi
   - **Type B** — reference data (BE repo index, server topology) → leave in
     place; not a preference
   - **Type C** — episodic memory / fact → leave in place; will move in Phase 2

2. **Type A entries are migrated to Knosi** via the new UI. Approximate
   list (subject to audit during implementation):
   - `response_language = "Always reply in Chinese..."` (global)
   - `package_manager = "pnpm"` (global)
   - `claude_code_no_flicker = "..."` (global)
   - `credentials_in_chat = "..."` (global, feedback)
   - `multi_repo_bash_cwd = "..."` (global, feedback)

3. **Originals are deleted** from the source files immediately after
   migration. Do not leave them as "backup" — that defeats single-source.

4. **CLAUDE.md replacement section** says explicitly:
   > "Preferences are managed in Knosi. Call `knosi_pref_list` at session
   > start. Do not maintain preference content in this file."

5. **MEMORY.md index** loses the entries that were migrated. Surviving
   entries (BE repo index, server topology, etc.) stay.

### Out-of-scope for Phase 1

- Migrating Type C (episodic memories) — that's Phase 2's job
- Deleting `MEMORY.md` itself — keep it; it indexes Type B/C survivors

## 12. Definition of Done

Phase 1 is complete when **all** the following are verified:

1. **Schema deployed**: `preferences` table exists in **production Turso**
   (per `AGENTS.md` schema rollout protocol — local `db:push` does not
   suffice). Verify with `SELECT * FROM preferences LIMIT 1;` against
   production Turso database.
2. **3 MCP tools work**: from local Claude Code, all three
   (`knosi_pref_list`, `knosi_pref_set`, `knosi_pref_delete`) execute
   successfully and return expected shapes. Verified via E2E test in
   `e2e/preferences.spec.ts`.
3. **UI works**: `/preferences` page renders, supports add / inline-edit /
   delete. Covered by E2E test.
4. **Migration done**: at least 3 Type A preferences migrated from local
   files into Knosi; original entries removed; CLAUDE.md replaced section
   present.
5. **Cross-agent sync demonstrated**: user changes a preference in Knosi
   UI; **local Claude Code** in a fresh session sees it; **Hermes** in a
   fresh Telegram conversation sees it. Both within seconds.

**Web sync (Phase 1.5)** is NOT required for Phase 1 completion.

## 13. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dual-source between CLAUDE.md and Knosi | High if not enforced | Phase 1 fails its core goal | Section 11 migration is a hard part of DoD, not optional |
| Agent doesn't actually call `pref_list` at session start | Medium | Preferences silently ignored | CLAUDE.md instructions are explicit; verification step (DoD 5) catches this |
| Hermes cluster-internal token mishandled | Low | Auth bypass within cluster | Cluster-internal traffic only; no public exposure; token rotation via Hermes config edit |
| Token bloat from `pref_list` returning everything | Low (small table) | Cost overhead | Table is small by design; revisit if it ever exceeds ~200 rows |
| Schema change blocks production | Low | Deploy stalls | Knosi already has Turso production rollout protocol per `AGENTS.md` |
| User adds preference but agent applies wrong scope | Medium | Confusing behavior | UI shows scope clearly; `set` requires explicit scope; user trains by example |

## 14. Future Phases (Reference Only)

This section is informational. Each phase will get its own design doc.

### Phase 1.5 — Claude Code Web connector (configuration only)

Add Knosi MCP connector to claude.ai/code. Paste system prompt into
dedicated project. Verify Web sees same preferences as local Claude Code.

### Phase 2 — Memories (1–2 weeks)

- New `memories` table: `(id, project, kind, body, source_agent, supersedes, created_at)`
- `kind` enum: `fact | decision | bug | todo | preference | incident`
- 4 MCP tools: `mem_search`, `mem_save`, `mem_recent`, `mem_get`
- **Deduplication strategy** (critical, since memories table grows
  unbounded unlike preferences):
  - Defense 1 (write-time, agent self-discipline): CLAUDE.md instructs
    agent to `mem_search` before `mem_save` and use `supersedes` field
    when updating existing entries
  - Defense 2 (read-time, backend cluster + collapse): `mem_search`
    groups near-duplicates by (project, kind) + trigram similarity, returns
    one per cluster with "N similar collapsed" hint, accepts
    `expand_clusters=true` to override
  - Optional Defense 3 (Phase 2.5, if Defense 1+2 prove insufficient):
    backend rejects `mem_save` with 409 + candidate IDs when similarity
    above threshold; agent must explicitly use `supersedes`

### Phase 3 — Skills (2–3 weeks)

- New `agent_skills` table with markdown body + targets array
- 5 MCP tools including bidirectional sync (`sync_to_local`,
  `import_from_local`)
- Adapters per target (Claude Code skill format, Hermes skill format)

### Phase 4 — Project Workspaces and Handoffs (optional)

- First-class `projects` table tying preferences/memories/skills together
- `knosi_project_context(slug)` mega-tool returning all three layers in one call
- Handoff namespace for cross-session/cross-agent continuity

## 15. Open Questions

None blocking. All Phase 1 design decisions are settled per Section 4 of the
brainstorming session (decision summary captured in Section 5–8 of this
document).

## 16. References

- Brainstorming session transcript: 2026-05-02 conversation
- Knosi `AGENTS.md` — verification rules, schema rollout protocol
- Knosi `CLAUDE.md` — Phase ship-and-commit protocol
- `~/.claude/CLAUDE.md` — current global preferences (source for migration)
- `~/.claude/projects/-Users-bytedance/memory/MEMORY.md` — current memory index
