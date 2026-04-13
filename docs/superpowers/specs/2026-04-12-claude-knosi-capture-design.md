# Claude Conversations to Knosi Capture — Claude Web + Claude Code

**Status:** Draft
**Author:** Codex with user
**Date:** 2026-04-12

---

## Background

The product already has:

- a deployed public app at `https://www.knosi.xyz`
- an authenticated notes system backed by `notes`, `folders`, and the existing knowledge indexer
- a local CLI package at `packages/cli`
- an explicit product need: preserve valuable Claude conversations inside Knosi instead of leaving them trapped in chat history

The user wants this capability to work in two places:

- `claude.ai` on the web
- local `Claude Code`

The user also explicitly chose these product constraints:

- capture is **explicit only**: nothing is auto-saved
- default destination is a fixed `AI Inbox` folder
- one save creates **one note**
- V1 stores the **raw conversation data** plus minimal metadata
- V1 does **not** run extra AI summarization or post-processing
- Claude should have both **read** and **write** access, but write access should stay narrow

This is an explicit exception outside the currently active implementation phase in `PLAN.md`; the user requested a forward-looking design for a new capability before implementation.

---

## Decision Summary

| Topic | Decision |
|------|------|
| Overall architecture | Dual entry, single server-side capture core |
| Claude Web integration | Public `remote MCP` connector hosted by Knosi |
| Claude Code integration | Personal skill + local CLI command |
| Knowledge reads | Shared through the Knosi `remote MCP` surface |
| Note writes from Claude Web | `save_to_knosi` MCP tool |
| Note writes from Claude Code | `/save-to-knosi` skill -> local CLI -> Knosi capture API |
| Auth identity | Reuse existing Knosi user accounts |
| Auth credentials | Separate OAuth tokens for connector/CLI, not website session cookies |
| Write location | Root-level `AI Inbox` folder, auto-created if missing |
| Saved content | Raw excerpt + minimal metadata only |
| V1 note count per save | Exactly one new note |
| V1 note mutation scope | Create-only; no update/delete of existing notes |

---

## Alternatives Considered

### Option A — Remote MCP only

Expose only a public `remote MCP` server and use it for both Claude Web and Claude Code.

**Pros**

- One integration surface
- Best long-term alignment with Claude connectors
- Shared read/write tool contracts

**Cons**

- Loses the flexibility of the existing local CLI investment
- Makes explicit local save workflows in Claude Code more awkward than necessary

### Option B — Skill + CLI only

Use only a personal Claude Code skill and local CLI command.

**Pros**

- Fastest path for local workflows
- Reuses `packages/cli` directly
- Easy to script and iterate

**Cons**

- Does not support `claude.ai`
- Cannot satisfy the web Claude requirement because web Claude cannot invoke local CLI tools

### Option C — Dual entry, single capture kernel

Use two entrypoints:

- `Claude Web` -> `remote MCP`
- `Claude Code` -> `skill + CLI`

Both call the same Knosi server-side capture service.

**Pros**

- Supports both required surfaces
- Preserves CLI flexibility locally
- Keeps business logic, audit rules, note shape, and folder logic centralized

**Cons**

- Slightly more integration work than a single-entry design

**Chosen:** Option C

---

## Goals

- Let `Claude Web` read knowledge from Knosi and explicitly save a conversation excerpt into Knosi.
- Let `Claude Code` explicitly save a conversation excerpt into Knosi through a local skill and CLI command.
- Reuse the existing Knosi account system rather than introducing a separate user database.
- Store saved conversations inside the existing notes system so they immediately participate in existing search/indexing flows.
- Keep V1 intentionally narrow and predictable.

## Non-Goals

- No automatic background saving of conversations.
- No AI-generated summaries, tags, titles, or structured post-processing in V1.
- No update/delete tools for existing notes.
- No arbitrary folder selection in V1.
- No batch save, bulk import, or thread-wide export.
- No attempt to make web Claude invoke local CLI.
- No change to the main Notes editor model or folder tree UX as part of V1.

---

## Architecture

### High-level flow

```text
Claude Web
  -> Knosi remote MCP connector
  -> Knosi MCP tool adapter
  -> captureAiNote()
  -> notes + folder resolution + index job

Claude Code
  -> personal /save-to-knosi skill
  -> local knosi CLI command
  -> Knosi capture API
  -> captureAiNote()
  -> notes + folder resolution + index job
```

