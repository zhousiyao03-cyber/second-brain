# Claude to Knosi Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Web and Claude Code explicitly save raw conversation excerpts into Knosi's `AI Inbox`, while also letting Claude Web read knowledge through a remote MCP connector.

**Architecture:** Build one shared server-side capture core that creates raw AI capture notes in the existing `notes` table and auto-creates an `AI Inbox` folder when needed. Put two adapters in front of that core: a public `remote MCP` surface for Claude Web and a local `packages/cli` write path for Claude Code skill workflows. Reuse existing Knosi accounts, but issue separate OAuth credentials for connector and CLI clients so session cookies are not used as machine credentials.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM with libsql/Turso, NextAuth/Auth.js v5, Node.js ESM CLI, lightweight JSON-RPC over HTTP for the remote MCP endpoint, existing Knosi notes/indexing stack.

---

## File Structure

### Existing files to modify

- `.env.example`
  - document OAuth / connector environment variables
- `src/server/db/schema.ts`
  - add integration auth tables
- `src/app/(app)/settings/page.tsx`
  - render the Connected AI Clients section
- `src/app/login/page.tsx`
  - preserve `next` so OAuth authorize can resume after login
- `src/app/login/actions.ts`
  - redirect credentials sign-in back to the requested path instead of always `/dashboard`
- `packages/cli/package.json`
  - update description/keywords if the CLI is no longer daemon-only
- `packages/cli/src/index.mjs`
  - refactor from daemon-only entrypoint to subcommand dispatcher while keeping daemon mode working
- `packages/cli/src/daemon.mjs`
  - extracted current daemon loop so the new subcommand dispatcher stays small
- `README.md`
  - document Claude Web connector setup and Claude Code CLI + skill setup
- `packages/cli/README.md`
  - document `knosi auth login`, `knosi save-ai-note --json`, and skill install

### New server files

- `src/server/integrations/ai-inbox.ts`
  - resolve/create the root-level `AI Inbox` folder
- `src/server/integrations/ai-capture.ts`
  - title derivation, markdown rendering, note insert, index enqueue
- `src/server/integrations/ai-capture.test.mjs`
  - unit tests for capture behavior
- `src/server/integrations/oauth-clients.ts`
  - static registry for the `knosi-cli` and `anthropic-connector` OAuth clients
- `src/server/integrations/oauth.ts`
  - auth code issuance, PKCE verification, access token issuance, refresh, revoke, bearer validation
- `src/server/integrations/oauth.test.mjs`
  - unit tests for OAuth primitives and scope enforcement
- `src/server/integrations/knowledge-read.ts`
  - search/recent/get services for MCP tools
- `src/server/integrations/knowledge-read.test.mjs`
  - tests for read tool data selection and ownership filtering
- `src/server/integrations/mcp-tools.ts`
  - translate remote MCP tool calls into service-layer functions
- `src/server/integrations/mcp-tools.test.mjs`
  - tests for tool dispatch and create-only write scope

### New Next.js routes and pages

- `src/app/oauth/authorize/page.tsx`
  - OAuth consent UI
- `src/app/oauth/authorize/actions.ts`
  - approve/deny server actions for the consent page
- `src/app/api/oauth/token/route.ts`
  - authorization-code exchange and refresh-token exchange
- `src/app/api/oauth/revoke/route.ts`
  - token revocation endpoint
- `src/app/.well-known/oauth-authorization-server/route.ts`
  - OAuth metadata for connector/CLI discovery
- `src/app/api/integrations/ai-captures/route.ts`
  - CLI capture API that calls `captureAiNote()`
- `src/app/api/mcp/route.ts`
  - remote MCP HTTP endpoint for Claude Web

### New settings UI files

- `src/app/(app)/settings/connected-ai-clients-section.tsx`
  - show active connector/CLI authorizations and revoke buttons
- `src/app/(app)/settings/connected-ai-clients-actions.ts`
  - server actions for revocation

### New CLI files

- `packages/cli/src/config.mjs`
  - local config/token storage and base URL resolution
- `packages/cli/src/http.mjs`
  - authenticated fetch helpers with token refresh
- `packages/cli/src/commands/auth-login.mjs`
  - browser-based OAuth login for the CLI
- `packages/cli/src/commands/save-ai-note.mjs`
  - stdin JSON capture command
- `packages/cli/src/commands/install-skill.mjs`
  - install/update the personal Claude Code skill template
- `packages/cli/src/commands/auth-login.test.mjs`
  - unit tests for login URL generation and callback parsing
- `packages/cli/src/commands/save-ai-note.test.mjs`
  - unit tests for stdin parsing and request shaping
- `packages/cli/templates/save-to-knosi/SKILL.md`
  - personal skill template copied into `~/.claude/skills/save-to-knosi/SKILL.md`

### New migration / rollout files

- `drizzle/0029_claude_knosi_capture.sql`
  - local schema migration for integration auth tables
- `drizzle/meta/0029_snapshot.json`
  - Drizzle snapshot generated alongside the migration
- `scripts/db/2026-04-12-claude-knosi-capture.sql`
  - deterministic production Turso rollout SQL
- `scripts/db/apply-2026-04-12-claude-knosi-capture-rollout.mjs`
  - production rollout script using `@libsql/client` and `.env.turso-prod.local`

### New implementation log

- `docs/changelog/2026-04-12-claude-knosi-capture-implementation.md`
  - implementation record, verification commands, production rollout result, residual risks

---

### Task 1: Build the shared AI Inbox resolver and raw note capture core

**Files:**
- Create: `src/server/integrations/ai-inbox.ts`
- Create: `src/server/integrations/ai-capture.ts`
- Create: `src/server/integrations/ai-capture.test.mjs`
- Reuse: `src/lib/markdown-to-tiptap.ts`
- Reuse: `src/server/ai/indexer.ts`

- [ ] **Step 1: Write failing tests for title derivation, markdown rendering, and AI Inbox creation**

Create `src/server/integrations/ai-capture.test.mjs` with:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAiCaptureMarkdown,
  deriveAiCaptureTitle,
} from "./ai-capture.ts";
import { resolveOrCreateAiInboxFolder } from "./ai-inbox.ts";

test("deriveAiCaptureTitle prefers explicit title and otherwise uses first user turn", () => {
  assert.equal(
    deriveAiCaptureTitle({
      title: "Keep this",
      messages: [{ role: "user", content: "ignored because explicit title exists" }],
      now: new Date("2026-04-12T07:20:00.000Z"),
    }),
    "Keep this"
  );

  assert.equal(
    deriveAiCaptureTitle({
      messages: [{ role: "user", content: "How should I model OAuth grants for connector clients?" }],
      now: new Date("2026-04-12T07:20:00.000Z"),
    }),
    "How should I model OAuth grants for connector clients?"
  );
});

