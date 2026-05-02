# Knosi Agent Context Layer — Phase 1 (Preferences) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `preferences` table, three MCP tools (`knosi_pref_list` / `knosi_pref_set` / `knosi_pref_delete`), and a minimal inline-edit `/preferences` page so Claude Code (local) and Hermes share the same agent constraints via Knosi.

**Architecture:** Follows existing Knosi patterns: Drizzle schema in `src/server/db/schema/preferences.ts`, pure reader/writer functions in `src/server/integrations/preferences-store.ts` (test-seam friendly), MCP tools registered in `src/server/integrations/mcp-tools.ts`, tRPC router for the UI in `src/server/routers/preferences.ts`, page at `src/app/(app)/preferences/page.tsx`. OAuth scope `preferences:read` / `preferences:write` added to existing `OAUTH_SCOPES`. Production schema rolled out to Turso per `AGENTS.md`.

**Tech Stack:** Next.js 16 App Router, React 19, tRPC v11, Drizzle ORM + libsql/Turso, Tailwind CSS v4, zod/v4, Vitest (unit) + Playwright (E2E). Branch: `feat/agent-context-layer-phase1`.

**Spec:** [`docs/superpowers/specs/2026-05-02-knosi-agent-context-layer-phase1-design.md`](../specs/2026-05-02-knosi-agent-context-layer-phase1-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/server/db/schema/preferences.ts` | **Create** | Drizzle table definition |
| `src/server/db/schema/index.ts` | **Modify** | Re-export new schema |
| `drizzle/00XX_*.sql` | **Generated** | Migration for new table |
| `src/server/integrations/preferences-store.ts` | **Create** | Pure CRUD functions (`listPreferences`, `setPreference`, `deletePreference`) — test seam via deps injection |
| `src/server/integrations/preferences-store.test.ts` | **Create** | Unit tests for store functions |
| `src/server/integrations/oauth-clients.ts` | **Modify** | Add `preferencesRead` / `preferencesWrite` scopes; allow them on `anthropic-connector` and `knosi-cli` |
| `src/server/integrations/mcp-tools.ts` | **Modify** | Register 3 new tools in `KNOSI_MCP_TOOLS`, add cases to `callKnosiMcpTool` switch, extend `KnosiMcpDeps` |
| `src/server/integrations/mcp-tools.test.ts` | **Modify** | Add unit tests for the 3 new MCP tool dispatches |
| `src/app/api/mcp/route.ts` | **Modify** | Map new tool names to required scopes |
| `src/server/routers/preferences.ts` | **Create** | tRPC router (list/set/delete) for the UI |
| `src/server/routers/_app.ts` | **Modify** | Register `preferences` router |
| `src/app/(app)/preferences/page.tsx` | **Create** | Page entry — server component shell |
| `src/app/(app)/preferences/preferences-table.tsx` | **Create** | Client component with inline-edit table |
| `src/components/layout/sidebar.tsx` | **Modify** | Add sidebar entry |
| `e2e/preferences.spec.ts` | **Create** | E2E covering CRUD via UI |
| `e2e/preferences-mcp.spec.ts` | **Create** | E2E hitting the MCP HTTP endpoint with the new tools |
| `~/.claude/CLAUDE.md` | **Modify (out-of-repo)** | Add "Knosi Agent Context Layer" section, remove migrated preferences |
| `~/.claude/projects/-Users-bytedance/memory/MEMORY.md` | **Modify (out-of-repo)** | Remove links to migrated entries |
| `docs/changelog/phase-knosi-acl-1.md` | **Create** | Phase completion log per Knosi protocol |

Production rollout commands recorded in the changelog entry per `AGENTS.md` rule 4.

---

## Task 1: Create the Drizzle schema for `preferences`

**Files:**
- Create: `src/server/db/schema/preferences.ts`
- Modify: `src/server/db/schema/index.ts`

- [ ] **Step 1: Write the schema file**

Create `src/server/db/schema/preferences.ts`:

```typescript
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * Agent context layer — Phase 1.
 *
 * Holds cross-agent preferences. Each row is a single (scope, key) constraint
 * (e.g. global response_language="Always reply in Chinese"). Agents pull these
 * at session start via the knosi_pref_* MCP tools.
 *
 * scope is either the literal string "global" or "project:<slug>" where slug
 * matches /^[a-z0-9._-]+$/. Application-layer code enforces the format; the
 * DB stores it as a plain string for simplicity.
 */
export const preferences = sqliteTable(
  "preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("preferences_user_scope_key_idx").on(
      table.userId,
      table.scope,
      table.key
    ),
    index("preferences_user_scope_idx").on(table.userId, table.scope),
  ]
);
```

- [ ] **Step 2: Re-export from the schema barrel**

Edit `src/server/db/schema/index.ts` — add to the section comment block and the export list:

```diff
   focus      — focus tracker activity sessions, device pairing, summaries
   portfolio  — portfolio holdings, AI-generated news summaries
   projects   — open-source project analysis (projects, prompts, tasks, messages)
   ops        — daemon/job heartbeats, CLI tokens
+  preferences — cross-agent preferences (Agent Context Layer Phase 1)
```

```diff
 export * from "./drifter";
+export * from "./preferences";
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file appears in `drizzle/` named `00XX_<adjective>_<character>.sql` containing `CREATE TABLE preferences ...` plus the two indexes.

Open the generated file and verify:
- `CREATE TABLE \`preferences\`` block lists all 8 columns
- The `UNIQUE INDEX preferences_user_scope_key_idx` is present
- The non-unique `INDEX preferences_user_scope_idx` is present

- [ ] **Step 4: Apply locally**

Run: `pnpm db:push`
Expected: `[✓] Changes applied`

Verify with the dev DB:

Run: `sqlite3 data/knosi.db ".schema preferences"`
Expected output contains `CREATE TABLE preferences` with the columns above.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/preferences.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat(schema): add preferences table for agent context layer"
```

---

## Task 2: Write the preferences store (TDD — failing tests first)

**Files:**
- Create: `src/server/integrations/preferences-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/integrations/preferences-store.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";

import {
  listPreferences,
  setPreference,
  deletePreference,
} from "./preferences-store";
import * as schema from "../db/schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

const TEST_USER = "user-acl-1";

async function makeDb(): Promise<DB> {
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  // seed user FK target
  await db.insert(schema.users).values({
    id: TEST_USER,
    email: `${TEST_USER}@test.local`,
    name: "Test",
  });
  return db;
}