### Why this split is intentional

- `claude.ai` can only call public remote integrations, so it must go through `remote MCP`.
- `Claude Code` runs on the user's machine, so local skill plus CLI is the most ergonomic and flexible local write path.
- Both entrypoints converge on one server-side service so note shape, permissions, and future enhancements stay consistent.

### Read vs write responsibilities

- **Read path**
  - shared via `remote MCP`
  - available to Claude Web
  - also available to Claude Code if the user configures the same remote connector there
- **Write path**
  - Claude Web: `save_to_knosi` MCP tool
  - Claude Code: local skill calling CLI, then server capture API

This preserves the user's preferred local tooling without forking the saved-note model.

---

## Authentication and Identity

### Principle

Reuse existing Knosi accounts, but do **not** reuse website session cookies as machine credentials.

### Why session cookies are not enough

- Website sessions are for the browser app.
- `remote MCP` calls come from Anthropic's cloud infrastructure, not from the user's browser tab.
- Local CLI also needs a stable credential it can store and refresh outside normal website navigation.

### Chosen auth model

Knosi becomes an OAuth authorization server for integration clients.

Two clients are relevant in V1:

1. `Anthropic Claude Connector`
   - used by `Claude Web` custom connector / remote MCP
2. `Knosi CLI`
   - used by the local CLI after a one-time browser login

### User experience

#### Claude Web

1. User adds the Knosi custom connector in Claude.
2. Claude sends the user to Knosi's authorization flow.
3. If the user is not logged in, they complete the existing Knosi login flow.
4. Knosi shows a concise consent page:
   - read your knowledge
   - save new notes to AI Inbox
5. Knosi issues OAuth tokens to the connector.

#### Claude Code CLI

1. User runs `knosi auth login`.
2. CLI opens the browser to the same Knosi authorization flow.
3. User logs in if necessary and grants access.
4. CLI stores refresh/access credentials locally.

### Scope model

V1 scopes stay intentionally small:

- `knowledge:read`
- `knowledge:write_inbox`

No scope grants:

- update existing notes
- delete notes
- modify sharing state
- move notes across folders

### User-facing management

Knosi Settings should include a `Connected AI Clients` section where the user can:

- see active Claude connector sessions
- see active CLI authorizations
- revoke either independently

---

## Integration Surfaces

### 1. Remote MCP for Claude Web

### Endpoint

Expose a public `remote MCP` endpoint from Knosi, for example:

- `https://www.knosi.xyz/api/mcp`

### V1 tools

#### `search_knowledge`

**Purpose**

- Search the user's notes/bookmarks knowledge corpus

**Input**

```json
{
  "query": "drizzle transaction boundary",
  "scope": "all",
  "limit": 5
}
```

**Output**

```json
{
  "items": [
    {
      "id": "note_123",
      "type": "note",
      "title": "Drizzle transaction notes",
      "snippet": "Wrap note update and outbox enqueue in one transaction..."
    }
  ]
}
```

#### `get_knowledge_item`

**Purpose**

- Read one knowledge item in full

**Input**

```json
{ "id": "note_123" }
```

**Output**

```json
{
  "id": "note_123",
  "type": "note",
  "title": "Drizzle transaction notes",
  "content": "...",
  "updatedAt": "2026-04-12T07:00:00.000Z"
}
```

#### `list_recent_knowledge`

**Purpose**

- Give Claude a lightweight "recent context" list when it does not yet know what to search

**Input**

```json
{
  "scope": "all",
  "limit": 10
}
```

#### `save_to_knosi`

**Purpose**

- Create exactly one new AI capture note in `AI Inbox`

**Input**

```json
{
  "title": "Optional title",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "sourceApp": "claude-web",
  "sourceMeta": {
    "conversationHint": "optional short note"
  }
}
```

**Output**

```json
{
  "noteId": "uuid",
  "title": "Captured note title",
  "url": "https://www.knosi.xyz/notes/uuid"
}
```

### Tool restrictions

- `save_to_knosi` is create-only
- messages must be role-ordered and limited in size
- folder is not caller-controlled in V1