test("buildAiCaptureMarkdown preserves raw excerpt and metadata only", () => {
  const markdown = buildAiCaptureMarkdown({
    messages: [
      { role: "user", content: "Question body" },
      { role: "assistant", content: "Answer body" },
    ],
    sourceApp: "claude-code",
    capturedAtLabel: "2026-04-12 15:20 SGT",
    sourceMeta: { projectPath: "/Users/bytedance/second-brain" },
  });

  assert.match(markdown, /# Raw Excerpt/);
  assert.match(markdown, /## User\\nQuestion body/);
  assert.match(markdown, /## Claude\\nAnswer body/);
  assert.match(markdown, /- Source: claude-code/);
  assert.doesNotMatch(markdown, /Summary/);
});

test("resolveOrCreateAiInboxFolder creates AI Inbox only once", async () => {
  let insertCount = 0;
  const folders = [];

  const firstId = await resolveOrCreateAiInboxFolder({
    userId: "user-1",
    findRootFolderByName: async () => null,
    getMaxRootSortOrder: async () => 4,
    insertFolder: async (row) => {
      insertCount += 1;
      folders.push(row);
      return row.id;
    },
  });

  assert.equal(insertCount, 1);
  assert.equal(firstId, folders[0].id);
});
```

- [ ] **Step 2: Run the test file and confirm the missing imports/functions fail**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/ai-capture.test.mjs
```

Expected: FAIL with missing module or missing export errors for `./ai-capture.ts` and `./ai-inbox.ts`.

- [ ] **Step 3: Implement the AI Inbox resolver and pure capture helpers**

Create `src/server/integrations/ai-inbox.ts` with:

```typescript
import crypto from "node:crypto";
import { sql, and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { folders } from "@/server/db/schema";

const AI_INBOX_FOLDER_NAME = "AI Inbox";

export async function resolveOrCreateAiInboxFolder(deps: {
  userId: string;
  findRootFolderByName?: (args: { userId: string; name: string }) => Promise<{ id: string } | null>;
  getMaxRootSortOrder?: (args: { userId: string }) => Promise<number>;
  insertFolder?: (row: {
    id: string;
    userId: string;
    name: string;
    parentId: null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }) => Promise<string>;
}) {
  const findRootFolderByName =
    deps.findRootFolderByName ??
    (async ({ userId, name }) => {
      const [existing] = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.userId, userId), eq(folders.name, name), sql`${folders.parentId} is null`))
        .limit(1);
      return existing ?? null;
    });

  const existing = await findRootFolderByName({ userId: deps.userId, name: AI_INBOX_FOLDER_NAME });
  if (existing) return existing.id;

  const getMaxRootSortOrder =
    deps.getMaxRootSortOrder ??
    (async ({ userId }) => {
      const [row] = await db
        .select({ max: sql<number>`coalesce(max(${folders.sortOrder}), -1)` })
        .from(folders)
        .where(and(eq(folders.userId, userId), sql`${folders.parentId} is null`));
      return row?.max ?? -1;
    });

  const sortOrder = (await getMaxRootSortOrder({ userId: deps.userId })) + 1;
  const row = {
    id: crypto.randomUUID(),
    userId: deps.userId,
    name: AI_INBOX_FOLDER_NAME,
    parentId: null,
    sortOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const insertFolder = deps.insertFolder ?? (async (value) => {
    await db.insert(folders).values(value);
    return value.id;
  });

  return insertFolder(row);
}
```

Create `src/server/integrations/ai-capture.ts` with:

```typescript
import crypto from "node:crypto";
import { markdownToTiptap } from "@/lib/markdown-to-tiptap";
import { db } from "@/server/db";
import { notes } from "@/server/db/schema";
import { enqueueNoteIndexJob } from "@/server/ai/indexer";
import { resolveOrCreateAiInboxFolder } from "./ai-inbox";

export function deriveAiCaptureTitle(input: {
  title?: string | null;
  messages: Array<{ role: string; content: string }>;
  now?: Date;
}) {
  const explicit = input.title?.trim();
  if (explicit) return explicit.slice(0, 160);

  const firstUser = input.messages.find((message) => message.role === "user")?.content?.trim();
  if (firstUser) return firstUser.slice(0, 160);

  const now = input.now ?? new Date();
  return `Claude Capture - ${now.toISOString().slice(0, 16).replace("T", " ")}`;
}

export function buildAiCaptureMarkdown(input: {
  messages: Array<{ role: string; content: string }>;
  sourceApp: string;
  capturedAtLabel: string;
  sourceMeta?: { projectPath?: string; conversationHint?: string };
}) {
  const sections = ["# Raw Excerpt", ""];

  for (const message of input.messages) {
    sections.push(`## ${message.role === "assistant" ? "Claude" : "User"}`);
    sections.push(message.content.trim() || "(empty)");
    sections.push("");
  }

  sections.push("# Metadata");
  sections.push(`- Source: ${input.sourceApp}`);
  sections.push(`- Captured at: ${input.capturedAtLabel}`);
  if (input.sourceMeta?.projectPath) sections.push(`- Project: ${input.sourceMeta.projectPath}`);
  if (input.sourceMeta?.conversationHint) sections.push(`- Conversation hint: ${input.sourceMeta.conversationHint}`);

  return sections.join("\\n");
}
```

- [ ] **Step 4: Add the note insert path and index enqueue**

Extend `src/server/integrations/ai-capture.ts` with:

```typescript
function flattenMessagesToPlainText(messages: Array<{ role: string; content: string }>) {
  return messages
    .map((message) => `${message.role === "assistant" ? "Claude" : "User"}:\\n${message.content.trim()}`)
    .join("\\n\\n");
}

export async function captureAiNote(input: {
  userId: string;
  title?: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  sourceApp: "claude-web" | "claude-code";
  sourceMeta?: { projectPath?: string; conversationHint?: string };
  capturedAt?: Date;
  originUrl?: string;
}) {
  const capturedAt = input.capturedAt ?? new Date();
  const folderId = await resolveOrCreateAiInboxFolder({ userId: input.userId });
  const title = deriveAiCaptureTitle({ title: input.title, messages: input.messages, now: capturedAt });
  const markdown = buildAiCaptureMarkdown({
    messages: input.messages,
    sourceApp: input.sourceApp,
    capturedAtLabel: capturedAt.toLocaleString("en-SG", { hour12: false, timeZone: "Asia/Singapore" }),
    sourceMeta: input.sourceMeta,
  });
  const tiptapDoc = markdownToTiptap(markdown);
  const plainText = flattenMessagesToPlainText(input.messages);
  const id = crypto.randomUUID();

  await db.insert(notes).values({
    id,
    userId: input.userId,
    title,
    content: JSON.stringify(tiptapDoc),
    plainText,
    type: "note",
    folderId,
  });

  await enqueueNoteIndexJob(id, "ai-capture-create");

  return {
    noteId: id,
    title,
    url: input.originUrl ? `${input.originUrl.replace(/\\/$/, "")}/notes/${id}` : `/notes/${id}`,
  };
}
```

- [ ] **Step 5: Re-run the tests and confirm the helper contract passes**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/ai-capture.test.mjs
```

Expected: PASS for the title, markdown, and folder resolver tests.

- [ ] **Step 6: Commit the shared capture core**

```bash
cd /Users/bytedance/second-brain && git add src/server/integrations/ai-inbox.ts src/server/integrations/ai-capture.ts src/server/integrations/ai-capture.test.mjs && git commit -m "feat: add shared AI capture core and AI Inbox resolver"
```

---

### Task 2: Add integration auth tables, OAuth primitives, and production rollout assets

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `src/server/integrations/oauth-clients.ts`
- Create: `src/server/integrations/oauth.ts`
- Create: `src/server/integrations/oauth.test.mjs`
- Create: `drizzle/0029_claude_knosi_capture.sql`
- Create: `drizzle/meta/0029_snapshot.json`
- Create: `scripts/db/2026-04-12-claude-knosi-capture.sql`
- Create: `scripts/db/apply-2026-04-12-claude-knosi-capture-rollout.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Read the Next.js route-handler and authentication docs before adding auth routes**

Run:

```bash
cd /Users/bytedance/second-brain && sed -n '1,220p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md && sed -n '1,220p' node_modules/next/dist/docs/01-app/02-guides/authentication.md
```

Expected: You see the local Next.js 16 route-handler and authentication docs in the terminal before changing auth-related Next.js code.

- [ ] **Step 2: Write failing OAuth primitive tests**

Create `src/server/integrations/oauth.test.mjs` with:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import {
  createAuthorizationCode,
  exchangeAuthorizationCode,
  hashOpaqueToken,
  validateBearerToken,
} from "./oauth.ts";

test("createAuthorizationCode stores PKCE challenge and returns an opaque code", async () => {
  const inserted = [];
  const code = await createAuthorizationCode({
    userId: "user-1",
    clientId: "knosi-cli",
    redirectUri: "http://127.0.0.1:5123/callback",
    scope: ["knowledge:read", "knowledge:write_inbox"],
    codeChallenge: "abc123",
    codeChallengeMethod: "S256",
    insertAuthorizationCode: async (row) => {
      inserted.push(row);
      return row.id;
    },
  });

  assert.match(code.plaintextCode, /^knc_[0-9a-f]{48}$/);
  assert.equal(inserted[0].codeChallenge, "abc123");
});

test("validateBearerToken rejects revoked access tokens", async () => {
  const result = await validateBearerToken({
    token: "knat_deadbeef",
    findAccessTokenByHash: async () => ({
      userId: "user-1",
      scope: "knowledge:read knowledge:write_inbox",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    }),
  });

  assert.equal(result, null);
});
```

- [ ] **Step 3: Run the OAuth test file and confirm it fails before implementation**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/oauth.test.mjs
```

Expected: FAIL with missing module/export errors for `./oauth.ts`.

- [ ] **Step 4: Add integration auth tables to `src/server/db/schema.ts`**

Append these tables near the existing auth/device-auth tables in `src/server/db/schema.ts`:

```typescript
export const integrationAuthorizations = sqliteTable("integration_authorizations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  scope: text("scope").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => ({
  userClientIdx: uniqueIndex("integration_authorizations_user_client_idx").on(table.userId, table.clientId),
}));

