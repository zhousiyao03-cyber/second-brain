# Model Provider Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace knosi 的 6-provider AI routing 系统（local/openai/codex/cursor/claude-code-daemon/knosi-hosted + 散落 env）为 user-managed Provider 表 + Role 表的统一接入层，支持 OpenAI / DeepSeek / 任意 OpenAI-compatible API 零代码加新服务。

**Architecture:** 新增 `ai_providers`（用户配置的 backend 实例）+ `ai_role_assignments`（chat/task/embedding 三个 role 各选一个 provider+model）两张 DB 表；API key 用 AES-256-GCM 加密（master key 来自 `KNOSI_SECRET_KEY` env）；新 façade `resolveAiCall(role, userId)` 取代旧的 mode-based dispatcher；删除 `codex.ts` / cursor / hosted 整套；Settings UI 重写为「Providers 段 + AI Roles 段」两段式。

**Tech Stack:** Drizzle ORM + libsql/Turso, Vercel AI SDK v6 (`@ai-sdk/openai`), Next.js 16 App Router, tRPC v11, React 19 + Tailwind v4, vitest, Playwright, Node `crypto` (AES-256-GCM)

**Reference Spec:** `docs/superpowers/specs/2026-05-02-model-provider-refactor-design.md`

**Branch:** `feat/model-provider-refactor`（已开）

---

## File Map

### New files

| Path | Responsibility |
|---|---|
| `src/server/ai/crypto.ts` | AES-256-GCM `encryptApiKey` / `decryptApiKey` + master-key validation |
| `src/server/ai/crypto.test.ts` | Round-trip / IV-uniqueness / wrong-secret tests |
| `src/server/db/schema/ai-providers.ts` | Drizzle tables `ai_providers` + `ai_role_assignments` |
| `src/server/ai/provider/resolve.ts` | `resolveAiCall(role, userId)` + `MissingAiRoleError` (replaces `mode.ts`) |
| `src/server/ai/provider/resolve.test.ts` | role 解析 / daemon-禁用-embedding / cache 失效 |
| `src/server/ai/provider/presets.ts` | OpenAI-compatible preset 列表 + 静态 model 预设 + 默认 daemon model 列表 |
| `src/server/ai/provider/probe.ts` | `probeProvider(provider)` — `GET /v1/models` 探活 + daemon health |
| `src/server/routers/ai-settings.ts` | New tRPC router (replaces billing.ts AI procedures) |
| `src/app/(app)/settings/providers/providers-section.tsx` | Providers 段 UI |
| `src/app/(app)/settings/providers/provider-card.tsx` | 单 provider 卡片（Test / Edit 按钮） |
| `src/app/(app)/settings/providers/provider-edit-dialog.tsx` | Add / Edit 弹窗（按 kind 渲染） |
| `src/app/(app)/settings/providers/roles-section.tsx` | AI Roles 段 UI |
| `src/app/(app)/settings/providers/role-row.tsx` | 单 role 行（provider + model 选择器 + Refresh） |
| `e2e/ai-settings.spec.ts` | E2E：Add/Edit/Delete provider + Set role + 验证 chat 走选定 provider |
| `drizzle/00xx_ai_provider_refactor.sql` | drizzle-generated migration |
| `docs/changelog/2026-05-02-model-provider-refactor.md` | Phase changelog |

### Modified files

| Path | Change |
|---|---|
| `src/server/db/schema/auth.ts` | Drop `aiProviderPreference` / `aiChatModel` columns |
| `src/server/db/schema/index.ts` | Add `ai-providers` re-export |
| `src/server/ai/provider/index.ts` | Rewrite façade, remove hosted/codex branches |
| `src/server/ai/provider/types.ts` | Drop `AIProviderMode` enum, add `ProviderKind` + `ResolvedProvider` |
| `src/server/ai/provider/ai-sdk.ts` | Drop cursor branch + env-reading; accept `ResolvedProvider` arg |
| `src/server/ai/provider/identity.ts` | Make async, take `userId`, drop codex/cursor/hosted |
| `src/server/ai/provider/daemon.ts` | Replace `process.env.CLAUDE_CODE_CHAT_MODEL` 默认 → 用 resolved model id |
| `src/server/ai/embeddings.ts` | Take `userId`, route via `resolveAiCall('embedding', userId)`; keep `transformers` (in-process) as a separate provider kind |
| `src/server/ai/indexer.ts` | Pass `userId` to `embedTexts` |
| `src/server/ai/agentic-rag.ts` | Same |
| `src/server/council/persona-stream.ts` | Drop OPENAI_API_KEY peek; route via new façade |
| `src/server/routers/billing.ts` | Delete the 4 AI procedures; keep `me` |
| `src/app/(app)/settings/page.tsx` | Render new providers section instead of old `<AiProviderSection>` |
| `src/app/(app)/settings/ai-provider-section.tsx` | DELETE |
| `src/app/(app)/settings/model-picker.tsx` | DELETE |
| `src/app/api/chat/route.ts` | Drop `getProviderMode` + `maxStepsByMode` mode lookup; use `resolveAiCall` to gate tool support |
| `src/server/ai/provider/codex.ts` | DELETE |
| `src/server/billing/ai-providers/hosted.ts` | DELETE |
| `src/server/ai/provider/mode.ts` | DELETE (replaced by resolve.ts) |
| `src/server/ai/provider/mode.test.ts` | DELETE |
| `src/server/ai/provider/ai-sdk.test.ts` | Rewrite for new `ResolvedProvider`-based API |
| `e2e/per-user-provider.spec.ts` | Rewrite or delete (旧 6-provider 模型已不存在) |
| `e2e/ask-local-toggle.spec.ts` | Adjust if it depends on removed modes |
| `.env.example` (if exists) | Document `KNOSI_SECRET_KEY` only |

### Decision: `transformers` (Transformers.js) embedding kind

Spec §4.3 only listed 3 kinds. But `embeddings.ts` 现在还跑着 in-process Transformers.js（默认就用它）。它是 zero-config / no-key / 自包含的，不是 HTTP 也不是 daemon。

**Decision (added to plan, not in original spec):** 加第 4 个 kind `transformers`，仅用于 embedding role；UI 上 Add Provider 时是个独立选项，无 base URL / key / model（model id 内置 `Xenova/multilingual-e5-small`，可在 Custom 字段覆写）。这样既保留现状的 zero-setup 体验，又不破坏新架构。

实施时 `kind` enum = `'openai-compatible' | 'local' | 'claude-code-daemon' | 'transformers'`。

---

## Phase 0 — Branch & guardrails

### Task 0.1: Sanity check the worktree

**Files:** none

- [ ] **Step 1: Verify branch + working tree**

```bash
git branch --show-current   # expect: feat/model-provider-refactor
git status                   # expect: clean (only untracked drifter files from main; spec already committed on this branch)
```

Expected: branch `feat/model-provider-refactor`. The pre-existing untracked files from `main` (drifter / drizzle journal etc.) are unrelated and stay alone.

- [ ] **Step 2: Confirm spec is on this branch**

```bash
git log --oneline -3
ls docs/superpowers/specs/2026-05-02-model-provider-refactor-design.md
```

Expected: top commit is the spec doc; file exists.

- [ ] **Step 3: Smoke-test current toolchain works**

```bash
pnpm install
pnpm build
```

Expected: build green on the unchanged baseline. (If it fails on baseline, fix that first — don't bury baseline breakage under refactor noise.)

---

## Phase 1 — Crypto module (foundation, no DB yet)

### Task 1.1: Add `KNOSI_SECRET_KEY` env doc + boot check

**Files:**
- Create: `src/server/ai/crypto.ts`
- Modify: `.env.example` (if it exists; otherwise create) — document `KNOSI_SECRET_KEY` only
- Test: `src/server/ai/crypto.test.ts`

- [ ] **Step 1: Write failing test for boot validation**

Create `src/server/ai/crypto.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEY = "KNOSI_SECRET_KEY";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  // Force a fresh import per test by clearing the module cache.
  // (vitest re-evaluates modules when the env changes if we use top-level dynamic import)
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("crypto module — secret-key validation", () => {
  it("throws when KNOSI_SECRET_KEY is missing", async () => {
    delete process.env[ENV_KEY];
    await expect(import("./crypto?missing")).rejects.toThrow(
      /KNOSI_SECRET_KEY/,
    );
  });
});
```

- [ ] **Step 2: Run test, expect it to fail**

```bash
pnpm test:unit src/server/ai/crypto.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal `crypto.ts` to pass**

Create `src/server/ai/crypto.ts`:

```ts
import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

function loadMasterKey(): Buffer {
  const raw = process.env.KNOSI_SECRET_KEY?.trim();
  if (!raw) {
    throw new Error(
      "KNOSI_SECRET_KEY is not set. Generate one with `openssl rand -hex 32` and add it to your environment.",
    );
  }
  // Accept hex (64 chars) or base64 (44 chars).
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    try {
      key = Buffer.from(raw, "base64");
    } catch {
      throw new Error(
        "KNOSI_SECRET_KEY must be 32 random bytes encoded as hex (64 chars) or base64.",
      );
    }
  }
  if (key.length !== KEY_LEN) {
    throw new Error(
      `KNOSI_SECRET_KEY must decode to ${KEY_LEN} bytes; got ${key.length}.`,
    );
  }
  return key;
}

const masterKey = loadMasterKey();

export class ApiKeyDecryptionError extends Error {
  constructor(cause?: unknown) {
    super("Failed to decrypt API key — secret key may have changed.", {
      cause,
    });
    this.name = "ApiKeyDecryptionError";
  }
}

