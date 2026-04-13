# CLI Browser Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "copy-paste token" CLI login flow with a browser-based OAuth-style authorization, similar to `vercel login` or `gh auth login`.

**Architecture:** CLI runs `knosi login` → opens browser to `/cli/auth?session_id=xxx` → user sees "Authorize CLI" page (already logged in via NextAuth) → clicks Approve → server generates token, stores in DB → CLI polls `/api/cli/auth/poll?session_id=xxx` and receives the token automatically. No manual copy-paste.

**Tech Stack:** Next.js App Router pages + API routes, existing `cli_tokens` table + `generateCliToken()`, CLI `open` package for browser launch.

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `src/app/api/cli/auth/session/route.ts` | `POST` — CLI calls this to create a pending auth session (returns `sessionId`) |
| `src/app/api/cli/auth/poll/route.ts` | `GET ?session_id=xxx` — CLI polls this; returns `{status: "pending"}` or `{status: "approved", token: "knosi_..."}` |
| `src/app/api/cli/auth/approve/route.ts` | `POST {sessionId}` — Browser calls this (with NextAuth session) to approve and generate token |
| `src/app/(app)/cli/auth/page.tsx` | Browser UI: "Authorize Knosi CLI" confirmation page |
| `src/server/ai/cli-auth-session.ts` | In-memory store for pending CLI auth sessions (Map with TTL cleanup) |

### Modified files
| File | Change |
|---|---|
| `packages/cli/src/index.mjs` | Rewrite `loginFlow()`: create session → open browser → poll for token |
| `packages/cli/src/api.mjs` | Add `createAuthSession()` and `pollAuthSession()` exports |

### Deleted files
| File | Reason |
|---|---|
| `src/app/api/cli/token/route.ts` | No longer needed — token generation moved to approve endpoint |

---

## Flow Diagram

```
CLI                          Server                       Browser
 │                             │                             │
 ├─ POST /api/cli/auth/session │                             │
 │     (no auth needed)        │                             │
 │◄── { sessionId, authUrl }   │                             │
 │                             │                             │
 ├─ open(authUrl) ────────────────────────────────────────►  │
 │                             │                   GET /cli/auth?session_id=xxx
 │                             │                   (requires NextAuth session)
 │                             │                             │
 │  poll loop:                 │               User clicks "Authorize"
 ├─ GET /api/cli/auth/poll ──► │                             │
 │◄── { status: "pending" }    │◄─ POST /api/cli/auth/approve
 │                             │   (NextAuth session + sessionId)
 ├─ GET /api/cli/auth/poll ──► │   → generateCliToken(userId)
 │◄── { status: "approved",   │   → store token in session map
 │      token: "knosi_..." }   │                             │
 │                             │                             │
 ├─ save token to ~/.knosi/token                             │
 └─ ✅ Done                                                  │
```

---

### Task 1: CLI Auth Session Store

**Files:**
- Create: `src/server/ai/cli-auth-session.ts`

- [ ] **Step 1: Create the in-memory session store**

```typescript
// src/server/ai/cli-auth-session.ts
import crypto from "node:crypto";

interface PendingSession {
  createdAt: number;
  token: string | null; // null = pending, string = approved
}

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const sessions = new Map<string, PendingSession>();

/** Create a new pending CLI auth session. Returns the session ID. */
export function createCliAuthSession(): string {
  cleanup();
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, { createdAt: Date.now(), token: null });
  return sessionId;
}

/** Check session status. Returns null if not found/expired, token string if approved, "pending" if waiting. */
export function getCliAuthSessionStatus(sessionId: string): "pending" | string | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return null;
  }
  if (session.token) {
    // One-time read: delete after returning
    sessions.delete(sessionId);
    return session.token;
  }
  return "pending";
}

/** Approve a session by attaching a token. Returns false if session not found/expired. */
export function approveCliAuthSession(sessionId: string, token: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return false;
  }
  if (session.token) return false; // already approved
  session.token = token;
  return true;
}

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/cli-auth-session.ts
git commit -m "feat(cli-auth): add in-memory session store for browser auth flow"
```

---

### Task 2: Server API Routes

**Files:**
- Create: `src/app/api/cli/auth/session/route.ts`
- Create: `src/app/api/cli/auth/poll/route.ts`
- Create: `src/app/api/cli/auth/approve/route.ts`
- Delete: `src/app/api/cli/token/route.ts`

- [ ] **Step 1: Create session endpoint (no auth required)**

```typescript
// src/app/api/cli/auth/session/route.ts
import { createCliAuthSession } from "@/server/ai/cli-auth-session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const serverUrl = body.serverUrl || "";

  const sessionId = createCliAuthSession();
  const authUrl = `${serverUrl}/cli/auth?session_id=${sessionId}`;

  return Response.json({ sessionId, authUrl });
}
```