export const integrationAuthorizationCodes = sqliteTable("integration_authorization_codes", {
  id: text("id").primaryKey(),
  authorizationId: text("authorization_id").notNull().references(() => integrationAuthorizations.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeHash: text("code_hash").notNull(),
  codeChallenge: text("code_challenge"),
  codeChallengeMethod: text("code_challenge_method"),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const integrationAccessTokens = sqliteTable("integration_access_tokens", {
  id: text("id").primaryKey(),
  authorizationId: text("authorization_id").notNull().references(() => integrationAuthorizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  scope: text("scope").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const integrationRefreshTokens = sqliteTable("integration_refresh_tokens", {
  id: text("id").primaryKey(),
  authorizationId: text("authorization_id").notNull().references(() => integrationAuthorizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

- [ ] **Step 5: Implement the client registry and OAuth helpers**

Create `src/server/integrations/oauth-clients.ts`:

```typescript
export const OAUTH_CLIENTS = {
  "knosi-cli": {
    clientId: "knosi-cli",
    type: "public",
    allowLoopbackRedirect: true,
    defaultScopes: ["knowledge:read", "knowledge:write_inbox"],
  },
  "anthropic-connector": {
    clientId: process.env.KNOSI_CLAUDE_CONNECTOR_CLIENT_ID ?? "anthropic-connector",
    clientSecret: process.env.KNOSI_CLAUDE_CONNECTOR_CLIENT_SECRET ?? "",
    type: "confidential",
    defaultScopes: ["knowledge:read", "knowledge:write_inbox"],
  },
} as const;
```

Create `src/server/integrations/oauth.ts`:

```typescript
import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import {
  integrationAccessTokens,
  integrationAuthorizationCodes,
  integrationAuthorizations,
  integrationRefreshTokens,
} from "@/server/db/schema";

export function hashOpaqueToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  codeChallenge?: string | null;
  codeChallengeMethod?: "S256" | null;
  insertAuthorizationCode?: (row: any) => Promise<string>;
}) {
  const authorizationId = crypto.randomUUID();
  await db.insert(integrationAuthorizations).values({
    id: authorizationId,
    userId: input.userId,
    clientId: input.clientId,
    scope: input.scope.join(" "),
  }).onConflictDoUpdate({
    target: [integrationAuthorizations.userId, integrationAuthorizations.clientId],
    set: { scope: input.scope.join(" "), status: "active", revokedAt: null, updatedAt: new Date() },
  });

  const plaintextCode = `knc_${crypto.randomBytes(24).toString("hex")}`;
  const row = {
    id: crypto.randomUUID(),
    authorizationId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeHash: hashOpaqueToken(plaintextCode),
    codeChallenge: input.codeChallenge ?? null,
    codeChallengeMethod: input.codeChallengeMethod ?? null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    createdAt: new Date(),
  };
  await (input.insertAuthorizationCode ? input.insertAuthorizationCode(row) : db.insert(integrationAuthorizationCodes).values(row));
  return { plaintextCode, authorizationId };
}

export async function validateBearerToken(input: {
  token: string;
  findAccessTokenByHash?: (hash: string) => Promise<any>;
}) {
  const finder = input.findAccessTokenByHash ?? (async (hash) => {
    const [row] = await db
      .select({
        authorizationId: integrationAccessTokens.authorizationId,
        scope: integrationAccessTokens.scope,
        revokedAt: integrationAccessTokens.revokedAt,
        expiresAt: integrationAccessTokens.expiresAt,
        userId: integrationAuthorizations.userId,
      })
      .from(integrationAccessTokens)
      .innerJoin(integrationAuthorizations, eq(integrationAuthorizations.id, integrationAccessTokens.authorizationId))
      .where(and(eq(integrationAccessTokens.tokenHash, hash), isNull(integrationAccessTokens.revokedAt), gt(integrationAccessTokens.expiresAt, new Date())))
      .limit(1);
    return row ?? null;
  });

  const tokenRow = await finder(hashOpaqueToken(input.token));
  if (!tokenRow || tokenRow.revokedAt) return null;
  return tokenRow;
}
```

- [ ] **Step 6: Generate the migration, add a deterministic production rollout script, and document env vars**

Run:

```bash
cd /Users/bytedance/second-brain && pnpm db:generate
```

Then make sure the generated migration is committed as:

```text
drizzle/0029_claude_knosi_capture.sql
drizzle/meta/0029_snapshot.json
```

Create `scripts/db/2026-04-12-claude-knosi-capture.sql` with:

```sql
CREATE TABLE IF NOT EXISTS integration_authorizations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_authorizations_user_client_idx
  ON integration_authorizations(user_id, client_id);
```

Create `scripts/db/apply-2026-04-12-claude-knosi-capture-rollout.mjs` with:

```javascript
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const sql = readFileSync(new URL("./2026-04-12-claude-knosi-capture.sql", import.meta.url), "utf8");
const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
  await client.execute(statement);
}

console.log("Production Turso rollout — Claude capture auth");
```

Add to `.env.example`:

```bash
KNOSI_CLAUDE_CONNECTOR_CLIENT_ID=anthropic-connector
KNOSI_CLAUDE_CONNECTOR_CLIENT_SECRET=replace-me
KNOSI_ORIGIN=https://www.knosi.xyz
```

- [ ] **Step 7: Run tests and local DB push**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/oauth.test.mjs && pnpm db:push
```

Expected: OAuth unit tests pass and local schema push completes without SQL errors.

- [ ] **Step 8: Commit the auth foundation**

```bash
cd /Users/bytedance/second-brain && git add src/server/db/schema.ts src/server/integrations/oauth-clients.ts src/server/integrations/oauth.ts src/server/integrations/oauth.test.mjs drizzle/0029_claude_knosi_capture.sql drizzle/meta/0029_snapshot.json scripts/db/2026-04-12-claude-knosi-capture.sql scripts/db/apply-2026-04-12-claude-knosi-capture-rollout.mjs .env.example && git commit -m "feat: add OAuth foundation for Claude capture integrations"
```

---

### Task 3: Add the OAuth consent UI and token routes

**Files:**
- Create: `src/app/oauth/authorize/page.tsx`
- Create: `src/app/oauth/authorize/actions.ts`
- Create: `src/app/api/oauth/token/route.ts`
- Create: `src/app/api/oauth/revoke/route.ts`
- Create: `src/app/.well-known/oauth-authorization-server/route.ts`

- [ ] **Step 1: Write a failing test for authorization-code exchange**

Append to `src/server/integrations/oauth.test.mjs`:

```javascript
test("exchangeAuthorizationCode consumes the code and returns access + refresh tokens", async () => {
  const updates = [];
  const result = await exchangeAuthorizationCode({
    plaintextCode: "knc_valid",
    codeVerifier: "plain-verifier",
    redirectUri: "http://127.0.0.1:5123/callback",
    findCodeByHash: async () => ({
      id: "code-1",
      authorizationId: "auth-1",
      redirectUri: "http://127.0.0.1:5123/callback",
      codeChallengeMethod: "S256",
      codeChallenge: "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    }),
    consumeCode: async (id) => updates.push(id),
    issueAccessToken: async () => ({ plaintextAccessToken: "knat_access", plaintextRefreshToken: "knrt_refresh" }),
  });

  assert.equal(result.accessToken, "knat_access");
  assert.deepEqual(updates, ["code-1"]);
});
```

- [ ] **Step 2: Implement token exchange, refresh, and metadata responses**

Extend `src/server/integrations/oauth.ts` with:

```typescript
function toS256(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function exchangeAuthorizationCode(input: {
  plaintextCode: string;
  codeVerifier: string;
  redirectUri: string;
  findCodeByHash?: (hash: string) => Promise<any>;
  consumeCode?: (id: string) => Promise<void>;
  issueAccessToken?: (authorizationId: string) => Promise<{ plaintextAccessToken: string; plaintextRefreshToken: string }>;
}) {
  const row = await (input.findCodeByHash
    ? input.findCodeByHash(hashOpaqueToken(input.plaintextCode))
    : db.select().from(integrationAuthorizationCodes).where(eq(integrationAuthorizationCodes.codeHash, hashOpaqueToken(input.plaintextCode))).limit(1).then((rows) => rows[0] ?? null));

  if (!row || row.consumedAt || row.redirectUri !== input.redirectUri || row.expiresAt <= new Date()) {
    throw new Error("invalid_grant");
  }

  if (row.codeChallengeMethod === "S256" && row.codeChallenge !== toS256(input.codeVerifier)) {
    throw new Error("invalid_grant");
  }

  await (input.consumeCode ? input.consumeCode(row.id) : db.update(integrationAuthorizationCodes).set({ consumedAt: new Date() }).where(eq(integrationAuthorizationCodes.id, row.id)));
  return issueAccessTokenForAuthorization(row.authorizationId, input.issueAccessToken);
}

export async function issueAccessTokenForAuthorization(authorizationId: string, customIssuer?: (authorizationId: string) => Promise<any>) {
  if (customIssuer) return customIssuer(authorizationId);
  const plaintextAccessToken = `knat_${crypto.randomBytes(24).toString("hex")}`;
  const plaintextRefreshToken = `knrt_${crypto.randomBytes(24).toString("hex")}`;
  await db.insert(integrationAccessTokens).values({
    id: crypto.randomUUID(),
    authorizationId,
    tokenHash: hashOpaqueToken(plaintextAccessToken),
    scope: "knowledge:read knowledge:write_inbox",
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  await db.insert(integrationRefreshTokens).values({
    id: crypto.randomUUID(),
    authorizationId,
    tokenHash: hashOpaqueToken(plaintextRefreshToken),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  });
  return { accessToken: plaintextAccessToken, refreshToken: plaintextRefreshToken, expiresIn: 3600 };
}

export async function refreshAccessToken(plaintextRefreshToken: string) {
  const [row] = await db
    .select({ authorizationId: integrationRefreshTokens.authorizationId, revokedAt: integrationRefreshTokens.revokedAt, expiresAt: integrationRefreshTokens.expiresAt })
    .from(integrationRefreshTokens)
    .where(eq(integrationRefreshTokens.tokenHash, hashOpaqueToken(plaintextRefreshToken)))
    .limit(1);

  if (!row || row.revokedAt || row.expiresAt <= new Date()) {
    throw new Error("invalid_grant");
  }

  return issueAccessTokenForAuthorization(row.authorizationId);
}

export async function revokeAccessToken(plaintextToken: string) {
  const hash = hashOpaqueToken(plaintextToken);
  const now = new Date();

  await db
    .update(integrationAccessTokens)
    .set({ revokedAt: now })
    .where(eq(integrationAccessTokens.tokenHash, hash));

  await db
    .update(integrationRefreshTokens)
    .set({ revokedAt: now })
    .where(eq(integrationRefreshTokens.tokenHash, hash));
}
```

Create `src/app/api/oauth/token/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, refreshAccessToken } from "@/server/integrations/oauth";

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    if (body.grant_type === "authorization_code") {
      const result = await exchangeAuthorizationCode({
        plaintextCode: body.code,
        codeVerifier: body.code_verifier,
        redirectUri: body.redirect_uri,
      });
      return NextResponse.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        scope: "knowledge:read knowledge:write_inbox",
      });
    }

    if (body.grant_type === "refresh_token") {
      const result = await refreshAccessToken(body.refresh_token);
      return NextResponse.json({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_type: "Bearer",
        expires_in: result.expiresIn,
        scope: "knowledge:read knowledge:write_inbox",
      });
    }

    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid_grant" }, { status: 400 });
  }
}
```

Create `src/app/api/oauth/revoke/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { revokeAccessToken } from "@/server/integrations/oauth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.token) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  await revokeAccessToken(body.token);
  return new NextResponse(null, { status: 200 });
}
```

Create `src/app/.well-known/oauth-authorization-server/route.ts`:

```typescript
import { NextResponse } from "next/server";

export function GET() {
  const origin = process.env.KNOSI_ORIGIN ?? "https://www.knosi.xyz";
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  });
}
```

- [ ] **Step 3: Create the consent page and approval actions, and preserve `next` across login**

Create `src/app/oauth/authorize/actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { createAuthorizationCode } from "@/server/integrations/oauth";

export async function approveOAuthRequest(formData: FormData) {
  const session = await getRequestSession();
  if (!session?.user?.id) redirect("/login");

  const clientId = String(formData.get("clientId") ?? "");
  const redirectUri = String(formData.get("redirectUri") ?? "");
  const state = String(formData.get("state") ?? "");
  const codeChallenge = String(formData.get("codeChallenge") ?? "");

  const { plaintextCode } = await createAuthorizationCode({
    userId: session.user.id,
    clientId,
    redirectUri,
    scope: ["knowledge:read", "knowledge:write_inbox"],
    codeChallenge,
    codeChallengeMethod: "S256",
  });

  redirect(`${redirectUri}?code=${encodeURIComponent(plaintextCode)}&state=${encodeURIComponent(state)}`);
}
```

Create `src/app/oauth/authorize/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { approveOAuthRequest } from "./actions";

export default async function OAuthAuthorizePage({ searchParams }) {
  const session = await getRequestSession();
  if (!session?.user?.id) {
    const params = await searchParams;
    const current = new URLSearchParams(params);
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${current.toString()}`)}`);
  }

  const params = await searchParams;
  const clientId = String(params.client_id ?? "");
  const redirectUri = String(params.redirect_uri ?? "");
  const state = String(params.state ?? "");
  const codeChallenge = String(params.code_challenge ?? "");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Connect Knosi to Claude</h1>
      <p className="text-sm text-stone-500">This client can read your knowledge and save new notes into AI Inbox.</p>
      <form action={approveOAuthRequest} className="space-y-4">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="redirectUri" value={redirectUri} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="codeChallenge" value={codeChallenge} />
        <button type="submit" className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white">Allow access</button>
      </form>
    </div>
  );
}
```

Modify `src/app/login/page.tsx` so `searchParams` also accepts `next`, preserves it in a hidden input for the credentials form, and passes it into the GitHub/Google `redirectTo` destination instead of always hard-coding `/dashboard`:

```tsx
const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;

if (session) {
  redirect(nextPath ?? "/dashboard");
}

<input type="hidden" name="next" value={nextPath ?? "/dashboard"} />

await signIn("github", { redirectTo: nextPath ?? "/dashboard" });
await signIn("google", { redirectTo: nextPath ?? "/dashboard" });
```

Modify `src/app/login/actions.ts` so `loginWithCredentials` respects `formData.get("next")`:

```typescript
const nextPath = String(formData.get("next") ?? "/dashboard");

await signIn("credentials", {
  email: normalizeEmail(parsed.data.email),
  password: parsed.data.password,
  redirectTo: nextPath,
});

redirect(nextPath);
```

- [ ] **Step 4: Run OAuth tests and smoke-test metadata locally**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/oauth.test.mjs && pnpm dev
```

In another terminal run:

```bash
curl -s http://127.0.0.1:3200/.well-known/oauth-authorization-server | jq '.issuer,.authorization_endpoint,.token_endpoint'
```

Expected: unit tests PASS and the metadata endpoint returns the local issuer plus the authorize/token URLs.

- [ ] **Step 5: Commit the OAuth routes**

```bash
cd /Users/bytedance/second-brain && git add src/app/oauth/authorize/page.tsx src/app/oauth/authorize/actions.ts src/app/api/oauth/token/route.ts src/app/api/oauth/revoke/route.ts src/app/.well-known/oauth-authorization-server/route.ts src/app/login/page.tsx src/app/login/actions.ts src/server/integrations/oauth.ts src/server/integrations/oauth.test.mjs && git commit -m "feat: add OAuth consent and token routes for Claude integrations"
```

---

### Task 4: Expose the CLI capture API backed by the shared capture core

**Files:**
- Create: `src/app/api/integrations/ai-captures/route.ts`
- Modify: `src/server/integrations/ai-capture.ts`
- Reuse: `src/server/integrations/oauth.ts`

- [ ] **Step 1: Add a failing API-level test for bearer-authenticated capture**

Append to `src/server/integrations/ai-capture.test.mjs`:

```javascript
test("captureAiNote returns a stable note URL and inserts one note", async () => {
  const result = await captureAiNote({
    userId: "user-1",
    messages: [
      { role: "user", content: "Persist this" },
      { role: "assistant", content: "Stored raw only" },
    ],
    sourceApp: "claude-code",
    originUrl: "https://www.knosi.xyz",
  });

  assert.match(result.title, /Persist this|Claude Capture/);
  assert.match(result.url, /^https:\/\/www\.knosi\.xyz\/notes\//);
});
```

- [ ] **Step 2: Create the capture API route**

Create `src/app/api/integrations/ai-captures/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { captureAiNote } from "@/server/integrations/ai-capture";
import { validateBearerToken } from "@/server/integrations/oauth";

const captureSchema = z.object({
  title: z.string().trim().max(160).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(20_000),
  })).min(1).max(12),
  sourceApp: z.enum(["claude-web", "claude-code"]),
  sourceMeta: z.object({
    projectPath: z.string().trim().optional(),
    conversationHint: z.string().trim().max(200).optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bearer = await validateBearerToken({ token });
  if (!bearer || !bearer.scope.includes("knowledge:write_inbox")) {
    return NextResponse.json({ error: "forbidden_scope" }, { status: 403 });
  }

  const parsed = captureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const note = await captureAiNote({
    userId: bearer.userId,
    ...parsed.data,
    originUrl: process.env.KNOSI_ORIGIN ?? "https://www.knosi.xyz",
  });

  return NextResponse.json(note, { status: 201 });
}
```

- [ ] **Step 3: Tighten `captureAiNote()` to enforce payload caps before writing**

Update `src/server/integrations/ai-capture.ts`:

```typescript
function enforcePayloadLimits(messages: Array<{ role: string; content: string }>) {
  if (messages.length > 12) throw new Error("payload_too_large");
  const combinedChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (combinedChars > 40_000) throw new Error("payload_too_large");
}

export async function captureAiNote(input: {
  userId: string;
  title?: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  sourceApp: "claude-web" | "claude-code";
  sourceMeta?: { projectPath?: string; conversationHint?: string };
  capturedAt?: Date;
  originUrl?: string;
}) {
  enforcePayloadLimits(input.messages);
  // existing implementation follows...
}
```

- [ ] **Step 4: Run the capture tests and smoke-test the API route with an auth token**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/ai-capture.test.mjs
```

After starting `pnpm dev`, run a local smoke test with a valid bearer token generated from the OAuth flow:

```bash
curl -sS -X POST http://127.0.0.1:3200/api/integrations/ai-captures \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid-cli-access-token>" \
  -d '{"messages":[{"role":"user","content":"Persist this"},{"role":"assistant","content":"Stored raw only"}],"sourceApp":"claude-code"}'
```

Expected: test PASS and the API returns `201` with `noteId`, `title`, and `url`.

- [ ] **Step 5: Commit the shared capture API**

```bash
cd /Users/bytedance/second-brain && git add src/app/api/integrations/ai-captures/route.ts src/server/integrations/ai-capture.ts src/server/integrations/ai-capture.test.mjs && git commit -m "feat: add authenticated AI capture API for CLI saves"
```

---

### Task 5: Refactor `packages/cli` into subcommands and add auth/save/install-skill commands

**Files:**
- Modify: `packages/cli/src/index.mjs`
- Create: `packages/cli/src/config.mjs`
- Create: `packages/cli/src/http.mjs`
- Create: `packages/cli/src/commands/auth-login.mjs`
- Create: `packages/cli/src/commands/save-ai-note.mjs`
- Create: `packages/cli/src/commands/install-skill.mjs`
- Create: `packages/cli/src/commands/auth-login.test.mjs`
- Create: `packages/cli/src/commands/save-ai-note.test.mjs`
- Create: `packages/cli/templates/save-to-knosi/SKILL.md`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Write failing CLI tests for JSON stdin save and auth URL generation**

Create `packages/cli/src/commands/save-ai-note.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { parseSaveAiNoteInput } from "./save-ai-note.mjs";

test("parseSaveAiNoteInput parses stdin JSON into the capture payload", async () => {
  const payload = await parseSaveAiNoteInput(async () => JSON.stringify({
    title: "Persist this",
    messages: [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }],
    sourceApp: "claude-code",
  }));

  assert.equal(payload.title, "Persist this");
  assert.equal(payload.messages.length, 2);
});
```

Create `packages/cli/src/commands/auth-login.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { buildAuthorizeUrl } from "./auth-login.mjs";

test("buildAuthorizeUrl includes PKCE challenge and loopback redirect", () => {
  const url = buildAuthorizeUrl({
    origin: "https://www.knosi.xyz",
    clientId: "knosi-cli",
    redirectUri: "http://127.0.0.1:5123/callback",
    state: "state-123",
    codeChallenge: "challenge-123",
  });

  assert.match(url, /^https:\/\/www\.knosi\.xyz\/oauth\/authorize\?/);
  assert.match(url, /client_id=knosi-cli/);
  assert.match(url, /code_challenge=challenge-123/);
});
```

- [ ] **Step 2: Run the CLI tests and confirm they fail before implementation**

Run:

```bash
cd /Users/bytedance/second-brain && node --test packages/cli/src/commands/auth-login.test.mjs packages/cli/src/commands/save-ai-note.test.mjs
```

Expected: FAIL because the new command modules do not exist yet.

- [ ] **Step 3: Create CLI config, auth login, save command, and skill template**

Create `packages/cli/src/config.mjs`:

```javascript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".knosi");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { origin: "https://www.knosi.xyz", tokens: null };
  }
}

