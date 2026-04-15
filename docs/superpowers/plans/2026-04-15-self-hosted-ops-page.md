# Self-Hosted Ops Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user, read-only `/settings/ops` page that shows deployment, service, queue, daemon, cron, and host health for the self-hosted Hetzner stack without exposing arbitrary shell execution.

**Architecture:** Keep the page inside the existing authenticated settings area, aggregate app-native status on the server, and read host-native status from a narrow JSON snapshot generated on the Hetzner host. Use one owner-only authorization helper, one server-side data assembler, and focused card components so each operational concern stays isolated and testable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Drizzle ORM, SQLite/Turso, Playwright, tsx tests, Docker Compose, Hetzner cron.

---

## File Map

| File | Responsibility |
|---|---|
| `src/server/ops/authorization.ts` | Owner-only gate for the Ops page |
| `src/server/ops/types.ts` | Shared typed shapes for ops snapshot data |
| `src/server/ops/deployment.ts` | Runtime deployment metadata (`git sha`, `deployment id`, source, environment) |
| `src/server/ops/job-heartbeats.ts` | DB-backed read/write helpers for cron job heartbeat status |
| `src/server/ops/host-snapshot.ts` | Read and validate the host-generated JSON snapshot |
| `src/server/ops/page-data.ts` | Aggregate all cards into one page payload |
| `src/server/ops/*.test.mjs` | Focused unit tests for owner gate, snapshot parsing, and page data assembly |
| `src/app/(app)/settings/ops/page.tsx` | Server page route for `/settings/ops` |
| `src/app/(app)/settings/ops/ops-dashboard.tsx` | Read-only card layout and formatting |
| `src/app/(app)/settings/ops/ops-card.tsx` | Small presentational wrapper for cards |
| `src/app/(app)/settings/page.tsx` | Add a link/entry point to the new Ops page |
| `src/server/db/schema.ts` | Add `ops_job_heartbeats` table |
| `drizzle/*.sql` | Generated migration for `ops_job_heartbeats` |
| `src/app/api/jobs/tick/route.ts` | Record cron heartbeat success/failure |
| `src/app/api/cron/cleanup-stale-chat-tasks/route.ts` | Record cron heartbeat success/failure |
| `src/app/api/cron/portfolio-news/route.ts` | Record cron heartbeat when enabled |
| `ops/hetzner/collect-ops-snapshot.sh` | Host-side snapshot collector script |
| `docker-compose.prod.yml` | Mount host snapshot directory into the app container |
| `ops/hetzner/knosi.cron.example` | Add periodic host snapshot collection |
| `README.md` | Document the new Ops page and host snapshot requirement |
| `docs/changelog/2026-04-15-self-hosted-ops-page.md` | Record the implementation, verification, and deployment follow-up |

### Task 1: Add owner-only access control and route scaffolding

**Files:**
- Create: `src/server/ops/authorization.ts`
- Create: `src/server/ops/authorization.test.mjs`
- Create: `src/app/(app)/settings/ops/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Write the failing owner gate test**

Create `src/server/ops/authorization.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  __resetOpsOwnerConfigCacheForUnitTest,
  getOpsOwnerAccess,
} from "@/server/ops/authorization";

test("getOpsOwnerAccess returns allowed when session email matches env", () => {
  process.env.OPS_OWNER_EMAIL = "owner@example.com";
  __resetOpsOwnerConfigCacheForUnitTest();

  const result = getOpsOwnerAccess({
    user: { id: "u_1", email: "owner@example.com" },
  });

  assert.deepEqual(result, {
    allowed: true,
    reason: null,
  });
});