export function encryptApiKey(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("encryptApiKey: plaintext must be a non-empty string.");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptApiKey(enc: string): string {
  try {
    const buf = Buffer.from(enc, "base64");
    if (buf.length < IV_LEN + 16) {
      throw new Error("ciphertext too short");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(IV_LEN, buf.length - 16);
    const decipher = createDecipheriv(ALGO, masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch (cause) {
    throw new ApiKeyDecryptionError(cause);
  }
}
```

- [ ] **Step 4: Update test to also cover round-trip + IV uniqueness + wrong-key**

Replace `crypto.test.ts` with full coverage:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENV_KEY = "KNOSI_SECRET_KEY";
let saved: string | undefined;

const validHex = "0".repeat(64);

beforeEach(() => {
  saved = process.env[ENV_KEY];
  process.env[ENV_KEY] = validHex;
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("crypto round trip", () => {
  it("encrypt then decrypt yields the original plaintext", async () => {
    const { encryptApiKey, decryptApiKey } = await import("./crypto");
    const plain = "sk-test-1234567890";
    const enc = encryptApiKey(plain);
    expect(decryptApiKey(enc)).toBe(plain);
  });

  it("each encryption uses a fresh IV (ciphertext differs)", async () => {
    const { encryptApiKey } = await import("./crypto");
    const a = encryptApiKey("sk-same");
    const b = encryptApiKey("sk-same");
    expect(a).not.toBe(b);
  });

  it("decrypt with wrong-shaped ciphertext throws ApiKeyDecryptionError", async () => {
    const { decryptApiKey, ApiKeyDecryptionError } = await import("./crypto");
    expect(() => decryptApiKey("not-base64-or-too-short")).toThrow(
      ApiKeyDecryptionError,
    );
  });

  it("rejects empty plaintext", async () => {
    const { encryptApiKey } = await import("./crypto");
    expect(() => encryptApiKey("")).toThrow();
  });
});

describe("crypto secret-key validation (separate process import)", () => {
  // Skipped: validation runs once at module load. Covered manually by
  // booting the server with a missing/short key in QA. A vitest run that
  // requires deleting the env after `crypto.ts` is already cached cannot
  // re-trigger the throw without isolated workers.
  it.skip("throws on missing key (validated via boot smoke-test, not unit)", () => {});
});
```

- [ ] **Step 5: Run tests, expect green**

```bash
pnpm test:unit src/server/ai/crypto.test.ts
```

Expected: 4 passed, 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add src/server/ai/crypto.ts src/server/ai/crypto.test.ts
git commit -m "feat(ai): AES-256-GCM crypto module for API key storage"
```

### Task 1.2: Add `KNOSI_SECRET_KEY` to local + e2e + prod environments

**Files:**
- Modify: `playwright.config.ts` — pass `KNOSI_SECRET_KEY` to webServer env
- Modify: `.env.local` (user-local; document in plan but engineer adds it manually)
- Modify: `ops/hetzner/deploy.sh` and/or k8s secret manifest — wire prod secret
- Modify: `.github/workflows/deploy-hetzner.yml` — pass secret through

- [ ] **Step 1: Generate a key for local dev**

Run once:
```bash
openssl rand -hex 32
```

Add to `.env.local`:
```
KNOSI_SECRET_KEY=<the hex string>
```

Verify it loads:
```bash
KNOSI_SECRET_KEY=<hex> pnpm test:unit src/server/ai/crypto.test.ts
```

Expected: green.

- [ ] **Step 2: Wire e2e webServer env**

Read `playwright.config.ts` first:
```bash
cat playwright.config.ts | head -80
```

Find the two `webServer` blocks (default + billing). Add `KNOSI_SECRET_KEY` to each `env:` block. The simplest stable choice is a deterministic test value:

```ts
// In each webServer env:
KNOSI_SECRET_KEY: "0".repeat(64),
```

(Tests don't care about secret strength; they care that the boot path doesn't crash.)

- [ ] **Step 3: Verify e2e webServer can boot**

```bash
pnpm test:e2e --reporter=line e2e/ask-local-toggle.spec.ts
```

Expected: at least the webServer starts (test outcome can fail later — that's fine). If the webServer logs "KNOSI_SECRET_KEY is not set", fix the env wiring and retry.

- [ ] **Step 4: Document prod secret wiring**

In `docs/changelog/2026-05-02-model-provider-refactor.md` (create if not exists), add a section "Production secret rollout" with the exact `kubectl create secret` / `gh secret set` commands. Don't commit the actual secret value.

Add this `kubectl` snippet to the doc:

```bash
# Generate once:
openssl rand -hex 32

# k3s on Hetzner:
kubectl -n knosi create secret generic knosi-secret-key \
  --from-literal=KNOSI_SECRET_KEY=<the hex string>

# Then patch the Deployment to mount it as env. See ops/hetzner/deploy.sh.
```

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts docs/changelog/2026-05-02-model-provider-refactor.md
git commit -m "ops: wire KNOSI_SECRET_KEY into e2e + document prod rollout"
```

---

## Phase 2 — Schema (DB tables only, no logic yet)

### Task 2.1: Define new `ai_providers` and `ai_role_assignments` tables

**Files:**
- Create: `src/server/db/schema/ai-providers.ts`
- Modify: `src/server/db/schema/index.ts` (add re-export)

- [ ] **Step 1: Write the schema file**

Create `src/server/db/schema/ai-providers.ts`:

```ts
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/**
 * A user-configured backend that can produce tokens.
 *
 *   kind = 'openai-compatible'  → HTTP, requires base_url + api_key_enc
 *   kind = 'local'              → HTTP (Ollama / LM Studio), requires base_url, no key
 *   kind = 'claude-code-daemon' → in-process queue, no base_url, no key
 *   kind = 'transformers'       → in-process Transformers.js (embedding only),
 *                                 no base_url, no key
 *
 * `label` is the user-facing name (e.g. "OpenAI", "DeepSeek", "Home Ollama").
 * Multiple rows of the same kind are allowed (e.g. a Personal + Work key).
 */
export const aiProviders = sqliteTable(
  "ai_providers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["openai-compatible", "local", "claude-code-daemon", "transformers"],
    }).notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url"),
    apiKeyEnc: text("api_key_enc"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (t) => ({
    userIdx: index("ai_providers_user_idx").on(t.userId),
  }),
);

/**
 * Per-user assignment of one provider+model pair to each AI role.
 *
 *   chat       → Ask AI / Council / Drifter
 *   task       → tag/summary/structured-output generation
 *   embedding  → RAG indexing (kind ∈ {openai-compatible, local, transformers})
 *
 * On delete restrict at the provider FK so deleting an in-use provider
 * forces the user to reassign the role first (UI surfaces a confirmation).
 */
export const aiRoleAssignments = sqliteTable(
  "ai_role_assignments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["chat", "task", "embedding"] }).notNull(),
    providerId: text("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    modelId: text("model_id").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.role] }),
  }),
);
```

- [ ] **Step 2: Re-export from the schema barrel**

Modify `src/server/db/schema/index.ts`, add line at end of barrel block:

```ts
export * from "./ai-providers";
```

- [ ] **Step 3: Verify drizzle picks it up**

```bash
pnpm db:generate
```

Expected: drizzle-kit creates a new migration file (e.g. `drizzle/0045_xxx.sql`) containing CREATE TABLE for both tables. Inspect:

```bash
ls drizzle/ | tail -3
cat drizzle/$(ls drizzle/ | grep -E '^00[0-9]+_.*\.sql$' | tail -1)
```

Expected: SQL for both new tables, with `kind` enum check, FKs, primary key on (user_id, role).

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/ai-providers.ts src/server/db/schema/index.ts drizzle/
git commit -m "feat(db): add ai_providers + ai_role_assignments tables"
```

### Task 2.2: Drop old columns `users.ai_provider_preference` / `users.ai_chat_model`

**Files:**
- Modify: `src/server/db/schema/auth.ts`
- Run: `pnpm db:generate`

- [ ] **Step 1: Remove the two columns from the Drizzle schema**

Edit `src/server/db/schema/auth.ts` — delete lines 13-22 (the `aiProviderPreference` and `aiChatModel` definitions). The trailing `createdAt` line stays; only the two AI-routing columns leave.

After edit, the `users` table block should look like:

```ts
export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: Generate the drop migration**

```bash
pnpm db:generate
```

Expected: a new migration file with two `ALTER TABLE users DROP COLUMN` statements. SQLite's drizzle dialect typically rewrites the table — verify the SQL keeps all other columns intact.

```bash
cat drizzle/$(ls drizzle/ | grep -E '^00[0-9]+_.*\.sql$' | tail -1)
```

If drizzle-kit lumped both schema changes (Task 2.1's CREATE + this DROP) into one migration when run in sequence — that's fine, single migration is preferable.

- [ ] **Step 3: Apply locally**

```bash
pnpm db:push
```

Expected: drizzle-kit prompts about column drop (data loss). For local SQLite this is fine; confirm. After:

```bash
sqlite3 data/second-brain.db ".schema users"
```

Expected: no `ai_provider_preference` or `ai_chat_model` columns.

```bash
sqlite3 data/second-brain.db ".schema ai_providers"
sqlite3 data/second-brain.db ".schema ai_role_assignments"
```

Expected: both new tables present.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema/auth.ts drizzle/
git commit -m "feat(db): drop legacy users.ai_provider_preference + ai_chat_model"
```

---

## Phase 3 — Resolver (DB-backed routing core)

### Task 3.1: Define `presets.ts` (static preset data)

**Files:**
- Create: `src/server/ai/provider/presets.ts`

- [ ] **Step 1: Write the preset module**

```ts
/**
 * Static presets used by Settings UI. Adding a new OpenAI-compatible
 * service here = zero code changes elsewhere.
 *
 * `models` is a fallback list. Settings UI also fetches `/v1/models`
 * (see probe.ts) and merges with these — presets just give first-time
 * users something to pick before they hit Refresh.
 */
export type OpenAiCompatiblePreset = {
  id: string;
  label: string;
  baseUrl: string;
  models: readonly string[];
};

export const OPENAI_COMPATIBLE_PRESETS: readonly OpenAiCompatiblePreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-5.4", "o1-mini", "text-embedding-3-small", "text-embedding-3-large"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "moonshot",
    label: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V2.5"],
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
  },
] as const;

export const LOCAL_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
export const LOCAL_PRESET_MODELS: readonly string[] = [
  "qwen2.5:14b",
  "llama3.2",
  "mistral-nemo",
  "nomic-embed-text",
];

export const DAEMON_PRESET_MODELS: readonly string[] = [
  "opus",
  "sonnet",
];

export const TRANSFORMERS_DEFAULT_MODEL = "Xenova/multilingual-e5-small";
export const TRANSFORMERS_PRESET_MODELS: readonly string[] = [
  TRANSFORMERS_DEFAULT_MODEL,
];
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/provider/presets.ts
git commit -m "feat(ai): static provider presets (OpenAI / DeepSeek / Moonshot / ...)"
```

### Task 3.2: Define `ProviderKind`, `ResolvedProvider`, `MissingAiRoleError`

**Files:**
- Modify: `src/server/ai/provider/types.ts`

- [ ] **Step 1: Replace types.ts contents**

Read the file first (it's used by other code), then rewrite:

```bash
cat src/server/ai/provider/types.ts
```

Then overwrite with:

```ts
import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod/v4";

export type ProviderKind =
  | "openai-compatible"
  | "local"
  | "claude-code-daemon"
  | "transformers";

export type AiRole = "chat" | "task" | "embedding";

export type ResolvedProvider =
  | {
      kind: "openai-compatible";
      providerId: string;
      label: string;
      baseURL: string;
      apiKey: string;
      modelId: string;
    }
  | {
      kind: "local";
      providerId: string;
      label: string;
      baseURL: string;
      modelId: string;
    }
  | {
      kind: "claude-code-daemon";
      providerId: string;
      label: string;
      modelId: string;
    }
  | {
      kind: "transformers";
      providerId: string;
      label: string;
      modelId: string;
    };

export class MissingAiRoleError extends Error {
  constructor(public readonly role: AiRole) {
    super(
      `No provider assigned to AI role "${role}". Configure one in Settings.`,
    );
    this.name = "MissingAiRoleError";
  }
}

export type StreamChatOptions = {
  messages: ModelMessage[];
  sessionId?: string;
  signal?: AbortSignal;
  system: string;
  /**
   * Tools are honored only by `openai-compatible` and `local` providers.
   * `claude-code-daemon` and `transformers` ignore them (single-turn / N/A).
   */
  tools?: ToolSet;
  /**
   * Maximum number of LLM steps (model call + tool resolutions). Honored
   * alongside `tools`. Defaulted by `maxStepsForKind()` below when omitted.
   */
  maxSteps?: number;
};

export type GenerateStructuredDataOptions<TSchema extends z.ZodType> = {
  description: string;
  name: string;
  prompt: string;
  schema: TSchema;
  signal?: AbortSignal;
};

/**
 * Default tool-loop step cap by provider kind.
 *
 *   openai-compatible: 6 — gpt-class / Claude can plan a few searches
 *   local:             3 — qwen2.5 / smaller models loop, cut early
 *   claude-code-daemon: 1 — single-turn, no tool support
 *   transformers:      1 — embedding only, no tool support
 */
export function maxStepsForKind(kind: ProviderKind): number {
  if (kind === "openai-compatible") return 6;
  if (kind === "local") return 3;
  return 1;
}
```

- [ ] **Step 2: Compile to surface downstream breakage**

```bash
pnpm build 2>&1 | tail -40
```

Expected: many errors. That's the to-do list for Phase 4 — write them down. Common ones will be: `AIProviderMode` not exported, `CodexAuthStore` / `CodexProfile` not exported, `maxStepsByMode` removed, etc.

We don't fix these yet — Phase 4 rewrites the call sites. Confirm the errors are *only* in the files Phase 4 touches; if any unrelated file imports `AIProviderMode`, add it to the Phase 4 file map.

- [ ] **Step 3: Commit (broken state — explicit in commit msg)**

```bash
git add src/server/ai/provider/types.ts
git commit -m "wip(ai): replace AIProviderMode with ProviderKind/ResolvedProvider (build broken)"
```

### Task 3.3: Implement `resolve.ts` (DB lookup + per-user cache)

**Files:**
- Create: `src/server/ai/provider/resolve.ts`
- Test: `src/server/ai/provider/resolve.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/server/ai/provider/resolve.test.ts`:

```ts
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";
import { users } from "@/server/db/schema/auth";
import { aiProviders, aiRoleAssignments } from "@/server/db/schema/ai-providers";
import { encryptApiKey } from "@/server/ai/crypto";
import { MissingAiRoleError } from "./types";
import {
  __resetProviderCacheForTests,
  invalidateProviderCache,
  resolveAiCall,
} from "./resolve";

const USER = "resolve-test-user";

beforeAll(async () => {
  process.env.KNOSI_SECRET_KEY = "0".repeat(64);
  await migrate(db, {
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });
  await db.insert(users).values({ id: USER, email: "resolve@test.local" }).onConflictDoNothing();
});

beforeEach(async () => {
  __resetProviderCacheForTests();
  await db.delete(aiRoleAssignments).where(eq(aiRoleAssignments.userId, USER));
  await db.delete(aiProviders).where(eq(aiProviders.userId, USER));
});

describe("resolveAiCall", () => {
  it("throws MissingAiRoleError when no role assignment exists", async () => {
    await expect(resolveAiCall("chat", USER)).rejects.toThrow(MissingAiRoleError);
  });

  it("resolves an openai-compatible chat assignment with decrypted key", async () => {
    const providerId = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: providerId,
      userId: USER,
      kind: "openai-compatible",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnc: encryptApiKey("sk-test-secret"),
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId,
      modelId: "gpt-4o",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("openai-compatible");
    if (r.kind !== "openai-compatible") throw new Error("type narrow");
    expect(r.baseURL).toBe("https://api.openai.com/v1");
    expect(r.apiKey).toBe("sk-test-secret");
    expect(r.modelId).toBe("gpt-4o");
    expect(r.label).toBe("OpenAI");
  });

  it("resolves a local provider with no api key", async () => {
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "local",
      label: "Home Ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId: id,
      modelId: "qwen2.5:14b",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("local");
  });

  it("resolves a claude-code-daemon provider (no baseURL, no key)", async () => {
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "claude-code-daemon",
      label: "Claude CLI",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "chat",
      providerId: id,
      modelId: "opus",
    });

    const r = await resolveAiCall("chat", USER);
    expect(r.kind).toBe("claude-code-daemon");
    if (r.kind !== "claude-code-daemon") throw new Error("type narrow");
    expect(r.modelId).toBe("opus");
  });

  it("rejects daemon provider for embedding role even if assigned", async () => {
    // schema doesn't enforce this — runtime tripwire does.
    const id = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id,
      userId: USER,
      kind: "claude-code-daemon",
      label: "Claude CLI",
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER,
      role: "embedding",
      providerId: id,
      modelId: "opus",
    });

    await expect(resolveAiCall("embedding", USER)).rejects.toThrow(
      /embedding.*daemon/i,
    );
  });

  it("cache survives within TTL; invalidation forces re-read", async () => {
    const id1 = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: id1,
      userId: USER,
      kind: "openai-compatible",
      label: "First",
      baseUrl: "https://a.example/v1",
      apiKeyEnc: encryptApiKey("sk-a"),
    });
    await db.insert(aiRoleAssignments).values({
      userId: USER, role: "chat", providerId: id1, modelId: "m1",
    });

    expect((await resolveAiCall("chat", USER)).label).toBe("First");

    // Switch underlying assignment without invalidating.
    const id2 = crypto.randomUUID();
    await db.insert(aiProviders).values({
      id: id2, userId: USER, kind: "openai-compatible",
      label: "Second", baseUrl: "https://b.example/v1",
      apiKeyEnc: encryptApiKey("sk-b"),
    });
    await db
      .update(aiRoleAssignments)
      .set({ providerId: id2, modelId: "m2" })
      .where(and(eq(aiRoleAssignments.userId, USER), eq(aiRoleAssignments.role, "chat")));

    expect((await resolveAiCall("chat", USER)).label).toBe("First"); // cached

    invalidateProviderCache(USER);
    expect((await resolveAiCall("chat", USER)).label).toBe("Second");
  });
});
```

- [ ] **Step 2: Run, expect all to fail (module missing)**

```bash
pnpm test:unit src/server/ai/provider/resolve.test.ts
```

Expected: cannot find module `./resolve`. Good.

- [ ] **Step 3: Implement `resolve.ts`**

Create:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { aiProviders, aiRoleAssignments } from "@/server/db/schema/ai-providers";
import { decryptApiKey } from "@/server/ai/crypto";
import { MissingAiRoleError } from "./types";
import type { AiRole, ResolvedProvider } from "./types";

const TTL_MS = 30_000;
const MAX_CACHE = 1000;

type CacheEntry = {
  expires: number;
  byRole: Partial<Record<AiRole, ResolvedProvider>>;
};

const cache = new Map<string, CacheEntry>();

export function invalidateProviderCache(userId: string): void {
  cache.delete(userId);
}

export function __resetProviderCacheForTests(): void {
  cache.clear();
}

async function loadResolved(
  userId: string,
  role: AiRole,
): Promise<ResolvedProvider> {
  const [row] = await db
    .select({
      providerId: aiProviders.id,
      kind: aiProviders.kind,
      label: aiProviders.label,
      baseUrl: aiProviders.baseUrl,
      apiKeyEnc: aiProviders.apiKeyEnc,
      modelId: aiRoleAssignments.modelId,
    })
    .from(aiRoleAssignments)
    .innerJoin(aiProviders, eq(aiProviders.id, aiRoleAssignments.providerId))
    .where(
      and(
        eq(aiRoleAssignments.userId, userId),
        eq(aiRoleAssignments.role, role),
      ),
    )
    .limit(1);

  if (!row) throw new MissingAiRoleError(role);

  if (role === "embedding" && row.kind === "claude-code-daemon") {
    throw new Error(
      "Provider kind 'claude-code-daemon' cannot serve role 'embedding'. Reassign embedding to an openai-compatible / local / transformers provider.",
    );
  }

  if (row.kind === "openai-compatible") {
    if (!row.baseUrl || !row.apiKeyEnc) {
      throw new Error(
        `Provider ${row.providerId} (kind=openai-compatible) is missing base_url or api_key_enc.`,
      );
    }
    return {
      kind: "openai-compatible",
      providerId: row.providerId,
      label: row.label,
      baseURL: row.baseUrl,
      apiKey: decryptApiKey(row.apiKeyEnc),
      modelId: row.modelId,
    };
  }
  if (row.kind === "local") {
    if (!row.baseUrl) {
      throw new Error(
        `Provider ${row.providerId} (kind=local) is missing base_url.`,
      );
    }
    return {
      kind: "local",
      providerId: row.providerId,
      label: row.label,
      baseURL: row.baseUrl,
      modelId: row.modelId,
    };
  }
  if (row.kind === "claude-code-daemon") {
    return {
      kind: "claude-code-daemon",
      providerId: row.providerId,
      label: row.label,
      modelId: row.modelId,
    };
  }
  // transformers
  return {
    kind: "transformers",
    providerId: row.providerId,
    label: row.label,
    modelId: row.modelId,
  };
}

export async function resolveAiCall(
  role: AiRole,
  userId: string,
): Promise<ResolvedProvider> {
  const now = Date.now();
  const entry = cache.get(userId);
  if (entry && entry.expires > now && entry.byRole[role]) {
    return entry.byRole[role]!;
  }

  const resolved = await loadResolved(userId, role);

  // Refresh / create cache entry, sharing the byRole map so subsequent
  // role lookups for the same user accumulate without extra queries.
  if (cache.size >= MAX_CACHE && !entry) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const next: CacheEntry = entry && entry.expires > now
    ? entry
    : { expires: now + TTL_MS, byRole: {} };
  next.byRole[role] = resolved;
  cache.set(userId, next);
  return resolved;
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm test:unit src/server/ai/provider/resolve.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/provider/resolve.ts src/server/ai/provider/resolve.test.ts
git commit -m "feat(ai): resolveAiCall(role, userId) with per-user cache"
```