export function writeConfig(value) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(value, null, 2)}\n`);
}
```

Create `packages/cli/src/commands/auth-login.mjs`:

```javascript
import crypto from "node:crypto";
import http from "node:http";
import { readConfig, writeConfig } from "../config.mjs";

export function buildAuthorizeUrl({ origin, clientId, redirectUri, state, codeChallenge }) {
  const url = new URL("/oauth/authorize", origin);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "knowledge:read knowledge:write_inbox");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function runAuthLogin({ origin = readConfig().origin } = {}) {
  const state = crypto.randomUUID();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:5123/callback";
  const authorizeUrl = buildAuthorizeUrl({
    origin,
    clientId: "knosi-cli",
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  console.log(`Open in browser:\n${authorizeUrl}`);
  // start loopback listener, exchange code at /api/oauth/token, then persist tokens
}
```

Create `packages/cli/src/commands/save-ai-note.mjs`:

```javascript
import { readConfig } from "../config.mjs";
import { apiFetch } from "../http.mjs";

export async function parseSaveAiNoteInput(readStdin = () => new Promise((resolve) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => resolve(data));
})) {
  const raw = await readStdin();
  return JSON.parse(raw);
}

export async function runSaveAiNote() {
  const payload = await parseSaveAiNoteInput();
  const config = readConfig();
  const result = await apiFetch({
    origin: config.origin,
    path: "/api/integrations/ai-captures",
    method: "POST",
    token: config.tokens?.accessToken,
    json: payload,
  });
  console.log(JSON.stringify(result, null, 2));
}
```

