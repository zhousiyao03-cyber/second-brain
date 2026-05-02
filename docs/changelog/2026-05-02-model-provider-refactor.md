# Model Provider Refactor — 2026-05-02

Replaced the 6-provider AI routing (local/openai/codex/cursor/claude-code-daemon/knosi-hosted) with a user-managed Provider table + Role table.

## Status

Implementation complete on `feat/model-provider-refactor`. Pending: production Turso rollout + GitHub/k3s secret wiring (this changelog has the runbook).

## Spec / Plan

- Spec: `docs/superpowers/specs/2026-05-02-model-provider-refactor-design.md`
- Plan: `docs/superpowers/plans/2026-05-02-model-provider-refactor.md`

## What changed

### Data model

Two new tables (drizzle migrations `0045_rare_nightmare` + `0046_far_madame_masque`):

- `ai_providers (id, user_id, kind, label, base_url, api_key_enc, created_at, updated_at)` — user-managed backend instances. `kind ∈ { openai-compatible, local, claude-code-daemon, transformers }`. Multiple rows per user allowed.
- `ai_role_assignments (user_id, role, provider_id, model_id, updated_at)` — per-user (chat | task | embedding) → (provider, model). Composite PK on (user_id, role). Provider FK is `on delete restrict` so the UI must reassign before delete.

Dropped from `users`: `ai_provider_preference`, `ai_chat_model`.

### Crypto

- `src/server/ai/crypto.ts` — AES-256-GCM with a master key from `KNOSI_SECRET_KEY` env (32 random bytes hex or base64). Per-row 12-byte IV. Output is `base64(iv || ciphertext || authTag)`. Module-init validates the env var and aborts startup if missing/short.
- API keys are encrypted before insert and never returned to the client (only `hasApiKey: boolean`).

### Routing core

- `src/server/ai/provider/resolve.ts` — `resolveAiCall(role, userId): Promise<ResolvedProvider>`. Joins assignments + providers, decrypts the key, returns a discriminated union narrowed on `kind`. Per-user 30s TTL cache (one entry per user, multi-role inside). `invalidateProviderCache(userId)` is called from every settings mutation.
- `src/server/ai/provider/types.ts` — `ProviderKind`, `AiRole`, `ResolvedProvider`, `MissingAiRoleError`, `maxStepsForKind(kind)`.
- `src/server/ai/provider/probe.ts` — `probeProvider({ kind, ... })`: `GET /v1/models` for HTTP kinds with 8s timeout, smoke checks for daemon/transformers. Used for both the Test button and the per-provider model list.
- `src/server/ai/provider/presets.ts` — static OpenAI-compatible preset list (OpenAI / DeepSeek / Moonshot / SiliconFlow / Groq) + per-kind default model lists. Adding a new service = add one row here.

### Façade

`src/server/ai/provider/index.ts` rewritten. Public entries:

- `streamChatResponse(options, { userId, role: "chat" | "task" })` — kind-aware dispatch; rejects daemon (chat route handles enqueue separately) and transformers.
- `generateStructuredData(options, { userId, role })` — routes to ai-sdk for HTTP kinds, daemon implementation otherwise.
- `streamPlainTextAiSdk(options, { userId, role })` — used by Council; rejects non-HTTP kinds with a fixed message.
- `getChatAssistantIdentity(userId)` / `getAISetupHint(userId)` — async, reflects the user's actual chat assignment (the old "lying about model" footnote is gone).
- `MissingAiRoleError` exported so the chat route can return 412 `MISSING_AI_ROLE`.

### Caller migration

All eight `generateStructuredData` callers thread `{ userId, role }` (most already had userId; only `focus.ts` needed signature tightening from `userId?: string | null` → `userId: string`):

| Caller | Role |
|---|---|
| `app/api/chat/route.ts` (HTTP path) | chat |
| `app/api/summarize/route.ts` | task |
| `app/api/explore/route.ts` | task |
| `app/api/generate-lesson/route.ts` | task |
| `routers/portfolio.ts` (news + analyze) | task |
| `routers/learning-notebook.ts` (review + ask) | task |
| `council/persona-stream.ts` | chat |
| `council/classifier.ts` | task |
| `ai/focus.ts` (3 sites) | task |
| `ai/drifter.ts` (2 sites) | chat |

`embedTexts(texts, { userId, kind? })` — routes via `resolveAiCall("embedding", userId)`. `transformers` kind kept (zero-config Xenova/multilingual-e5-small default). `MissingAiRoleError` → null for graceful keyword-only fallback. Callers in `indexer.ts` and `agentic-rag.ts` plumb `userId`.

### tRPC

New router `routers/ai-settings.ts` exposes:

- `listProviders` (no plaintext keys), `addProvider`, `updateProvider`, `deleteProvider` (PRECONDITION_FAILED if a role refs it), `testProvider`, `listProviderModels`
- `getRoleAssignments`, `setRoleAssignment` (kind-validated: no daemon embedding, no transformers chat/task)

Removed from `routers/billing.ts`: `setAiProviderPreference`, `getAiProviderPreference`, `getAiChatModel`, `setAiChatModel` (all backed by dropped columns).

### UI

`src/app/(app)/settings/providers/`:

- `provider-edit-dialog.tsx` — kind-aware Add/Edit form. OpenAI-compatible has a Preset dropdown that prefills base URL.
- `provider-card.tsx` — Test / Edit / Delete inline.
- `providers-section.tsx` — list + empty state + Add button.
- `role-row.tsx` — per-role provider+model picker. Eligible providers filtered per role. Model list = static presets ∪ live `/v1/models` ∪ Custom… text input. Refresh button re-fetches the live list.
- `roles-section.tsx` — three rows for chat / task / embedding.

`src/components/ask/missing-role-banner.tsx` — yellow banner above the Ask AI input when the chat role is unassigned, deep-linking to /settings.

### Deletions

- `src/server/ai/provider/codex.ts` — entire codex backend
- `src/server/ai/provider/mode.ts` + its test — env-driven mode resolver
- `src/server/billing/ai-providers/hosted.ts` (+ test) — Codex pool routing
- `src/app/(app)/settings/ai-provider-section.tsx` — old radio-list provider picker
- `src/app/(app)/settings/model-picker.tsx` — old model picker
- `e2e/per-user-provider.spec.ts` — covered the removed 6-mode preference flow

`src/server/ai/daemon-mode.ts::shouldUseDaemonForChat()` is now a permanent `false` shim (deprecated; chat route resolves daemon kind per-user via `resolveAiCall`). `daemon-banner.tsx` is a placeholder rendering `null` until Phase 7 follow-up reinstates it on the new role assignment.

### Env scrub

All AI-routing env reads removed: `AI_PROVIDER`, `KNOSI_HOSTED_MODE`, `KNOSI_CODEX_ACCOUNT_POOL`, `OPENAI_API_KEY` (as routing key — embeddings and provider construction now read from DB), `OPENAI_BASE_URL` / `OPENAI_ORGANIZATION` / `OPENAI_PROJECT`, `OPENAI_*_MODEL`, `CURSOR_*`, `LOCAL_AI_*`, `AI_BASE_URL` / `AI_API_KEY` / `AI_*_MODEL`, `CODEX_*`, `OPENCLAW_*`, `EMBEDDING_PROVIDER`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_EMBEDDING_MODEL`, `EMBEDDING_MODEL`, `TRANSFORMERS_EMBEDDING_MODEL`, `CLAUDE_CODE_CHAT_MODEL`.

Kept: `KNOSI_SECRET_KEY` (encryption master key).

## Verification

- `pnpm build` — green (commit `d7dbcc6` and after)
- `pnpm test:unit` — 211 passed, 1 skipped, 1 pre-existing failure (`safe-fetch.test.ts` — IPv6 SSRF block unrelated to this refactor)
- New tests added: `crypto.test.ts` (4 + 1 skip), `resolve.test.ts` (7), `probe.test.ts` (5), `ai-sdk.test.ts` (rewritten, 2)
- `pnpm test:e2e` — pending (run as part of Phase 8.5 after deploy)

## Production rollout runbook

### 1. KNOSI_SECRET_KEY (one-time)

```bash
# Generate the prod key (write it down once — losing it requires re-entering all stored API keys):
openssl rand -hex 32

# GitHub Actions:
gh secret set KNOSI_SECRET_KEY --body=<the hex>

# Hetzner k3s:
ssh knosi
kubectl -n knosi create secret generic knosi-secret-key \
  --from-literal=KNOSI_SECRET_KEY=<the hex>
```

Wire the secret into the deployment env in `ops/hetzner/deploy.sh` or the k8s manifest. Verify after rollout:

```bash
kubectl -n knosi exec deploy/knosi -- printenv | grep KNOSI_SECRET_KEY
```

### 2. Turso schema rollout — DONE 2026-05-02

Applied both migrations directly via the libsql HTTP API (no `turso` CLI on this machine). Pre-state had legacy `users.ai_provider_preference` + `users.ai_chat_model` and no new tables. Post-state verified:

```
=== post-rollout verification ===

CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`base_url` text,
	`api_key_enc` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
)

CREATE TABLE `ai_role_assignments` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_providers`(`id`) ON UPDATE no action ON DELETE restrict
)

users columns: id, name, email, email_verified, image, created_at
  legacy ai_provider_preference: GONE ✓
  legacy ai_chat_model: GONE ✓
```

### 3. Deploy — DONE 2026-05-02

PR #4 squash-merged to main as `d54a303` triggered `deploy-hetzner.yml`. **First attempt failed** because `crypto.ts` validated `KNOSI_SECRET_KEY` at module-import time, which broke Docker's `pnpm build` step ("Collecting page data" imports every route module). Fixed in `9d5a3c0` by switching to lazy initialization — the master key is loaded on the first `encrypt`/`decrypt` call instead of at import. Build doesn't encrypt anything, so no key needed during build; runtime still fails fast on the first AI request if it's missing. Second deploy attempt succeeded.

Verified `https://www.knosi.xyz/login` → HTTP 200. User-facing smoke test (add provider, set chat role, send Ask AI message) is on the user once they sign in.

### 4. Post-deploy follow-ups

- `scripts/billing/check-prod-schema.mjs:13` still references the dropped `ai_provider_preference` column. Update or delete this script.
- Phase 7 cleanup: re-enable `daemon-banner.tsx` reading from the new chat-role assignment instead of returning `null`.