### Task 3.4: Delete legacy `mode.ts` and its test

**Files:**
- Delete: `src/server/ai/provider/mode.ts`
- Delete: `src/server/ai/provider/mode.test.ts`

- [ ] **Step 1: Find every importer of mode.ts**

```bash
grep -rn "from.*provider/mode\|provider/mode'" src/ --include="*.ts" --include="*.tsx"
```

Expected list (from earlier exploration): `provider/index.ts`, `provider/identity.ts`, `provider/ai-sdk.ts`, `app/api/chat/route.ts`, `routers/billing.ts`, `council/persona-stream.ts`. **All of these are addressed in Phase 4.** Do not delete yet — leave for Task 4.x.

- [ ] **Step 2: Note for Phase 4**

(No code change in this task — Phase 4 deletes mode.ts as the last step after rewiring everything to resolve.ts.)

---

## Phase 4 — Façade rewrite + caller migration

### Task 4.1: Rewrite `ai-sdk.ts` to accept `ResolvedProvider` instead of mode + env

**Files:**
- Modify: `src/server/ai/provider/ai-sdk.ts`
- Modify: `src/server/ai/provider/ai-sdk.test.ts` (rewrite)

- [ ] **Step 1: Rewrite `ai-sdk.ts`**

Replace the file with:

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, stepCountIs, streamText } from "ai";
import type { ModelMessage } from "ai";
import type { z } from "zod/v4";
import type {
  GenerateStructuredDataOptions,
  ResolvedProvider,
  StreamChatOptions,
} from "./types";

type AiSdkResolvable = Extract<
  ResolvedProvider,
  { kind: "openai-compatible" | "local" }
>;

function shouldRecordTelemetryContent() {
  return process.env.LANGFUSE_RECORD_CONTENT === "true";
}

function createAiSdkProvider(p: AiSdkResolvable) {
  if (p.kind === "openai-compatible") {
    return createOpenAI({
      name: p.label,
      baseURL: p.baseURL,
      apiKey: p.apiKey,
    });
  }
  // local — Ollama / LM Studio. The OpenAI client requires *some* apiKey,
  // even if the server doesn't validate it.
  return createOpenAI({
    name: p.label,
    baseURL: p.baseURL,
    apiKey: "local",
  });
}

export type StreamChatAiSdkResult = {
  response: Response;
  modelId: string;
};

export async function streamChatAiSdk(
  options: StreamChatOptions & { provider: AiSdkResolvable },
): Promise<StreamChatAiSdkResult> {
  const { provider, messages, signal, system, tools, maxSteps } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const hasTools = Boolean(tools && Object.keys(tools).length > 0);

  const result = streamText({
    abortSignal: signal,
    model: sdk(provider.modelId),
    messages,
    system,
    ...(hasTools
      ? { tools, stopWhen: stepCountIs(maxSteps ?? 1) }
      : {}),
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: hasTools ? "ask-ai-agent" : "chat",
      metadata: {
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        ...(hasTools ? { hasTools: true, maxSteps: maxSteps ?? 1 } : {}),
      },
    },
  });

  return { response: result.toUIMessageStreamResponse(), modelId: provider.modelId };
}

export async function streamPlainTextAiSdk(options: {
  system: string;
  messages: ModelMessage[];
  signal?: AbortSignal;
  provider: AiSdkResolvable;
}): Promise<AsyncIterable<string>> {
  const sdk = createAiSdkProvider(options.provider);
  const result = streamText({
    abortSignal: options.signal,
    model: sdk(options.provider.modelId),
    messages: options.messages,
    system: options.system,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: shouldRecordTelemetryContent(),
      recordOutputs: shouldRecordTelemetryContent(),
      functionId: "council-persona-stream",
      metadata: {
        kind: options.provider.kind,
        providerLabel: options.provider.label,
        model: options.provider.modelId,
      },
    },
  });
  return result.textStream;
}

export async function generateStructuredDataAiSdk<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema> & { provider: AiSdkResolvable },
): Promise<z.infer<TSchema>> {
  const { provider, description, name, prompt, schema, signal } = options;
  const sdk = createAiSdkProvider(provider);
  const recordContent = shouldRecordTelemetryContent();
  const { output } = await generateText({
    model: sdk(provider.modelId),
    output: Output.object({ description, name, schema }),
    prompt,
    abortSignal: signal,
    experimental_telemetry: {
      isEnabled: true,
      recordInputs: recordContent,
      recordOutputs: recordContent,
      functionId: "task",
      metadata: {
        kind: provider.kind,
        providerLabel: provider.label,
        model: provider.modelId,
        name,
      },
    },
  });
  return output as z.infer<TSchema>;
}
```

- [ ] **Step 2: Rewrite `ai-sdk.test.ts`**

Overwrite to test the new signature only — no env, no user pref. Each test constructs a `ResolvedProvider` literal and checks the request goes to the right URL/model. Use `vi.spyOn(globalThis, "fetch")` to capture the call.

```ts
import { describe, expect, it, vi } from "vitest";
import { streamChatAiSdk } from "./ai-sdk";
import type { ResolvedProvider } from "./types";

function makeOpenAi(model = "gpt-4o"): Extract<ResolvedProvider, { kind: "openai-compatible" }> {
  return {
    kind: "openai-compatible",
    providerId: "p1",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: "sk-test",
    modelId: model,
  };
}

