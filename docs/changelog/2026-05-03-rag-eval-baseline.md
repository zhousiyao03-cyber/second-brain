# 2026-05-03 — RAG eval baseline

## Goal

Establish the first repeatable RAG-retrieval quality baseline for Knosi Ask AI, per spec `docs/superpowers/specs/2026-05-03-agent-eval-system-v1-design.md` (M1).

## Key changes

- Expanded `eval/ground-truth.json` from 3 unfilled placeholder queries to **18 hand-annotated queries** drawn from the user's real chat_tasks history (Apr 9–May 1 2026, 127 sessions).
- Distribution intentionally skews to recency queries: the user's dominant real-world failure mode is asking "what did I do recently / today" but the retriever returns very old chunks. 9 of 18 queries (q-001…q-009) are recency variants; the user asked these phrasings 30+ times in real sessions.
- Other queries cover global synthesis ("评价一下我"), deep topic recall (RAG / 编程语言 / openclaw vs hermes / Knosi project / algorithm 八股), date-metadata ("GitHub 5月1日的热门"), and one negative case.
- `relevant_chunk_ids` were labeled by inspecting the user's actual notes on Turso prod (`knowledge_chunks` table) on 2026-05-03.
- Ran `scripts/eval-rag.mjs` against Turso prod (user `5dcad5a2-...`, 92 notes / 4619 chunks) and committed results to `eval/results/baseline.json`.

## Files touched

- `eval/ground-truth.json` (expanded from 3 placeholder queries to 18 annotated queries)
- `eval/results/baseline.json` (new)
- `docs/changelog/2026-05-03-rag-eval-baseline.md` (new)
- `scripts/_extract-real-queries.mjs` (new — one-off helper used to mine real queries from chat_tasks)
- `scripts/_turso-query.mjs` (new — one-off helper used to query Turso prod)

## Verification

```
$ EVAL_USER_ID=5dcad5a2-1d20-43df-818c-d640958ddb8a npx tsx --env-file=.env.turso-prod.local scripts/eval-rag.mjs --user 5dcad5a2-1d20-43df-818c-d640958ddb8a --top-k 16 --out eval/results/baseline.json

[skip] q-018 没有 relevant_chunk_ids 标注 (negative case, intentional)

ID       Query                          Recall@5  Recall@10  MRR     Latency
-------- ------------------------------ --------  ---------  ------  -------
q-001    我最近干了啥                            0.000      0.000   0.000  10544ms
q-002    Summarize my recent notes         0.000      0.000   0.000    944ms
q-003    看看我今天的日记写的啥                       0.000      0.000   0.000   1048ms
q-004    看看我是什么样的人                         0.000      0.000   0.000    979ms
q-005    评价一下我                             0.000      0.000   0.000   1230ms
q-006    我最近在干啥                            0.000      0.000   0.000   1060ms
q-007    看到我最近的日子                          0.000      0.000   0.000   1120ms
q-008    最新的笔记                             0.000      0.000   0.000    965ms
q-009    我最近写过什么关于 RAG 的笔记                 0.000      0.000   0.000   1070ms
q-010    规划一下我的职业发展                        0.750      0.750   1.000   1070ms
q-011    对比一下主流编程语言                        0.000      0.000   0.000   1068ms
q-012    openclaw 和 hermes agent 的架构区别     0.500      1.000   0.250    968ms
q-013    Knosi 项目的整体架构                     0.000      0.000   0.000   1020ms
q-014    Redis ZSet 为什么用跳表                 0.000      0.000   0.077   1064ms
q-015    布隆过滤器误判率怎么算                       0.000      0.500   0.100   1062ms
q-016    GitHub 5月1日的热门项目                  0.000      0.000   0.071   1059ms
q-017    5月有哪些 TODO                        0.000      0.000   0.000   1090ms

Aggregate (n=17, q-018 negative case skipped):
  Recall@5     : 0.074
  Recall@10    : 0.132
  MRR          : 0.088
  p50 latency  : 1062ms
  p95 latency  : 10544ms
```

## Diagnosis from baseline

This is the **first time the user's "RAG returns ancient chunks for recent queries" intuition is quantified**:

- **Recency-class queries (q-001..q-009): 0.000 across the board.** All nine recency variants — covering "我最近干了啥", "Summarize my recent notes", "看看我今天的日记", "最新的笔记", etc. — fail completely. The retriever has no notion of "recent" baked into ranking.
- **Topic-deep queries are mediocre but real-positive:** q-010 (职业, 0.75), q-012 (openclaw, 1.0), q-015 (布隆过滤器, 0.5 @ recall@10). When the query phrasing is keyword-rich, retrieval works.
- **Single-doc queries with strong title signal still fail:** q-013 ("Knosi 项目的整体架构" → "Knosi 项目完整讲稿") and q-017 ("5月有哪些 TODO" → "5月份 TODO") both score 0. Title BM25 boost is not enough; query rephrasing is breaking the match.
- **q-001 latency 10544ms** (vs ~1s for everything else): first call cold-warmed the MiniSearch index for this user — subsequent calls reuse the cache. p95 number reflects cold-start, not steady-state.

Concrete next steps surfaced by this baseline (NOT in this milestone):
1. Add a recency / decay term to ranking. Currently `agentic-rag.ts` has no `source_updated_at`-based boost.
2. Investigate why title-direct hits fail (q-013, q-017). Tokenizer? Boost weights? Chunk-0 vs full-doc indexing?
3. Add a "today" / "recent" intent classifier or a date-aware retrieval path.

## Environment

- Node: v22.16.0
- DB: Turso prod (`libsql://database-bisque-ladder-vercel-icfg-tnw2bxcy86redrmrihvdkdl7.aws-us-east-1.turso.io`)
- Index size: 4619 chunks (92 notes), user `5dcad5a2-1d20-43df-818c-d640958ddb8a`
- Reranker / vector store: defaults from `.env.turso-prod.local` (no overrides)
- HNSW EF: default (no `--ef`)

## Known caveats

- Annotation set is 18 queries. With small N each query moves the aggregate by ~6%; movements smaller than ~10% may be noise.
- `chunk_id`s are not stable under re-chunking. If chunking parameters change, the labels go stale and need a fresh `--seed-template` pass plus relabeling.
- Recency queries (q-001..q-009) are weighted heavier than spec § "Suggested distribution" recommended. Reason: the spec's distribution was a generic best-practice guess; the actual user's most-frequent query class is recency, so the eval set follows the data.
- q-018 (negative case) has empty `relevant_chunk_ids` and is skipped by the harness — intentional documentation that this kind of case exists.

## Remaining risks / follow-ups

- M2 (end-to-end agent harness) is the next milestone in this spec.
- M3–M5 are deferred per the spec; revisit after ~2 weeks of self-use.
- Once retrieval improvements land, this baseline JSON is the comparison anchor — diff future runs against it before considering changes shipped.