- [ ] **Step 2: Create poll endpoint (no auth required)**

```typescript
// src/app/api/cli/auth/poll/route.ts
import { getCliAuthSessionStatus } from "@/server/ai/cli-auth-session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");

  if (!sessionId) {
    return Response.json({ error: "Missing session_id" }, { status: 400 });
  }

  const status = getCliAuthSessionStatus(sessionId);

  if (status === null) {
    return Response.json({ status: "expired" });
  }

  if (status === "pending") {
    return Response.json({ status: "pending" });
  }

  // status is the token string
  return Response.json({ status: "approved", token: status });
}
```

- [ ] **Step 3: Create approve endpoint (requires NextAuth session)**

```typescript
// src/app/api/cli/auth/approve/route.ts
import { z } from "zod/v4";
import { auth } from "@/lib/auth";
import { generateCliToken } from "@/server/ai/cli-auth";
import { approveCliAuthSession } from "@/server/ai/cli-auth-session";

const bodySchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const { token } = await generateCliToken(session.user.id, "CLI (browser auth)");
  const ok = approveCliAuthSession(parsed.data.sessionId, token);

  if (!ok) {
    return Response.json({ error: "Session expired or already used" }, { status: 410 });
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Delete the old manual token endpoint**

```bash
rm src/app/api/cli/token/route.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cli/auth/ && git rm src/app/api/cli/token/route.ts
git commit -m "feat(cli-auth): add browser auth API routes (session/poll/approve)"
```

---

### Task 3: Browser Authorization Page

**Files:**
- Create: `src/app/(app)/cli/auth/page.tsx`

- [ ] **Step 1: Create the authorization page**

```tsx
// src/app/(app)/cli/auth/page.tsx
"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";