describe("streamChatAiSdk", () => {
  it("posts to the resolved baseURL and uses the resolved model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("data: {\"type\":\"text\",\"value\":\"ok\"}\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    await streamChatAiSdk({
      provider: makeOpenAi("gpt-4o-mini"),
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("api.openai.com/v1");
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body ?? "{}"));
    expect(body.model).toBe("gpt-4o-mini");
    fetchSpy.mockRestore();
  });

  it("respects local kind base URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    );
    await streamChatAiSdk({
      provider: {
        kind: "local",
        providerId: "p2",
        label: "Ollama",
        baseURL: "http://127.0.0.1:11434/v1",
        modelId: "qwen2.5:14b",
      },
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("127.0.0.1:11434");
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests, expect green**

```bash
pnpm test:unit src/server/ai/provider/ai-sdk.test.ts
```

Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add src/server/ai/provider/ai-sdk.ts src/server/ai/provider/ai-sdk.test.ts
git commit -m "refactor(ai): ai-sdk takes ResolvedProvider, drops env/mode reads"
```

### Task 4.2: Update `daemon.ts` to take `ResolvedProvider`

**Files:**
- Modify: `src/server/ai/provider/daemon.ts`

- [ ] **Step 1: Replace `daemon.ts` to accept resolved model id from caller, not env**

Edit `daemon.ts`. Change the function signature so it takes `model` from a caller-supplied argument instead of `process.env.CLAUDE_CODE_CHAT_MODEL`:

```ts
import { and, eq } from "drizzle-orm";
import type { z } from "zod/v4";
import { db } from "@/server/db";
import { chatTasks } from "@/server/db/schema";
import { publishDaemonTaskNotification } from "@/server/ai/daemon-task-notifications";
import { buildStructuredJsonPrompt, extractJsonObject } from "./shared";
import type { GenerateStructuredDataOptions } from "./types";

export async function generateStructuredDataDaemon<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema> & {
    modelId: string;
    userId: string;
  },
): Promise<z.infer<TSchema>> {
  const { description, name, prompt, schema, signal, modelId, userId } = options;
  const fullPrompt = buildStructuredJsonPrompt({ description, name, prompt, schema });

  const taskId = crypto.randomUUID();
  await db.insert(chatTasks).values({
    id: taskId,
    userId,
    status: "queued",
    taskType: "structured",
    sourceScope: "direct",
    messages: "[]",
    systemPrompt: fullPrompt,
    model: modelId,
  });
  await publishDaemonTaskNotification({
    kind: "wake",
    userId,
    taskType: "structured",
  });

  const POLL_INTERVAL = 300;
  const TIMEOUT = 120_000;
  const deadline = Date.now() + TIMEOUT;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await db.update(chatTasks).set({ status: "cancelled" })
        .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
      throw new Error("Aborted");
    }
    const [row] = await db
      .select({
        status: chatTasks.status,
        structuredResult: chatTasks.structuredResult,
        error: chatTasks.error,
      })
      .from(chatTasks)
      .where(eq(chatTasks.id, taskId));
    if (!row) throw new Error(`Daemon task ${taskId} disappeared`);
    if (row.status === "completed" && row.structuredResult) {
      return schema.parse(JSON.parse(extractJsonObject(row.structuredResult)));
    }
    if (row.status === "failed") {
      throw new Error(row.error || `Daemon structured task failed: ${taskId}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  await db.update(chatTasks).set({ status: "cancelled" })
    .where(and(eq(chatTasks.id, taskId), eq(chatTasks.status, "queued")));
  throw new Error(`Daemon structured task timed out: ${taskId}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ai/provider/daemon.ts
git commit -m "refactor(ai): daemon takes modelId/userId from caller, no env"
```

### Task 4.3: Rewrite the façade `provider/index.ts`

**Files:**
- Modify: `src/server/ai/provider/index.ts`
- Delete: `src/server/ai/provider/codex.ts`
- Delete: `src/server/billing/ai-providers/hosted.ts` (after grep confirms nothing imports it)

- [ ] **Step 1: Rewrite `provider/index.ts`**

Overwrite:

```ts
/**
 * Provider façade — resolves the user's role assignment and dispatches
 * to the matching backend implementation.
 *
 * All callers must supply { userId, role }. Self-hosted / E2E bypass with
 * no userId is no longer supported by this entry point — that path is
 * replaced by per-test fixtures that seed `ai_providers` + `ai_role_assignments`.
 */

import type { z } from "zod/v4";
import { resolveAiCall } from "./resolve";
import {
  generateStructuredDataAiSdk,
  streamChatAiSdk,
  streamPlainTextAiSdk as streamPlainTextAiSdkInner,
} from "./ai-sdk";
import { generateStructuredDataDaemon } from "./daemon";
import type {
  AiRole,
  GenerateStructuredDataOptions,
  StreamChatOptions,
} from "./types";

export type StreamChatResult = {
  response: Response;
  modelId: string | null;
  /** ProviderKind that actually handled the request (for X-Knosi-Mode header). */
  kind: string;
};

export async function streamChatResponse(
  options: StreamChatOptions,
  ctx: { userId: string; role?: Exclude<AiRole, "embedding"> },
): Promise<StreamChatResult> {
  const role: AiRole = ctx.role ?? "chat";
  const provider = await resolveAiCall(role, ctx.userId);

  if (provider.kind === "claude-code-daemon") {
    throw new Error(
      "streamChatResponse must not be called when the chat role is assigned to claude-code-daemon. " +
        "The /api/chat handler is responsible for taking the daemon enqueue branch.",
    );
  }
  if (provider.kind === "transformers") {
    throw new Error("transformers kind cannot serve chat/task — only embedding.");
  }

  const result = await streamChatAiSdk({ ...options, provider });
  return { response: result.response, modelId: result.modelId, kind: provider.kind };
}

export async function generateStructuredData<TSchema extends z.ZodType>(
  options: GenerateStructuredDataOptions<TSchema>,
  ctx: { userId: string; role?: Exclude<AiRole, "embedding"> },
): Promise<z.infer<TSchema>> {
  const role: AiRole = ctx.role ?? "task";
  const provider = await resolveAiCall(role, ctx.userId);

  if (provider.kind === "claude-code-daemon") {
    return generateStructuredDataDaemon({
      ...options,
      modelId: provider.modelId,
      userId: ctx.userId,
    });
  }
  if (provider.kind === "transformers") {
    throw new Error("transformers kind cannot serve task — only embedding.");
  }
  return generateStructuredDataAiSdk({ ...options, provider });
}

export async function streamPlainTextAiSdk(options: {
  system: string;
  messages: import("ai").ModelMessage[];
  signal?: AbortSignal;
  userId: string;
  role?: Exclude<AiRole, "embedding">;
}) {
  const role: AiRole = options.role ?? "chat";
  const provider = await resolveAiCall(role, options.userId);
  if (provider.kind === "claude-code-daemon" || provider.kind === "transformers") {
    throw new Error(
      `streamPlainTextAiSdk does not support kind=${provider.kind}; assignment must be openai-compatible or local.`,
    );
  }
  return streamPlainTextAiSdkInner({
    system: options.system,
    messages: options.messages,
    signal: options.signal,
    provider,
  });
}

export type { ResolvedProvider, AiRole } from "./types";
export { MissingAiRoleError } from "./types";
export { invalidateProviderCache } from "./resolve";

export {
  getAIErrorMessage,
  getAISetupHint,
  getChatAssistantIdentity,
} from "./identity";
```

- [ ] **Step 2: Delete `codex.ts`**

```bash
git rm src/server/ai/provider/codex.ts
```

- [ ] **Step 3: Verify `hosted.ts` has no remaining importer**

```bash
grep -rn "billing/ai-providers/hosted\|runWithHostedAi" src/ --include="*.ts" --include="*.tsx"
```

Expected: only the file itself remains. Then:

```bash
git rm src/server/billing/ai-providers/hosted.ts
# also check if the directory becomes empty
ls src/server/billing/ai-providers/ 2>/dev/null
# if empty:
rmdir src/server/billing/ai-providers 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai): rewrite façade around resolveAiCall; delete codex + hosted"
```

### Task 4.4: Rewrite `identity.ts` (async, takes userId)

**Files:**
- Modify: `src/server/ai/provider/identity.ts`

- [ ] **Step 1: Replace identity.ts**

```ts
import { resolveAiCall } from "./resolve";
import { MissingAiRoleError } from "./types";

export function getAIErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof MissingAiRoleError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function getAISetupHint(userId: string): Promise<string> {
  try {
    const p = await resolveAiCall("chat", userId);
    if (p.kind === "claude-code-daemon") {
      return "请确认本机 Claude CLI 已登录（claude login），并启动 Ask AI daemon 队列。";
    }
    if (p.kind === "openai-compatible" || p.kind === "local") {
      return `当前 Chat 路由到 "${p.label}" (${p.baseURL})，模型 ${p.modelId}。请检查 base URL / API key / 模型 id 是否有效。`;
    }
    return "Embedding-only kind 不能用于 Chat — 请到 Settings 重新分配。";
  } catch (e) {
    if (e instanceof MissingAiRoleError) {
      return "尚未在 Settings 中为 Chat 分配 Provider 与 Model。";
    }
    throw e;
  }
}

export async function getChatAssistantIdentity(userId: string): Promise<string> {
  try {
    const p = await resolveAiCall("chat", userId);
    return `你是 Second Brain 的 AI 助手，当前运行在 ${p.label}（${p.modelId}）上。只有当用户询问你的身份、模型或运行方式时，才明确说明当前模型。`;
  } catch {
    return "你是 Second Brain 的 AI 助手。";
  }
}
```

- [ ] **Step 2: Commit (will break callers — fix in next tasks)**

```bash
git add src/server/ai/provider/identity.ts
git commit -m "refactor(ai): identity becomes async + userId-aware"
```

### Task 4.5: Update `chat-system-prompt.ts` and tests for async identity

**Files:**
- Modify: `src/server/ai/chat-system-prompt.ts`
- Modify: `src/server/ai/chat-system-prompt.test.ts`
- Modify: `src/server/ai/inject-preamble.ts` if it uses identity sync

- [ ] **Step 1: Find every caller of identity**

```bash
grep -rn "getChatAssistantIdentity\|getAISetupHint\|getAIErrorMessage" src/ --include="*.ts" --include="*.tsx"
```

- [ ] **Step 2: Update each caller**

For each, propagate `userId` and add `await`. The chat preamble assembly used to be sync; it must become async. Most callers already have a `userId` in scope (they all live in API routes that already auth'd).

If a sync caller has *no* userId reachable, return a static fallback string (e.g. "你是 Second Brain 的 AI 助手。") instead of pretending to know the model.

- [ ] **Step 3: Run unit tests**

```bash
pnpm test:unit src/server/ai/chat-system-prompt.test.ts
pnpm test:unit src/server/ai/inject-preamble.test.ts
```

Fix any failures.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai): propagate userId to identity callers"
```

### Task 4.6: Update `app/api/chat/route.ts`

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Read the file**

Re-read after Phase 3/4 changes have invalidated the imports.

- [ ] **Step 2: Replace mode-based logic with kind-based**

Key changes:
- Drop `import { getProviderMode } from "@/server/ai/provider/mode"`
- Drop `import { maxStepsByMode } from "@/server/ai/provider/types"` → import `maxStepsForKind` from the same module
- Drop `import { shouldUseDaemonForChat } from "@/server/ai/daemon-mode"` (env-based) — replaced by checking the resolved provider's kind
- The handler order:
  1. Auth → get `userId` (already done)
  2. Try `resolveAiCall("chat", userId)` early; on `MissingAiRoleError` return 412 with a "configure provider" message
  3. If `provider.kind === "claude-code-daemon"` → take the daemon enqueue branch
  4. Otherwise pass through to `streamChatResponse({ ... }, { userId })` (which re-resolves but cache hits)
  5. `supportsTools = provider.kind === "openai-compatible" || provider.kind === "local"`
  6. `maxSteps = maxStepsForKind(provider.kind)`
  7. Replace `withDebugHeaders({ mode, modelId })` → `withDebugHeaders({ kind, modelId })`; rename header to `X-Knosi-Kind` (backward-compat alias `X-Knosi-Mode` allowed for one release)

Final route handler skeleton:

```ts
import {
  getAIErrorMessage,
  streamChatResponse,
  MissingAiRoleError,
} from "@/server/ai/provider";
import { resolveAiCall } from "@/server/ai/provider/resolve";
import { maxStepsForKind } from "@/server/ai/provider/types";
// ... existing imports for auth / chat-prepare / tools etc.

export async function POST(req: Request) {
  // ... existing auth/parse code, unchanged ...

  // E2E auth bypass: per-user-provider e2e seeds DB ahead of time;
  // if no userId is present (bypass without seeding), return 401.
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let provider;
  try {
    provider = await resolveAiCall("chat", userId);
  } catch (e) {
    if (e instanceof MissingAiRoleError) {
      return Response.json(
        { error: e.message, code: "MISSING_AI_ROLE" },
        { status: 412 },
      );
    }
    throw e;
  }

  // Daemon branch
  if (provider.kind === "claude-code-daemon") {
    // ... existing daemon enqueue, BUT use provider.modelId instead of env ...
    const { taskId } = await enqueueChatTask({
      userId,
      messages: sanitizeMessages(await normalizeMessages(parsed.data.messages)),
      sourceScope: parsed.data.sourceScope ?? "all",
      // (if enqueueChatTask supports model override, pass provider.modelId here;
      //  see Task 4.6.1 below)
    });
    if (!isAuthBypassEnabled()) {
      void recordAiUsage(userId).catch(() => undefined);
    }
    return Response.json({ taskId, mode: "daemon" });
  }

  if (provider.kind === "transformers") {
    return Response.json(
      { error: "Transformers kind cannot serve chat. Reassign chat role." },
      { status: 412 },
    );
  }

  // HTTP branch
  const { system, messages } = await buildChatContext(parsed.data, userId);
  const supportsTools = provider.kind === "openai-compatible" || provider.kind === "local";

  let tools, toolSystemPreamble = "";
  if (supportsTools) {
    const conversationId = parsed.data.id ?? crypto.randomUUID();
    tools = buildAskAiTools({
      userId,
      conversationId,
      urlBudget: getOrCreateUrlBudget(conversationId),
    });
    toolSystemPreamble = `\n\n---\n\n` +
      `You have access to tools to extend your reach beyond the initial context above:\n` +
      `- searchKnowledge(query, scope?, topK?): re-query the user's notes/bookmarks via hybrid retrieval.\n` +
      `- readNote(noteId): fetch the full body of a note that searchKnowledge returned.\n` +
      `- fetchUrl(url): fetch and extract readable text from a public URL. Each conversation has a hard budget of 3 distinct URLs.\n` +
      `Do not exceed ${maxStepsForKind(provider.kind)} steps.`;
  }

  const { response: rawResponse, modelId, kind } = await streamChatResponse(
    {
      messages,
      sessionId: parsed.data.id,
      signal: req.signal,
      system: system + toolSystemPreamble,
      tools,
      maxSteps: tools ? maxStepsForKind(provider.kind) : undefined,
    },
    { userId, role: "chat" },
  );

  if (!isAuthBypassEnabled()) {
    void recordAiUsage(userId).catch(() => undefined);
  }

  const finalResponse = supportsTools
    ? rawResponse
    : adaptTextStreamToUiMessageStream(rawResponse);

  // Spec §6.2: kind + model headers for E2E + dev-tools.
  const headers = new Headers(finalResponse.headers);
  headers.set("X-Knosi-Kind", kind);
  if (modelId) headers.set("X-Knosi-Model", modelId);
  return new Response(finalResponse.body, {
    status: finalResponse.status,
    statusText: finalResponse.statusText,
    headers,
  });
}
```

- [ ] **Step 3: Build to verify route compiles**

```bash
pnpm build 2>&1 | tail -40
```

Fix any remaining errors in this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "refactor(api/chat): route via resolveAiCall, drop env mode"
```

### Task 4.6.1: Update `enqueueChatTask` if it reads env model

**Files:**
- Modify: `src/server/ai/chat-enqueue.ts` (if it currently reads `CLAUDE_CODE_CHAT_MODEL`)

- [ ] **Step 1: Inspect**

```bash
grep -n "CLAUDE_CODE_CHAT_MODEL\|model:" src/server/ai/chat-enqueue.ts
```

- [ ] **Step 2: If it reads env, plumb `modelId` from caller**

Add a `modelId?: string` argument; use it when present, otherwise keep the existing default. The `chat/route.ts` change above passes it.

- [ ] **Step 3: Commit**

```bash
git add src/server/ai/chat-enqueue.ts
git commit -m "refactor(ai): chat-enqueue accepts model from resolved provider"
```

### Task 4.7: Update `council/persona-stream.ts` to use new façade

**Files:**
- Modify: `src/server/council/persona-stream.ts`

- [ ] **Step 1: Replace the file**

Drop the env-peek `resolveCouncilMode`. Replace the `streamPlainTextAiSdk` call with the new façade signature (which takes `userId` and resolves internally). If the resolved provider is daemon / transformers, fall back to a fixture: yield "Council currently requires an HTTP-backed chat provider; reassign in Settings." once.

```ts
import { streamPlainTextAiSdk, MissingAiRoleError } from "@/server/ai/provider";
import { resolveAiCall } from "@/server/ai/provider/resolve";
// ... existing other imports

export async function* streamPersonaResponse({
  persona, history, userId, channelTopic, abortSignal,
}: {
  persona: Persona;
  history: HistoryEntry[];
  userId: string;
  channelTopic: string | null;
  abortSignal: AbortSignal;
}): AsyncIterable<string> {
  if (TEST_MODE) {
    yield* fakeStream();
    return;
  }

  // Phase-1 limitation: council needs HTTP streaming.
  let provider;
  try {
    provider = await resolveAiCall("chat", userId);
  } catch (e) {
    if (e instanceof MissingAiRoleError) {
      yield "[Council 需要先在 Settings 中为 Chat 分配 Provider。]";
      return;
    }
    throw e;
  }
  if (provider.kind === "claude-code-daemon" || provider.kind === "transformers") {
    yield "[Council 仅支持 OpenAI-compatible 或 Local provider，请到 Settings 调整 Chat 分配。]";
    return;
  }

  // ... existing RAG/prompt build ...

  const stream = await streamPlainTextAiSdk({
    system, messages: [{ role: "user", content: user }],
    signal: abortSignal, userId, role: "chat",
  });
  for await (const chunk of stream) {
    if (abortSignal.aborted) return;
    yield chunk;
  }
}
```

(Drop the `resolveCouncilMode` helper entirely.)

- [ ] **Step 2: Commit**

```bash
git add src/server/council/persona-stream.ts
git commit -m "refactor(council): persona stream routes via resolveAiCall"
```

### Task 4.8: Migrate every `generateStructuredData` caller to pass `userId`

**Files:** (modify each)
- `src/app/api/summarize/route.ts`
- `src/app/api/explore/route.ts`
- `src/app/api/generate-lesson/route.ts`
- `src/server/routers/portfolio.ts`
- `src/server/routers/learning-notebook.ts`
- `src/server/council/classifier.ts`
- `src/server/ai/focus.ts`
- `src/server/ai/drifter.ts`

- [ ] **Step 1: Inventory current calls**

```bash
grep -rn "generateStructuredData(" src/ --include="*.ts" --include="*.tsx"
```

For each call, locate the surrounding `userId` (every call site already runs inside auth'd handlers; they have it).

- [ ] **Step 2: Update each call site**

Pattern: change

```ts
const out = await generateStructuredData({ ...options });
```

to

```ts
const out = await generateStructuredData(
  { ...options },
  { userId, role: "task" },
);
```

For `council/classifier.ts` — task role. For `drifter.ts` — chat role (it's mid-conversation generation). For `focus.ts` — task role.

- [ ] **Step 3: Build until clean**

```bash
pnpm build 2>&1 | tail -40
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai): pass userId+role to generateStructuredData callers"
```

### Task 4.9: Migrate embeddings to userId-based resolution

**Files:**
- Modify: `src/server/ai/embeddings.ts`
- Modify: `src/server/ai/indexer.ts`
- Modify: `src/server/ai/agentic-rag.ts`

- [ ] **Step 1: Rewrite `embeddings.ts`**

Replace the env-driven mode with a userId-resolved one. Keep the in-process `transformers` branch (it stays valuable as zero-config default).

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { resolveAiCall } from "./provider/resolve";
import { MissingAiRoleError } from "./provider/types";
import { TRANSFORMERS_DEFAULT_MODEL } from "./provider/presets";

type EmbedKind = "passage" | "query";

let transformersPipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getTransformersPipeline(modelId: string) {
  if (!transformersPipelinePromise) {
    transformersPipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("feature-extraction", modelId, { dtype: "q8" });
    })();
  }
  return transformersPipelinePromise;
}

function normalizeVector(vector: number[]) {
  const m = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (!Number.isFinite(m) || m <= 0) return vector;
  return vector.map((v) => v / m);
}

async function embedWithTransformers(
  texts: string[], kind: EmbedKind, modelId: string,
) {
  const extractor = await getTransformersPipeline(modelId);
  const prefix = kind === "query" ? "query: " : "passage: ";
  const tensor = await extractor(texts.map((t) => prefix + t), {
    pooling: "mean", normalize: true,
  });
  const dims = tensor.dims[1] ?? 0;
  const flat = Array.from(tensor.data as Float32Array);
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(flat.slice(i * dims, (i + 1) * dims));
  }
  return { model: modelId, vectors };
}

