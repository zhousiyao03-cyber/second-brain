# 2026-05-03 — End-to-end agent eval baseline

## Goal

Establish the first repeatable end-to-end Ask AI quality baseline, per spec `docs/superpowers/specs/2026-05-03-agent-eval-system-v1-design.md` (M2).

## Key changes

- **Refactored `streamChatAiSdk`** in `src/server/ai/provider/ai-sdk.ts` to delegate to a new exported `runChatStream` helper (commit `c69f5f5`). Production behavior is byte-identical (verified by existing `streamChatAiSdk` unit tests still passing). The helper is what the eval harness reuses.
- **Added `eval/agent-cases.json`** with 18 hand-annotated end-to-end cases mirroring the 18 RAG queries from M1, with `expected_tool_touched_note_ids` derived by mapping each query's relevant chunks back to their parent note ids.
- **Added `scripts/eval-agent.mjs`** — end-to-end harness that calls `buildChatContext` + `runChatStream` + `buildAskAiTools` exactly like the production `/api/chat` route, consumes `result.textStream` and `result.toolResults` directly, and scores each case on three independent dimensions:
  - `citationScore` — actual ⊇ expected for tool-touched note ids (now also includes notes pre-injected via the user preamble; see "Citation extraction" below)
  - `mentionScore` — case-insensitive substring presence ratio over `must_mention[]`
  - `negativeScore` — binary, 0 if any `must_not_mention` substring leaks
- **First baseline committed to `eval/results/agent/baseline.json`** (Turso prod, user `5dcad5a2-...`, DeepSeek `deepseek-v4-flash` as the chat provider, 18 cases).

## Citation extraction (important nuance discovered during baselining)

Initial design assumed the agent would call `searchKnowledge` / `readNote` tools and the resulting note ids would constitute "citations". In practice, with `deepseek-v4-flash`, the agent **almost never calls tools** — it answers directly from whatever the system preamble pre-injected via the standard `buildChatContext` RAG pass.

If the harness only counted tool-touched note ids, citationScore would be ~0 for the entire eval and tell us nothing useful. So `runOneCase` also greps the user preamble (`<source id="…">` blocks emitted by `buildUserPreamble`) and adds those ids to the touched set. This matches user-perceived correctness: if the right note made it into the prompt, the agent has the right context whether or not it called a tool.

The harness records `preambleNoteIds` separately in the per-case JSON so future runs can disentangle "agent reached for it via tool" vs "RAG pre-fetched it".

## Files touched

- `src/server/ai/provider/ai-sdk.ts` (refactor — Task 4)
- `src/server/ai/provider/ai-sdk.test.ts` (new test for `runChatStream`)
- `eval/agent-cases.json` (new — 18 cases)
- `scripts/eval-agent.mjs` (new — harness with three-dimension scoring + preamble-derived citation extraction)
- `eval/results/agent/baseline.json` (new — first baseline)
- `docs/changelog/2026-05-03-agent-eval-baseline.md` (this file)
- `.gitignore` (allow committing `eval/results/{baseline,agent/baseline}.json`)

## Verification

```
$ pnpm vitest run src/server/ai/provider/ai-sdk.test.ts
  ✓ all streamChatAiSdk tests pass
  ✓ runChatStream returns raw streamText result

$ pnpm build
  ✓ pass

$ pnpm lint
  ✓ pass

$ EVAL_USER_ID=5dcad5a2-... npx tsx --env-file=<merged turso+secret env> \
  scripts/eval-agent.mjs --user 5dcad5a2-... --out eval/results/agent/baseline.json

Aggregate (n=18):
  Pass rate              : 38.9%
  Mean citation score    : 0.491
  Mean mention score     : 0.889 (over non-empty: 0.800, n=18)
  Mean negative score    : 1.000
  p50 latency            : 11777ms
  Runtime errors         : 0/18
```

## Diagnosis from baseline

| Category | Cases | Pass | Citation | Notes |
|---|---|---|---|---|
| recency-recent-days | 4 | 0/4 | 0.00 | All four "我最近干了啥" / "在干啥" / "看到我最近的日子" / Summarize fail. RAG returns ancient diaries. |
| recency-today | 1 | 0/1 | 0.00 | "看看我今天的日记" misses the 5/3 diary. |
| recency-newest | 1 | 0/1 | 0.33 | "最新的笔记" partial — finds some recent but misses the newest 5/3 note. |
| topic-recency | 1 | 0/1 | 0.50 | "RAG 笔记" finds 1/2 hits. |
| global-synthesis | 2 | 0/2 | 0.00 | Open-ended, no specific target — may be partly an annotation problem. |
| topic-deep | 4 | 3/4 | 0.75 | When phrasing is keyword-rich, retrieval works (career planning, openclaw, Knosi). 编程语言 case fails — title has parens, may break tokenizer. |
| topic-algorithm | 2 | 2/2 | 1.00 | 跳表 / 布隆过滤器: clean direct hits. |
| metadata-by-date | 1 | 1/1 | 1.00 | "GitHub 5月1日的热门" passes. |
| metadata-by-month | 1 | 0/1 | 1.00 | "5月有哪些 TODO": citation correct, but answer text doesn't say the literal word "TODO" so mention=0 — annotation may be too strict. |
| negative | 1 | 1/1 | 1.00 (auto) | Floor case. |

**Top signal**: 8 of 9 recency-class queries fail. This is the single highest-leverage bug to fix — it's the user's stated #1 pain and the eval now quantifies the gap (citation 0.00–0.50 across the recency band). Concrete next steps surfaced by this baseline (NOT in this milestone):
1. Add a recency / time-decay term to ranking. `agentic-rag.ts` currently has no `source_updated_at`-based boost.
2. Investigate the 编程语言 (ask-011) tokenizer issue — title contains parentheses and slashes.
3. Tighten ask-017's mention assertion or relax to allow Chinese/English variants.
4. Decide whether DeepSeek's tool-call avoidance is acceptable or whether the system prompt should push harder for tool use.

## Environment

- Node: v22.16.0
- DB: Turso prod (same as M1)
- Chat provider: DeepSeek (`openai-compatible`, `deepseek-v4-flash`)
- Embedding provider: local Transformers.js (`Xenova/multilingual-e5-small`)
- Reranker / vector store: defaults
- `MAX_STEPS`: derived from `maxStepsForKind("openai-compatible") = 6` per Task 4 fix

## Known caveats / limitations

- 18 cases. Movements smaller than ~5% pass-rate are likely noise.
- Substring `must_mention` is blunt: "do NOT use X" still passes a `X` mention assertion. Spot-check failures manually.
- Citations are approximated by union of (a) tool-touched note ids and (b) preamble-injected note ids. The agent may "see" a preamble note and not actually use it; v1 accepts this.
- LLM-as-judge intentionally not in v1.
- DeepSeek occasionally returns transient API errors (`reasoning_content must be passed back`). Currently rare enough to not be a blocker; if it becomes flaky, retry-on-error in the harness.

## Remaining risks / follow-ups

- M3 (A/B comparison framework), M4 (categorization), M5 (workflow integration) deferred.
- Re-evaluate after ~2 weeks of self-use to decide which milestone is highest-leverage next.
- Harness was developed without driving a real PR through `/api/chat` end-to-end at the same time. Production behavior is unchanged after the `runChatStream` refactor (existing test suite passes), but a pre-deploy `pnpm test:e2e -- --grep "ask-ai|chat"` smoke pass is the intended last gate before pushing M2 to main.