Create `packages/cli/templates/save-to-knosi/SKILL.md`:

```md
---
name: save-to-knosi
description: Save the explicitly requested Claude Code exchange into Knosi as one raw AI Inbox note.
argument-hint: "[what to save]"
---

Use this skill only when the user explicitly asks to save or archive content into Knosi.
Preserve the raw user/assistant exchange.
Call `knosi save-ai-note --json` with stdin JSON.
Return the created note title and URL.
```

- [ ] **Step 4: Refactor the CLI entrypoint into a subcommand dispatcher while preserving daemon mode**

Replace `packages/cli/src/index.mjs` with a dispatcher shape like:

```javascript
#!/usr/bin/env node
import { runAuthLogin } from "./commands/auth-login.mjs";
import { runSaveAiNote } from "./commands/save-ai-note.mjs";
import { installClaudeSkill } from "./commands/install-skill.mjs";
import { runDaemon } from "./daemon.mjs";

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "daemon" || command.startsWith("--")) {
  await runDaemon([command, ...rest].filter(Boolean));
} else if (command === "auth" && rest[0] === "login") {
  await runAuthLogin();
} else if (command === "save-ai-note" && rest.includes("--json")) {
  await runSaveAiNote();
} else if (command === "install" && rest[0] === "claude-skill") {
  await installClaudeSkill();
} else {
  console.error("Usage: knosi daemon | knosi auth login | knosi save-ai-note --json | knosi install claude-skill");
  process.exit(1);
}
```

