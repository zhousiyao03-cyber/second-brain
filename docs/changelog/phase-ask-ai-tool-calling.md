# Phase: Ask AI Tool-Calling Agent

Date: 2026-04-30
Status: Implementation complete, awaiting one-week observation

## 1. Goal

Upgrade Ask AI from a single-turn RAG to a multi-step tool-calling agent
backed by the Vercel AI SDK v6 tool loop. Three tools wired up:

- `searchKnowledge(query, scope?, topK?)` — re-runs hybrid retrieval
  (`retrieveAgenticContext`)
- `readNote(noteId)` — reads the full body of a user's note (with
  user-isolation enforced in the WHERE clause)
- `fetchUrl(url)` — extracts readable text from a public URL via the
  existing SSRF-safe pipeline; per-conversation budget of 3 distinct URLs

Spec: `docs/specs/2026-04-30-ask-ai-tool-calling-design.md`.

## 2. Files added

```
src/server/ai/tools/
  index.ts                    -- buildAskAiTools(ctx) factory + re-exports
  context.ts                  -- AskAiToolContext type
  fetch-url-budget.ts         -- per-conversation URL budget Map
  search-knowledge.ts         -- searchKnowledge tool factory
  read-note.ts                -- readNote tool factory
  fetch-url.ts                -- fetchUrl tool factory
  search-knowledge.test.ts    -- vitest
  read-note.test.ts           -- vitest
  fetch-url.test.ts           -- vitest
  fetch-url-budget.test.ts    -- vitest
src/server/ai/legacy-stream-adapter.ts
                              -- wraps text/plain Response → UI message stream
src/components/ask/chat-message-parts.tsx
                              -- renders parts[] with text/tool/fetchUrl badges
src/components/ask/api-key-prompt.tsx
                              -- stub for Phase 2 BYO key flow
e2e/ask-ai-tools.spec.ts      -- end-to-end tool-rendering coverage
```

## 3. Files modified

- `src/server/ai/provider/types.ts` — added `tools?` and `maxSteps?` to
  `StreamChatOptions` plus `maxStepsByMode(mode)` helper (openai=6,
  local=3, codex/daemon=1)
- `src/server/ai/provider/ai-sdk.ts` — `streamChatAiSdk` now passes
  through `tools` + `stopWhen: stepCountIs(maxSteps)` when caller opted
  in, and switches to `toUIMessageStreamResponse()` so the front-end
  can render tool parts. `functionId` becomes `ask-ai-agent` when tools
  are attached so Langfuse can compare loops vs single-turn separately.
- `src/server/ai/provider/index.ts` — silently strips `tools` /
  `maxSteps` before forwarding to codex / hosted-pool branches (single-
  turn paths)
- `src/app/api/chat/route.ts` — dispatch on provider mode: AI-SDK
  surfaces (openai + local) get a fresh `AskAiToolContext` per request
  (`urlBudget` is keyed by `chatInputSchema.id`, falls back to a
  uuid), tool-system prompt preamble is appended, and the response
  flows through unchanged. Codex / daemon / hosted run unchanged but go
  through `adaptTextStreamToUiMessageStream` so the front-end transport
  stays uniform.
- `src/components/ask/ask-page-client.tsx` /
  `src/components/ask/floating-ask-ai-dock.tsx` /
  `src/components/editor/inline-ask-ai-popover.tsx` —
  `TextStreamChatTransport` → `DefaultChatTransport`. The two ask
  surfaces (full page + floating dock) now render messages via
  `<ChatMessageParts>` so tool-step badges appear in-flow. The inline
  popover still uses the concatenated text path because it always sends
  `sourceScope: "direct"` which skips RAG and tools.

## 4. Behavioral matrix after this phase

| AI_PROVIDER mode    | Tools active? | Response shape                               |
|---------------------|---------------|----------------------------------------------|
| `openai`            | yes (≤6 steps)| UI message stream (text + tool-* parts)      |
| `local`             | yes (≤3 steps)| UI message stream                            |
| `codex` (incl pool) | no            | UI message stream via `adaptTextStreamToUiMessageStream` |
| `claude-code-daemon`| no (route falls through to daemon enqueue branch) | unchanged JSON `{taskId, mode}` |

Spec §5.3 / §5.5: no kill-switch env var. Rollback path is `git revert`.

## 5. AI SDK v6 API verified

- `tool({...})` exists from `ai` (re-exported from `@ai-sdk/provider-utils`)
- `stepCountIs(N)` exists; passed to `streamText({ stopWhen: ... })`
- `streamText().toUIMessageStreamResponse()` exists on the result and
  returns a `Response` with header `x-vercel-ai-ui-message-stream: v1`
