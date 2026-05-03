# Agent Eval System v1 — Design

**Date**: 2026-05-03
**Status**: Draft (awaiting user review)
**Owner**: zhousiyao03
**Parent initiative**: Production AI Agent Engineering for Knosi (sub-project #1 of N)

---

## Background and motivation

Knosi already runs a non-trivial AI surface in production: Ask AI (RAG + tool-using chat), Drifter, Council, Claude Code Daemon, plus structured AI calls inside Learning notebook / OSS / Portfolio. The author uses Ask AI daily and reports **frowning at the answer almost every day** — wrong answers, fabricated facts, citations to the wrong note, etc.

Two coupled problems are blocking improvement:

1. **No ground truth**: there is no repeatable, mood-independent measure of "is the answer good".
2. **No regression signal**: every prompt / model / RAG-param change is judged by gut feel. After a few iterations the author cannot tell whether the current build is better or worse than last week.

A half-built RAG eval harness exists (`scripts/eval-rag.mjs` + `eval/ground-truth.json` with three unfilled queries), but:
- It has never been run end-to-end (Node 22 requirement, no annotated data).
- It only measures retrieval, not the user-visible answer.
- There is no way to compare two configurations.

The hosted product currently has 12 registered users and 1 active user (the author). This shapes scope heavily: safety, cost governance, multi-tenant observability are **not** the right first investments. The first investment must remove the daily frown.

## Goal

Establish a quality-eval system that turns "is Ask AI good" into a **repeatable number**, decomposed into a retrieval-layer score and an end-to-end answer score. The author should be able to run a single command after any change and see whether quality moved up, down, or sideways, with per-case detail when something regresses.

### Non-goals (v1)

- No observability stack (OTel / tracing UI / Grafana).
- No cost or safety governance.
- No formal prompt registry / prompt management framework.
- No CI integration — manual `pnpm` invocation only.
- No A/B comparison framework — that lands in a future milestone.
- No LLM-as-judge — keyword + citation assertions only.
- No Drifter / Council / Capture coverage — Ask AI only. Other agents come later.

## Scope (v1)

This spec covers two milestones:

- **M1 — RAG retrieval baseline**: get the existing harness running, build a real annotation set, publish a baseline number.
- **M2 — End-to-end agent harness**: a new harness that runs annotated cases through the real Ask AI pipeline and scores them with deterministic assertions.

Three additional milestones are deferred and tracked under "Future scope" at the bottom of this doc:

- M3 — A/B comparison framework (config-driven, `eval:compare`).
- M4 — Category tags + failure case library.
- M5 — Workflow integration (CLAUDE.md update, npm scripts, eval README).

The decision to ship M1+M2 first and re-evaluate after ~2 weeks of self-use is intentional: only after the author has lived with the minimum viable loop will it be clear whether M3 (more comparison machinery) or M4 (better diagnostics) is the higher-leverage next step.

---

## M1 — RAG retrieval baseline

### What ships

1. The existing `scripts/eval-rag.mjs` runs to completion in the local environment.
2. `eval/ground-truth.json` contains 15–20 hand-annotated queries with `relevant_chunk_ids` filled in.
3. A first baseline run is committed to `eval/results/baseline.json`.
4. A short entry in `docs/changelog/` records the baseline numbers and the environment they were measured in.

### Implementation notes

**Node version**: the script's header notes that Node 20 does not support `--experimental-strip-types` and that `agentic-rag.ts` is a TS file. Resolution: require Node 22+ for eval runs. Document this in the eval README (M5) and in the script's error message.

**Annotation flow**: use the existing `--seed-template` mode to print BM25 + ANN candidates per query, then hand-label `relevant_chunk_ids` in the JSON. No tooling change needed.

**Query selection**: 15–20 queries spanning the author's real Ask AI usage. Suggested distribution (rough, not enforced):
- ~6 code / implementation lookups ("how did I implement X")
- ~4 cross-note synthesis ("what do I know about Y")
- ~3 recent-fact recall ("what did I write last week about Z")
- ~3 metadata / tag / folder queries
- ~2 negative cases (queries that should retrieve nothing useful)

**Baseline metrics**: Recall@5, Recall@10, MRR, p50 / p95 latency. The harness already computes these — no change needed.

**Storage**: `eval/results/baseline.json` is committed. Future runs go to timestamped files in the same directory; only the baseline is special.

### Done criteria

- `nvm use 22 && node --experimental-strip-types --env-file=.env.local scripts/eval-rag.mjs --user <id>` returns aggregate numbers without error.
- `eval/ground-truth.json` has ≥15 queries with non-empty `relevant_chunk_ids`.
- `eval/results/baseline.json` exists and is committed.
- Changelog entry `docs/changelog/<YYYY-MM-DD>-rag-eval-baseline.md` records the numbers, the environment, and any caveats.

### Risks

- **Annotation drift**: if the author re-indexes / re-chunks notes, `chunk_id`s change and the annotation set goes stale. v1 accepts this risk; M4 / future work may need a more stable identifier (e.g. note id + section path) but that is over-engineering for now.
- **Small-N noise**: with only 15–20 queries, single-query changes move the aggregate noticeably. This is acceptable for the author's manual workflow; aggregate movements should be interpreted alongside per-query diffs.

---

## M2 — End-to-end agent harness

### What ships

1. New file `eval/agent-cases.json` — annotated end-to-end cases (target: 15–20 in v1).
2. New script `scripts/eval-agent.mjs` — runs each case through the real Ask AI pipeline and produces deterministic scores.
3. New directory `eval/results/agent/` — per-run JSON outputs.
4. A first agent-eval baseline run is committed.
5. Changelog entry recording the baseline.

### Case schema

```json
{
  "id": "ask-001",
  "query": "How did I implement Markdown table paste in the Tiptap editor?",
  "category": "code-recall",
  "expected_citations": ["<note_id_1>", "<note_id_2>"],
  "must_mention": ["MarkdownTablePaste", "handlePaste"],
  "must_not_mention": ["Notion API", "I don't know"],
  "rubric": "Answer must be grounded in cited notes; no fabricated API names."
}
```

Field semantics:

- `expected_citations`: note IDs that the answer's citation list must include (subset relationship: actual ⊇ expected). Extra citations are allowed.
- `must_mention`: substrings (case-insensitive) that must appear somewhere in the final answer text. Each substring is one assertion.
- `must_not_mention`: substrings that must NOT appear. Useful for catching common failure modes ("I don't know", "I cannot find", fabricated APIs).
- `category`: free-form string; not used for scoring in v1, recorded for future M4 grouping.
- `rubric`: human-readable note. Not consumed by the harness; documents the author's intent for the case so future-self knows why a case exists.

### Scoring

Per case, the harness computes three numbers in [0, 1]:

1. **Citation score**: 1 if `actual_citations ⊇ expected_citations`, else `|actual ∩ expected| / |expected|`.
2. **Mention score**: fraction of `must_mention` substrings present in the answer.
3. **Negative score**: 1 if no `must_not_mention` substring appears, else 0 (binary — any leak is a fail).

Aggregate: per case, **case_pass = (citation_score == 1) AND (mention_score == 1) AND (negative_score == 1)**. Output the per-case three numbers plus the boolean pass/fail, and the aggregate pass rate.

The choice to keep three independent scores (rather than a weighted sum) is deliberate: weighted sums hide which dimension regressed.

### Harness architecture

**Entry point**: `scripts/eval-agent.mjs`

**Pipeline reuse**: the harness mirrors what `src/app/api/chat/route.ts` does internally — call `buildChatContext` (from `src/server/ai/chat-prepare.ts`) to assemble system + messages, then run the same `streamText(...)` call that `streamChatAiSdk` uses (`src/server/ai/provider/ai-sdk.ts:53-104`) with `tools = buildAskAiTools(...)` so the agent exercises the real `searchKnowledge` / `readNote` / `fetchUrl` surface.

The harness does **not** call the HTTP endpoint (SSE / daemon claim / Redis fan-out is fragile to test against), and it does **not** consume the production `Response` produced by `result.toUIMessageStreamResponse()` — that response is the Vercel UI Message Stream protocol (text-delta + tool-call + tool-result + step parts) intended for the front-end renderer; reverse-parsing it inside the harness is brittle.

To avoid drift between production and the harness, this milestone refactors the `streamText({...})` call inside `streamChatAiSdk` into a small reusable helper (e.g. `runChatStream(...)`) that returns the raw `streamText` result. Production `streamChatAiSdk` keeps wrapping it with `toUIMessageStreamResponse()` for the UI; the harness consumes `result.textStream` (final text) and `result.toolCalls` / `result.toolResults` (citation extraction inputs) directly. One source of truth, no SSE protocol parsing, no drift.

**LLM call**: the harness uses whatever model the case config specifies (default: the user's currently-configured Ask AI model). It awaits the full response (no streaming consumption — collect the final text and citation list).

**Citation extraction**: the harness needs to identify which note IDs the agent actually used. Two signals are available from the `streamText` result:

1. `toolResults` — every `searchKnowledge` / `readNote` invocation logs the note IDs it touched. The set of note IDs returned by these tool results is a faithful proxy for "the agent saw these notes".
2. The final text body — citations are emitted by the system prompt as a structured trailing block (the prompt is in `src/server/ai/chat-system-prompt.ts`); the harness must read that file to determine the exact format. If the format turns out to be unstable, a small change to `chat-system-prompt.ts` to enforce a parseable citation block is in scope for M2.

V1 scoring uses signal #1 (tool-touched note IDs). Signal #2 is recorded in the per-case JSON for offline review but does not feed scoring. Reasoning: tool-touched IDs are robust to small phrasing changes in the answer; parsing the citation block is a separate cleanup task that should not block the first eval run.

**Output**: `eval/results/agent/run-<ISO-timestamp>.json` containing aggregate + per-case detail, plus a stable `eval/results/agent/baseline.json` symlink or copy for the first run.

**Concurrency**: serial. 15–20 cases × ~5–15s each = a few minutes. Parallelism is a v2 problem.

**Error handling**: a case that throws (timeout, model error, malformed response) is recorded as `pass=false` with a `runtime_error` field. It does NOT halt the run — partial results beat no results.

### Done criteria

- The `node --experimental-strip-types --env-file=.env.local scripts/eval-agent.mjs --user <id>` invocation runs all annotated cases and prints aggregate + per-case results. (The `pnpm eval:agent` shortcut script lands in M5; v1 uses the raw `node` command.)
- `eval/agent-cases.json` has ≥15 cases with all required fields filled in.
- `eval/results/agent/baseline.json` is committed.
- Changelog entry records the baseline pass rate, broken down by score dimension (citation / mention / negative).
- The author can answer "did my last change improve quality?" by running the harness twice and diffing the JSON manually. (M3 will automate the diff; v1 leaves it manual.)

### Risks

- **Citation contract instability**: if Ask AI's prompt or tool format does not produce structured citations consistently, the parser will be brittle. Mitigation: document the parser's expectations in `eval/agent-cases.json`'s `_doc` field; if the contract changes, eval breaks loudly rather than silently misreporting.
- **Model nondeterminism**: even at temperature 0 some providers produce varied output. v1 accepts this; small variance in `mention_score` between runs is expected. If it becomes a problem, set `temperature: 0` and `seed` (provider permitting) in the harness's model call.
- **Substring assertions are blunt**: `must_mention: ["handlePaste"]` will pass even if the answer says "do NOT use handlePaste". v1 accepts this. The author will spot-check failed cases manually; LLM-judge is the right fix and it lands later, not now.
- **Annotation maintenance**: as notes change, `expected_citations` may need updating. v1 ignores this; if it becomes a real burden, M4-era work introduces a mechanism (likely "case skipped if note no longer exists").

---

## File and directory layout (v1)

```
eval/
├── ground-truth.json              # M1 — RAG layer (existing, expanded)
├── agent-cases.json               # M2 — end-to-end (new)
└── results/
    ├── baseline.json              # M1 RAG baseline (committed)
    ├── run-<timestamp>.json       # M1 ad-hoc runs
    └── agent/
        ├── baseline.json          # M2 baseline (committed)
        └── run-<timestamp>.json   # M2 ad-hoc runs
scripts/
├── eval-rag.mjs                   # M1 (existing)
└── eval-agent.mjs                 # M2 (new)
docs/changelog/
└── <YYYY-MM-DD>-rag-eval-baseline.md
└── <YYYY-MM-DD>-agent-eval-baseline.md
```

M1 requires no `src/` changes. M2 makes a single, surgical refactor to `src/server/ai/provider/ai-sdk.ts`: extract the `streamText({...})` call body inside `streamChatAiSdk` into a small helper so production and the harness share a single source of truth for model invocation. Production behavior must be byte-identical after the refactor — verified by running `pnpm build`, `pnpm lint`, and the existing `src/server/ai/provider/ai-sdk.test.ts` plus an end-to-end `pnpm test:e2e` chat flow.

## Verification plan

Per project convention (CLAUDE.md → AGENTS.md), each milestone's "done" requires `pnpm build` + `pnpm lint` + (where applicable) `pnpm test:e2e` to pass. For this eval work:

- **M1**: build + lint must pass (no `src/` changes expected). The harness run itself is the functional verification.
- **M2**: build + lint must pass. If the citation parser requires touching `chat-system-prompt.ts`, the existing `chat-system-prompt.test.ts` plus a fresh agent-eval run together serve as functional verification. No new e2e is required — the harness IS the integration test.

Each milestone gets its own `docs/changelog/` entry per project rule, and a commit on the same day per project rule.

---

## Future scope (deferred from v1)

Recorded here so the next planning cycle has continuity. **None of these are in scope for v1**.

### M3 — A/B comparison framework (3–4 days estimated)

`pnpm eval:compare --baseline <path> --experiment <path> --suite agent` — runs both configs, prints per-case delta with regression highlighting. Config files are import-path + parameter overrides only; no prompt template engine. Decision principle: the highlighted regressions matter more than the aggregate delta.

### M4 — Category tags + failure case library (2–3 days estimated)

Use the `category` field already present in M2 cases to produce per-category aggregates ("you regressed on `cross-note-synthesis` but improved on `code-recall`"). Add `eval/failures/` directory: every failed case is dumped with full trace (query, retrieved chunks, raw answer, failure reason) for offline review. No automatic clustering; manual category tagging is fine at this scale.

### M5 — Workflow integration (1–2 days estimated)

- Add `pnpm eval:rag`, `pnpm eval:agent`, `pnpm eval:compare` scripts.
- Update `CLAUDE.md` / `AGENTS.md` to require `pnpm eval:agent` after Ask AI / agent-pipeline changes, with results pasted into the changelog entry.
- Add `docs/eval/README.md` covering: how to run, how to add a case, how to add a category, how to interpret regressions.
- Explicitly **not** wiring this into GitHub Actions — eval consumes LLM tokens and the author's push frequency does not justify the cost.

### Re-evaluation gate

After ~2 weeks of M1+M2 self-use, the author re-runs the brainstorming flow to decide:

- Has using the eval system surfaced a clear next bottleneck (more cases? cross-version comparison? per-category drilldown)?
- Has the author actually run the harness, or did the manual workflow get skipped? If skipped, M5 (workflow integration) is the right next step regardless.
- Are there other agents (Drifter, Council, structured AI calls) that have moved up the pain ranking and warrant their own eval surface?

---

## Out of scope for the entire "Production AI Agent Engineering" initiative (v1)

For clarity, the larger initiative explicitly defers the following. They are real production concerns but the user-base size (12 registered, 1 active) means investing in them now is premature:

- Observability and tracing.
- Cost governance and per-user budgets.
- Safety, prompt-injection defense, abuse mitigation.
- Multi-tenant fairness / quota enforcement.
- Provider failover beyond what already exists in `src/server/ai/provider/`.

These get their own sub-project specs when the user base or threat surface warrants it.