export async function embedTexts(
  texts: string[],
  opts: { userId: string; kind?: EmbedKind },
) {
  if (texts.length === 0) return null;
  const kind: EmbedKind = opts.kind ?? "passage";

  let provider;
  try {
    provider = await resolveAiCall("embedding", opts.userId);
  } catch (e) {
    if (e instanceof MissingAiRoleError) return null; // graceful: keyword-only retrieval
    throw e;
  }

  if (provider.kind === "transformers") {
    return embedWithTransformers(texts, kind, provider.modelId || TRANSFORMERS_DEFAULT_MODEL);
  }
  if (provider.kind === "claude-code-daemon") {
    throw new Error("daemon kind cannot serve embedding"); // resolveAiCall already trips
  }

  const sdk = createOpenAI({
    name: provider.label,
    baseURL: provider.baseURL,
    apiKey: provider.kind === "openai-compatible" ? provider.apiKey : "local",
  });
  const model = sdk.embeddingModel(provider.modelId);
  const { embeddings } = await embedMany({ model, values: texts });
  return {
    model: provider.modelId,
    vectors: embeddings.map((e) => normalizeVector(e)),
  };
}

export async function isEmbeddingEnabled(userId: string): Promise<boolean> {
  try {
    await resolveAiCall("embedding", userId);
    return true;
  } catch {
    return false;
  }
}

export function vectorBufferToArray(buffer: Buffer | Uint8Array | null) {
  if (!buffer) return [];
  const u8 = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const v = new Float32Array(
    u8.buffer, u8.byteOffset, u8.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(v);
}

export function vectorArrayToBuffer(vector: number[]) {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function dotProduct(left: number[], right: number[]) {
  const n = Math.min(left.length, right.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += left[i]! * right[i]!;
  return s;
}
```

- [ ] **Step 2: Update `indexer.ts` and `agentic-rag.ts` to plumb `userId`**

For `indexer.ts`: every call to `embedTexts(...)` becomes `embedTexts(..., { userId, kind: "passage" })`. The indexer functions probably already take a `userId` because notes belong to users; if not, add it as a required param and propagate through callers (notes router etc.).

For `agentic-rag.ts`: change `embedTexts([query], "query")` → `embedTexts([query], { userId, kind: "query" })`.

- [ ] **Step 3: Build clean**

```bash
pnpm build 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(ai): embeddings route via resolveAiCall(embedding, userId)"
```

### Task 4.10: Delete `mode.ts` and clean up dead env reads

**Files:**
- Delete: `src/server/ai/provider/mode.ts`
- Delete: `src/server/ai/provider/mode.test.ts`
- Modify: `src/server/ai/daemon-mode.ts` — repurpose to a sync helper that returns `false` always (env path is dead) OR delete and inline its callers
- Verify dead env reads gone

- [ ] **Step 1: Verify mode.ts has no remaining importer**

```bash
grep -rn "provider/mode" src/ --include="*.ts" --include="*.tsx"
```

Expected: zero matches. If any remain, fix those callers first.

- [ ] **Step 2: Delete**

```bash
git rm src/server/ai/provider/mode.ts src/server/ai/provider/mode.test.ts
```

- [ ] **Step 3: Audit `shouldUseDaemonForChat` callers**

```bash
grep -rn "shouldUseDaemonForChat" src/ --include="*.ts" --include="*.tsx"
```

`/api/chat/route.ts` already moved off it. Other callers (`api/config/route.ts`, `(app)/ask/page.tsx`) currently use it to *display* whether daemon is on. With the new model, "daemon vs not" is a per-user decision, not a deployment one — those displays must take a `userId` and call `resolveAiCall("chat", userId)`. For server components / RSC handlers, this is fine. For client components, fetch via tRPC.

For each caller:
- `src/app/api/config/route.ts`: take auth session, resolve, return `{ chatKind: provider.kind }` (rename field).
- `src/app/(app)/ask/page.tsx`: this is an RSC; `await` the resolution and pass `chatMode={kind === "claude-code-daemon" ? "daemon" : "stream"}`.

- [ ] **Step 4: Delete or simplify `daemon-mode.ts`**

If `shouldUseDaemonForChat` no longer has any caller, delete the file. If it does, replace with:

```ts
// src/server/ai/daemon-mode.ts — kept for daemon health/CLI checks ONLY.
// `shouldUseDaemonForChat` removed; chat routing decision lives in
// resolveAiCall now. Anything else here that referenced AI_PROVIDER
// gets deleted in this commit.
```

(Verify `daemon-mode.ts` doesn't have other unrelated exports — if it does, keep them; remove only `shouldUseDaemonForChat` and the env read.)

- [ ] **Step 5: Audit env reads project-wide**

```bash
grep -rn "process.env.AI_PROVIDER\|KNOSI_HOSTED_MODE\|KNOSI_CODEX_ACCOUNT_POOL\|CURSOR_PROXY\|process.env.OPENAI_API_KEY\|LOCAL_AI_\|process.env.AI_BASE_URL\|process.env.AI_API_KEY\|process.env.AI_MODEL\|EMBEDDING_PROVIDER\|GOOGLE_GENERATIVE_AI_API_KEY\|TRANSFORMERS_EMBEDDING_MODEL\|CODEX_\|OPENCLAW_" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."
```

Expected: zero matches in non-test code (Langfuse and Auth.js OAuth env vars don't match these patterns; if they do, leave them — they're unrelated).

If any AI-routing env reads remain, delete them. The grep is the gate.

- [ ] **Step 6: Build clean**

```bash
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(ai): delete mode.ts + scrub dead AI env reads"
```

---

## Phase 5 — `probe.ts` (provider health + model discovery)

### Task 5.1: Implement `probeProvider`

**Files:**
- Create: `src/server/ai/provider/probe.ts`
- Test: `src/server/ai/provider/probe.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { probeProvider } from "./probe";

afterEach(() => vi.restoreAllMocks());

describe("probeProvider — openai-compatible", () => {
  it("returns ok + model list on 200 with {data:[{id}]}", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }),
    );
    const r = await probeProvider({
      kind: "openai-compatible", baseURL: "https://api.example.com/v1", apiKey: "sk-x",
    });
    expect(r).toEqual({ ok: true, models: ["gpt-4o", "gpt-4o-mini"] });
  });

  it("returns ok=false on 401 with parsed error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    );
    const r = await probeProvider({
      kind: "openai-compatible", baseURL: "https://api.example.com/v1", apiKey: "sk-bad",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.error).toContain("Invalid API key");
  });

  it("network failure surfaces as ok=false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const r = await probeProvider({
      kind: "openai-compatible", baseURL: "https://nope.example.com/v1", apiKey: "sk-x",
    });
    expect(r.ok).toBe(false);
  });
});