export default function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = use(searchParams);
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "approving" | "done" | "error">("idle");

  if (!session_id) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Invalid Request</h1>
          <p className="mt-2 text-muted-foreground">
            This page should be opened from the Knosi CLI.
            Run <code className="rounded bg-muted px-1.5 py-0.5 text-sm">knosi login</code> to start.
          </p>
        </div>
      </div>
    );
  }

  async function handleApprove() {
    setStatus("approving");
    try {
      const res = await fetch("/api/cli/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session_id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to authorize");
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">✓</div>
          <h1 className="text-2xl font-bold">CLI Authorized</h1>
          <p className="mt-2 text-muted-foreground">
            You can close this tab and return to your terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md w-full rounded-lg border bg-card p-8 text-center shadow-sm">
        <div className="text-4xl mb-4">🔐</div>
        <h1 className="text-2xl font-bold">Authorize Knosi CLI</h1>
        <p className="mt-3 text-muted-foreground">
          The Knosi CLI is requesting access to your account.
          This will allow the CLI daemon to process AI tasks on your behalf.
        </p>

        <div className="mt-8 flex gap-3 justify-center">
          <button
            onClick={() => router.back()}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={status === "approving"}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === "approving" ? "Authorizing..." : "Authorize"}
          </button>
        </div>

        {status === "error" && (
          <p className="mt-4 text-sm text-destructive">
            Authorization failed. The session may have expired — try running{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">knosi login</code> again.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/cli/auth/page.tsx
git commit -m "feat(cli-auth): add browser authorization confirmation page"
```

---

### Task 4: Update CLI Login Flow

**Files:**
- Modify: `packages/cli/src/api.mjs` — add `createAuthSession()` and `pollAuthSession()`
- Modify: `packages/cli/src/index.mjs` — rewrite `loginFlow()`

- [ ] **Step 1: Add auth session API functions to api.mjs**

Add these two exports at the bottom of `packages/cli/src/api.mjs`:

```javascript
export async function createAuthSession(serverUrl) {
  const res = await fetch(`${serverUrl}/api/cli/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverUrl }),
  });
  if (!res.ok) throw new Error(`Failed to create auth session: ${res.status}`);
  return res.json(); // { sessionId, authUrl }
}

export async function pollAuthSession(serverUrl, sessionId) {
  const res = await fetch(
    `${serverUrl}/api/cli/auth/poll?session_id=${encodeURIComponent(sessionId)}`
  );
  if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
  return res.json(); // { status: "pending" | "approved" | "expired", token?: string }
}
```

- [ ] **Step 2: Rewrite loginFlow() in index.mjs**

Replace the entire `loginFlow` function and the `import` of `setAuthToken` in `packages/cli/src/index.mjs`:

Update the import line:
```javascript
import { configure, claimTask, sendHeartbeat, setAuthToken, createAuthSession, pollAuthSession } from "./api.mjs";
```

Replace the `loginFlow` function:
```javascript
async function loginFlow() {
  console.log("");
  console.log("🔐 Knosi CLI Login");
  console.log("");

  // Step 1: Create a pending auth session on the server
  let session;
  try {
    session = await createAuthSession(serverUrl);
  } catch (err) {
    console.error(`❌ Could not reach ${serverUrl}. Is the server running?`);
    console.error(`   ${err.message}`);
    process.exit(1);
  }

  // Step 2: Open the browser
  const authUrl = session.authUrl;
  console.log("Opening browser for authorization...");
  console.log("");
  console.log(`  If the browser doesn't open, visit:`);
  console.log(`  ${authUrl}`);
  console.log("");

  // Dynamic import to handle open across platforms
  try {
    const { default: open } = await import("open");
    await open(authUrl);
  } catch {
    // open package not available — user can manually visit the URL
  }

  // Step 3: Poll for approval
  console.log("Waiting for authorization...");
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_DURATION_MS = 5 * 60 * 1000; // 5 min
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const result = await pollAuthSession(serverUrl, session.sessionId);

      if (result.status === "approved" && result.token) {
        saveToken(result.token);
        console.log("");
        console.log("✅ Authenticated successfully! Token saved to ~/.knosi/token");
        console.log("   Run `knosi` to start the daemon.");
        process.exit(0);
      }

      if (result.status === "expired") {
        console.error("");
        console.error("❌ Session expired. Please try again.");
        process.exit(1);
      }

      // status === "pending" — keep polling
    } catch {
      // Network hiccup — keep trying
    }
  }

  console.error("");
  console.error("❌ Timed out waiting for authorization. Please try again.");
  process.exit(1);
}
```

- [ ] **Step 3: Run build check from CLI package**

```bash
cd packages/cli && node --check src/index.mjs && node --check src/api.mjs
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.mjs packages/cli/src/api.mjs
git commit -m "feat(cli): rewrite login to use browser auth flow instead of manual token paste"
```

---

### Task 5: Add `open` dependency to CLI package

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Add `open` as a dependency**

```bash
cd /Users/bytedance/second-brain/packages/cli && npm install open
```

Note: `open` is a well-known cross-platform package for opening URLs in the default browser. The CLI already has a dynamic `import("open")` with a try/catch fallback, so this is a graceful dependency.

- [ ] **Step 2: Verify it installed correctly**

```bash
node -e "const o = await import('open'); console.log('open loaded')"
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json packages/cli/package-lock.json
git commit -m "chore(cli): add open package for browser auth flow"
```

---

### Task 6: Build & Smoke Test

**Files:** (no code changes)

- [ ] **Step 1: Build the Next.js app**

```bash
cd /Users/bytedance/second-brain && pnpm build
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: No new errors.

- [ ] **Step 3: Manual smoke test**

Start the dev server and verify the full flow:

```bash
pnpm dev
```

In another terminal:

```bash
cd packages/cli && node src/index.mjs login --url http://localhost:3000
```

Expected:
1. Browser opens to `http://localhost:3000/cli/auth?session_id=...`
2. Page shows "Authorize Knosi CLI" with Authorize/Cancel buttons
3. Click "Authorize" → page shows "CLI Authorized"
4. Terminal shows "✅ Authenticated successfully!"
5. `cat ~/.knosi/token` shows a `knosi_...` token

Then verify the daemon works with the new token:

```bash
node src/index.mjs --url http://localhost:3000
```

Expected: Daemon starts and polls without auth errors.

- [ ] **Step 4: Commit any fixes from smoke testing, if needed**

---

### Task 7: Pre-merge verification

**Files:** (no code changes)

- [ ] **Step 1: Verify all acceptance criteria**

Walk the flow end-to-end:

| Criterion | How to verify |
|---|---|
| `knosi login` opens browser automatically | Run login, observe browser opens |
| User sees auth confirmation page | Check the page renders with Authorize/Cancel |
| Clicking Authorize completes the flow | CLI receives token within poll interval |
| Token persists to `~/.knosi/token` | Check file exists with `knosi_` prefix |
| Session expires after 5 minutes | Wait or set TTL to 10s for test, verify "expired" |
| Old `/api/cli/token` route is removed | `curl -X POST localhost:3000/api/cli/token` → 404 |
| Daemon works with browser-issued token | Start daemon, verify it polls without 401 |

- [ ] **Step 2: Confirm no regressions**

- Existing daemon Bearer token auth still works (tokens in `cli_tokens` table still valid)
- `knosi logout` still removes `~/.knosi/token`
- All existing API endpoints still require Bearer auth

- [ ] **Step 3: If all pass, commit and push**

```bash
git push
```
