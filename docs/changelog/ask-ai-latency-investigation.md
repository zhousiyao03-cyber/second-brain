# Ask AI Latency Investigation

**Date:** 2026-04-27

## Summary

Ask AI 在生产上明显变慢(每次回车要等 9-10 秒才看到反应)。这次调查在 Ask
AI 请求路径上加了 env-gated 的 timing instrumentation,在生产实测出瓶颈,然后做了
两步修复:

1. **MiniSearch 索引每次请求重建** → 改成按 `(userId, scope)` 进程内缓存
2. **缓存被 indexer 后台 retry 持续失效** → 指纹换成 `count + max(source_updated_at)`

修完之后 cache hit 路径从 9.5s 降到 0.7s(约 13× 加速)。
**libonnxruntime 缺失**导致语义检索全军覆没的根因没有在这次修,留给 Dockerfile
工作流处理。

## Investigation Path

### Phase 1 — Add timing

新文件 `src/server/ai/ask-timing.ts`:env-gated(`ASK_TIMING=1`)单行 timing
helper,默认完全 no-op。在四个关键位置打点:

- `/api/chat` route(auth / parse / enqueue)
- `chat-prepare.ts buildChatContext`(stream 模式路径)
- `chat-enqueue.ts enqueueChatTask`(daemon 模式路径)
- `agentic-rag.ts retrieveAgenticContext`(六段:ensureSeed / loadIndex /
  bm25 / embed / milvus / fuseExpand)

每段输出一行,前缀 `[ask-timing]`,带 cache=hit|miss、chunks、scope 等 extras。

### Phase 2 — Capture baseline

在 Hetzner 生产上打开 ASK_TIMING=1,跑一次真实 ask,抓到的 baseline:

```
[ask-timing] agentic-rag ensureSeed=119ms selectChunks=1329ms buildIndex=7755ms
            bm25=23ms embed=1ms milvus=0ms fuseExpand=7ms total=9234ms
            chunks=3462 bm25Hits=18 semHits=0 results=16
[ask-timing] enqueue   rag=9243ms dbInsert=134ms notify=2ms total=9379ms
[ask-timing] /api/chat auth=120ms parse=6ms enqueue=9386ms total=9512ms (daemon)
```

发现:
- **MiniSearch 索引重建占 80% 时间(7.8s)**——每次 ask 都把全部 3462 个 chunks
  重新分词建倒排再扔掉。
- **Turso `SELECT *` 跨大陆 1.3s**(欧洲机房 → libsql 远程)。
- **Transformers.js embedding 直接 fail-fast**——`libonnxruntime.so.1: cannot
  open shared object file`。Node ESM import 缓存 + embeddings.ts 自己的
  `transformersPipelinePromise` 双层缓存了 rejected promise,所以是 1ms,
  不是 fail slow。
- **Milvus 0 命中**——因为 query embedding 失败,直接跳过。Milvus 切换实际
  上没有在 ask 路径上生效。

### Phase 3 — Fix: cache the index

`src/server/ai/agentic-rag.ts` 加了 `getOrBuildIndex(userId, scope)`:

- 进程内 Map(容量 32)按 `userId:scope` 存 `{ scopedChunks, miniSearch,
  chunkMap }`。
- 每次 ask 先 `SELECT count(*), max(updated_at)` 拿指纹,跟缓存里的对比,
  匹配就直接复用,不匹配才重新拉全表 + 建索引。
- LRU:Map 插入顺序 + 命中时 delete-set 把 entry 推到末尾。

实测对比:

| | Baseline | Cache miss | Cache hit |
|---|---|---|---|
| `/api/chat` total | 9512ms | 10629ms | **730ms** |
| `agentic-rag` total | 9234ms | 10223ms | 357ms |
| index load | 9084ms (selectChunks+buildIndex) | 10068ms | **216ms** |

### Phase 4 — Fix: stable fingerprint