Also move the current daemon body from `packages/cli/src/index.mjs` into a new `packages/cli/src/daemon.mjs` file.

- [ ] **Step 5: Run the CLI tests and an end-to-end save command against local dev**

Run:

```bash
cd /Users/bytedance/second-brain && node --test packages/cli/src/commands/auth-login.test.mjs packages/cli/src/commands/save-ai-note.test.mjs
```

Then, after authenticating once:

```bash
printf '%s' '{"messages":[{"role":"user","content":"Persist this exact exchange"},{"role":"assistant","content":"Raw capture only"}],"sourceApp":"claude-code","sourceMeta":{"projectPath":"/Users/bytedance/second-brain"}}' | node packages/cli/src/index.mjs save-ai-note --json
```

Expected: unit tests PASS and the CLI prints the created `noteId`, `title`, and `url`.

- [ ] **Step 6: Commit the CLI expansion**

```bash
cd /Users/bytedance/second-brain && git add packages/cli/package.json packages/cli/src/index.mjs packages/cli/src/config.mjs packages/cli/src/http.mjs packages/cli/src/daemon.mjs packages/cli/src/commands/auth-login.mjs packages/cli/src/commands/save-ai-note.mjs packages/cli/src/commands/install-skill.mjs packages/cli/src/commands/auth-login.test.mjs packages/cli/src/commands/save-ai-note.test.mjs packages/cli/templates/save-to-knosi/SKILL.md && git commit -m "feat: add CLI auth and raw AI capture commands"
```

---

### Task 6: Add the remote MCP read/write surface for Claude Web

**Files:**
- Create: `src/server/integrations/knowledge-read.ts`
- Create: `src/server/integrations/knowledge-read.test.mjs`
- Create: `src/server/integrations/mcp-tools.ts`
- Create: `src/server/integrations/mcp-tools.test.mjs`
- Create: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Add a failing test for ownership-filtered search results**

Create `src/server/integrations/knowledge-read.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { mapDashboardSearchToKnowledgeItems } from "./knowledge-read.ts";

test("mapDashboardSearchToKnowledgeItems only returns note and bookmark items", () => {
  const result = mapDashboardSearchToKnowledgeItems({
    notes: [{ id: "n1", title: "Note 1", type: "note" }],
    bookmarks: [{ id: "b1", title: "Bookmark 1", url: "https://example.com", type: "bookmark" }],
    todos: [{ id: "t1", title: "Todo 1", type: "todo" }],
  });

  assert.deepEqual(result.map((item) => item.id), ["n1", "b1"]);
});
```

Create `src/server/integrations/mcp-tools.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { handleMcpToolCall } from "./mcp-tools.ts";

test("handleMcpToolCall dispatches save_to_knosi into the capture service", async () => {
  const result = await handleMcpToolCall({
    userId: "user-1",
    name: "save_to_knosi",
    args: {
      messages: [
        { role: "user", content: "Persist this" },
        { role: "assistant", content: "Stored raw only" },
      ],
    },
    captureNote: async (input) => ({ noteId: "note-1", title: input.messages[0].content, url: "https://www.knosi.xyz/notes/note-1" }),
  });

  assert.equal(result.noteId, "note-1");
});
```

- [ ] **Step 2: Implement the read services**

Create `src/server/integrations/knowledge-read.ts`:

```typescript
import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/server/db";
import { bookmarks, notes } from "@/server/db/schema";

export function mapDashboardSearchToKnowledgeItems(input: {
  notes: Array<{ id: string; title: string | null; type: "note" }>;
  bookmarks: Array<{ id: string; title: string | null; url?: string | null; type: "bookmark" }>;
  todos?: Array<unknown>;
}) {
  return [
    ...input.notes.map((note) => ({ id: note.id, type: "note", title: note.title ?? "Untitled note" })),
    ...input.bookmarks.map((bookmark) => ({ id: bookmark.id, type: "bookmark", title: bookmark.title ?? bookmark.url ?? "Untitled bookmark" })),
  ];
}

export async function searchKnowledge({ userId, query, limit = 5 }: { userId: string; query: string; limit?: number }) {
  const q = `%${query}%`;
  const noteResults = await db
    .select({ id: notes.id, title: notes.title, plainText: notes.plainText })
    .from(notes)
    .where(and(eq(notes.userId, userId), or(like(notes.title, q), like(notes.plainText, q))))
    .limit(limit);
  const bookmarkResults = await db
    .select({ id: bookmarks.id, title: bookmarks.title, url: bookmarks.url, summary: bookmarks.summary })
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), or(like(bookmarks.title, q), like(bookmarks.summary, q), like(bookmarks.content, q))))
    .limit(limit);

  return [
    ...noteResults.map((row) => ({ id: row.id, type: "note", title: row.title ?? "Untitled note", snippet: row.plainText?.slice(0, 180) ?? "" })),
    ...bookmarkResults.map((row) => ({ id: row.id, type: "bookmark", title: row.title ?? row.url ?? "Untitled bookmark", snippet: row.summary?.slice(0, 180) ?? "" })),
  ].slice(0, limit);
}

export async function listRecentKnowledge({ userId, limit = 10 }: { userId: string; limit?: number }) {
  const recentNotes = await db.select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt }).from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.updatedAt)).limit(limit);
  return recentNotes.map((row) => ({ id: row.id, type: "note", title: row.title ?? "Untitled note", updatedAt: row.updatedAt?.toISOString() ?? null }));
}

export async function getNoteById({ userId, id }: { userId: string; id: string }) {
  const [row] = await db
    .select({ id: notes.id, title: notes.title, content: notes.content, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.id, id)))
    .limit(1);

  return row
    ? { id: row.id, type: "note", title: row.title ?? "Untitled note", content: row.content ?? "", updatedAt: row.updatedAt?.toISOString() ?? null }
    : null;
}
```

- [ ] **Step 3: Implement MCP tool dispatch and the `/api/mcp` route**

Create `src/server/integrations/mcp-tools.ts`:

```typescript
import { getNoteById, listRecentKnowledge, searchKnowledge } from "./knowledge-read";
import { captureAiNote } from "./ai-capture";

export async function handleMcpToolCall({
  userId,
  name,
  args,
  captureNote = captureAiNote,
}: {
  userId: string;
  name: string;
  args: Record<string, unknown>;
  captureNote?: typeof captureAiNote;
}) {
  if (name === "search_knowledge") {
    return { items: await searchKnowledge({ userId, query: String(args.query ?? ""), limit: Number(args.limit ?? 5) }) };
  }

  if (name === "list_recent_knowledge") {
    return { items: await listRecentKnowledge({ userId, limit: Number(args.limit ?? 10) }) };
  }

  if (name === "get_knowledge_item") {
    return await getNoteById({ userId, id: String(args.id ?? "") });
  }

  if (name === "save_to_knosi") {
    return await captureNote({
      userId,
      title: typeof args.title === "string" ? args.title : undefined,
      messages: Array.isArray(args.messages) ? args.messages : [],
      sourceApp: "claude-web",
      sourceMeta: typeof args.sourceMeta === "object" && args.sourceMeta ? args.sourceMeta : undefined,
      originUrl: process.env.KNOSI_ORIGIN ?? "https://www.knosi.xyz",
    });
  }

  throw new Error("method_not_found");
}
```

Create `src/app/api/mcp/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { validateBearerToken } from "@/server/integrations/oauth";
import { handleMcpToolCall } from "@/server/integrations/mcp-tools";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bearer = await validateBearerToken({ token });
  if (!bearer || !bearer.scope.includes("knowledge:read")) {
    return NextResponse.json({ error: "forbidden_scope" }, { status: 403 });
  }

  const body = await request.json();

  if (body.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        tools: [
          { name: "search_knowledge", description: "Search notes and bookmarks" },
          { name: "get_knowledge_item", description: "Read one knowledge item" },
          { name: "list_recent_knowledge", description: "List recent notes" },
          { name: "save_to_knosi", description: "Create one raw AI Inbox note from explicit conversation content" },
        ],
      },
    });
  }

  if (body.method === "tools/call") {
    const result = await handleMcpToolCall({
      userId: bearer.userId,
      name: body.params.name,
      args: body.params.arguments ?? {},
    });

    return NextResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "json", json: result }] },
    });
  }

  return NextResponse.json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32601, message: "Method not found" } }, { status: 400 });
}
```

- [ ] **Step 4: Run the read-tool tests and smoke-test the MCP route**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/knowledge-read.test.mjs src/server/integrations/mcp-tools.test.mjs
```

After `pnpm dev` is running, smoke-test:

```bash
curl -sS -X POST http://127.0.0.1:3200/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid-connector-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected: unit tests PASS and the MCP route returns the four tool definitions.

- [ ] **Step 5: Commit the remote MCP surface**

```bash
cd /Users/bytedance/second-brain && git add src/server/integrations/knowledge-read.ts src/server/integrations/knowledge-read.test.mjs src/server/integrations/mcp-tools.ts src/server/integrations/mcp-tools.test.mjs src/app/api/mcp/route.ts && git commit -m "feat: add remote MCP tools for Claude Web knowledge access"
```

---

### Task 7: Add Connected AI Clients settings UI and revoke flows

**Files:**
- Create: `src/app/(app)/settings/connected-ai-clients-section.tsx`
- Create: `src/app/(app)/settings/connected-ai-clients-actions.ts`
- Modify: `src/app/(app)/settings/page.tsx`
- Modify: `src/server/integrations/oauth.ts`

- [ ] **Step 1: Add a failing test for authorization revocation**

Append to `src/server/integrations/oauth.test.mjs`:

```javascript
test("revokeAuthorization revokes active access and refresh tokens for one client", async () => {
  const calls = [];
  await revokeAuthorization({
    userId: "user-1",
    clientId: "knosi-cli",
    revokeAuthorizationRow: async (args) => calls.push(args),
  });

  assert.deepEqual(calls, [{ userId: "user-1", clientId: "knosi-cli" }]);
});
```

- [ ] **Step 2: Implement revoke/list helpers and server actions**

Extend `src/server/integrations/oauth.ts` with:

```typescript
export async function listActiveAuthorizations(userId: string) {
  return db
    .select({
      id: integrationAuthorizations.id,
      clientId: integrationAuthorizations.clientId,
      scope: integrationAuthorizations.scope,
      lastUsedAt: integrationAuthorizations.lastUsedAt,
      createdAt: integrationAuthorizations.createdAt,
    })
    .from(integrationAuthorizations)
    .where(and(eq(integrationAuthorizations.userId, userId), eq(integrationAuthorizations.status, "active")));
}

export async function revokeAuthorization(input: {
  userId: string;
  clientId: string;
  revokeAuthorizationRow?: (args: { userId: string; clientId: string }) => Promise<void>;
}) {
  if (input.revokeAuthorizationRow) return input.revokeAuthorizationRow({ userId: input.userId, clientId: input.clientId });

  const now = new Date();
  await db
    .update(integrationAuthorizations)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(and(eq(integrationAuthorizations.userId, input.userId), eq(integrationAuthorizations.clientId, input.clientId)));
}
```

Create `src/app/(app)/settings/connected-ai-clients-actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { revokeAuthorization } from "@/server/integrations/oauth";

export async function revokeConnectedAiClient(formData: FormData) {
  const session = await getRequestSession();
  if (!session?.user?.id) redirect("/login");

  const clientId = String(formData.get("clientId") ?? "");
  await revokeAuthorization({ userId: session.user.id, clientId });
  redirect("/settings?integrationStatus=revoked");
}
```