describe("preferences-store", () => {
  let db: DB;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("listPreferences returns [] for a fresh user", async () => {
    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toEqual([]);
  });

  it("setPreference inserts a new row and reports created=true", async () => {
    const result = await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "response_language",
        value: "Always reply in Chinese",
      },
      { db: db as never }
    );
    expect(result.created).toBe(true);
    expect(typeof result.id).toBe("string");

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "global",
      key: "response_language",
      value: "Always reply in Chinese",
    });
  });

  it("setPreference upserts on (scope,key) and reports created=false", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "package_manager",
        value: "pnpm",
      },
      { db: db as never }
    );
    const second = await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "package_manager",
        value: "yarn",
      },
      { db: db as never }
    );
    expect(second.created).toBe(false);

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("yarn");
  });

  it("listPreferences filters by scope when provided", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "global",
        key: "response_language",
        value: "Chinese",
      },
      { db: db as never }
    );
    await setPreference(
      {
        userId: TEST_USER,
        scope: "project:knosi",
        key: "package_manager",
        value: "pnpm",
      },
      { db: db as never }
    );

    const globalOnly = await listPreferences(
      { userId: TEST_USER, scope: "global" },
      { db: db as never }
    );
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0]?.key).toBe("response_language");

    const knosiOnly = await listPreferences(
      { userId: TEST_USER, scope: "project:knosi" },
      { db: db as never }
    );
    expect(knosiOnly).toHaveLength(1);
    expect(knosiOnly[0]?.key).toBe("package_manager");
  });

  it("listPreferences sorts by scope (global first), then key", async () => {
    await setPreference(
      {
        userId: TEST_USER,
        scope: "project:knosi",
        key: "z_key",
        value: "v",
      },
      { db: db as never }
    );
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "b_key", value: "v" },
      { db: db as never }
    );
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "a_key", value: "v" },
      { db: db as never }
    );

    const rows = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(rows.map((r) => `${r.scope}/${r.key}`)).toEqual([
      "global/a_key",
      "global/b_key",
      "project:knosi/z_key",
    ]);
  });

  it("deletePreference returns deleted=true on hit, false on miss", async () => {
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "x", value: "v" },
      { db: db as never }
    );

    const hit = await deletePreference(
      { userId: TEST_USER, scope: "global", key: "x" },
      { db: db as never }
    );
    expect(hit.deleted).toBe(true);

    const miss = await deletePreference(
      { userId: TEST_USER, scope: "global", key: "x" },
      { db: db as never }
    );
    expect(miss.deleted).toBe(false);
  });

  it("setPreference rejects empty key", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/key/i);
  });

  it("setPreference rejects key with bad chars", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "Bad-Key", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/key/i);
  });

  it("setPreference rejects empty value", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "global", key: "k", value: "   " },
        { db: db as never }
      )
    ).rejects.toThrow(/value/i);
  });

  it("setPreference rejects malformed scope", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "weird", key: "k", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/scope/i);
  });

  it("setPreference rejects bad project slug in scope", async () => {
    await expect(
      setPreference(
        { userId: TEST_USER, scope: "project:Bad Slug!", key: "k", value: "v" },
        { db: db as never }
      )
    ).rejects.toThrow(/scope/i);
  });

  it("isolates rows per user", async () => {
    await db.insert(schema.users).values({
      id: "user-other",
      email: "other@test.local",
      name: "Other",
    });
    await setPreference(
      { userId: TEST_USER, scope: "global", key: "k", value: "mine" },
      { db: db as never }
    );
    await setPreference(
      { userId: "user-other", scope: "global", key: "k", value: "theirs" },
      { db: db as never }
    );
    const mine = await listPreferences(
      { userId: TEST_USER },
      { db: db as never }
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.value).toBe("mine");
  });
});
```

- [ ] **Step 2: Run the tests; they should fail because the module doesn't exist**

Run: `pnpm vitest run src/server/integrations/preferences-store.test.ts`
Expected: FAIL with "Cannot find module './preferences-store'" or similar import error.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/server/integrations/preferences-store.test.ts
git commit -m "test(preferences): add failing unit tests for preferences-store"
```

---

## Task 3: Implement the preferences store

**Files:**
- Create: `src/server/integrations/preferences-store.ts`

- [ ] **Step 1: Write the implementation**

Create `src/server/integrations/preferences-store.ts`:

```typescript
import { and, asc, eq } from "drizzle-orm";

import { db as defaultDb } from "../db";
import { preferences } from "../db/schema";

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SLUG_PATTERN = /^[a-z0-9._-]+$/;

export type PreferenceScope = "global" | `project:${string}`;

export type PreferenceRow = {
  id: string;
  scope: string;
  key: string;
  value: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
};

type StoreDeps = {
  db?: typeof defaultDb;
  /** Override `Date.now()` for deterministic tests. Optional. */
  now?: () => Date;
};

function assertScope(scope: string): asserts scope is PreferenceScope {
  if (scope === "global") return;
  if (scope.startsWith("project:")) {
    const slug = scope.slice("project:".length);
    if (slug.length > 0 && SLUG_PATTERN.test(slug)) return;
  }
  throw new Error(
    `Invalid scope: ${JSON.stringify(scope)}. Expected "global" or "project:<slug>" where slug matches ${SLUG_PATTERN}.`
  );
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid key: ${JSON.stringify(key)}. Expected snake_case matching ${KEY_PATTERN}.`
    );
  }
}

function assertValue(value: string): void {
  if (value.trim().length === 0) {
    throw new Error("value must be non-empty after trim");
  }
}