### 2. Claude Code personal skill

The personal skill exists only to make local saving explicit and ergonomic.

### Skill responsibilities

- Trigger only on explicit user intent such as "save to Knosi"
- Collect the relevant excerpt
- Call local CLI
- Return the created note title and URL

### Skill responsibilities it should **not** take on

- no direct HTTP hand-rolled `curl` in the skill body
- no extra summarization or rewriting
- no folder routing logic
- no direct database access

### Suggested skill shape

```md
---
name: save-to-knosi
description: Save the selected or explicitly referenced Claude Code exchange into Knosi as a raw AI Inbox note. Use only when the user explicitly asks to save or archive something to Knosi.
argument-hint: "[what to save]"
---

When invoked:
1. Save only on explicit user request.
2. Preserve the raw user/assistant exchange.
3. Call the local Knosi CLI with JSON input.
4. Report the created note title and URL.
```

### 3. Local CLI

The CLI is the write adapter for Claude Code.

### Commands

#### `knosi auth login`

- Performs one-time browser-based login/authorization
- Stores refresh/access credentials locally

#### `knosi save-ai-note --json`

- Reads JSON from stdin
- Validates the payload
- Calls the Knosi capture API

### Input contract

Use JSON stdin rather than many shell flags so quoting stays stable.

```json
{
  "title": "Optional title",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "sourceApp": "claude-code",
  "sourceMeta": {
    "projectPath": "/Users/bytedance/second-brain",
    "conversationHint": "optional short note"
  }
}
```

### Output contract

```json
{
  "noteId": "uuid",
  "title": "Captured note title",
  "url": "https://www.knosi.xyz/notes/uuid"
}
```

---

## Saved Note Model

### Storage location

- root-level folder: `AI Inbox`
- if missing, create it automatically
- this mirrors the existing `resolveSourceReadingFolderId()` pattern already used by source-reading notes

### One save = one note

Each explicit save creates one new note in `notes`.

V1 does **not**:

- append to a daily log note
- create a second "clean summary" note
- update an earlier capture

### Note content shape

V1 keeps the note intentionally raw:

```md
# Raw Excerpt

## User
...

## Claude
...

# Metadata
- Source: Claude Web
- Captured at: 2026-04-12 15:20 SGT
- Project: second-brain
- Conversation hint: optional
```

### Rendering model

- server converts the markdown template into Tiptap JSON using the existing `markdownToTiptap()`
- `plainText` stores the flattened raw text for search/indexing
- note `type` remains `"note"`

### Title derivation

V1 title generation must not depend on another AI call.

Order of precedence:

1. caller-provided `title`, after sanitization
2. first non-empty user message, truncated
3. fallback format:
   - `Claude Capture - 2026-04-12 15:20`

### Payload limits

To keep notes and requests bounded:

- max saved message count: small, explicit excerpt only
- max combined content size: hard cap enforced by server

If the payload exceeds the cap, return `payload_too_large` and tell the caller to save a narrower excerpt.

---

## Server-Side Capture Core

The business logic should live in a shared service, for example:

- `resolveOrCreateAiInboxFolder(userId)`
- `captureAiNote(input)`

### `captureAiNote(input)` responsibilities

1. authenticate the caller and resolve `userId`
2. validate scope and payload size
3. resolve or create the `AI Inbox` folder
4. derive title
5. render markdown from ordered message turns and metadata
6. convert markdown to Tiptap JSON
7. insert a `notes` row
8. enqueue the existing knowledge indexing job
9. return `{ noteId, title, url }`

### Why centralize this logic

Without a shared capture service, the MCP adapter and CLI route would drift on:

- folder rules
- note shape
- title generation
- indexing behavior
- future dedupe or audit behavior

---

## Data Model Impact

### Existing tables reused as-is

- `notes`
- `folders`
- `knowledge_index_jobs`
- `knowledge_chunks`
- existing auth/user tables

This is deliberate. V1 does **not** require a dedicated `ai_captures` content table.

### New auth/integration state

Implementation will need OAuth/integration persistence for:

- connector grants/tokens
- CLI grants/tokens
- revocation and last-used tracking

Exact schema names can be chosen during implementation, but they must support:

- user-bound authorization grants
- scope tracking
- token revocation
- management UI under Settings

This auth state is the only substantial new data area required by V1.

---

## API / Adapter Shape

### Remote MCP adapter

- public route hosted by Knosi
- enforces OAuth bearer auth
- exposes the four V1 tools only
- maps tools into service-layer calls

### CLI capture API

Expose a protected server endpoint for the local CLI, for example:

- `POST /api/integrations/ai-captures`

This endpoint:

- accepts the same message-based payload used by the CLI
- authenticates via CLI OAuth token
- calls `captureAiNote()`

The CLI does not need a separate persistence model beyond shared auth state and the existing notes system.

---

## Error Handling

Return explicit, narrow errors.

### Common error codes

- `unauthorized`
- `forbidden_scope`
- `invalid_payload`
- `payload_too_large`
- `folder_create_failed`
- `note_create_failed`
- `network_error`

### Caller behavior

#### Claude Web

- if auth expires, prompt reconnect/re-authorize the Knosi connector
- if save fails, surface the exact failure and do not pretend the note exists

#### Claude Code CLI

- if auth expires, ask the user to run `knosi auth login`
- if API call fails, print structured stderr and non-zero exit code

### Duplicate saves

V1 intentionally keeps duplicate handling simple:

- repeated explicit saves create repeated notes
- no server-side semantic dedupe in V1

This behavior is predictable and avoids false positives.

---

## Security and Permission Boundaries

- Only explicit user intent should trigger save behavior.
- The write scope is limited to creating new notes in `AI Inbox`.
- No caller-controlled folder path in V1.
- No update/delete tools exposed to Claude.
- No unbounded bulk export endpoint.
- Payloads should be treated as plain text/markdown and normalized before rendering.

---

## Verification Strategy

V1 needs real checks for both server behavior and both entrypoints.

### 1. Service-level verification

- test `resolveOrCreateAiInboxFolder()`:
  - existing folder reused
  - missing folder created once
- test `captureAiNote()`:
  - creates one `notes` row
  - sets `folderId` to `AI Inbox`
  - stores Tiptap JSON content
  - stores searchable `plainText`
  - enqueues knowledge indexing

### 2. API/adapter verification

- remote MCP tool tests for:
  - auth required
  - `search_knowledge` returns only caller-owned data
  - `save_to_knosi` writes exactly one note
- CLI capture API test for:
  - valid bearer token accepted
  - invalid token rejected

### 3. End-to-end manual checks

### Claude Web

1. connect Knosi as a Claude custom connector
2. ask Claude to save a short excerpt
3. confirm a note appears in `AI Inbox`

### Claude Code

1. run `knosi auth login`
2. invoke `/save-to-knosi`
3. confirm the same save path creates a note in `AI Inbox`

### Broad checks

Because this touches auth and server routes, the eventual implementation should also run:

- `pnpm lint`
- `pnpm build`
- targeted automated tests for the capture service and auth paths

If the implementation changes user-facing flows and no good automated E2E exists, add a minimal E2E rather than skipping verification.

---

## Rollout Order

Recommended implementation order:

1. shared server capture service
2. `AI Inbox` folder resolver
3. CLI capture API
4. local CLI auth + save command
5. Claude Code skill
6. remote MCP adapter with read tools
7. remote MCP `save_to_knosi`
8. settings UI for connected client revocation

This order delivers value early while keeping the core logic stable.

---

## Residual Risks

- OAuth authorization-server work is the heaviest part of the design.
- Claude Web connector behavior depends on Anthropic's remote MCP expectations; exact route shape may need small integration-driven adjustments.
- Payload size limits need real-world tuning after first usage.
- Duplicate saves are acceptable in V1 but may become noisy for frequent users.

---

## Final Design Statement

Knosi V1 for Claude capture uses **dual entrypoints with one shared server-side capture core**:

- `Claude Web` reads and writes through a Knosi-hosted `remote MCP` connector
- `Claude Code` saves explicitly through a personal skill and local CLI
- both paths create exactly one raw capture note inside `AI Inbox`
- no extra AI summarization is performed in V1
- existing Knosi accounts are reused, while integration credentials are issued separately via OAuth

This gives the user a practical way to turn Claude conversations into durable knowledge without over-designing the first version.