第三次 ask 又 miss 了,chunks 从 4038 涨到 4091——说明 indexer 在背景一直
retry embedding job(因为 libonnxruntime 缺失),每次 retry 都把 chunk
delete + insert,`chunks.updated_at` 被刷新,fingerprint 变,cache 失效。

把指纹改成 `count + max(source_updated_at)`。`source_updated_at` 是从 source
笔记/书签的 `updated_at` 抄过来的,indexer 重新写 chunks 时(只要 source 本身
没变)源时间戳不变,fingerprint 稳定,cache 命中。

各种 mutation 仍然能正确触发失效:
- 删 chunk → count 变
- 新 source → count 和 max 都变
- source 编辑 → indexer 把新 updated_at 抄进 source_updated_at,max 变
- indexer retry on unchanged source → source_updated_at 不变,**这就是要跳过的情况**

## Files Touched

- `src/server/ai/ask-timing.ts` — 新增,env-gated timing helper
- `src/server/ai/agentic-rag.ts` — 加 cache + 改指纹
- `src/server/ai/chat-prepare.ts` — 加 timing 打点
- `src/server/ai/chat-enqueue.ts` — 加 timing 打点
- `src/app/api/chat/route.ts` — 加 timing 打点

提交三笔:
- `426ab7b feat(ask-ai): env-gated latency instrumentation`
- `e82ec20 perf(rag): cache MiniSearch index per (user, scope)`
- `a24ad38 perf(rag): fingerprint cache by max(source_updated_at)`

## Verification

- `pnpm build` ✅ — 三次 commit 各一次
- `npx eslint <file>` ✅ — 0 errors,只有 4 个预先存在的 destructure-discard
  warnings(不是这次引入的)
- 生产实测 ✅ — 三次连续 ask 抓到 baseline / miss / hit / miss(后两次 miss
  是 indexer churn 触发,催生第二次修复)
- Production deploy(commit a24ad38)✅ — GH Actions run 25003118769
  通过,新 pod `knosi-6f85f8b5f9-zbh24` 已 Running

## Remaining Risks / Follow-ups

1. **libonnxruntime.so.1 缺失依然没修**——语义检索目前 0 命中,Milvus 投资
   收益为 0。生产看到的是纯 BM25 retrieval。Dockerfile 修复在另一个工作流里。
   修了之后:
   - 语义检索恢复
   - Indexer 后台 retry 风暴停止
   - cache 命中率会进一步提升(不再有零星 source-side 触发的 miss)

2. **Turso `SELECT *` 仍然在 cache miss 路径上**(1.3s+)。下一步可以让 Milvus
   命中后只 `SELECT WHERE id IN (16 个 id)`,而不是把全用户语料拉进 Node 内存。
   收益主要在 cache miss 路径(用户改了笔记后第一次 ask)。

3. **Daemon 模式下 RAG 仍然在 HTTP 请求里同步跑**——理想是 enqueue 立刻返回
   taskId,worker 自己跑 RAG。改动较大,做完上面两步后再考虑。

4. **slow_query 普查**——日志里 `oauth_access_tokens` 和 `chat_tasks` 的查询
   普遍 350ms+,是另一个正交问题。

## How to Re-Enable Timing for Verification

`ASK_TIMING=1` 已经从 `.env.production` 撤回。如果需要再实测一次:

```bash
ssh knosi
cd /srv/knosi
printf "\nASK_TIMING=1\n" >> .env.production
kubectl -n knosi create secret generic knosi-env \
  --from-env-file=.env.production --dry-run=client -o yaml | kubectl apply -f -
kubectl -n knosi rollout restart deploy/knosi
kubectl -n knosi rollout status deploy/knosi --timeout=180s

# 然后浏览器 ask 一次,日志:
kubectl -n knosi logs deploy/knosi --since=2m | grep ask-timing

# 看完记得撤回:
sed -i '/^ASK_TIMING=/d; /^# Temporary: latency capture/d' .env.production
kubectl -n knosi create secret generic knosi-env \
  --from-env-file=.env.production --dry-run=client -o yaml | kubectl apply -f -
kubectl -n knosi rollout restart deploy/knosi
```