function toRow(
  row: typeof preferences.$inferSelect
): PreferenceRow {
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    value: row.value,
    description: row.description ?? null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function listPreferences(
  input: { userId: string; scope?: string },
  deps: StoreDeps = {}
): Promise<PreferenceRow[]> {
  const dbImpl = deps.db ?? defaultDb;

  const where =
    input.scope !== undefined
      ? and(
          eq(preferences.userId, input.userId),
          eq(preferences.scope, input.scope)
        )
      : eq(preferences.userId, input.userId);

  const rows = await dbImpl
    .select()
    .from(preferences)
    .where(where)
    .orderBy(asc(preferences.scope), asc(preferences.key));

  // Sort: "global" before any "project:*". DB returns alphabetical,
  // which puts "global" after "project:..." — fix client-side.
  return rows
    .map(toRow)
    .sort((a, b) => {
      const aGlobal = a.scope === "global" ? 0 : 1;
      const bGlobal = b.scope === "global" ? 0 : 1;
      if (aGlobal !== bGlobal) return aGlobal - bGlobal;
      if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
      return a.key.localeCompare(b.key);
    });
}

export async function setPreference(
  input: {
    userId: string;
    scope: string;
    key: string;
    value: string;
    description?: string | null;
  },
  deps: StoreDeps = {}
): Promise<{ id: string; created: boolean }> {
  assertScope(input.scope);
  assertKey(input.key);
  assertValue(input.value);

  const dbImpl = deps.db ?? defaultDb;
  const now = (deps.now ?? (() => new Date()))();

  const existing = await dbImpl
    .select()
    .from(preferences)
    .where(
      and(
        eq(preferences.userId, input.userId),
        eq(preferences.scope, input.scope),
        eq(preferences.key, input.key)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    await dbImpl
      .update(preferences)
      .set({
        value: input.value,
        description:
          input.description !== undefined
            ? input.description
            : row.description,
        updatedAt: now,
      })
      .where(eq(preferences.id, row.id));
    return { id: row.id, created: false };
  }

  const id = crypto.randomUUID();
  await dbImpl.insert(preferences).values({
    id,
    userId: input.userId,
    scope: input.scope,
    key: input.key,
    value: input.value,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, created: true };
}

export async function deletePreference(
  input: { userId: string; scope: string; key: string },
  deps: StoreDeps = {}
): Promise<{ deleted: boolean }> {
  assertScope(input.scope);
  assertKey(input.key);

  const dbImpl = deps.db ?? defaultDb;

  const result = await dbImpl
    .delete(preferences)
    .where(
      and(
        eq(preferences.userId, input.userId),
        eq(preferences.scope, input.scope),
        eq(preferences.key, input.key)
      )
    )
    .returning({ id: preferences.id });

  return { deleted: result.length > 0 };
}
```

- [ ] **Step 2: Run the tests; they should pass**

Run: `pnpm vitest run src/server/integrations/preferences-store.test.ts`
Expected: all 11 tests pass.

If any test fails, fix the implementation, not the test.

- [ ] **Step 3: Commit**

```bash
git add src/server/integrations/preferences-store.ts
git commit -m "feat(preferences): implement store (list/set/delete + validation)"
```

---

## Task 4: Add OAuth scopes for preferences

**Files:**
- Modify: `src/server/integrations/oauth-clients.ts`

- [ ] **Step 1: Extend `OAUTH_SCOPES`**

Edit `src/server/integrations/oauth-clients.ts`:

```diff
 export const OAUTH_SCOPES = {
   knowledgeRead: "knowledge:read",
   knowledgeWriteInbox: "knowledge:write_inbox",
+  preferencesRead: "preferences:read",
+  preferencesWrite: "preferences:write",
 } as const;
```

- [ ] **Step 2: Allow new scopes on existing clients**

In the same file, update `STATIC_OAUTH_CLIENTS`:

```diff
   "anthropic-connector": {
     clientId: "anthropic-connector",
     displayName: "Claude Web Connector",
     allowedRedirectUris: [
       "https://claude.ai/api/mcp/auth_callback",
       "https://claude.com/api/mcp/auth_callback",
     ],
     allowedScopes: [
       OAUTH_SCOPES.knowledgeRead,
       OAUTH_SCOPES.knowledgeWriteInbox,
+      OAUTH_SCOPES.preferencesRead,
+      OAUTH_SCOPES.preferencesWrite,
     ],
   },
   "knosi-cli": {
     clientId: "knosi-cli",
     displayName: "Knosi CLI",
     allowedRedirectUris: [
       "http://localhost:6274/oauth/callback",
       "http://127.0.0.1:6274/oauth/callback",
     ],
     allowedScopes: [
       OAUTH_SCOPES.knowledgeRead,
       OAUTH_SCOPES.knowledgeWriteInbox,
+      OAUTH_SCOPES.preferencesRead,
+      OAUTH_SCOPES.preferencesWrite,
     ],
   },
```

- [ ] **Step 3: Verify type-check passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/integrations/oauth-clients.ts
git commit -m "feat(oauth): add preferences:read and preferences:write scopes"
```

---

## Task 5: Register MCP tools (TDD — failing tests first)

**Files:**
- Modify: `src/server/integrations/mcp-tools.test.ts`

- [ ] **Step 1: Add failing tests for the 3 new tools**

Read the existing file first to find the right insertion point. Append the following test block (or insert into the existing `describe`):

```typescript
describe("knosi_pref_* MCP tool dispatches", () => {
  const userId = "user-pref";

  it("dispatches knosi_pref_list with no scope", async () => {
    const calls: unknown[] = [];
    const deps = {
      ...defaultDeps,
      listPreferences: async (
        input: { userId: string; scope?: string }
      ) => {
        calls.push(input);
        return [
          {
            id: "p1",
            scope: "global",
            key: "k",
            value: "v",
            description: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ];
      },
    } as never;

    const result = await callKnosiMcpTool(
      { userId, name: "knosi_pref_list", arguments: {} },
      deps
    );

    expect(calls).toEqual([{ userId }]);
    expect(result).toEqual({
      items: [
        {
          id: "p1",
          scope: "global",
          key: "k",
          value: "v",
          description: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
  });

  it("dispatches knosi_pref_list with scope filter", async () => {
    const calls: unknown[] = [];
    const deps = {
      ...defaultDeps,
      listPreferences: async (
        input: { userId: string; scope?: string }
      ) => {
        calls.push(input);
        return [];
      },
    } as never;

    await callKnosiMcpTool(
      {
        userId,
        name: "knosi_pref_list",
        arguments: { scope: "project:knosi" },
      },
      deps
    );

    expect(calls).toEqual([{ userId, scope: "project:knosi" }]);
  });

  it("dispatches knosi_pref_set", async () => {
    const calls: unknown[] = [];
    const deps = {
      ...defaultDeps,
      setPreference: async (input: unknown) => {
        calls.push(input);
        return { id: "p2", created: true };
      },
    } as never;

    const result = await callKnosiMcpTool(
      {
        userId,
        name: "knosi_pref_set",
        arguments: {
          scope: "global",
          key: "package_manager",
          value: "pnpm",
          description: "use pnpm",
        },
      },
      deps
    );

    expect(calls).toEqual([
      {
        userId,
        scope: "global",
        key: "package_manager",
        value: "pnpm",
        description: "use pnpm",
      },
    ]);
    expect(result).toEqual({ id: "p2", created: true });
  });

  it("dispatches knosi_pref_delete", async () => {
    const calls: unknown[] = [];
    const deps = {
      ...defaultDeps,
      deletePreference: async (input: unknown) => {
        calls.push(input);
        return { deleted: true };
      },
    } as never;

    const result = await callKnosiMcpTool(
      {
        userId,
        name: "knosi_pref_delete",
        arguments: { scope: "global", key: "package_manager" },
      },
      deps
    );

    expect(calls).toEqual([
      { userId, scope: "global", key: "package_manager" },
    ]);
    expect(result).toEqual({ deleted: true });
  });
});
```

If `defaultDeps` is not exported from `mcp-tools.ts`, build the test deps object inline by spreading the imports. If the existing test file uses a different style (per-test mock), match that style — read the file before editing.

- [ ] **Step 2: Run tests; they should fail**

Run: `pnpm vitest run src/server/integrations/mcp-tools.test.ts`
Expected: FAIL — either "Unsupported MCP tool: knosi_pref_list" or a missing-deps error.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/server/integrations/mcp-tools.test.ts
git commit -m "test(mcp): add failing dispatch tests for knosi_pref_* tools"
```

---

## Task 6: Wire up the MCP tools

**Files:**
- Modify: `src/server/integrations/mcp-tools.ts`

- [ ] **Step 1: Extend the imports and `KnosiMcpDeps`**

At the top of `src/server/integrations/mcp-tools.ts`, add:

```typescript
import {
  listPreferences,
  setPreference,
  deletePreference,
} from "./preferences-store";
```

Update the deps interface and defaults:

```diff
 export interface KnosiMcpDeps {
   searchKnowledge: typeof searchKnowledge;
   listRecentKnowledge: typeof listRecentKnowledge;
   getKnowledgeItem: typeof getKnowledgeItem;
   captureAiNote: typeof captureAiNote;
   captureMarkdownNote: typeof captureMarkdownNote;
   createLearningCard: typeof createLearningCard;
+  listPreferences: typeof listPreferences;
+  setPreference: typeof setPreference;
+  deletePreference: typeof deletePreference;
 }

 const defaultDeps: KnosiMcpDeps = {
   searchKnowledge,
   listRecentKnowledge,
   getKnowledgeItem,
   captureAiNote,
   captureMarkdownNote,
   createLearningCard,
+  listPreferences,
+  setPreference,
+  deletePreference,
 };
```

If `defaultDeps` is currently not exported, export it now (the test file needs it). Same for `KNOSI_MCP_TOOLS` if not already exported (it is, per the existing file).

- [ ] **Step 2: Register the 3 new tool descriptors**

Add these entries at the end of the `KNOSI_MCP_TOOLS` array, before the trailing `] as const;`:

```typescript
  {
    name: "knosi_pref_list",
    description:
      "List the user's cross-agent preferences from Knosi. Call once at session start. " +
      "Pass `scope` to filter ('global' or 'project:<slug>'); omit to fetch all.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description:
            "Optional scope filter. 'global' for global preferences or 'project:<slug>' for a specific project.",
        },
      },
    },
  },
  {
    name: "knosi_pref_set",
    description:
      "Create or update a cross-agent preference. Upserts on (scope, key). " +
      "Use when the user instructs a persistent constraint (e.g. 'always use pnpm').",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          description: "'global' or 'project:<slug>'",
        },
        key: {
          type: "string",
          description: "snake_case identifier, e.g. 'package_manager'",
        },
        value: {
          type: "string",
          description: "Free-form constraint text, multi-line allowed.",
        },
        description: {
          type: "string",
          description: "Optional human-readable note for the UI.",
        },
      },
      required: ["scope", "key", "value"],
    },
  },
  {
    name: "knosi_pref_delete",
    description:
      "Delete a cross-agent preference by (scope, key). Use when the user revokes a constraint.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string" },
        key: { type: "string" },
      },
      required: ["scope", "key"],
    },
  },