test("getOpsOwnerAccess returns denied when session email does not match env", () => {
  process.env.OPS_OWNER_EMAIL = "owner@example.com";
  __resetOpsOwnerConfigCacheForUnitTest();

  const result = getOpsOwnerAccess({
    user: { id: "u_2", email: "other@example.com" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not-owner");
});

test("getOpsOwnerAccess returns unavailable when OPS_OWNER_EMAIL is missing", () => {
  delete process.env.OPS_OWNER_EMAIL;
  __resetOpsOwnerConfigCacheForUnitTest();

  const result = getOpsOwnerAccess({
    user: { id: "u_1", email: "owner@example.com" },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "missing-owner-config");
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/authorization.test.mjs
```

Expected: FAIL with module-not-found or missing export errors for `@/server/ops/authorization`.

- [ ] **Step 3: Implement the owner-only access helper**

Create `src/server/ops/authorization.ts`:

```ts
type OpsSessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

export type OpsOwnerAccess =
  | { allowed: true; reason: null }
  | {
      allowed: false;
      reason: "missing-session" | "missing-owner-config" | "not-owner";
    };

let cachedOwnerEmail: string | null | undefined;

function readOwnerEmail() {
  if (cachedOwnerEmail !== undefined) {
    return cachedOwnerEmail;
  }

  const email = process.env.OPS_OWNER_EMAIL?.trim().toLowerCase() ?? "";
  cachedOwnerEmail = email.length > 0 ? email : null;
  return cachedOwnerEmail;
}

export function getOpsOwnerAccess(session: OpsSessionLike): OpsOwnerAccess {
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? "";
  if (!session?.user?.id || sessionEmail.length === 0) {
    return { allowed: false, reason: "missing-session" };
  }

  const ownerEmail = readOwnerEmail();
  if (!ownerEmail) {
    return { allowed: false, reason: "missing-owner-config" };
  }

  if (sessionEmail !== ownerEmail) {
    return { allowed: false, reason: "not-owner" };
  }

  return { allowed: true, reason: null };
}

export function __resetOpsOwnerConfigCacheForUnitTest() {
  cachedOwnerEmail = undefined;
}
```

- [ ] **Step 4: Re-run the owner gate test**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/authorization.test.mjs
```

Expected: PASS, all 3 tests green.

- [ ] **Step 5: Scaffold the `/settings/ops` page and entry point**

Create `src/app/(app)/settings/ops/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getRequestSession } from "@/server/auth/request-session";
import { getOpsOwnerAccess } from "@/server/ops/authorization";

export default async function SettingsOpsPage() {
  const session = await getRequestSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const access = getOpsOwnerAccess(session);
  if (!access.allowed) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Ops</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Self-hosted deployment, daemon, queue, and machine health.
        </p>
      </div>
    </div>
  );
}
```

Modify `src/app/(app)/settings/page.tsx` near the top intro section to add a link:

```tsx
import Link from "next/link";
```

and inside the top-level header block:

```tsx
<div className="mt-4">
  <Link
    href="/settings/ops"
    className="inline-flex items-center justify-center rounded-xl border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-900"
  >
    Open Ops dashboard
  </Link>
</div>
```

- [ ] **Step 6: Verify the app still builds this new route**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
AUTH_SECRET=test-secret TURSO_DATABASE_URL=file:data/second-brain.db NEXT_DEPLOYMENT_ID=ops-route pnpm build
```

Expected: PASS, Next.js build succeeds with the new `/settings/ops` route scaffolded.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
git add src/server/ops/authorization.ts src/server/ops/authorization.test.mjs 'src/app/(app)/settings/ops/page.tsx' 'src/app/(app)/settings/page.tsx'
git commit -m "feat: add owner-only ops route scaffold"
```

Expected: commit succeeds with the four files staged.

### Task 2: Add DB-backed cron heartbeat status and queue/deployment aggregators

**Files:**
- Create: `src/server/ops/types.ts`
- Create: `src/server/ops/deployment.ts`
- Create: `src/server/ops/job-heartbeats.ts`
- Create: `src/server/ops/page-data.ts`
- Create: `src/server/ops/page-data.test.mjs`
- Modify: `src/server/db/schema.ts`
- Modify: `src/app/api/jobs/tick/route.ts`
- Modify: `src/app/api/cron/cleanup-stale-chat-tasks/route.ts`
- Modify: `src/app/api/cron/portfolio-news/route.ts`
- Create: `drizzle/<generated>.sql`

- [ ] **Step 1: Write the failing page-data test**

Create `src/server/ops/page-data.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOverallStatus } from "@/server/ops/page-data";

test("summarizeOverallStatus returns degraded when daemon is stale", () => {
  const result = summarizeOverallStatus({
    services: [
      { name: "knosi", status: "healthy" },
      { name: "redis", status: "healthy" },
      { name: "caddy", status: "healthy" },
      { name: "daemon", status: "degraded" },
    ],
    queue: {
      queued: 0,
      running: 1,
      failedRecent: 0,
    },
    host: { available: true },
    cron: {
      jobsTick: { status: "healthy" },
      cleanupStaleChatTasks: { status: "healthy" },
    },
  });

  assert.equal(result, "degraded");
});

test("summarizeOverallStatus returns healthy when all subsystems are healthy", () => {
  const result = summarizeOverallStatus({
    services: [
      { name: "knosi", status: "healthy" },
      { name: "redis", status: "healthy" },
      { name: "caddy", status: "healthy" },
      { name: "daemon", status: "healthy" },
    ],
    queue: {
      queued: 0,
      running: 0,
      failedRecent: 0,
    },
    host: { available: true },
    cron: {
      jobsTick: { status: "healthy" },
      cleanupStaleChatTasks: { status: "healthy" },
    },
  });

  assert.equal(result, "healthy");
});
```

- [ ] **Step 2: Run the page-data test to confirm it fails**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/page-data.test.mjs
```

Expected: FAIL because `@/server/ops/page-data` does not exist yet.

- [ ] **Step 3: Add the `ops_job_heartbeats` schema**

Modify `src/server/db/schema.ts` to add:

```ts
export const opsJobHeartbeats = sqliteTable("ops_job_heartbeats", {
  jobName: text("job_name").primaryKey(),
  lastStatus: text("last_status", {
    enum: ["healthy", "degraded"],
  }).notNull(),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp_ms" }),
  lastFailureAt: integer("last_failure_at", { mode: "timestamp_ms" }),
  lastMessage: text("last_message"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

Generate migration:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm db:generate
```

Expected: a new `drizzle/*.sql` file is created containing `CREATE TABLE "ops_job_heartbeats"`.

- [ ] **Step 4: Add typed deployment, heartbeat, and status helpers**

Create `src/server/ops/types.ts`:

```ts
export type OpsServiceStatus = "healthy" | "degraded" | "unknown";
export type OpsOverallStatus = "healthy" | "degraded" | "down";

export type OpsDeploymentSnapshot = {
  gitSha: string | null;
  deploymentId: string | null;
  source: "github-actions" | "manual" | "unknown";
  deployedAt: string | null;
  environment: "production";
};

export type OpsJobHeartbeatSnapshot = {
  jobName: string;
  status: "healthy" | "degraded" | "unknown";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  message: string | null;
};
```

Create `src/server/ops/deployment.ts`:

```ts
import type { OpsDeploymentSnapshot } from "./types";

export function getDeploymentSnapshot(): OpsDeploymentSnapshot {
  const gitSha = process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null;
  const deploymentId = process.env.NEXT_DEPLOYMENT_ID ?? null;
  const deployedAt = process.env.DEPLOYED_AT ?? null;
  const source = process.env.GITHUB_ACTIONS === "true" ? "github-actions" : deployedAt ? "manual" : "unknown";

  return {
    gitSha,
    deploymentId,
    source,
    deployedAt,
    environment: "production",
  };
}
```

Create `src/server/ops/job-heartbeats.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { opsJobHeartbeats } from "@/server/db/schema";

export async function markOpsJobSuccess(jobName: string, message: string | null = null) {
  const now = new Date();
  await db
    .insert(opsJobHeartbeats)
    .values({
      jobName,
      lastStatus: "healthy",
      lastSuccessAt: now,
      lastMessage: message,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opsJobHeartbeats.jobName,
      set: {
        lastStatus: "healthy",
        lastSuccessAt: now,
        lastMessage: message,
        updatedAt: now,
      },
    });
}

export async function markOpsJobFailure(jobName: string, message: string) {
  const now = new Date();
  await db
    .insert(opsJobHeartbeats)
    .values({
      jobName,
      lastStatus: "degraded",
      lastFailureAt: now,
      lastMessage: message,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: opsJobHeartbeats.jobName,
      set: {
        lastStatus: "degraded",
        lastFailureAt: now,
        lastMessage: message,
        updatedAt: now,
      },
    });
}

export async function listOpsJobHeartbeats() {
  return db.select().from(opsJobHeartbeats);
}
```

- [ ] **Step 5: Add page data aggregation and health summarization**

Create `src/server/ops/page-data.ts`:

```ts
import { count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { chatTasks, daemonHeartbeats } from "@/server/db/schema";
import { snapshotMetrics } from "@/server/metrics";
import { getDeploymentSnapshot } from "./deployment";
import { listOpsJobHeartbeats } from "./job-heartbeats";
import type { OpsOverallStatus, OpsServiceStatus } from "./types";

export function summarizeOverallStatus(input: {
  services: Array<{ name: string; status: OpsServiceStatus }>;
  queue: { queued: number; running: number; failedRecent: number };
  host: { available: boolean };
  cron: Record<string, { status: "healthy" | "degraded" | "unknown" }>;
}): OpsOverallStatus {
  if (!input.host.available) return "down";
  if (input.services.some((item) => item.status === "degraded")) return "degraded";
  if (Object.values(input.cron).some((item) => item.status !== "healthy")) return "degraded";
  if (input.queue.failedRecent > 0) return "degraded";
  return "healthy";
}

export async function getOpsPageData() {
  const now = Date.now();
  const failureWindow = new Date(now - 1000 * 60 * 60 * 6);
  const daemonStaleBefore = new Date(now - 1000 * 60 * 2);

  const [
    queuedRows,
    runningRows,
    failedRows,
    recentTasks,
    daemonRows,
    jobHeartbeats,
  ] = await Promise.all([
    db.select({ total: count() }).from(chatTasks).where(eq(chatTasks.status, "queued")),
    db.select({ total: count() }).from(chatTasks).where(eq(chatTasks.status, "running")),
    db.select({ total: count() }).from(chatTasks).where(
      sql`${chatTasks.status} = 'failed' and ${chatTasks.updatedAt} >= ${failureWindow}`,
    ),
    db
      .select({
        id: chatTasks.id,
        taskType: chatTasks.taskType,
        status: chatTasks.status,
        updatedAt: chatTasks.updatedAt,
      })
      .from(chatTasks)
      .orderBy(desc(chatTasks.updatedAt))
      .limit(10),
    db.select().from(daemonHeartbeats),
    listOpsJobHeartbeats(),
  ]);

  const daemon = daemonRows[0] ?? null;
  const daemonStatus: OpsServiceStatus =
    daemon && daemon.lastSeenAt && daemon.lastSeenAt >= daemonStaleBefore ? "healthy" : "degraded";

  const metrics = snapshotMetrics();

  return {
    generatedAt: new Date(now).toISOString(),
    deployment: getDeploymentSnapshot(),
    queue: {
      queued: queuedRows[0]?.total ?? 0,
      running: runningRows[0]?.total ?? 0,
      failedRecent: failedRows[0]?.total ?? 0,
      recentTasks,
    },
    daemon: {
      status: daemonStatus,
      lastSeenAt: daemon?.lastSeenAt?.toISOString() ?? null,
    },
    metrics,
    cron: jobHeartbeats,
  };
}
```

- [ ] **Step 6: Update cron routes to record heartbeat status**

At the top of each cron route, import:

```ts
import { markOpsJobFailure, markOpsJobSuccess } from "@/server/ops/job-heartbeats";
```

Then wrap the route body in `try/catch`. Example pattern for `src/app/api/jobs/tick/route.ts`:

```ts
try {
  // existing route logic
  await markOpsJobSuccess("jobs-tick");
  return NextResponse.json(result);
} catch (error) {
  await markOpsJobFailure(
    "jobs-tick",
    error instanceof Error ? error.message : "unknown error",
  );
  throw error;
}
```

Use job names:

- `jobs-tick`
- `cleanup-stale-chat-tasks`
- `portfolio-news`

- [ ] **Step 7: Re-run tests and schema checks**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/page-data.test.mjs
AUTH_SECRET=test-secret TURSO_DATABASE_URL=file:data/second-brain.db pnpm db:push
```

Expected:

- page-data tests PASS
- `db:push` succeeds and creates `ops_job_heartbeats`

- [ ] **Step 8: Commit Task 2**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
git add src/server/ops/types.ts src/server/ops/deployment.ts src/server/ops/job-heartbeats.ts src/server/ops/page-data.ts src/server/ops/page-data.test.mjs src/server/db/schema.ts src/app/api/jobs/tick/route.ts src/app/api/cron/cleanup-stale-chat-tasks/route.ts src/app/api/cron/portfolio-news/route.ts drizzle
git commit -m "feat: add ops status aggregation and cron heartbeats"
```

Expected: commit succeeds with schema, server helpers, and cron route updates.

### Task 3: Add host snapshot collection and safe parsing

**Files:**
- Create: `ops/hetzner/collect-ops-snapshot.sh`
- Create: `src/server/ops/host-snapshot.ts`
- Create: `src/server/ops/host-snapshot.test.mjs`
- Modify: `docker-compose.prod.yml`
- Modify: `ops/hetzner/knosi.cron.example`
- Modify: `ops/hetzner/bootstrap.sh`

- [ ] **Step 1: Write the failing host snapshot parser test**

Create `src/server/ops/host-snapshot.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseOpsHostSnapshot } from "@/server/ops/host-snapshot";

test("parseOpsHostSnapshot returns unavailable for malformed JSON", () => {
  const result = parseOpsHostSnapshot("{not-json");
  assert.equal(result.available, false);
  assert.match(result.reason, /invalid/i);
});

test("parseOpsHostSnapshot returns typed host data for valid JSON", () => {
  const result = parseOpsHostSnapshot(
    JSON.stringify({
      generatedAt: "2026-04-15T15:00:00.000Z",
      host: {
        uptimeSeconds: 123,
        loadAverage: [0.1, 0.2, 0.3],
        memory: { usedBytes: 10, totalBytes: 20 },
        disk: { usedBytes: 30, totalBytes: 40, mount: "/" },
      },
      services: [{ name: "knosi", status: "healthy", detail: "Up 3m" }],
    }),
  );

  assert.equal(result.available, true);
  assert.equal(result.snapshot.host.memory.totalBytes, 20);
});
```

- [ ] **Step 2: Run the parser test to confirm it fails**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/host-snapshot.test.mjs
```

Expected: FAIL because the parser module does not exist yet.

- [ ] **Step 3: Add the host snapshot collector**

Create `ops/hetzner/collect-ops-snapshot.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/knosi}"
RUNTIME_DIR="${RUNTIME_DIR:-$APP_DIR/runtime}"
TMP_FILE="$RUNTIME_DIR/ops-snapshot.json.tmp"
OUT_FILE="$RUNTIME_DIR/ops-snapshot.json"

mkdir -p "$RUNTIME_DIR"

MEM_TOTAL_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
MEM_AVAILABLE_KB="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
MEM_USED_BYTES="$(( (MEM_TOTAL_KB - MEM_AVAILABLE_KB) * 1024 ))"
MEM_TOTAL_BYTES="$(( MEM_TOTAL_KB * 1024 ))"

read -r LOAD1 LOAD5 LOAD15 _ < /proc/loadavg

UPTIME_SECONDS="$(cut -d' ' -f1 /proc/uptime | cut -d'.' -f1)"

DISK_JSON="$(df -B1 --output=used,size,target /srv/knosi | tail -n1 | awk '{printf \"{\\\"usedBytes\\\":%s,\\\"totalBytes\\\":%s,\\\"mount\\\":\\\"%s\\\"}\", $1, $2, $3}')"

SERVICES_JSON="$(docker compose -f "$APP_DIR/docker-compose.prod.yml" ps --format json | node -e '
const fs = require(\"node:fs\");
const input = fs.readFileSync(0, \"utf8\").trim();
const rows = input ? input.split(/\\n+/).map((line) => JSON.parse(line)) : [];
const mapped = rows.map((row) => ({
  name: row.Service,
  status: row.State === \"running\" ? \"healthy\" : \"degraded\",
  detail: row.Status,
}));
process.stdout.write(JSON.stringify(mapped));
')"

cat >"$TMP_FILE" <<EOF
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "host": {
    "uptimeSeconds": ${UPTIME_SECONDS},
    "loadAverage": [${LOAD1}, ${LOAD5}, ${LOAD15}],
    "memory": {
      "usedBytes": ${MEM_USED_BYTES},
      "totalBytes": ${MEM_TOTAL_BYTES}
    },
    "disk": ${DISK_JSON}
  },
  "services": ${SERVICES_JSON}
}
EOF

mv "$TMP_FILE" "$OUT_FILE"
```

- [ ] **Step 4: Add the safe parser/reader**

Create `src/server/ops/host-snapshot.ts`:

```ts
import { readFile } from "node:fs/promises";
import { z } from "zod";

const hostSnapshotSchema = z.object({
  generatedAt: z.string(),
  host: z.object({
    uptimeSeconds: z.number(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    memory: z.object({
      usedBytes: z.number(),
      totalBytes: z.number(),
    }),
    disk: z.object({
      usedBytes: z.number(),
      totalBytes: z.number(),
      mount: z.string(),
    }),
  }),
  services: z.array(
    z.object({
      name: z.string(),
      status: z.enum(["healthy", "degraded", "unknown"]),
      detail: z.string().optional(),
    }),
  ),
});

export function parseOpsHostSnapshot(raw: string) {
  try {
    const parsed = hostSnapshotSchema.parse(JSON.parse(raw));
    return { available: true, snapshot: parsed } as const;
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "invalid host snapshot",
    } as const;
  }
}

export async function readOpsHostSnapshot() {
  try {
    const raw = await readFile("/app/runtime/ops-snapshot.json", "utf8");
    return parseOpsHostSnapshot(raw);
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : "host snapshot unavailable",
    } as const;
  }
}
```

- [ ] **Step 5: Mount the runtime snapshot into the app container**

Modify `docker-compose.prod.yml` under `knosi.volumes`:

```yml
    volumes:
      - knosi-data:/app/data
      - ./runtime:/app/runtime:ro
```

Modify `ops/hetzner/bootstrap.sh` to ensure the directory exists:

```bash
install -d -m 755 /srv/knosi
install -d -m 755 /srv/knosi/runtime
```

Modify `ops/hetzner/knosi.cron.example` to add the collector:

```cron
* * * * * APP_DIR=/srv/knosi /srv/knosi/ops/hetzner/collect-ops-snapshot.sh >/dev/null 2>&1
```

- [ ] **Step 6: Re-run the parser tests**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/host-snapshot.test.mjs
bash -n ops/hetzner/collect-ops-snapshot.sh
```

Expected:

- parser tests PASS
- shell script syntax check exits `0`

- [ ] **Step 7: Commit Task 3**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
git add ops/hetzner/collect-ops-snapshot.sh src/server/ops/host-snapshot.ts src/server/ops/host-snapshot.test.mjs docker-compose.prod.yml ops/hetzner/knosi.cron.example ops/hetzner/bootstrap.sh
git commit -m "feat: add host ops snapshot collector"
```

Expected: commit succeeds with the collector and host snapshot parser staged.

### Task 4: Build the dashboard UI and wire all five cards

**Files:**
- Create: `src/app/(app)/settings/ops/ops-card.tsx`
- Create: `src/app/(app)/settings/ops/ops-dashboard.tsx`
- Modify: `src/app/(app)/settings/ops/page.tsx`
- Modify: `src/server/ops/page-data.ts`

- [ ] **Step 1: Add the dashboard card components**

Create `src/app/(app)/settings/ops/ops-card.tsx`:

```tsx
import type { ReactNode } from "react";

export function OpsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-stone-200 bg-white/92 p-6 shadow-[0_22px_80px_-58px_rgba(15,23,42,0.55)] dark:border-stone-800 dark:bg-stone-950/88">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
```

Create `src/app/(app)/settings/ops/ops-dashboard.tsx`:

```tsx
import { OpsCard } from "./ops-card";

export function OpsDashboard({ data }: { data: Awaited<ReturnType<typeof import("@/server/ops/page-data").getOpsPageData>> }) {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-2">
        <OpsCard title="Deployment" description="What is running right now?">
          <dl className="grid gap-3 text-sm text-stone-700 dark:text-stone-200">
            <div><dt className="font-medium">Git SHA</dt><dd className="font-mono">{data.deployment.gitSha ?? "Unavailable"}</dd></div>
            <div><dt className="font-medium">Deployment ID</dt><dd className="font-mono">{data.deployment.deploymentId ?? "Unavailable"}</dd></div>
            <div><dt className="font-medium">Source</dt><dd>{data.deployment.source}</dd></div>
          </dl>
        </OpsCard>
        <OpsCard title="Services" description="Core service and daemon health">
          <ul className="space-y-3 text-sm text-stone-700 dark:text-stone-200">
            {data.services.map((service) => (
              <li key={service.name} className="flex items-center justify-between">
                <span>{service.name}</span>
                <span>{service.status}</span>
              </li>
            ))}
          </ul>
        </OpsCard>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <OpsCard title="Queue" description="Current chat task pressure">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-stone-500 dark:text-stone-400">Queued</p><p className="text-2xl font-semibold">{data.queue.queued}</p></div>
            <div><p className="text-stone-500 dark:text-stone-400">Running</p><p className="text-2xl font-semibold">{data.queue.running}</p></div>
            <div><p className="text-stone-500 dark:text-stone-400">Recent failures</p><p className="text-2xl font-semibold">{data.queue.failedRecent}</p></div>
          </div>
        </OpsCard>
        <OpsCard title="System" description="Host-level pressure snapshot">
          {data.host.available ? (
            <dl className="grid gap-3 text-sm text-stone-700 dark:text-stone-200">
              <div><dt className="font-medium">Memory</dt><dd>{data.host.snapshot.host.memory.usedBytes} / {data.host.snapshot.host.memory.totalBytes}</dd></div>
              <div><dt className="font-medium">Disk</dt><dd>{data.host.snapshot.host.disk.usedBytes} / {data.host.snapshot.host.disk.totalBytes}</dd></div>
              <div><dt className="font-medium">Load</dt><dd>{data.host.snapshot.host.loadAverage.join(", ")}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-300">{data.host.reason}</p>
          )}
        </OpsCard>
      </div>
      <OpsCard title="Health" description="Do I need SSH right now?">
        <div className="space-y-3 text-sm text-stone-700 dark:text-stone-200">
          <p className="text-base font-semibold">{data.overallStatus}</p>
          <p>Generated at {data.generatedAt}</p>
        </div>
      </OpsCard>
    </div>
  );
}
```

- [ ] **Step 2: Wire the page to the aggregated data**

Modify `src/app/(app)/settings/ops/page.tsx`:

```tsx
import { getOpsPageData } from "@/server/ops/page-data";
import { OpsDashboard } from "./ops-dashboard";
```

and replace the placeholder return body with:

```tsx
  const data = await getOpsPageData();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Ops</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Deployment, daemon, queue, cron, and machine health for this self-hosted stack.
        </p>
      </div>
      <OpsDashboard data={data} />
    </div>
  );
```

- [ ] **Step 3: Extend `getOpsPageData()` to produce the final page shape**

Update `src/server/ops/page-data.ts` to return:

```ts
import { readOpsHostSnapshot } from "./host-snapshot";

export async function getOpsPageData() {
  // existing deployment / queue / daemon / metrics work
  const host = await readOpsHostSnapshot();

  const services = [
    { name: "knosi", status: "healthy" as const },
    {
      name: "redis",
      status: metrics.caches ? "healthy" as const : "unknown" as const,
    },
    {
      name: "caddy",
      status: host.available
        ? host.snapshot.services.find((item) => item.name === "caddy")?.status ?? "unknown"
        : "unknown",
    },
    { name: "daemon", status: daemonStatus },
  ];

  const cronMap = {
    jobsTick: normalizeJobHeartbeat(jobHeartbeats, "jobs-tick"),
    cleanupStaleChatTasks: normalizeJobHeartbeat(jobHeartbeats, "cleanup-stale-chat-tasks"),
    portfolioNews: normalizeJobHeartbeat(jobHeartbeats, "portfolio-news"),
  };

  return {
    generatedAt: new Date(now).toISOString(),
    deployment: getDeploymentSnapshot(),
    services,
    queue: {
      queued: queuedRows[0]?.total ?? 0,
      running: runningRows[0]?.total ?? 0,
      failedRecent: failedRows[0]?.total ?? 0,
      recentTasks,
    },
    daemon: {
      status: daemonStatus,
      lastSeenAt: daemon?.lastSeenAt?.toISOString() ?? null,
    },
    host,
    cron: cronMap,
    overallStatus: summarizeOverallStatus({
      services,
      queue: {
        queued: queuedRows[0]?.total ?? 0,
        running: runningRows[0]?.total ?? 0,
        failedRecent: failedRows[0]?.total ?? 0,
      },
      host,
      cron: cronMap,
    }),
  };
}
```

- [ ] **Step 4: Run lint and build after wiring the UI**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm lint
AUTH_SECRET=test-secret TURSO_DATABASE_URL=file:data/second-brain.db NEXT_DEPLOYMENT_ID=ops-ui pnpm build
```

Expected:

- `pnpm lint` PASS (existing warnings may remain unchanged)
- `pnpm build` PASS with `/settings/ops`

- [ ] **Step 5: Commit Task 4**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
git add 'src/app/(app)/settings/ops/page.tsx' 'src/app/(app)/settings/ops/ops-card.tsx' 'src/app/(app)/settings/ops/ops-dashboard.tsx' src/server/ops/page-data.ts
git commit -m "feat: add self-hosted ops dashboard UI"
```

Expected: commit succeeds with the page and card components staged.

### Task 5: Add browser verification, docs, and production rollout notes

**Files:**
- Create: `tests/e2e/settings-ops.spec.ts`
- Modify: `README.md`
- Create: `docs/changelog/2026-04-15-self-hosted-ops-page.md`

- [ ] **Step 1: Add a minimal e2e coverage for owner-only access**

Create `tests/e2e/settings-ops.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("owner can open the ops dashboard after login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL ?? "owner@example.com");
  await page.getByLabel("Password").fill(process.env.E2E_USER_PASSWORD ?? "password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.goto("/settings/ops");

  await expect(page.getByRole("heading", { name: "Ops" })).toBeVisible();
  await expect(page.getByText("Deployment")).toBeVisible();
  await expect(page.getByText("Services")).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e and targeted tests**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
pnpm tsx --test src/server/ops/authorization.test.mjs src/server/ops/page-data.test.mjs src/server/ops/host-snapshot.test.mjs
pnpm test:e2e --grep "owner can open the ops dashboard after login"
```

Expected:

- unit tests PASS
- the Playwright test PASSes against the local app

- [ ] **Step 3: Document the feature and Hetzner setup**

Update `README.md` with a short “Ops dashboard” section:

```md
## Ops dashboard

Self-hosted production includes an owner-only `/settings/ops` page for deployment, daemon, queue, cron, and host health.

Required environment:

- `OPS_OWNER_EMAIL`

Hetzner production also needs the host collector cron job:

```bash
* * * * * APP_DIR=/srv/knosi /srv/knosi/ops/hetzner/collect-ops-snapshot.sh >/dev/null 2>&1
```
```

Create `docs/changelog/2026-04-15-self-hosted-ops-page.md` with:

```md
# 2026-04-15 — Self-hosted ops page

- task / goal: add a single-user `/settings/ops` page for self-hosted deployment visibility without SSH.
- key changes:
  - added owner-only ops route and dashboard cards
  - added DB-backed cron heartbeats
  - added host snapshot collector and mounted runtime snapshot
  - added browser verification for the new page
- files touched:
  - `src/app/(app)/settings/ops/page.tsx`
  - `src/app/(app)/settings/ops/ops-dashboard.tsx`
  - `src/server/ops/*`
  - `src/server/db/schema.ts`
  - `ops/hetzner/collect-ops-snapshot.sh`
  - `docker-compose.prod.yml`
  - `ops/hetzner/knosi.cron.example`
  - `README.md`
- verification commands and results:
  - `pnpm tsx --test src/server/ops/*.test.mjs` — PASS
  - `pnpm lint` — PASS
  - `pnpm build` — PASS
  - `pnpm test:e2e --grep "owner can open the ops dashboard after login"` — PASS
  - `ssh knosi 'APP_DIR=/srv/knosi /srv/knosi/ops/hetzner/collect-ops-snapshot.sh && cat /srv/knosi/runtime/ops-snapshot.json'` — PASS
- remaining risks or follow-up items:
  - host snapshot is minute-level, not real-time
  - only single-owner auth is supported in v1
```

- [ ] **Step 4: Perform the production rollout and verify the snapshot**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
rsync -az --delete --exclude-from=ops/hetzner/rsync-excludes.txt ./ knosi:/srv/knosi/
ssh knosi 'chmod +x /srv/knosi/ops/hetzner/collect-ops-snapshot.sh && APP_DIR=/srv/knosi /srv/knosi/ops/hetzner/collect-ops-snapshot.sh && cat /srv/knosi/runtime/ops-snapshot.json'
ssh knosi 'cd /srv/knosi && docker compose -f docker-compose.prod.yml up -d --build knosi caddy'
```

Expected:

- snapshot collector writes valid JSON on the server
- production containers rebuild successfully

- [ ] **Step 5: Verify the deployed dashboard**

Run:

```bash
curl -I https://www.knosi.xyz/settings/ops
ssh knosi 'curl -sS http://127.0.0.1:3000/settings/ops | head -n 40'
```

Expected:

- public request is authenticated and returns either `200` for a logged-in browser path or `307`/`200` login flow behavior as expected
- loopback HTML includes the `Ops` heading and card titles

- [ ] **Step 6: Commit Task 5**

Run:

```bash
cd /Users/bytedance/second-brain/.worktrees/codex-hetzner-self-host
git add tests/e2e/settings-ops.spec.ts README.md docs/changelog/2026-04-15-self-hosted-ops-page.md
git commit -m "docs: record self-hosted ops dashboard rollout"
```

Expected: commit succeeds with e2e coverage and documentation updates staged.

## Self-Review

### Spec coverage

- `/settings/ops` single-owner read-only route: covered by Task 1 and Task 4
- five cards (Deployment / Services / Queue / System / Health): covered by Task 4
- owner-only access with no general RBAC: covered by Task 1
- app-native data (deployment, daemon, queue, metrics, cron): covered by Task 2
- host-native allowlisted collector: covered by Task 3
- partial degradation and no arbitrary shell execution in the browser: covered by Task 3 and Task 4
- docs and real verification: covered by Task 5

No spec gaps remain.

### Placeholder scan

- Removed generic “add validation/error handling” wording and replaced it with concrete route-wrapping and parser code.
- Every task contains explicit file paths, commands, and expected outcomes.

### Type consistency

- Owner gate naming is consistent: `getOpsOwnerAccess`
- Host snapshot parser naming is consistent: `parseOpsHostSnapshot` / `readOpsHostSnapshot`
- Overall status naming is consistent: `summarizeOverallStatus`

No naming mismatches remain.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-self-hosted-ops-page.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