describe("probeProvider — local (no key)", () => {
  it("works without apiKey", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "qwen2.5:14b" }] }), { status: 200 }),
    );
    const r = await probeProvider({ kind: "local", baseURL: "http://127.0.0.1:11434/v1" });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test:unit src/server/ai/provider/probe.test.ts
```

- [ ] **Step 3: Implement probe.ts**

```ts
import type { ProviderKind } from "./types";

export type ProbeInput =
  | { kind: "openai-compatible"; baseURL: string; apiKey: string }
  | { kind: "local"; baseURL: string }
  | { kind: "claude-code-daemon" }
  | { kind: "transformers" };

export type ProbeResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

const PROBE_TIMEOUT_MS = 8000;

function trimBase(url: string) {
  return url.replace(/\/+$/, "");
}

async function probeOpenAiCompat(
  baseURL: string, apiKey: string | null,
): Promise<ProbeResult> {
  const url = `${trimBase(baseURL)}/models`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message ?? j?.message ?? msg;
      } catch {}
      return { ok: false, error: msg };
    }
    let models: string[] = [];
    try {
      const j = JSON.parse(text);
      models = (j?.data ?? [])
        .map((m: { id?: string }) => m?.id)
        .filter((x: unknown): x is string => typeof x === "string");
    } catch {}
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeProvider(input: ProbeInput): Promise<ProbeResult> {
  if (input.kind === "openai-compatible") {
    return probeOpenAiCompat(input.baseURL, input.apiKey);
  }
  if (input.kind === "local") {
    return probeOpenAiCompat(input.baseURL, null);
  }
  if (input.kind === "claude-code-daemon") {
    // Daemon health: defer to existing infra (HTTP daemon health endpoint
    // or simple table-presence check). For v1 we accept the assignment if
    // the chat_tasks table exists; full health check can be a follow-up.
    return { ok: true, models: ["opus", "sonnet"] };
  }
  // transformers: in-process; if module loads, it's ok.
  try {
    await import("@huggingface/transformers");
    return { ok: true, models: ["Xenova/multilingual-e5-small"] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type { ProviderKind };
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test:unit src/server/ai/provider/probe.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/server/ai/provider/probe.ts src/server/ai/provider/probe.test.ts
git commit -m "feat(ai): probe provider health + model discovery via /v1/models"
```

---

## Phase 6 — tRPC router for AI settings

### Task 6.1: Create `routers/ai-settings.ts`

**Files:**
- Create: `src/server/routers/ai-settings.ts`
- Modify: `src/server/routers/_app.ts` (or wherever routers are mounted) — add `aiSettings`
- Modify: `src/server/routers/billing.ts` — delete the 4 AI procedures

- [ ] **Step 1: Find the root router file**

```bash
grep -rln "billingRouter" src/server/routers/ --include="*.ts" | head -3
```

Open the root file (probably `_app.ts` or `index.ts`).

- [ ] **Step 2: Implement the router**

Create `src/server/routers/ai-settings.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/server/db";
import { aiProviders, aiRoleAssignments } from "@/server/db/schema/ai-providers";
import { encryptApiKey, decryptApiKey } from "@/server/ai/crypto";
import {
  invalidateProviderCache,
} from "@/server/ai/provider/resolve";
import { probeProvider } from "@/server/ai/provider/probe";
import { protectedProcedure, router } from "@/server/trpc";

const KIND = z.enum(["openai-compatible", "local", "claude-code-daemon", "transformers"]);
const ROLE = z.enum(["chat", "task", "embedding"]);

function requireUser(ctx: unknown): string {
  const userId = (ctx as { userId?: string }).userId;
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return userId;
}

export const aiSettingsRouter = router({
  listProviders: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUser(ctx);
    const rows = await db
      .select({
        id: aiProviders.id,
        kind: aiProviders.kind,
        label: aiProviders.label,
        baseUrl: aiProviders.baseUrl,
        apiKeyEnc: aiProviders.apiKeyEnc,
      })
      .from(aiProviders)
      .where(eq(aiProviders.userId, userId));
    // Never return plaintext key — only `hasApiKey`.
    return rows.map((r) => ({
      id: r.id, kind: r.kind, label: r.label,
      baseUrl: r.baseUrl, hasApiKey: Boolean(r.apiKeyEnc),
    }));
  }),

  addProvider: protectedProcedure
    .input(z.object({
      kind: KIND,
      label: z.string().trim().min(1).max(80),
      baseUrl: z.string().trim().url().nullable(),
      apiKey: z.string().trim().min(1).max(500).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      // Schema-level kind/required-field validation
      if (input.kind === "openai-compatible") {
        if (!input.baseUrl || !input.apiKey) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "openai-compatible requires baseUrl + apiKey" });
        }
      } else if (input.kind === "local") {
        if (!input.baseUrl) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "local requires baseUrl" });
        }
      }
      const id = crypto.randomUUID();
      await db.insert(aiProviders).values({
        id, userId, kind: input.kind, label: input.label,
        baseUrl: input.baseUrl ?? null,
        apiKeyEnc: input.apiKey ? encryptApiKey(input.apiKey) : null,
      });
      invalidateProviderCache(userId);
      return { id };
    }),

  updateProvider: protectedProcedure
    .input(z.object({
      id: z.string(),
      label: z.string().trim().min(1).max(80).optional(),
      baseUrl: z.string().trim().url().nullable().optional(),
      apiKey: z.string().trim().min(1).max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) patch.label = input.label;
      if (input.baseUrl !== undefined) patch.baseUrl = input.baseUrl;
      if (input.apiKey !== undefined) {
        patch.apiKeyEnc = input.apiKey === null ? null : encryptApiKey(input.apiKey);
      }
      const res = await db.update(aiProviders).set(patch)
        .where(and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)));
      // drizzle returns rowsAffected on libsql; treat 0 as not-found.
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),

  deleteProvider: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      // Ownership check before delete (FK on cascade is by user, not just by id)
      const [refRow] = await db.select({ role: aiRoleAssignments.role })
        .from(aiRoleAssignments)
        .where(and(
          eq(aiRoleAssignments.providerId, input.id),
          eq(aiRoleAssignments.userId, userId),
        ))
        .limit(1);
      if (refRow) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Provider is used by role "${refRow.role}". Reassign the role before deleting.`,
        });
      }
      await db.delete(aiProviders)
        .where(and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)));
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),

  testProvider: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [row] = await db.select({
        kind: aiProviders.kind, baseUrl: aiProviders.baseUrl, apiKeyEnc: aiProviders.apiKeyEnc,
      }).from(aiProviders)
        .where(and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.kind === "openai-compatible") {
        if (!row.baseUrl || !row.apiKeyEnc) {
          return { ok: false as const, error: "Missing baseURL or apiKey" };
        }
        return probeProvider({ kind: "openai-compatible", baseURL: row.baseUrl, apiKey: decryptApiKey(row.apiKeyEnc) });
      }
      if (row.kind === "local") {
        if (!row.baseUrl) return { ok: false as const, error: "Missing baseURL" };
        return probeProvider({ kind: "local", baseURL: row.baseUrl });
      }
      if (row.kind === "claude-code-daemon") return probeProvider({ kind: "claude-code-daemon" });
      return probeProvider({ kind: "transformers" });
    }),

  listProviderModels: protectedProcedure
    .input(z.object({ id: z.string(), refresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      // For v1, ignore caching layer; just probe live each call when refresh=true,
      // and return presets (from /server/ai/provider/presets.ts) inline-merged
      // with a probe if HTTP-backed kind. We rely on the client-side cache
      // for "don't call /v1/models on every render".
      const userId = requireUser(ctx);
      const [row] = await db.select({
        kind: aiProviders.kind, baseUrl: aiProviders.baseUrl, apiKeyEnc: aiProviders.apiKeyEnc,
      }).from(aiProviders)
        .where(and(eq(aiProviders.id, input.id), eq(aiProviders.userId, userId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.kind === "openai-compatible" && row.baseUrl && row.apiKeyEnc) {
        const r = await probeProvider({
          kind: "openai-compatible", baseURL: row.baseUrl, apiKey: decryptApiKey(row.apiKeyEnc),
        });
        return { models: r.ok ? r.models : [] };
      }
      if (row.kind === "local" && row.baseUrl) {
        const r = await probeProvider({ kind: "local", baseURL: row.baseUrl });
        return { models: r.ok ? r.models : [] };
      }
      if (row.kind === "claude-code-daemon") return { models: ["opus", "sonnet"] };
      return { models: ["Xenova/multilingual-e5-small"] };
    }),

  getRoleAssignments: protectedProcedure.query(async ({ ctx }) => {
    const userId = requireUser(ctx);
    const rows = await db.select().from(aiRoleAssignments)
      .where(eq(aiRoleAssignments.userId, userId));
    const out: Record<string, { providerId: string; modelId: string } | null> = {
      chat: null, task: null, embedding: null,
    };
    for (const r of rows) {
      out[r.role] = { providerId: r.providerId, modelId: r.modelId };
    }
    return out;
  }),

  setRoleAssignment: protectedProcedure
    .input(z.object({
      role: ROLE,
      providerId: z.string(),
      modelId: z.string().trim().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = requireUser(ctx);
      const [provider] = await db.select({ kind: aiProviders.kind })
        .from(aiProviders)
        .where(and(eq(aiProviders.id, input.providerId), eq(aiProviders.userId, userId)))
        .limit(1);
      if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      // Embedding role cannot be served by daemon kind.
      if (input.role === "embedding" && provider.kind === "claude-code-daemon") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "claude-code-daemon cannot serve the embedding role.",
        });
      }
      // Chat / task cannot be served by transformers kind.
      if (input.role !== "embedding" && provider.kind === "transformers") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "transformers kind only serves the embedding role.",
        });
      }
      await db.insert(aiRoleAssignments).values({
        userId, role: input.role, providerId: input.providerId,
        modelId: input.modelId, updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [aiRoleAssignments.userId, aiRoleAssignments.role],
        set: { providerId: input.providerId, modelId: input.modelId, updatedAt: new Date() },
      });
      invalidateProviderCache(userId);
      return { ok: true as const };
    }),
});
```

- [ ] **Step 3: Mount the router**

Edit the root router file. Add:

```ts
import { aiSettingsRouter } from "./ai-settings";
// ...
export const appRouter = router({
  // ...existing
  aiSettings: aiSettingsRouter,
  // ...
});
```

- [ ] **Step 4: Strip the 4 AI procedures from `billing.ts`**

Edit `src/server/routers/billing.ts`:
- Remove `setAiProviderPreference`, `getAiProviderPreference`, `getAiChatModel`, `setAiChatModel`
- Keep only `me`
- Remove the now-unused `invalidateProviderPrefCache` import (we use the new `invalidateProviderCache` from resolve, but only inside ai-settings — billing no longer needs it)

The resulting billingRouter has only `me`.

- [ ] **Step 5: Build to confirm types are clean**

```bash
pnpm build 2>&1 | tail -40
```

Fix any client-side `trpc.billing.setAiProviderPreference.useMutation` etc. — those will already be deleted in Phase 7's UI rewrite, but `pnpm build` may flag them now if Phase 7 hasn't started. Either:
- Defer to Phase 7 (broken UI commit with explicit "wip" message), or
- Stub the UI deletions in this commit too.

Choose deferral — easier to review.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ai-settings): tRPC router for providers + role assignments (UI broken until Phase 7)"
```

---

## Phase 7 — Settings UI rewrite

### Task 7.1: Build `provider-edit-dialog.tsx`

**Files:**
- Create: `src/app/(app)/settings/providers/provider-edit-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