```

- [ ] **Step 3: Add dispatch cases to `callKnosiMcpTool`**

In the `switch (input.name)` block, add three new cases (before the `default:` clause):

```typescript
    case "knosi_pref_list": {
      const scope =
        typeof input.arguments.scope === "string"
          ? input.arguments.scope
          : undefined;
      const items = await deps.listPreferences({
        userId: input.userId,
        ...(scope !== undefined ? { scope } : {}),
      });
      return { items };
    }
    case "knosi_pref_set": {
      const result = await deps.setPreference({
        userId: input.userId,
        scope: String(input.arguments.scope ?? ""),
        key: String(input.arguments.key ?? ""),
        value: String(input.arguments.value ?? ""),
        description:
          typeof input.arguments.description === "string"
            ? input.arguments.description
            : undefined,
      });
      return { id: result.id, created: result.created };
    }
    case "knosi_pref_delete": {
      const result = await deps.deletePreference({
        userId: input.userId,
        scope: String(input.arguments.scope ?? ""),
        key: String(input.arguments.key ?? ""),
      });
      return { deleted: result.deleted };
    }
```

- [ ] **Step 4: Run unit tests; they should pass**

Run: `pnpm vitest run src/server/integrations/mcp-tools.test.ts`
Expected: all dispatch tests (existing + 4 new ones) pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/integrations/mcp-tools.ts
git commit -m "feat(mcp): register knosi_pref_list/set/delete tools"
```

---

## Task 7: Map new tools to OAuth scopes in MCP HTTP route

**Files:**
- Modify: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Replace the scope-mapping logic**

Find this block in `src/app/api/mcp/route.ts`:

```typescript
  const requiredScopes =
    toolName === "save_to_knosi"
      ? [OAUTH_SCOPES.knowledgeWriteInbox]
      : [OAUTH_SCOPES.knowledgeRead];
```

Replace it with:

```typescript
  const requiredScopes = (() => {
    switch (toolName) {
      case "save_to_knosi":
      case "create_note":
      case "create_learning_card":
        return [OAUTH_SCOPES.knowledgeWriteInbox];
      case "knosi_pref_list":
        return [OAUTH_SCOPES.preferencesRead];
      case "knosi_pref_set":
      case "knosi_pref_delete":
        return [OAUTH_SCOPES.preferencesWrite];
      default:
        return [OAUTH_SCOPES.knowledgeRead];
    }
  })();
```

> **Note:** The original code only mapped `save_to_knosi` to a write scope, but the existing tools `create_note` and `create_learning_card` are also writes. The fix above brings them into the right bucket while we're here. If this surprises the reviewer, the existing test suite will still pass because `knosi-cli` and `anthropic-connector` already have `knowledgeWriteInbox`.

- [ ] **Step 2: Run type check + lint**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat(mcp-route): scope-gate knosi_pref_* tools"
```

---

## Task 8: tRPC router for the UI (TDD-lite — write router with shape tests)

**Files:**
- Create: `src/server/routers/preferences.ts`
- Modify: `src/server/routers/_app.ts`

- [ ] **Step 1: Write the router**

Create `src/server/routers/preferences.ts`:

```typescript
import { z } from "zod/v4";

import { router, protectedProcedure } from "../trpc";
import {
  listPreferences,
  setPreference,
  deletePreference,
} from "../integrations/preferences-store";

const scopeSchema = z
  .string()
  .refine(
    (s) =>
      s === "global" || /^project:[a-z0-9._-]+$/.test(s),
    {
      message: 'scope must be "global" or "project:<slug>"',
    }
  );

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, {
    message: "key must be snake_case",
  });

export const preferencesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          scope: scopeSchema.optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      return listPreferences({
        userId: ctx.userId,
        ...(input?.scope !== undefined ? { scope: input.scope } : {}),
      });
    }),

  set: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        key: keySchema,
        value: z.string().min(1),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return setPreference({
        userId: ctx.userId,
        scope: input.scope,
        key: input.key,
        value: input.value,
        description: input.description ?? null,
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        scope: scopeSchema,
        key: keySchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      return deletePreference({
        userId: ctx.userId,
        scope: input.scope,
        key: input.key,
      });
    }),
});
```

- [ ] **Step 2: Register the router**

Edit `src/server/routers/_app.ts`:

```diff
 import { learningNotebookRouter } from "./learning-notebook";
 import { councilRouter } from "./council";
+import { preferencesRouter } from "./preferences";

 export const appRouter = router({
   notes: notesRouter,
   ...
   learningNotebook: learningNotebookRouter,
   council: councilRouter,
+  preferences: preferencesRouter,
 });
