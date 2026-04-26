# 2026-04-26 — RAG overhaul: tokenizer + embedding provider

## Goal

Ask AI's RAG was returning bad results, especially for recent notes. Two
independent failures stacked:

1. **Tokenizer was a 150-word hardcoded dictionary** — common Chinese queries
   like `"向量库选型"`, `"婴幼儿培养"`, `"推理 训练 范式 演化"` tokenized to `[]`,
   so BM25 had nothing to match.
2. **Gemini embedding free-tier quota was exhausted** — 26 recent notes had
   chunks but no embeddings, permanently `failed/5` in the index queue. The
   1s/2s/4s/8s/16s exponential backoff couldn't outlast a daily quota reset.

Fix both, simultaneously.

## Changes

### Tokenizer (commit `29a6cd3`)

`src/server/ai/tokenizer.ts` — replaced dictionary forward-max-match with:

- `Intl.Segmenter("zh-CN", { granularity: "word" })` (Node-builtin, ICU-backed)
- character bigrams emitted alongside, as a recall safety net for jargon ICU
  doesn't know
- Latin extraction unchanged

`src/server/ai/tokenizer.test.ts` — new tests covering the previously-failing
queries.

Effect: `"向量库选型"` now → `[向量, 量库, 库选, 选型]` instead of `[]`. BM25
recall jumps from near-zero to high coverage on Chinese-heavy queries.

### Embedding provider — Gemini → Transformers.js (Xenova/multilingual-e5-small)

- `src/server/ai/embeddings.ts` — added `transformers` mode using
  `@huggingface/transformers` v4 in-process. Singleton pipeline, e5 prefix
  convention (`passage: ` for documents, `query: ` for queries),
  mean-pooled + L2-normalized. Default mode is now `transformers`; other
  providers (google/openai/local) require explicit `EMBEDDING_PROVIDER=...`.
- `src/server/ai/agentic-rag.ts` — passes `kind: "query"` to `embedTexts`.
- `next.config.ts` — adds `@huggingface/transformers` and `onnxruntime-node`
  to `serverExternalPackages` so Next.js doesn't try to bundle the native
  module.
- `Dockerfile` — switched base from `node:22-alpine` to `node:22-slim`.
  onnxruntime-node ships glibc-only Linux binaries; Alpine/musl would fail
  at runtime. Builder stage pre-downloads the model into `/app/.hf-cache`
  (~120MB), which is COPYed into the runner stage so first request doesn't
  hang for 30s downloading.
- `scripts/reembed-all.mjs` — one-shot migration script: dumps existing
  embeddings as JSON backup, deletes the old `gemini-embedding-001` rows
  (3072-dim, no longer compatible with the new 384-dim vector space),
  re-embeds every chunk with the new model in batches of 32, ordered by
  `source_updated_at DESC` so recent notes light up first.

### Diagnostic scripts (committed for future RAG debugging)

- `scripts/check-recent-notes-status.mjs` — chunks vs embeddings audit
- `scripts/check-note-body.mjs` — dump one note's content for inspection
- `scripts/reindex-orphan-notes.mjs` — re-enqueue notes with content but no chunks

## Verification

- `pnpm test:unit` — 74/74 pass (8 new tokenizer tests)
- `pnpm build` — clean
- `npx eslint src/` — 0 errors
- Local smoke test of `embedTexts(["RAG 系统"], "passage")` vs
  `embedTexts(["RAG 是什么"], "query")` — cosine 0.91, 384-dim, normalized

## Production rollout sequence

1. Push code (this commit) — Hetzner auto-builds new image with model
   pre-cached, rolls deployment.
2. During the gap: prod queries embed with new model (384-dim) but stored
   vectors are still old Gemini (3072-dim). `agentic-rag.ts` filters dim
   mismatches → semantic match returns 0 → falls back to BM25 (with the
   new tokenizer, which is much better than before).
3. Run `node scripts/reembed-all.mjs` from local against prod Turso.
   Expected: ~10-20 minutes for 2669 chunks on local CPU. Idempotent —
   safe to re-run if interrupted.
4. Run `node scripts/check-recent-notes-status.mjs` — all rows should show
   `OK` (chunks == embedded).
5. Browser smoke test in Ask AI: confirm previously-failing queries
   ("新加坡 DA 职业", "向量库选型", recent bagu notes) now surface real
   matches.

## Risks

- **Prod RAM headroom:** Hetzner CX23 has 3.7Gi total, ~1.3Gi free. Loading
  the model adds ~250MB to the Knosi pod. Monitor `kubectl top pod` after
  rollout; if OOMKilled, upgrade to CX31 (8GB).
- **Cold-start delay on first request after rollout:** model loads in ~5s
  from disk cache, not from network — should be acceptable.
- **No automatic rollback:** old Gemini vectors are deleted by reembed-all.
  Backup JSON is written to `tmp/embeddings-backup-*.json` before delete;
  retain it until prod RAG is verified working.