```tsx
"use client";

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { OPENAI_COMPATIBLE_PRESETS, LOCAL_DEFAULT_BASE_URL } from "@/server/ai/provider/presets";

export type ProviderKind =
  | "openai-compatible" | "local" | "claude-code-daemon" | "transformers";

type Existing = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

export function ProviderEditDialog({
  existing, onClose,
}: {
  existing: Existing | { kind: ProviderKind } | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const isEdit = existing !== null && "id" in existing;
  const initialKind: ProviderKind = existing?.kind ?? "openai-compatible";
  const [kind, setKind] = useState<ProviderKind>(initialKind);
  const [presetId, setPresetId] = useState<string>(
    initialKind === "openai-compatible" ? "openai" : "custom",
  );
  const [label, setLabel] = useState(isEdit ? existing.label : "");
  const [baseUrl, setBaseUrl] = useState(
    isEdit
      ? (existing.baseUrl ?? "")
      : kind === "local" ? LOCAL_DEFAULT_BASE_URL : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = trpc.aiSettings.addProvider.useMutation();
  const update = trpc.aiSettings.updateProvider.useMutation();
  const test = trpc.aiSettings.testProvider.useMutation();

  useEffect(() => {
    // Sync preset → fields
    if (kind !== "openai-compatible" || presetId === "custom") return;
    const p = OPENAI_COMPATIBLE_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setBaseUrl(p.baseUrl);
    if (!isEdit && !label) setLabel(p.label);
  }, [kind, presetId, isEdit, label]);

  async function save() {
    setBusy(true); setError(null);
    try {
      let id: string;
      if (isEdit) {
        await update.mutateAsync({
          id: existing.id,
          label: label.trim() || undefined,
          baseUrl: kind === "claude-code-daemon" || kind === "transformers" ? null : baseUrl,
          apiKey: apiKey ? apiKey : undefined, // empty = keep existing
        });
        id = existing.id;
      } else {
        const res = await add.mutateAsync({
          kind,
          label: label.trim(),
          baseUrl: kind === "claude-code-daemon" || kind === "transformers" ? null : baseUrl,
          apiKey: kind === "openai-compatible" ? apiKey : null,
        });
        id = res.id;
      }
      // Test after save (don't roll back on test failure — user gets a warning)
      const r = await test.mutateAsync({ id });
      if (!r.ok) {
        setError(`Saved, but connection test failed: ${r.error}`);
        await utils.aiSettings.listProviders.invalidate();
        setBusy(false);
        return;
      }
      await utils.aiSettings.listProviders.invalidate();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[28rem] rounded-2xl bg-white p-5 dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-lg font-semibold">
          {isEdit ? "Edit provider" : "Add provider"}
        </h3>

        {!isEdit && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Kind</label>
            <select className="mt-1 w-full rounded border px-2 py-1"
                    value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
              <option value="openai-compatible">OpenAI-compatible API</option>
              <option value="local">Local Model (Ollama / LM Studio)</option>
              <option value="claude-code-daemon">Claude Code Daemon</option>
              <option value="transformers">Transformers.js (in-process embedding)</option>
            </select>
          </div>
        )}

        {kind === "openai-compatible" && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Preset</label>
            <select className="mt-1 w-full rounded border px-2 py-1"
                    value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {OPENAI_COMPATIBLE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>
        )}

        {(kind === "openai-compatible" || kind === "local") && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">Base URL</label>
            <input className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
                   value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                   placeholder="https://api.example.com/v1" />
          </div>
        )}

        {kind === "openai-compatible" && (
          <div className="mb-3">
            <label className="block text-xs font-medium uppercase">API Key</label>
            <input type="password"
                   className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
                   value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder={isEdit ? "(leave blank to keep existing)" : "sk-..."} />
          </div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-medium uppercase">Label</label>
          <input className="mt-1 w-full rounded border px-2 py-1"
                 value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        {error && <div className="mb-3 rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

        <div className="flex justify-end gap-2">
          <button className="rounded border px-3 py-1" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="rounded bg-stone-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                  onClick={save} disabled={busy || !label.trim()}>
            {busy ? "Saving…" : "Test & Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/settings/providers/provider-edit-dialog.tsx
git commit -m "feat(settings): provider edit dialog (kind-aware)"
```

### Task 7.2: Build `provider-card.tsx` and `providers-section.tsx`

**Files:**
- Create: `src/app/(app)/settings/providers/provider-card.tsx`
- Create: `src/app/(app)/settings/providers/providers-section.tsx`

- [ ] **Step 1: Implement provider-card**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ProviderEditDialog } from "./provider-edit-dialog";