```

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routers/preferences.ts src/server/routers/_app.ts
git commit -m "feat(trpc): add preferences router (list/set/delete)"
```

---

## Task 9: Build the `/preferences` page

**Files:**
- Create: `src/app/(app)/preferences/page.tsx`
- Create: `src/app/(app)/preferences/preferences-table.tsx`

- [ ] **Step 1: Inspect existing patterns**

Run: `ls src/app/\(app\)/`
Run: `head -40 src/app/\(app\)/todos/page.tsx 2>/dev/null || head -40 src/app/\(app\)/notes/page.tsx`

Note the existing `(app)` page conventions: server-component shell + client child for interactivity. Match the style.

- [ ] **Step 2: Write the page shell**

Create `src/app/(app)/preferences/page.tsx`:

```tsx
import { PreferencesTable } from "./preferences-table";

export default function PreferencesPage() {
  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Agent Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cross-agent constraints. All connected agents (Claude Code, Hermes,
          Web) read this list at session start. Single source of truth.
        </p>
      </header>
      <PreferencesTable />
    </main>
  );
}
```

- [ ] **Step 3: Write the client table component**

Create `src/app/(app)/preferences/preferences-table.tsx`:

```tsx
"use client";

import { useState } from "react";

import { trpc } from "@/lib/trpc-client";
import { cn } from "@/lib/utils";

type DraftRow = {
  scope: string;
  key: string;
  value: string;
  description: string;
};

const EMPTY_DRAFT: DraftRow = {
  scope: "global",
  key: "",
  value: "",
  description: "",
};

export function PreferencesTable() {
  const utils = trpc.useUtils();
  const list = trpc.preferences.list.useQuery();
  const setMutation = trpc.preferences.set.useMutation({
    onSuccess: () => utils.preferences.list.invalidate(),
  });
  const deleteMutation = trpc.preferences.delete.useMutation({
    onSuccess: () => utils.preferences.list.invalidate(),
  });

  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [editing, setEditing] = useState<{
    scope: string;
    key: string;
    field: "value" | "description";
    text: string;
  } | null>(null);

  if (list.isLoading) return <p className="text-sm">Loading…</p>;
  if (list.error)
    return <p className="text-sm text-red-600">Error: {list.error.message}</p>;

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm"
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
        >
          Add preference
        </button>
      </div>

      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm" data-testid="preferences-table">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="p-2 w-32">Scope</th>
              <th className="p-2 w-44">Key</th>
              <th className="p-2">Value</th>
              <th className="p-2 w-56">Description</th>
              <th className="p-2 w-32">Updated</th>
              <th className="p-2 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && draft === null && (
              <tr>
                <td
                  colSpan={6}
                  className="p-4 text-center text-muted-foreground"
                >
                  No preferences yet. Click &quot;Add preference&quot; to start.
                </td>
              </tr>
            )}

            {rows.map((row) => {
              const isEditing =
                editing &&
                editing.scope === row.scope &&
                editing.key === row.key;
              return (
                <tr
                  key={`${row.scope}::${row.key}`}
                  className="border-t"
                  data-testid={`preferences-row-${row.scope}-${row.key}`}
                >
                  <td className="p-2 font-mono">{row.scope}</td>
                  <td className="p-2 font-mono">{row.key}</td>
                  <td
                    className={cn("p-2 cursor-pointer align-top")}
                    onClick={() =>
                      setEditing({
                        scope: row.scope,
                        key: row.key,
                        field: "value",
                        text: row.value,
                      })
                    }
                  >
                    {isEditing && editing.field === "value" ? (
                      <CellTextarea
                        value={editing.text}
                        onChange={(text) =>
                          setEditing({ ...editing, text })
                        }
                        onCommit={async () => {
                          await setMutation.mutateAsync({
                            scope: row.scope,
                            key: row.key,
                            value: editing.text,
                            description: row.description,
                          });
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                        testId="edit-value"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-sans">
                        {row.value}
                      </pre>
                    )}
                  </td>
                  <td
                    className="p-2 cursor-pointer text-muted-foreground align-top"
                    onClick={() =>
                      setEditing({
                        scope: row.scope,
                        key: row.key,
                        field: "description",
                        text: row.description ?? "",
                      })
                    }
                  >
                    {isEditing && editing.field === "description" ? (
                      <CellTextarea
                        value={editing.text}
                        onChange={(text) =>
                          setEditing({ ...editing, text })
                        }
                        onCommit={async () => {
                          await setMutation.mutateAsync({
                            scope: row.scope,
                            key: row.key,
                            value: row.value,
                            description: editing.text,
                          });
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                        testId="edit-description"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-sans">
                        {row.description ?? "—"}
                      </pre>
                    )}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-red-600 text-xs"
                      onClick={async () => {
                        if (!confirm(`Delete ${row.scope}/${row.key}?`))
                          return;
                        await deleteMutation.mutateAsync({
                          scope: row.scope,
                          key: row.key,
                        });
                      }}
                      data-testid="delete-button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}

            {draft && (
              <tr className="border-t bg-yellow-50/30" data-testid="draft-row">
                <td className="p-2">
                  <select
                    value={draft.scope.startsWith("project:")
                      ? "project"
                      : "global"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        scope:
                          e.target.value === "global" ? "global" : "project:",
                      })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                  >
                    <option value="global">global</option>
                    <option value="project">project:&lt;slug&gt;</option>
                  </select>
                  {draft.scope.startsWith("project:") && (
                    <input
                      type="text"
                      placeholder="slug"
                      value={draft.scope.slice("project:".length)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          scope: `project:${e.target.value}`,
                        })
                      }
                      className="mt-1 w-full text-xs border rounded px-1 py-0.5 font-mono"
                      data-testid="draft-scope-slug"
                    />
                  )}
                </td>
                <td className="p-2">
                  <input
                    type="text"
                    placeholder="snake_case_key"
                    value={draft.key}
                    onChange={(e) =>
                      setDraft({ ...draft, key: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5 font-mono"
                    data-testid="draft-key"
                  />
                </td>
                <td className="p-2">
                  <textarea
                    value={draft.value}
                    onChange={(e) =>
                      setDraft({ ...draft, value: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                    rows={2}
                    data-testid="draft-value"
                  />
                </td>
                <td className="p-2">
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    className="w-full text-xs border rounded px-1 py-0.5"
                    rows={2}
                    data-testid="draft-description"
                  />
                </td>
                <td className="p-2 text-xs text-muted-foreground">—</td>
                <td className="p-2 space-x-2">
                  <button
                    type="button"
                    className="text-xs"
                    onClick={async () => {
                      try {
                        await setMutation.mutateAsync({
                          scope: draft.scope,
                          key: draft.key,
                          value: draft.value,
                          description:
                            draft.description.trim() === ""
                              ? null
                              : draft.description,
                        });
                        setDraft(null);
                      } catch (err) {
                        alert(
                          err instanceof Error ? err.message : "Save failed"
                        );
                      }
                    }}
                    data-testid="draft-save"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellTextarea({
  value,
  onChange,
  onCommit,
  onCancel,
  testId,
}: {
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  return (
    <textarea
      autoFocus
      value={value}
      rows={Math.max(1, Math.min(8, value.split("\n").length))}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onCommit();
        }
      }}
      className="w-full text-sm border rounded px-1 py-0.5"
      data-testid={testId}
    />
  );
}
```