- [ ] **Step 3: Render the Connected AI Clients section**

Create `src/app/(app)/settings/connected-ai-clients-section.tsx`:

```tsx
import { revokeConnectedAiClient } from "./connected-ai-clients-actions";

export function ConnectedAiClientsSection({ clients }: {
  clients: Array<{ id: string; clientId: string; scope: string; lastUsedAt: Date | null; createdAt: Date | null }>;
}) {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Connected AI Clients</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Manage Claude connector and CLI access tokens here.</p>
      </div>
      <div className="space-y-3">
        {clients.map((client) => (
          <form key={client.id} action={revokeConnectedAiClient} className="flex items-center justify-between rounded-xl border border-stone-200 px-4 py-3 dark:border-stone-800">
            <input type="hidden" name="clientId" value={client.clientId} />
            <div>
              <div className="text-sm font-medium text-stone-900 dark:text-stone-100">{client.clientId}</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{client.scope}</div>
            </div>
            <button type="submit" className="rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-900/70 dark:text-red-300">
              Revoke
            </button>
          </form>
        ))}
      </div>
    </section>
  );
}
```

Modify `src/app/(app)/settings/page.tsx` to fetch `listActiveAuthorizations(session.user.id)` and render `<ConnectedAiClientsSection clients={...} />` above `<AnalysisPromptsSection />`.

- [ ] **Step 4: Run tests and do a quick browser verification**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/oauth.test.mjs && pnpm dev
```

Then sign in locally, open `http://127.0.0.1:3200/settings`, and confirm the new Connected AI Clients section renders active connector/CLI rows and revoke buttons.

Expected: test PASS and the settings page shows revocable integration rows.

- [ ] **Step 5: Commit the settings management UI**

```bash
cd /Users/bytedance/second-brain && git add 'src/app/(app)/settings/page.tsx' 'src/app/(app)/settings/connected-ai-clients-section.tsx' 'src/app/(app)/settings/connected-ai-clients-actions.ts' src/server/integrations/oauth.ts src/server/integrations/oauth.test.mjs && git commit -m "feat: add connected AI client management to settings"
```

---

### Task 8: Document setup, install the Claude Code skill template, and run full verification including production rollout

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Create: `docs/changelog/2026-04-12-claude-knosi-capture-implementation.md`
- Reuse: `packages/cli/templates/save-to-knosi/SKILL.md`

- [ ] **Step 1: Update README and CLI docs with exact setup instructions**

Add to `README.md`:

```md
## Claude Integrations

### Claude Web

1. Configure `KNOSI_CLAUDE_CONNECTOR_CLIENT_ID`, `KNOSI_CLAUDE_CONNECTOR_CLIENT_SECRET`, and `KNOSI_ORIGIN`.
2. In Claude, add a custom connector pointing at `https://www.knosi.xyz/api/mcp`.
3. Complete the Knosi OAuth consent flow.

### Claude Code

1. Run `knosi auth login`.
2. Run `knosi install claude-skill`.
3. In Claude Code, use `/save-to-knosi` when you explicitly want to archive an exchange.
```

Add to `packages/cli/README.md`:

```md
## Commands

- `knosi daemon`
- `knosi auth login`
- `knosi save-ai-note --json`
- `knosi install claude-skill`
```

- [ ] **Step 2: Create the implementation changelog entry**

Create `docs/changelog/2026-04-12-claude-knosi-capture-implementation.md` with:

```md
# Claude to Knosi Capture — 2026-04-12

## Date
- 2026-04-12

## Task / Goal
- Deliver raw Claude conversation capture for Claude Web and Claude Code, backed by one shared Knosi capture core.

## Key Changes
- Added OAuth-backed integration auth for connector and CLI clients.
- Added shared `captureAiNote()` service and automatic `AI Inbox` folder resolution.
- Added CLI auth + `save-ai-note --json`.
- Added remote MCP read/write tools for Claude Web.
- Added Connected AI Clients settings management.

## Files Touched
- README.md
- packages/cli/README.md
- src/server/integrations/*
- src/app/api/mcp/route.ts
- src/app/api/integrations/ai-captures/route.ts

## Verification Commands And Results
- Fill with the actual commands/results from Step 4 onward.

## Remaining Risks Or Follow-Up Items
- Duplicate saves are still allowed in V1.
```

- [ ] **Step 3: Run the full local verification suite**

Run:

```bash
cd /Users/bytedance/second-brain && node --test src/server/integrations/ai-capture.test.mjs src/server/integrations/oauth.test.mjs src/server/integrations/knowledge-read.test.mjs src/server/integrations/mcp-tools.test.mjs packages/cli/src/commands/auth-login.test.mjs packages/cli/src/commands/save-ai-note.test.mjs && pnpm lint && pnpm build
```

Expected: all targeted tests PASS, lint PASS, and build PASS.

- [ ] **Step 4: Perform the real Claude Code and Claude Web smoke tests**

Run the local CLI smoke test:

```bash
cd /Users/bytedance/second-brain && printf '%s' '{"messages":[{"role":"user","content":"Save this from Claude Code"},{"role":"assistant","content":"Raw capture path verified"}],"sourceApp":"claude-code"}' | node packages/cli/src/index.mjs save-ai-note --json
```

Expected: a note is created under `AI Inbox`.

Then verify Claude Web manually:

1. Open Claude.
2. Connect the Knosi custom connector.
3. Ask Claude to call `save_to_knosi` with a short explicit excerpt.
4. Confirm a new note appears in Knosi `AI Inbox`.

- [ ] **Step 5: Roll the schema to production Turso and verify the live tables**

Run:

```bash
cd /Users/bytedance/second-brain && set -a && source .env.turso-prod.local && set +a && node scripts/db/apply-2026-04-12-claude-knosi-capture-rollout.mjs
```

Expected: the script prints `Production Turso rollout — Claude capture auth`.

Then verify:

```bash
cd /Users/bytedance/second-brain && set -a && source .env.turso-prod.local && set +a && node - <<'NODE'
const { createClient } = require("@libsql/client");
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
(async () => {
  const rows = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('integration_authorizations','integration_authorization_codes','integration_access_tokens','integration_refresh_tokens') ORDER BY name");
  console.log(rows.rows);
})();
NODE
```

Expected: the four integration auth tables are listed from production Turso.

- [ ] **Step 6: Fill the changelog with real command outcomes and commit docs**

Update `docs/changelog/2026-04-12-claude-knosi-capture-implementation.md` with the exact verification outputs from Steps 3-5, including the production rollout command and verification query result.

Then commit:

```bash
cd /Users/bytedance/second-brain && git add README.md packages/cli/README.md docs/changelog/2026-04-12-claude-knosi-capture-implementation.md && git commit -m "docs: record Claude capture setup and verification"
```

---

## Self-Review

### Spec coverage

- Shared capture core -> Task 1 and Task 4
- OAuth-backed connector/CLI auth -> Tasks 2 and 3
- CLI auth + save command + skill path -> Task 5
- Remote MCP read/write tools -> Task 6
- Connected AI Clients management UI -> Task 7
- Docs + verification + production Turso rollout -> Task 8

### Placeholder scan

- No unresolved placeholder markers or defer-to-later phrasing should remain after saving this plan.
- Every code-writing step above includes an explicit snippet or command.

### Type consistency

- Shared write service name stays `captureAiNote()`
- Shared folder resolver name stays `resolveOrCreateAiInboxFolder()`
- CLI command stays `knosi save-ai-note --json`
- MCP write tool stays `save_to_knosi`