- `DefaultChatTransport` is exported from `ai` (NOT from `@ai-sdk/react`)
- `createUIMessageStreamResponse({ stream })` is the helper used by the
  legacy adapter — it does the JSON→SSE framing
- `tool execute(input, options)` — `options.toolCallId`, `options.messages`
  exist (no `abortSignal` in v6 — see "deviations" below)

These match spec assumptions; no API rewrites were needed.

## 6. Deviations from spec

1. **`retrieveAgenticContext` signal**: spec §4.1 mentioned passing
   `signal: abortSignal` into the retrieval call. The current function
   signature is `retrieveAgenticContext(query, options)` and `options`
   does not include a `signal`. Per spec §5.7 we did not refactor it
   (YAGNI — the call runs against in-memory caches and is fast). Tool
   abort still propagates via `streamText`'s pipeline teardown.
2. **`extractReadableContent`**: spec §5.7 mentioned needing to expose a
   readable-text extraction helper. We use the existing `fetchContent`
   in `src/server/ai/fetch-content.ts`, which already does Readability
   + fallback HTML stripping with a 10s timeout and 8000-char cap.
3. **System prompt assembly**: instead of injecting the tool-usage
   guide via `buildSystemPromptStable`, we append it in `route.ts` only
   when tools are actually attached. This keeps the existing system
   prompt callers (daemon, structured-data) untouched.

## 7. Verification results

- `pnpm build` — PASS (TypeScript compile + Next.js production build,
  9.2s TS, no new errors)
- `pnpm lint` — Same 25 pre-existing problems as on `main`. None of
  them are in code touched by this phase. Confirmed by stash + re-lint.
- `pnpm test:unit src/server/ai/tools/` — 4 files, 15 tests, all pass
- Full `pnpm test:unit` — 1 pre-existing failure in
  `src/server/ai/safe-fetch.test.ts` (DNS lookup of `[::1]` fails in
  this sandbox; not phase-related). All other 171 tests pass.
- `pnpm test:e2e --grep "Ask AI tool-calling"` — 2 / 2 pass
  (the new `e2e/ask-ai-tools.spec.ts` covers both the multi-step
  tool-rendering path and the legacy adapter path)
- Full `pnpm test:e2e` — many pre-existing failures unrelated to this
  phase. The two phase-4 / v1-core-paths Ask AI tests have stale
  Chinese-UI assertions (the actual UI is in English now); the
  ask-ai-editor-inline / ask-ai-mention specs fail on note-creation
  navigation in this environment, before reaching any chat assertion.
  These were already broken on `main`. None of them regressed because
  of this phase.

## 8. Known issues / follow-ups

- **`<ApiKeyPrompt>` is a stub** (spec §5.4). MVP relies on the global
  `OPENAI_API_KEY`. Activating per-user BYO key requires a schema
  change + settings UI — Phase 2.
- **fetchUrl budget is in-process**: a server restart resets all
  budgets (acceptable on single-instance Next.js deployments). Spec
  §5.2.
- **Pre-existing e2e suite is partially broken on `main`**: stale
  Chinese-UI assertions in `phase4.spec.ts` / `v1-core-paths.spec.ts`,
  and a note-creation flake in editor specs. Out of scope for this
  phase but worth a sweep.
- **Inline Ask AI rewrite popover** (sourceScope=direct) does NOT
  currently render tool badges. By design — that surface is for short
  rewrites, not multi-step research. If we ever change the inline
  flow to allow knowledge-base searches, we'd swap in `<ChatMessageParts>`
  there too.
- **One week of Langfuse observation** (spec §10): watch
  `functionId="ask-ai-agent"` step counts / cost / first-token latency
  vs the legacy `functionId="chat"` line. Decide on tuning or rollback
  by 2026-05-07.

## 9. Manual verification checklist (per spec §7.4)

To run after this lands and `OPENAI_API_KEY` is set:

- [ ] "对比我笔记里关于 RAG 的不同观点" → multi-step badges visible,
      final answer cites concrete notes
- [ ] "抓 https://example.com + 结合我的笔记给摘要" → red `fetchUrl`
      badge with full URL appears, content folded into answer
- [ ] Simple query "我笔记里有没有关于 X 的内容" → single step,
      no wasted tool calls
- [ ] Misspelled / nonsense query → graceful recovery via tool error
- [ ] Try to fetch 5 URLs → 4th and 5th rejected by budget