> **Note on imports:** Verify `trpc` is exported from `@/lib/trpc-client` (it is in this codebase — check existing pages like `notes` or `todos` to confirm the exact import path; adjust if different). Verify the path alias `@/` resolves to `src/`.

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/preferences/
git commit -m "feat(ui): /preferences page with inline-edit table"
```

---

## Task 10: Add sidebar entry

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Inspect the sidebar**

Run: `cat src/components/layout/sidebar.tsx | head -80`

Identify how existing entries are added (likely an array of `{ href, label, icon }`).

- [ ] **Step 2: Add the Preferences entry**

Add a new entry near settings/usage. Use a generic icon (`Settings2`, `Cog`, or whatever lucide-react icons are already imported in this file). Follow the exact shape the file uses:

```tsx
{ href: "/preferences", label: "Preferences", icon: Settings2 }
```

- [ ] **Step 3: Manual sanity check**

Run: `pnpm dev` (separate terminal)
Open: `http://localhost:3000/preferences`
Expected: page renders, sidebar shows "Preferences" entry, table is empty with "Add preference" button.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat(ui): add Preferences sidebar entry"
```

---

## Task 11: E2E — UI CRUD flow

**Files:**
- Create: `e2e/preferences.spec.ts`

- [ ] **Step 1: Inspect an existing E2E for auth/setup boilerplate**

Run: `head -60 e2e/notes.spec.ts 2>/dev/null || ls e2e/*.spec.ts | head -3 | xargs head -60`

Note the auth helper (likely `loginAs(page, ...)` or a stored auth state from `playwright.auth.config.ts`). Use the same setup.

- [ ] **Step 2: Write the E2E test**

Create `e2e/preferences.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

// Random suffix to avoid collisions in shared SQLite DB
const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("Preferences page", () => {
  test("create, edit, and delete a global preference", async ({ page }) => {
    const key = `e2e_${uid()}`;
    const initialValue = "initial value";
    const updatedValue = "updated value";

    await page.goto("/preferences");
    await expect(page.locator("main h1")).toHaveText("Agent Preferences");

    // Create
    await page.getByRole("button", { name: "Add preference" }).click();
    await page.getByTestId("draft-key").fill(key);
    await page.getByTestId("draft-value").fill(initialValue);
    await page.getByTestId("draft-save").click();

    const row = page.getByTestId(`preferences-row-global-${key}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(initialValue);

    // Edit value
    await row.locator("td").nth(2).click();
    const valueEdit = page.getByTestId("edit-value");
    await valueEdit.fill(updatedValue);
    await valueEdit.press("Meta+Enter").catch(() => valueEdit.press("Control+Enter"));
    await expect(row).toContainText(updatedValue);

    // Delete
    page.once("dialog", (d) => d.accept());
    await row.getByTestId("delete-button").click();
    await expect(row).not.toBeVisible();
  });

  test("create a project-scoped preference", async ({ page }) => {
    const key = `e2e_${uid()}`;
    const slug = `proj_${uid()}`;

    await page.goto("/preferences");

    await page.getByRole("button", { name: "Add preference" }).click();
    await page
      .locator('select')
      .first()
      .selectOption("project");
    await page.getByTestId("draft-scope-slug").fill(slug);
    await page.getByTestId("draft-key").fill(key);
    await page.getByTestId("draft-value").fill("project value");
    await page.getByTestId("draft-save").click();

    await expect(
      page.getByTestId(`preferences-row-project:${slug}-${key}`)
    ).toBeVisible();
  });

  test("rejects invalid key client-side via server validation", async ({ page }) => {
    await page.goto("/preferences");

    await page.getByRole("button", { name: "Add preference" }).click();
    await page.getByTestId("draft-key").fill("Bad-Key");
    await page.getByTestId("draft-value").fill("v");

    page.once("dialog", async (d) => {
      expect(d.message()).toMatch(/key/i);
      await d.dismiss();
    });
    await page.getByTestId("draft-save").click();
  });
});
```

- [ ] **Step 3: Run the E2E**

Run: `pnpm test:e2e e2e/preferences.spec.ts`
Expected: all 3 tests pass.

If the auth setup differs from this spec's assumption, update accordingly per existing E2E conventions (e.g. add a `test.use({ storageState: ... })` or login `beforeEach`).

- [ ] **Step 4: Commit**

```bash
git add e2e/preferences.spec.ts
git commit -m "test(e2e): preferences page CRUD"
```

---

## Task 12: E2E — MCP HTTP endpoint smoke test

**Files:**
- Create: `e2e/preferences-mcp.spec.ts`

- [ ] **Step 1: Inspect existing MCP tests**

Run: `grep -l 'api/mcp' e2e/ -r 2>/dev/null` — if there's an existing MCP E2E (e.g. for `save_to_knosi`), read it to see how they obtain a bearer token.

Run: `ls e2e/` and look for `mcp` or `oauth` patterns. If there's a helper like `getTestBearerToken()`, reuse it. Otherwise the simplest path is to issue a fresh OAuth token in `beforeAll` via the existing OAuth endpoints.

- [ ] **Step 2: Write the MCP smoke test**

Create `e2e/preferences-mcp.spec.ts`. Adapt the token acquisition to match existing helpers:

```typescript
import { expect, request, test } from "@playwright/test";

// Replace this with your existing helper if one exists.
async function getBearerToken(): Promise<string> {
  const tokenFromEnv = process.env.E2E_KNOSI_BEARER;
  if (!tokenFromEnv) {
    throw new Error(
      "Set E2E_KNOSI_BEARER to a valid OAuth access token with " +
        "preferences:read + preferences:write scopes before running this spec."
    );
  }
  return tokenFromEnv;
}

const uid = () => Math.random().toString(36).slice(2, 8);

test.describe("MCP — knosi_pref_* tools", () => {
  test("list, set, delete via MCP HTTP endpoint", async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const token = await getBearerToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const key = `e2e_mcp_${uid()}`;

    // 1. set
    let res = await ctx.post("/api/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "knosi_pref_set",
          arguments: {
            scope: "global",
            key,
            value: "via-mcp",
            description: "set via MCP smoke test",
          },
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const setBody = await res.json();
    expect(setBody.result.structuredContent).toMatchObject({
      created: true,
    });

    // 2. list (should include the new pref)
    res = await ctx.post("/api/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "knosi_pref_list", arguments: {} },
      },
    });
    expect(res.ok()).toBeTruthy();
    const listBody = await res.json();
    const items = listBody.result.structuredContent.items as Array<{
      scope: string;
      key: string;
      value: string;
    }>;
    const found = items.find((p) => p.scope === "global" && p.key === key);
    expect(found?.value).toBe("via-mcp");

    // 3. delete
    res = await ctx.post("/api/mcp", {
      headers,
      data: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "knosi_pref_delete",
          arguments: { scope: "global", key },
        },
      },
    });
    const delBody = await res.json();
    expect(delBody.result.structuredContent).toMatchObject({ deleted: true });
  });

  test("missing scope returns 401 with WWW-Authenticate", async ({ baseURL }) => {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post("/api/mcp", {
      headers: { "Content-Type": "application/json" },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "knosi_pref_list", arguments: {} },
      },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("Bearer");
  });
});
```

- [ ] **Step 3: Run the MCP E2E**

Acquire a bearer token via the existing OAuth flow or your dev tooling (the codebase already exercises this for `save_to_knosi` — reuse that path). Set:

```bash
export E2E_KNOSI_BEARER=<token>
```

Run: `pnpm test:e2e e2e/preferences-mcp.spec.ts`
Expected: both tests pass.

If the codebase has a different convention for E2E auth (e.g. seeded tokens), follow that — leave the env var fallback for local development.

- [ ] **Step 4: Commit**

```bash
git add e2e/preferences-mcp.spec.ts
git commit -m "test(e2e): MCP knosi_pref_* tool smoke test"
```

---

## Task 13: Run the full self-verification trio

Per `CLAUDE.md` rule 2 — these must pass before declaring Phase 1 done.

- [ ] **Step 1: Build**

Run: `pnpm build`
Expected: build succeeds, zero TypeScript errors.

If errors surface, fix them. Do NOT proceed.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 3: Full E2E suite**

Run: `pnpm test:e2e`
Expected: all suites pass (existing + the two new ones).

If any test outside `preferences*.spec.ts` fails, investigate — the schema change may have inadvertently affected something. Do NOT mark complete with failures.

- [ ] **Step 4: Run unit tests too**

Run: `pnpm exec vitest run`
Expected: all unit tests pass.

---

## Task 14: Production schema rollout (Turso)

Per `AGENTS.md` Verification Rules — schema changes must be applied to production Turso, not just local libsql, with the rollout command and verification recorded in the changelog.

- [ ] **Step 1: Prepare rollout SQL**

The migration generated in Task 1 lives in `drizzle/00XX_*.sql`. Inspect it:

Run: `cat drizzle/00XX_*.sql` (replace XX with the new migration number)
Confirm it only contains the `preferences` table + indexes (no unintended extra changes).

- [ ] **Step 2: Verify production credentials are available**

Run: `ls .env.turso-prod.local`
Expected: file exists. Per `~/knosi/CLAUDE.md` rule, credentials live there — do not ask the user for them.

- [ ] **Step 3: Apply to production**

Use whichever method has been documented for this codebase. If the convention is `drizzle-kit push` against the prod URL, run it explicitly with the prod env. If the convention is to execute the SQL file directly via `turso db shell`, use that.

Example pattern (verify against existing changelog entries that mention Turso rollout — e.g. search `docs/changelog/` for `turso`):

```bash
# Approach A: drizzle-kit push using prod credentials
env $(grep -v '^#' .env.turso-prod.local | xargs) pnpm db:push

# Approach B: execute SQL via turso CLI
turso db shell <prod-db-name> < drizzle/00XX_<file>.sql
```

Pick the approach that matches existing changelogs. Record the **exact** command used in the next task.

- [ ] **Step 4: Verify production schema**

Run a verification query against production:

```bash
turso db shell <prod-db-name> "SELECT name FROM sqlite_master WHERE type='table' AND name='preferences';"
```

Expected output: `preferences`

Also verify the unique index:

```bash
turso db shell <prod-db-name> "SELECT name FROM sqlite_master WHERE type='index' AND name='preferences_user_scope_key_idx';"
```

Expected: `preferences_user_scope_key_idx`

- [ ] **Step 5: Commit a rollout note (no code change, just for traceability)**

This task does not modify code, but the next task (changelog entry) records what happened.

---

## Task 15: Phase changelog + README progress update

Per `~/knosi/CLAUDE.md` rules 1 and 5.

**Files:**
- Create: `docs/changelog/phase-knosi-acl-1.md`
- Modify: `README.md` (or `README.zh-CN.md` — match the file's existing progress checklist)

- [ ] **Step 1: Write the changelog entry**

Create `docs/changelog/phase-knosi-acl-1.md`:

```markdown
# Phase: Agent Context Layer — Phase 1 (Preferences)

**Date:** 2026-05-02
**Spec:** `docs/superpowers/specs/2026-05-02-knosi-agent-context-layer-phase1-design.md`
**Plan:** `docs/superpowers/plans/2026-05-02-knosi-agent-context-layer-phase1.md`
**Branch:** `feat/agent-context-layer-phase1`

## Goal

Add the first layer of Knosi's Agent Context Layer: cross-agent preferences shared across local Claude Code, Hermes, and (in Phase 1.5) Claude Code Web.

## Key changes

- New `preferences` table (Drizzle schema + migration `drizzle/00XX_*.sql`)
- `src/server/integrations/preferences-store.ts` — pure CRUD with validation
- 3 new MCP tools: `knosi_pref_list`, `knosi_pref_set`, `knosi_pref_delete`
- 2 new OAuth scopes: `preferences:read`, `preferences:write` (added to `anthropic-connector` and `knosi-cli`)
- `preferences` tRPC router for the UI
- `/preferences` page — inline-edit table
- Sidebar entry

## Files touched

- Create: `src/server/db/schema/preferences.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `src/server/integrations/preferences-store.ts` + `.test.ts`
- Modify: `src/server/integrations/oauth-clients.ts`
- Modify: `src/server/integrations/mcp-tools.ts` + `.test.ts`
- Modify: `src/app/api/mcp/route.ts`
- Create: `src/server/routers/preferences.ts`
- Modify: `src/server/routers/_app.ts`
- Create: `src/app/(app)/preferences/page.tsx` + `preferences-table.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Create: `e2e/preferences.spec.ts` + `e2e/preferences-mcp.spec.ts`

## Verification

| Check | Result |
|---|---|
| `pnpm build` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm exec vitest run` | ✅ all pass |
| `pnpm test:e2e` | ✅ all suites pass |
| Production Turso schema rolled out | ✅ |

### Production rollout commands

```
<paste the exact command(s) used in Task 14 here>
```

### Production verification query results

```
<paste the actual outputs from Task 14 step 4 here>
```

## Cross-agent migration (manual, post-deploy)

These steps live outside the repo and are tracked here for completeness:

1. Audit `~/.claude/CLAUDE.md` and `~/.claude/projects/-Users-bytedance/memory/*.md`. Migrate true preferences (Type A) into Knosi via `/preferences` page.
2. Remove migrated entries from the source files; replace with a pointer block:
   > Preferences are managed in Knosi. Call `knosi_pref_list` at session start.
3. Update `MEMORY.md` index — drop migrated entries.
4. Add the same calling-rules block to a new Hermes skill `knosi-preferences`.

## Out of scope (deferred)

- Claude Code Web connector configuration → Phase 1.5
- Episodic memories table → Phase 2
- Skills sync → Phase 3
- Project workspaces → Phase 4

## Risks / follow-ups

- Cross-agent sync verification must be re-tested after the manual migration step.
- If `pref_list` ever exceeds ~200 rows it may be worth caching at the agent edge.
```

- [ ] **Step 2: Update README progress checklist**

Open `README.md` (or `README.zh-CN.md` if that's the one with the checklist — check both, mirror the pattern). Find the phase checklist and add a line for this phase. If no such checklist exists, skip this step.

- [ ] **Step 3: Commit**

```bash
git add docs/changelog/phase-knosi-acl-1.md README.md README.zh-CN.md 2>/dev/null || true
git commit -m "docs(changelog): phase Knosi ACL-1 — preferences"
```

---

## Task 16: Manual cross-agent migration + verify Phase 1 DoD

This is the **final acceptance step**. It happens **after** the code is merged to `main` and deployed (via the existing deploy workflow on push), because it touches files outside this repo.

- [ ] **Step 1: Push and merge**

```bash
git push -u origin feat/agent-context-layer-phase1
```

Open a PR or merge directly per existing convention (`~/knosi/CLAUDE.md` rule 5: push to main triggers production deploy via GitHub Actions).

After deploy completes (CI green + Hetzner deploy logs healthy), proceed.

- [ ] **Step 2: Migrate preferences from `~/.claude/CLAUDE.md`**

Open `~/.claude/CLAUDE.md` and `~/.claude/projects/-Users-bytedance/memory/MEMORY.md` plus the linked memory files.

Classify each entry:
- **Type A** (true preference) → migrate to Knosi via `/preferences`
- **Type B** (reference/index) → leave in place
- **Type C** (episodic memory) → leave in place; will move in Phase 2

Approximate Type A list (subject to per-entry audit):
- `response_language` = "Always reply in Chinese..." (global)
- `package_manager` = "pnpm" (global)
- `claude_code_no_flicker` = environment-variable instruction (global)
- `credentials_in_chat` = feedback content (global)
- `multi_repo_bash_cwd` = feedback content (global)

For each Type A entry, open `/preferences` and add the row, then delete the original entry from the source file.

- [ ] **Step 3: Add the calling-rules block to `~/.claude/CLAUDE.md`**

Append this section:

```markdown
## Knosi Agent Context Layer

Cross-agent preferences are managed in Knosi (single source of truth).
This file no longer maintains preference content; pull from Knosi instead.

### Calling rules

At session start (at most once):
- Call `knosi_pref_list` (no args) to load global preferences.
- When entering a known project directory (BE repo index above), also call
  `knosi_pref_list({ scope: "project:<slug>" })`.

When the user instructs a new persistent constraint
("from now on", "always", "never", "use X instead of Y"):
- Confirm with the user.
- Call `knosi_pref_set` with appropriate scope and key.

When the user revokes a constraint ("stop doing X", "forget that"):
- Call `knosi_pref_delete`.

Apply returned preferences to subsequent responses.
```

- [ ] **Step 4: Trim `MEMORY.md` index**

Remove links pointing to entries that were migrated to Knosi. Surviving entries (BE repo index, server topology, etc.) stay.

- [ ] **Step 5: Add Hermes skill**

SSH into the Knosi server (`ssh knosi`). Locate the Hermes skill directory under `/usr/local/lib/hermes-agent/` or `/root/.hermes/` (per `knosi_server.md` memory). Add a new skill file `knosi-preferences.md`:

```markdown
---
name: knosi-preferences
description: Apply Knosi preferences when handling messages
when_to_use:
  - At conversation start
  - User mentions a project name (knosi, ttec.*, leetcode-review)
  - User says "always", "never", "from now on", "remember"
---

At conversation start: call `knosi_pref_list` once.

If user mentions a known project, also call
`knosi_pref_list({ scope: "project:<slug>" })`.

If user instructs a new persistent constraint:
- Confirm with user.
- Call `knosi_pref_set` with appropriate scope and key.

Apply the returned preferences to subsequent responses
(language, tooling choices, formatting, etc.).
```

Configure Hermes' MCP client to point at the cluster-internal Knosi
service (per Spec §8.2). Restart `hermes-gateway.service`:

```bash
systemctl --user restart hermes-gateway.service
```

- [ ] **Step 6: Verify cross-agent sync (the DoD acceptance test)**

1. Open `/preferences` in a browser. Add a probe preference, e.g.
   `global / probe_acl_1 / "ACL probe — change this value to test sync"`.
2. Open a fresh local Claude Code session in any directory. Ask:
   `What preferences do I have set?`
   Confirm: agent calls `knosi_pref_list` and reports the probe value.
3. Send a fresh message to the Hermes Telegram bot:
   `What preferences are configured for me?`
   Confirm: Hermes calls `knosi_pref_list` and reports the same probe value.
4. Edit the probe value via `/preferences`. Repeat steps 2 and 3 in
   **fresh** sessions. Both should reflect the new value within seconds.
5. Delete the probe preference. Done.

If any step fails, do NOT mark Phase 1 complete. Investigate the failing
agent's MCP config / scope grants.

- [ ] **Step 7: Final completion log**

Append to the changelog file (`docs/changelog/phase-knosi-acl-1.md`) a "DoD verified" section recording:
- Probe test results from Step 6
- Any surprises during manual migration

Commit and push:

```bash
git add docs/changelog/phase-knosi-acl-1.md
git commit -m "docs(changelog): record Phase ACL-1 DoD verification"
git push
```

---

## Self-Review Notes (already addressed inline)

- Spec §5.1 → Task 1
- Spec §5.2 (validation rules) → Task 3 (`assertScope`/`assertKey`/`assertValue`) + Task 8 (zod schemas)
- Spec §6.1 (`knosi_pref_list`) → Task 5/6 (registration + dispatch)
- Spec §6.2 (`knosi_pref_set`) → Task 5/6
- Spec §6.3 (`knosi_pref_delete`) → Task 5/6
- Spec §7 (UI) → Tasks 9 + 10
- Spec §8.1 (local Claude Code integration) → Task 16 step 3
- Spec §8.2 (Hermes integration) → Task 16 step 5
- Spec §9 (auth / scopes) → Task 4 + Task 7
- Spec §10 (no caching) → no task needed; default behavior
- Spec §11 (migration) → Task 16 steps 2–4
- Spec §12 (DoD) → Task 13 (build/lint/test) + Task 14 (Turso) + Task 16 step 6 (cross-agent sync)
- Spec §13 risks → addressed by single-source enforcement in Task 16

Type-name consistency check:
- `listPreferences` / `setPreference` / `deletePreference` — used identically across Tasks 2/3/5/6/8.
- `PreferenceRow` shape — used identically across store, MCP dispatch, router, and UI.
- `data-testid` ids — consistent between component (Task 9) and E2E (Task 11).

No placeholders remain.
