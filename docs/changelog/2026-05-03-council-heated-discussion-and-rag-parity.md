# Council: heated discussion + RAG parity with Ask AI

**Date:** 2026-05-03

## What changed

Council previously deadlocked on chitchat / meta messages: the classifier
was tuned for "polite, non-redundant turn-taking", so when the user sent
short messages like `hi` / `在吗` / `？`, all three personas voted
`shouldSpeak=false` ("no substantive topic") and the orchestrator
immediately yielded `consecutive_no`. The channel looked broken even
though every layer was working as designed.

Two coupled fixes:

### 1. Bias toward speaking + first-turn fan-out

- **`classifier.ts`**: rewrote the prompt. Default is now
  `shouldSpeak=true`. Only stay silent in two narrow cases — you literally
  just spoke and have nothing new, or the topic is far outside your domain.
  Disagreement is welcomed.
- **`orchestrator.ts`**: when the user just sent a message
  (`agentSpoken === 0`), every persona that votes yes speaks in priority
  order before re-classifying. After the fan-out it reverts to the
  original single-step behavior so the hard limit isn't blown in one turn.
  History is reloaded between speakers in the fan-out so each persona
  sees what its peers just said and can rebut them.
- **`persona-stream.ts`**: persona system prompt now explicitly tells the
  model "you are in a heated multi-agent roundtable", asks for clear
  positions over hedging, and adds a rebuttal line targeting the previous
  agent speaker by name.

### 2. RAG parity with Ask AI

Council was using only `retrieveAgenticContext` and a hand-rolled
`Knowledge from your scope:` block. Ask AI also has a keyword-RAG
fallback when agentic returns nothing, plus a numbered cite format the
model can reference inline.

- New helper `src/server/ai/retriever.ts:retrieveWithFallback` runs
  agentic → keyword fallback with shared Langfuse tracing.
- `chat-prepare.ts` (Ask AI) now delegates to it instead of inlining the
  pipeline. Behavior identical; the only difference is the helper extracts
  the chunk-content stripping into a reusable `stripContent` so traces
  stay PII-clean.
- `persona-rag.ts` swapped `retrieveAgenticContext` →
  `retrieveWithFallback`. `enrichWithTags` was updated to consume the
  shared `RetrievedKnowledgeItem` shape.
- `persona-stream.ts` now formats RAG hits with the same numbered
  `[N] Source: …` markers Ask AI uses, and instructs the model to cite
  inline by `[N]` so any future cite-rendering UI works for both surfaces.

### 3. UI copy

`use-council-stream.ts` stop reasons are now in English (project rule:
all user-visible text is English). The `consecutive_no` text was also
rephrased from "💤 暂时没人想接话了" to a hint that nudges the user
toward asking a more specific question.

## Files touched

- `src/server/ai/retriever.ts` (new)
- `src/server/ai/chat-prepare.ts`
- `src/server/council/orchestrator.ts`
- `src/server/council/classifier.ts`
- `src/server/council/persona-rag.ts`
- `src/server/council/persona-stream.ts`
- `src/server/council/__tests__/classifier.test.ts`
- `src/server/council/__tests__/orchestrator.test.ts`
- `src/app/(app)/council/[channelId]/use-council-stream.ts`

## Verification

- `pnpm vitest run src/server/council src/server/ai/chat-prepare` —
  18/18 pass (added 2 new orchestrator tests for first-turn fan-out:
  priority order + hard-limit cap).
- `pnpm build` — compiles clean (11s incremental).
- `pnpm lint` — only pre-existing noise from `.next-e2e/` cache;
  added `retriever.ts` warnings fixed via `stripContent` helper.
- E2E intentionally skipped (per session decision — RAG/orchestrator
  refactor is unit-covered).

## Risk / follow-ups

- Eval not run for this change — RAG behavior for Ask AI is identical
  (helper is a refactor, not a tuning change). Council had no eval
  baseline before this change either; adding one is the right next step.
- Channel-level pinned sources (the third Ask-AI parity feature) is
  deferred — needs a schema change.
- The fan-out can now produce up to 3 agent messages in response to a
  single user message; `hardLimitPerTurn` still caps total per turn at
  the channel-configured value (default 6).