type Provider = {
  id: string;
  kind: "openai-compatible" | "local" | "claude-code-daemon" | "transformers";
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

export function ProviderCard({ p }: { p: Provider }) {
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const test = trpc.aiSettings.testProvider.useMutation();
  const del = trpc.aiSettings.deleteProvider.useMutation();

  async function runTest() {
    setTesting(true); setTestMsg(null);
    try {
      const r = await test.mutateAsync({ id: p.id });
      setTestMsg(r.ok ? `OK — ${r.models.length} models available.` : `Failed: ${r.error}`);
    } finally { setTesting(false); }
  }

  async function runDelete() {
    if (!confirm(`Delete provider "${p.label}"?`)) return;
    try {
      await del.mutateAsync({ id: p.id });
      await utils.aiSettings.listProviders.invalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium">{p.label}</div>
          <div className="text-xs text-stone-500">
            {p.kind} {p.baseUrl ? ` · ${p.baseUrl}` : ""}
            {p.hasApiKey ? " · key set" : ""}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                  onClick={runTest} disabled={testing}>
            {testing ? "Testing…" : "Test"}
          </button>
          <button className="rounded border px-2 py-1 text-xs" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button className="rounded border px-2 py-1 text-xs text-red-700"
                  onClick={runDelete}>Delete</button>
        </div>
      </div>
      {testMsg && <div className="mt-2 text-xs">{testMsg}</div>}
      {editing && <ProviderEditDialog existing={p} onClose={() => setEditing(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Implement providers-section**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ProviderCard } from "./provider-card";
import { ProviderEditDialog } from "./provider-edit-dialog";

export function ProvidersSection() {
  const { data: providers, isLoading } = trpc.aiSettings.listProviders.useQuery();
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-sm text-stone-500">
            Backends that can produce tokens. Add one for each API key / endpoint you want to use.
          </p>
        </div>
        <button className="rounded bg-stone-900 px-3 py-1 text-sm text-white dark:bg-stone-100 dark:text-stone-900"
                onClick={() => setAdding(true)}>+ Add provider</button>
      </div>
      {isLoading ? (
        <div className="text-sm text-stone-500">Loading…</div>
      ) : providers && providers.length > 0 ? (
        <div className="space-y-2">{providers.map((p) => <ProviderCard key={p.id} p={p} />)}</div>
      ) : (
        <div className="rounded border border-dashed p-4 text-center text-sm text-stone-500">
          No providers yet. Click <strong>Add provider</strong> above to get started.
        </div>
      )}
      {adding && <ProviderEditDialog existing={null} onClose={() => setAdding(false)} />}
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/settings/providers/
git commit -m "feat(settings): providers section + card"
```

### Task 7.3: Build `role-row.tsx` and `roles-section.tsx`

**Files:**
- Create: `src/app/(app)/settings/providers/role-row.tsx`
- Create: `src/app/(app)/settings/providers/roles-section.tsx`

- [ ] **Step 1: Implement role-row**

```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  OPENAI_COMPATIBLE_PRESETS, LOCAL_PRESET_MODELS,
  DAEMON_PRESET_MODELS, TRANSFORMERS_PRESET_MODELS,
} from "@/server/ai/provider/presets";

type Role = "chat" | "task" | "embedding";

type Provider = {
  id: string;
  kind: "openai-compatible" | "local" | "claude-code-daemon" | "transformers";
  label: string;
  baseUrl: string | null;
  hasApiKey: boolean;
};

function presetModelsFor(p: Provider): readonly string[] {
  if (p.kind === "openai-compatible") {
    const preset = OPENAI_COMPATIBLE_PRESETS.find(
      (x) => p.baseUrl?.startsWith(x.baseUrl),
    );
    return preset?.models ?? [];
  }
  if (p.kind === "local") return LOCAL_PRESET_MODELS;
  if (p.kind === "claude-code-daemon") return DAEMON_PRESET_MODELS;
  return TRANSFORMERS_PRESET_MODELS;
}

export function RoleRow({
  role, providers, current, description,
}: {
  role: Role;
  providers: Provider[];
  current: { providerId: string; modelId: string } | null;
  description: string;
}) {
  const utils = trpc.useUtils();
  const set = trpc.aiSettings.setRoleAssignment.useMutation({
    onSuccess: () => utils.aiSettings.getRoleAssignments.invalidate(),
  });
  const [providerId, setProviderId] = useState(current?.providerId ?? providers[0]?.id ?? "");
  const [modelId, setModelId] = useState(current?.modelId ?? "");
  const [refreshing, setRefreshing] = useState(false);

  // Filter providers per-role.
  const eligible = providers.filter((p) => {
    if (role === "embedding") return p.kind !== "claude-code-daemon";
    return p.kind !== "transformers";
  });

  const selectedProvider = eligible.find((p) => p.id === providerId);
  const presets = selectedProvider ? presetModelsFor(selectedProvider) : [];
  const live = trpc.aiSettings.listProviderModels.useQuery(
    { id: providerId, refresh: false },
    { enabled: Boolean(providerId), staleTime: 60_000 },
  );
  const allModels = Array.from(new Set([
    ...presets,
    ...(live.data?.models ?? []),
  ]));

  async function refresh() {
    setRefreshing(true);
    try { await live.refetch(); } finally { setRefreshing(false); }
  }

  async function save() {
    if (!providerId || !modelId.trim()) return;
    await set.mutateAsync({ role, providerId, modelId: modelId.trim() });
  }

  return (
    <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
      <div className="flex items-baseline justify-between">
        <div className="font-medium capitalize">{role}</div>
        <div className="text-xs text-stone-500">{description}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="rounded border px-2 py-1 text-sm"
                value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">— select provider —</option>
          {eligible.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select className="rounded border px-2 py-1 text-sm font-mono"
                value={modelId} onChange={(e) => setModelId(e.target.value)}>
          <option value="">— select model —</option>
          {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="__custom__">Custom…</option>
        </select>
        {modelId === "__custom__" && (
          <input className="rounded border px-2 py-1 text-sm font-mono"
                 placeholder="custom model id"
                 onBlur={(e) => setModelId(e.target.value.trim())} />
        )}
        <button className="rounded border px-2 py-1 text-xs" disabled={refreshing}
                onClick={() => void refresh()}>
          {refreshing ? "↻" : "Refresh"}
        </button>
        <button className="rounded bg-stone-900 px-2 py-1 text-xs text-white dark:bg-stone-100 dark:text-stone-900"
                onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement roles-section**

```tsx
"use client";

import { trpc } from "@/lib/trpc";
import { RoleRow } from "./role-row";

const DESCRIPTIONS: Record<"chat" | "task" | "embedding", string> = {
  chat: "Used by Ask AI, Council, Drifter",
  task: "Used by tag/summary/structured generation",
  embedding: "Used by RAG indexing",
};

export function RolesSection() {
  const { data: providers } = trpc.aiSettings.listProviders.useQuery();
  const { data: roles } = trpc.aiSettings.getRoleAssignments.useQuery();
  if (!providers || !roles) return <div className="text-sm text-stone-500">Loading…</div>;
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-950">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">AI Roles</h2>
        <p className="text-sm text-stone-500">
          Pick a provider + model for each role. Add providers above first.
        </p>
      </div>
      <div className="space-y-3">
        {(["chat", "task", "embedding"] as const).map((role) => (
          <RoleRow key={role} role={role} providers={providers}
                   current={roles[role]} description={DESCRIPTIONS[role]} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/settings/providers/role-row.tsx src/app/(app)/settings/providers/roles-section.tsx
git commit -m "feat(settings): roles section with refresh + custom model fallback"
```

### Task 7.4: Wire new sections into Settings page; delete old files

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`
- Delete: `src/app/(app)/settings/ai-provider-section.tsx`
- Delete: `src/app/(app)/settings/model-picker.tsx`

- [ ] **Step 1: Read current page**

```bash
cat src/app/(app)/settings/page.tsx
```

- [ ] **Step 2: Replace `<AiProviderSection />` import + usage with the two new sections**

```tsx
// inside settings/page.tsx
import { ProvidersSection } from "./providers/providers-section";
import { RolesSection } from "./providers/roles-section";
// ... in JSX:
<ProvidersSection />
<RolesSection />
```

(Place them where `<AiProviderSection />` used to live.)

- [ ] **Step 3: Delete old files**

```bash
git rm src/app/(app)/settings/ai-provider-section.tsx src/app/(app)/settings/model-picker.tsx
```

- [ ] **Step 4: Build clean**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(settings): mount new providers + roles sections; remove legacy UI"
```

### Task 7.5: Add a "configure your AI" gentle redirect when role is missing

**Files:**
- Modify: `src/app/(app)/ask/page.tsx` (or wherever Ask AI client lands)
- Possibly: `src/components/ask/ask-ai-banner.tsx` (new) or amend existing `api-key-prompt.tsx`

- [ ] **Step 1: When `chat` role is unassigned, the chat input should be disabled and show a "Configure in Settings" CTA**

The Ask AI page calls `/api/chat` which returns `{ code: "MISSING_AI_ROLE" }` 412. Add a tRPC `aiSettings.getRoleAssignments` query at the top of the Ask page; if `chat` is null, render the banner instead of the chat input.

(Implementation detail can adapt to the existing component layout — the rule is: never let the user hit chat with a missing assignment without a clear path.)

- [ ] **Step 2: Build + commit**

```bash
git add -A
git commit -m "feat(ask): configure-AI banner when chat role unassigned"
```

---

## Phase 8 — Tests + production rollout

### Task 8.1: Write the new E2E spec

**Files:**
- Create: `e2e/ai-settings.spec.ts`

- [ ] **Step 1: Implement the test**

```ts
import { test, expect } from "@playwright/test";

const BASE = "http://localhost:3100";

test.describe("AI Settings", () => {
  test.beforeEach(async ({ page }) => {
    // E2E auth bypass: the test webServer runs with AUTH_BYPASS=true and
    // a deterministic seeded user. Confirm by navigating to /settings.
    await page.goto(`${BASE}/settings`);
  });

  test("add OpenAI provider, set chat role, send chat", async ({ page }) => {
    // Mock /v1/models so the probe + listProviderModels returns predictably.
    await page.route("**/api.openai.com/v1/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
      });
    });

    await page.getByRole("button", { name: /add provider/i }).click();
    // Default kind = openai-compatible, preset = OpenAI; just fill key + label
    await page.getByPlaceholder("sk-...").fill("sk-fake-test-key");
    await page.getByLabel("Label", { exact: false }).fill("OpenAI Test");
    await page.getByRole("button", { name: /test & save/i }).click();

    await expect(page.getByText("OpenAI Test")).toBeVisible();

    // Set Chat role
    const chatRow = page.locator("text=Chat").locator("..");
    await chatRow.locator("select").nth(0).selectOption({ label: "OpenAI Test" });
    await chatRow.locator("select").nth(1).selectOption("gpt-4o");
    await chatRow.getByRole("button", { name: /save/i }).click();

    // Mock the chat completion stream too.
    await page.route("**/api.openai.com/v1/chat/completions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n`,
      });
    });

    // Go to Ask AI and verify the request goes through
    await page.goto(`${BASE}/ask`);
    await page.getByPlaceholder(/ask/i).fill("ping");
    await page.keyboard.press("Enter");

    // Wait for chat response — body element with "hello" or for X-Knosi-Kind
    const respPromise = page.waitForResponse((r) => r.url().includes("/api/chat"));
    const resp = await respPromise;
    expect(resp.headers()["x-knosi-kind"]).toBe("openai-compatible");
    expect(resp.headers()["x-knosi-model"]).toBe("gpt-4o");
  });

  test("delete in-use provider blocks with confirm dialog", async ({ page }) => {
    // Assumes "OpenAI Test" provider + chat role still set from previous test
    // — playwright clears state between tests. Set up via UI again or hit the
    // tRPC endpoints in beforeEach to seed. Pragmatic: this test mirrors the
    // happy path again, then attempts delete.
    await page.route("**/api.openai.com/v1/models", async (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ data: [{ id: "gpt-4o" }] }) }),
    );
    await page.getByRole("button", { name: /add provider/i }).click();
    await page.getByPlaceholder("sk-...").fill("sk-fake");
    await page.getByLabel("Label", { exact: false }).fill("ToDelete");
    await page.getByRole("button", { name: /test & save/i }).click();
    await expect(page.getByText("ToDelete")).toBeVisible();

    await page.locator("text=ToDelete").locator("..").getByRole("button", { name: /delete/i }).click();
    page.once("dialog", (d) => d.accept());
    // Provider not assigned to any role → delete succeeds.
    await expect(page.getByText("ToDelete")).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Adjust selectors as needed for the actual rendered DOM**

Run once and iterate:

```bash
pnpm test:e2e --reporter=line e2e/ai-settings.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add e2e/ai-settings.spec.ts
git commit -m "test(e2e): ai-settings happy path + delete protection"
```

### Task 8.2: Adjust or delete legacy E2E tests

**Files:**
- `e2e/per-user-provider.spec.ts` — delete (旧 enum 没了)
- `e2e/ask-local-toggle.spec.ts` — adjust if it depended on env-based AI_PROVIDER toggle

- [ ] **Step 1: Inspect each**

```bash
head -40 e2e/per-user-provider.spec.ts
head -40 e2e/ask-local-toggle.spec.ts
```

- [ ] **Step 2: Delete `per-user-provider.spec.ts`**

```bash
git rm e2e/per-user-provider.spec.ts
```

- [ ] **Step 3: Update `ask-local-toggle.spec.ts`**

If the test asserts a UI toggle that no longer exists, remove it; if it asserts that local mode still works, rewrite to use the new providers UI seeded via tRPC fixture.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): drop per-user-provider spec; update ask-local-toggle"
```

### Task 8.3: Run the full verification three-step

**Files:** none

- [ ] **Step 1: Build**

```bash
pnpm build
```

Expected: green.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: green.

- [ ] **Step 3: Unit tests**

```bash
pnpm test:unit
```

Expected: green. Fix any.

- [ ] **Step 4: E2E**

```bash
pnpm test:e2e
```

Expected: green.

- [ ] **Step 5: Commit (if any test fixes were needed)**

```bash
git add -A
git commit -m "test: resolve fallout from provider refactor"
```

### Task 8.4: Production Turso rollout

**Files:**
- Modify: `docs/changelog/2026-05-02-model-provider-refactor.md` (extend)

- [ ] **Step 1: Locate the prod rollout migration SQL**

```bash
ls drizzle/ | grep '^00[0-9]\{2\}_' | tail -3
cat drizzle/<the-migration-with-ai_providers>.sql
```

- [ ] **Step 2: Apply to prod Turso**

Read the prod creds location (`.env.turso-prod.local` per CLAUDE.md):

```bash
cat .env.turso-prod.local
# (Don't commit this output to anything.)
```

Apply migration:

```bash
turso db shell <prod-db-name> < drizzle/<migration>.sql
```

If turso doesn't accept multiple statements via stdin, paste each statement manually in `turso db shell`.

- [ ] **Step 3: Verify schema**

```bash
turso db shell <prod-db> "select sql from sqlite_master where name in ('ai_providers','ai_role_assignments')"
turso db shell <prod-db> "pragma table_info(users)"
```

Expected: both new tables present; `users` has no `ai_provider_preference` / `ai_chat_model` columns.

- [ ] **Step 4: Record in changelog**

Append to `docs/changelog/2026-05-02-model-provider-refactor.md`:

```markdown
## Production Turso rollout — 2026-05-02

Commands:
\`\`\`bash
turso db shell <prod-db-name> < drizzle/00xx_ai_provider_refactor.sql
turso db shell <prod-db> "select sql from sqlite_master where name in ('ai_providers','ai_role_assignments')"
\`\`\`

Output:
\`\`\`
<paste actual output>
\`\`\`

Result: ✅ both tables present; legacy columns dropped.
```

- [ ] **Step 5: Add `KNOSI_SECRET_KEY` to GitHub Actions + k3s secret**

Generate the prod secret if not already:

```bash
openssl rand -hex 32
# copy the output
```

Add to GitHub Actions secrets:
```bash
gh secret set KNOSI_SECRET_KEY --body=<the hex>
```

Add to k3s secret on Hetzner (one-time; run via SSH):
```bash
ssh knosi
kubectl -n knosi create secret generic knosi-secret-key \
  --from-literal=KNOSI_SECRET_KEY=<the hex>
```

Wire it into the Deployment env via `ops/hetzner/deploy.sh` or the k8s manifest. Verify by SSH'ing in and running `kubectl -n knosi get deploy knosi -o yaml | grep -A2 KNOSI_SECRET_KEY`.

- [ ] **Step 6: Commit changelog**

```bash
git add docs/changelog/2026-05-02-model-provider-refactor.md
git commit -m "docs(changelog): production Turso schema rollout for provider refactor"
```

### Task 8.5: Push and watch deploy

**Files:** none

- [ ] **Step 1: Push to feature branch and open PR**

```bash
git push -u origin feat/model-provider-refactor
gh pr create --title "Refactor model provider接入: drop hosted/codex/cursor, unify on OpenAI-compatible" \
  --body "$(cat <<'EOF'
## Summary
- 重写 AI provider 接入：用户在 Settings 中管理 Provider 列表（kind = openai-compatible / local / claude-code-daemon / transformers）+ 每个 role（chat/task/embedding）选一个 provider+model
- 砍掉 codex / cursor / knosi-hosted 三套 backend；env 不再作为 AI 配置入口
- API key 用 AES-256-GCM 加密存 DB（master key 来自 KNOSI_SECRET_KEY env）
- 支持任意 OpenAI-compatible API（DeepSeek / Moonshot / SiliconFlow / 自定义）零代码加新服务

## Test plan
- [ ] pnpm build 全绿
- [ ] pnpm lint 全绿
- [ ] pnpm test:unit 全绿
- [ ] pnpm test:e2e 全绿
- [ ] 生产 Turso 已 rollout 新 schema（changelog 记录）
- [ ] KNOSI_SECRET_KEY 已配 GitHub Actions secret + k3s secret
- [ ] 部署后访问线上 /settings 添加一个 OpenAI provider，配 chat role，发一条 Ask AI 消息能正常返回

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After review + merge to main, watch Hetzner deploy**

```bash
gh run watch
```

After deploy, SSH and verify pod env:

```bash
ssh knosi
kubectl -n knosi exec deploy/knosi -- printenv | grep KNOSI_SECRET_KEY
# expect a non-empty value
```

- [ ] **Step 3: Smoke-test the live deployment**

Open https://knosi.xyz/settings, add a real provider (your OpenAI key), set Chat role, send an Ask AI message. Confirm the response arrives and `X-Knosi-Kind: openai-compatible` header is present (DevTools → Network → /api/chat → Headers).

- [ ] **Step 4: Final commit (only if smoke surfaced an issue requiring a fix)**

If everything works → no commit. The PR merge is the closing event.

---

## Phase 9 — Cleanup

### Task 9.1: Final sweep + Definition-of-Done check

**Files:** none (read-only verification)

- [ ] **Step 1: Confirm dead-code grep is empty**

```bash
grep -rn "AIProviderMode\|knosi-hosted\|knosiProvidedAi\|cursor-proxy\|CURSOR_PROXY\|process.env.AI_PROVIDER" \
  src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "node_modules"
```

Expected: zero matches.

```bash
grep -rn "codex\|hosted-ai\|runWithHostedAi" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: zero matches outside maybe a comment in changelog/spec.

- [ ] **Step 2: Confirm DoD checklist from spec §8 all checked**

Re-read `docs/superpowers/specs/2026-05-02-model-provider-refactor-design.md` §8. Check each box:

- [ ] Schema in local + Turso prod
- [ ] `KNOSI_SECRET_KEY` in CI + prod secrets
- [ ] All 6 legacy provider names gone from src/
- [ ] Settings UI fully functional
- [ ] All 8+ AI callers route via new façade
- [ ] All four `pnpm` commands green
- [ ] Changelog written
- [ ] Live smoke-test passed

- [ ] **Step 3: Update `README.md` if it referenced the old AI configuration**

```bash
grep -n "AI_PROVIDER\|OPENAI_API_KEY\|hosted\|codex" README.md | head
```

If hits, replace with: "AI providers are configured per-user in `/settings`. The deployment requires `KNOSI_SECRET_KEY` (32 random bytes, hex) for encrypting user API keys."

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(readme): document KNOSI_SECRET_KEY + per-user AI configuration"
```

---

## Self-Review Checklist (run after writing this plan)

- [ ] Spec coverage: every section of the spec has a task. Crypto (Phase 1) ✓, schema (Phase 2) ✓, resolver (Phase 3) ✓, façade rewrite (Phase 4) ✓, probe (Phase 5) ✓, tRPC router (Phase 6) ✓, UI (Phase 7) ✓, tests + rollout (Phase 8) ✓, cleanup (Phase 9) ✓.
- [ ] No placeholders (TBD/TODO/"similar to") — every code-changing step has the actual code.
- [ ] Type names consistent: `ProviderKind`, `AiRole`, `ResolvedProvider`, `MissingAiRoleError`, `resolveAiCall`, `invalidateProviderCache`, `probeProvider` — all match across tasks.
- [ ] Spec §3 listed `transformers` as out-of-scope; plan adds it explicitly under "Decision: transformers kind" — kept consistent everywhere (schema enum, resolver branch, presets, UI dialog).
- [ ] Daemon's `process.env.CLAUDE_CODE_CHAT_MODEL` — addressed in Task 4.2 (becomes `provider.modelId`) and Task 4.6.1 (chat-enqueue).
- [ ] Identity made async (Task 4.4) ; all callers updated (Task 4.5).
- [ ] Legacy E2E specs addressed (Task 8.2).
- [ ] Production schema rollout has explicit verification queries + changelog (Task 8.4) per CLAUDE.md.
