# Phase B1 — 数据库进阶：事务、并发、N+1

> 学习 Phase，不是产品 Phase。目标是把"事务 / 并发 / 索引 / N+1"这一层后端基本功，用仓库里真实存在的数据（`knowledge_index_jobs`、`notes`、dashboard 聚合）练一遍。

## Before state — 我现在对这些主题的理解

- **事务**：概念上知道 ACID，写代码时几乎没主动写过 `BEGIN ... COMMIT`。业务里偶尔写过"先插 A 再改 B"的两步操作，通常靠"反正同步执行，应该不会出错"这种侥幸。
- **并发**：知道 race condition 是什么，会举"两个人同时扣库存"这种经典例子，但没在真实项目里**亲手复现并修复过一次**。
- **乐观锁 / 悲观锁**：名字知道，但说不清 SQLite/MySQL/PostgreSQL 在这件事上各自的默认行为。
- **N+1**：ORM 文档里见过，实际项目里多数时候是"别人已经写好 batch/join 了，我直接用"，不是"我排查出来并修掉"。
- **EXPLAIN**：几乎没用过。SQLite 的 `EXPLAIN QUERY PLAN` 完全没试过。
- **索引**：知道"查询慢就加 index"，但对"复合索引顺序为什么重要"、"覆盖索引是什么"只有模糊印象。

所以 B1 的目的不是"学新知识"，是**把这些模糊的知识压成一次亲手实验的记忆**。

---

## B1-2 — 并发冲突复现脚本

### 业务上下文：这段代码对应 Second Brain 的哪个场景？

在看"并发拾取 job"这件事之前，先把背后的产品故事讲清楚——否则后面所有实验都像空中楼阁。

**这段代码是 Second Brain 的"笔记 / 书签 → AI 检索索引"后台重建管道。**

#### 完整链路

```
用户在前端保存/编辑笔记
  ↓
notes.ts 的 create/update/append mutation 把笔记写进 notes 表
  ↓
同一个 mutation 尾部 fire-and-forget 调
  enqueueNoteIndexJob(noteId, "note-update")
  ↓
knowledge_index_jobs 表里新增一行 status='pending'
  ↓ ← 到这里，mutation 已经返回给前端了
  ↓
外部触发 tick（cron 或前端心跳调 /api/jobs/tick）
  ↓
worker.ts 的 processJobs(max) 被调用
  ↓
循环最多 max 次：claimNextJob → 如果有 → dispatch 到 handler → completeJob/failJob
  ↓
dispatch 路由到 ai/indexer.ts 的 runIndexJobFor：
  1. 读 note 正文
  2. chunkKnowledgeSource 切成 chunks
  3. embedTexts 调 AI provider 生成向量
  4. 写入 knowledgeChunks 和 knowledgeChunkEmbeddings 两张表
  ↓
Ask AI / Explore 的 RAG 检索（rag.ts / agentic-rag.ts）在用户提问时
从这两张表里做 BM25 + 向量检索
```

#### 关键文件一览

| 文件 | 角色 |
|---|---|
| `src/server/jobs/queue.ts` | 队列本体：enqueue / claim / complete / fail / snapshot |
| `src/server/jobs/worker.ts` | 驱动层：processOneJob / processJobs，把 claim 和 handler 连起来 |
| `src/server/ai/indexer.ts` | 真正干活的 handler：切 chunks、算 embedding、写索引表 |
| `src/server/routers/notes.ts` | 生产者：create / update / append / createFromTemplate 都会 enqueue |
| `src/server/ai/rag.ts` / `agentic-rag.ts` | 消费产出物：Ask AI / Explore 的检索端 |
| `src/app/api/jobs/*` | tick 触发端点（cron / 心跳敲这个接口推动消费） |

#### 为什么要拆成"先入队，再 tick"这种异步结构？

1. **Embedding 慢**。一次 embed 调用走 HTTP 到 AI provider，通常 1–5 秒，且看网络状况波动。这种延迟不能挂在用户"保存笔记"的请求链路上——用户按 Cmd+S 要立刻看到反馈。
2. **可重试**。provider 抖动、rate limit、OOM、网络闪断都可能发生。pull-based 队列 + 指数退避让这些错误自然地变成"下一轮再试"，而不是面向用户的 500。
3. **可观测**。任务状态落地到 `knowledge_index_jobs` 表，`dashboard` 的 `queueSnapshot` 能直接聚合 `pending / running / done / failed` 计数，出问题时一眼可见，不需要额外的监控系统。
4. **Serverless 亲和**。Vercel 上 Next.js 函数实例生命周期很短且不可预测，不能常驻 `setInterval`。"外部触发 tick 接口"的模式比进程内 polling 更稳——cron 敲一下、前端心跳敲一下都行。

#### 为什么"多 worker 并发抢一条 job"是真实场景，不是假想？

项目现在是**单一前端 + 单一后端部署**，看起来只有一个 worker 在跑，为什么还要关心并发？

答案是：**Vercel serverless 本质上是多实例的**。

- 两个前端请求可能落到两个不同的函数实例
- 这两个实例都可能同时敲 `/api/jobs/tick`
- 它们各自调 `processJobs` → 各自调 `claimNextJob`
- 两个独立的 DB 连接同时执行 "SELECT pending → UPDATE running"

即使你"以为"只有一个 worker，**两次重叠的 cron 触发**也足以构成并发场景。队列系统的"原子拾取"必须在这种场景下保持正确——这就是 B1-2 实验要回答的问题。

> 这一节解答了"为什么队列代码值得认真研究并发正确性"。没有这层业务背景，`claimNextJob` 看起来只是个无聊的 CRUD 函数；有了它，这就是一个能随时翻车的生产热点。

### 目标

项目里现有的 `src/server/jobs/queue.ts#claimNextJob` 是一个典型的 "pull-based 队列 worker 抢任务" 的场景。当前实现是：

```ts
// 第一步：select 一条最早的 pending
const [candidate] = await db.select().from(jobs).where(status='pending').limit(1);
// 第二步：update 成 running（靠 WHERE status='pending' 做 CAS）
await db.update(jobs).set({ status: 'running', attempts: attempts + 1 })
  .where(and(eq(jobs.id, candidate.id), eq(jobs.status, 'pending')));
```

这段代码注释里号称 "原子拾取"，但它不是真的用 `BEGIN ... COMMIT` 包起来的。我想亲手验证两件事：

1. **如果真的去掉 WHERE status='pending' 那个守卫会怎样？** 多 worker 会不会真的抢到同一条？
2. **如果用 `BEGIN IMMEDIATE` 事务实现，代价是什么？** 教科书说事务能避免并发问题，但吞吐下降多少？

### 方案

写一个脚本 `scripts/learn/b1-concurrency.mjs`，用**独立 libsql client** 模拟多 worker（实测两个 `createClient` 可以同时对同一个 SQLite 文件做读写），对同一条 `knowledge_index_jobs` 的"抢任务"操作跑四种实现：

| Variant | 描述 |
|---|---|
| **A0 truly-naive** | SELECT → UPDATE，UPDATE 的 WHERE 只匹配 id（没有 `AND status='pending'`），等于"我相信我 SELECT 回来的就是我的" |
| **A naive with CAS** | 完全照搬现有 `claimNextJob`：SELECT → UPDATE WHERE id AND status='pending' |
| **B atomic + RETURNING** | 一条 `UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING`，把挑选 + 标记压成一条 SQL |
| **C BEGIN IMMEDIATE tx** | 每个 worker 自己开 `BEGIN IMMEDIATE` 事务，靠 SQLite 写锁互斥 |

每轮实验：
1. 插一条 `status='bench-pending'` 的 job
2. 同时启 N 个 worker 去 claim 这**一条**
3. 统计多少个 worker 自认为"赢"了

期望结果：**恰好 1 个 winner**；>1 就是正确性 bug（double-claim）；0 就是 liveness bug（没人抢到）。

### 📖 概念卡：CAS（Compare-And-Swap）

在往下看实验结果之前先把 CAS 这个词讲清楚，否则后面所有"原子性"的讨论都是飘的。

**一句话定义**：

> **只有当这个值还是我上次看到的那个值时，才把它改成新值；否则什么都不做，并告诉我失败了。**

注意两个关键词：**"还是"** 和 **"告诉我失败了"**。这两件事必须是同一个原子操作的两半，不能拆开。

#### 为什么需要它

因为**读和写之间有时间差**。典型的"丢失更新"场景：

```
初始：账户余额 = 100
t=0  A 线程：读余额 → 看到 100
t=1  B 线程：读余额 → 看到 100
t=2  A 线程：100 - 30 = 70，写回 70   ✓ 扣了 30
t=3  B 线程：100 - 50 = 50，写回 50   ✗ A 的扣款被静默覆盖
最终：余额 = 50（应该是 20）
```

B 的写入不是算错，是**基于一个过期的快照做了决定**——它压根不知道 A 已经改过一次。

#### CAS 的解法

B 不写 "余额 = 50"，而是写 **"如果余额还是 100，就改成 50；否则失败"**：

```sql
-- 非 CAS，危险：盲目覆盖
UPDATE accounts SET balance = 50 WHERE id = 1;

-- CAS，安全：WHERE 子句里把上次读到的值作为前提
UPDATE accounts SET balance = 50 WHERE id = 1 AND balance = 100;
```

数据库执行这条 UPDATE 时，"判断 balance=100" 和 "写入 50" 是一起完成的，中间塞不进第三方修改。看 `rowsAffected`：

- **`1`** = compare 通过、swap 成功
- **`0`** = compare 失败（有人抢先改了），调用方决定要不要 retry

**`rowsAffected` 就是 CAS 的返回值。**

#### 在 B1-2 实验里的对应

`claimNextJob` 那条 UPDATE 的 `AND status='pending'` 就是 CAS：

```ts
UPDATE knowledge_index_jobs
SET status = 'running', attempts = attempts + 1
WHERE id = ? AND status = 'pending'   // ← 这一行就是 CAS
```

- "status 还是 pending 吗？" = compare
- "那就改成 running" = swap
- 两件事在一条 SQL 里完成，数据库保证不可分割

Variant A0 把 `AND status='pending'` 删掉，就等于退化成"盲目覆盖"版本——每个 worker 都声称自己赢了。后面的实验数据会直接给你看这个退化长什么样。

#### ⚠️ CAS 的经典坑：ABA 问题

CAS 判断的是"值相不相等"，不是"有没有被动过"。考虑这种场景：

```
t=0   值 = A
t=1   B 线程读到 A
t=2   C 线程把值改成 X，又改回 A
t=3   B 线程做 CAS(expected=A, new=Y) → 成功
```

B 完全不知道中间发生过 A → X → A 这段历史，CAS 告诉它一切正常。但 C 的那次 X 可能有重要含义（比如"这条 job 被处理过一次失败后又被重置 retry"），B 的成功 CAS 其实是个幻觉。

**在 B1-2 的场景里 ABA 会不会发生？**

- `status` 字段上的 CAS：理论上可能。一条 job 可以从 `pending → running → pending`（失败重试）。如果 worker A 读到第一次 pending，中间经历了一次 running/fail 又变回 pending，然后 A 再来做 CAS，会误认为"状态没变"。但实际上 `claimNextJob` 里每次进入的是**新的一次抢占**，不是持有一个"上次读到的快照"来延后写回，所以不会踩到 ABA。
- `version` 字段上的 CAS（B1-3 会用）：**天然免疫 ABA**。因为 version 是单调递增的，绝不回退。A → B → A 在 version 上不可能发生，所以用 version 做乐观锁比用"业务字段"做 CAS 更安全。这也是为什么"乐观锁"这个模式专门引入一个 version 列，而不是直接拿业务字段做 CAS。

**一句话记法**：**在能用 version 的地方就用 version，不要用会"绕回原值"的业务字段做 CAS。**

#### CAS vs 锁：两种并发风格

| 风格 | 思路 | 吞吐 | 调用方复杂度 |
|---|---|---|---|
| **锁（悲观）** | 先占住这条记录，改完再放开 | 低（串行化） | 简单：不用 retry |
| **CAS（乐观）** | 直接写，失败就 retry | 高（可并发） | 调用方要会处理失败重试 |

后面 B1-3 给 `notes` 加的 `version` 列，就是把 CAS 思路从"status 字段"搬到"一个专门的版本号"——本质完全一样，只是用了一个专用列。

> **一句话记法：CAS = 条件写入。读到什么值，就把那个值作为写入的前提条件。**

---

### 故意错一版：Variant A0 暴露了 race

8 workers × 30 rounds：

```
A0. truly-naive       │ 30/30 double-claim │ avg winners = 8.00
```

32 workers × 50 rounds：

```
A0. truly-naive       │ 50/50 double-claim │ avg winners = 32.00
```

**每一轮，每一个 worker 都声称自己赢了。** 这是最纯粹的 race condition 现场——所有 worker 同时 SELECT 到同一条 pending，然后所有 UPDATE 都命中 id=X，`rowsAffected` 全部是 1。

复现出来的那一瞬间我明白了一件事：**"我刚 SELECT 过，应该没问题"的直觉在并发下就是错**。UPDATE 自己必须校验一个会被其他 worker 改掉的条件（这里是 `status='pending'`），否则读和写之间的窗口期就是 race 窗口。

### 正确的三种方案：A / B / C 都有 0 double-claim，但代价不同

```
A.  naive with CAS    │ 0 double-claim │ avg winners = 1.00  │ avg busy = 0
B.  atomic+RETURNING  │ 0 double-claim │ avg winners = 1.00  │ avg busy = 0
C.  BEGIN IMMEDIATE   │ 0 double-claim │ avg winners = 1.00  │ avg busy = 31.00
```

（32 workers × 50 rounds）

**A 现有实现是安全的，但原因不是"两步 select + update"的逻辑**，而是 UPDATE 的 `AND status=pending` 起到了 CAS（Compare-And-Swap）作用——第二个到达的 UPDATE 看到 status 已经变了，WHERE 不匹配，`rowsAffected=0` 就知道自己没抢到。

**这意味着注释和代码的不一致是个潜在风险**：`queue.ts` 的头部注释把这个实现叫作"原子拾取"，但实际上原子性来自 UPDATE 的 WHERE 子句，不来自 SELECT + UPDATE 这两步的组合。如果哪天有人"重构"把 WHERE 的 status 条件去掉（"反正我 SELECT 过了"），代码瞬间退化成 A0。

**B（一条 UPDATE + RETURNING）是最干净的**：把"挑选哪条"和"标记成 running"变成一条 SQL，WHERE 子句里的 SELECT 在同一个语句内执行，压根不存在"两步之间"的窗口。代码也更简洁。

**C（BEGIN IMMEDIATE 事务）正确但粗暴**：32 个 worker 里，只有 1 个能拿到写锁，其余 31 个直接 `SQLITE_BUSY` 失败。真实场景必须加 retry + exponential backoff，否则 31/32 的 worker 瞬间放弃任务。它的价值在"一个事务里要做多个相关操作且必须原子"——单步操作用 BEGIN IMMEDIATE 是典型的 over-engineering。

### 学到了什么（after state）

1. **原子性是由"最后写入的那一步"守护的，不是由前面的 SELECT 守护的。** SELECT 是观察，UPDATE 才是声明所有权。UPDATE 的 WHERE 条件必须包含一个会被其他人改动的字段，这就是 CAS 的本质。
2. **SQLite 的单语句已经是原子的**，所以"一条 UPDATE + 子查询"的写法比"两步 + 事务"更轻、更简洁。优先考虑能否压成一条 SQL。
3. **事务不是万能药，是显式的写锁**。用 `BEGIN IMMEDIATE` 时必须评估吞吐代价，必须准备 retry 逻辑。
4. **测并发 bug 的第一步是找一个能把 bug 暴露出来的配置**（这里是"故意去掉 status 守卫"）。没有能复现的测试，修了也不知道修没修对。
5. **代码注释说"原子"不代表真的原子**。下一步我应该给 `queue.ts` 的注释做个修正：明确说原子性来自 UPDATE 的 WHERE CAS，而不是 SELECT + UPDATE 的组合。

### 下一步对 queue.ts 的改动（会在 B1-1 落实）

- 把 `claimNextJob` 的两步 select+update 改成一条 `UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING`，让原子性在 SQL 层面就明显
- 修正头部注释，承认当前实现的原子性依赖于 UPDATE 的 WHERE CAS
- 作为对照，把 `notes.update` 用 `db.transaction()` 包起来（因为那是"多表多步"的场景，正好是 C 方案合理的地方）

### 关键文件

- 脚本：`scripts/learn/b1-concurrency.mjs`
- 被实验对象：`src/server/jobs/queue.ts`（B1-1 会修改）
- 实验命令：
  ```bash
  node scripts/learn/b1-concurrency.mjs                   # 默认 8×30
  B1_WORKERS=32 B1_ROUNDS=50 node scripts/learn/b1-concurrency.mjs
  ```

---

## B1-1 — 把教训落到代码：notes.update 事务 + claimNextJob 重构

### 目标

B1-2 的实验给了两个清晰的动作项，这次把它们落成代码：

1. **`notes.update` 要把"写 notes"和"写索引队列"放进同一个事务**。这是后面 B6 outbox 模式的最小雏形——两件事必须一起成功或一起失败。
2. **`claimNextJob` 重构成一条 `UPDATE ... WHERE id=(SELECT ... LIMIT 1) RETURNING`**。不是因为原实现有 bug（B1-2 证明了它靠 UPDATE 的 WHERE CAS 是安全的），而是因为**原实现的注释和实际原子性来源不一致**，容易被未来的"重构"误伤。把代码层面的原子性写得更显然是最好的防御。

### 关键决策：事务应该包多大

`notes.update` 的执行步骤：

1. `UPDATE notes` — 核心写
2. `enqueueNoteIndexJob` — 内部是 `INSERT knowledge_index_jobs`
3. `SELECT` 回读刚写入的 note
4. `syncNoteLinks` — 内部是 `DELETE + 多条 INSERT note_links`（fire-and-forget）
5. `invalidateDashboardForUser` — Redis 调用
6. `invalidateNotesListForUser` — Vercel Runtime Cache 调用

拆解后我的决定：

| 步骤 | 进事务？ | 理由 |
|---|---|---|
| 1. UPDATE notes | ✅ | 核心写 |
| 2. INSERT jobs | ✅ | outbox 雏形——笔记改了就必须排一次重索引，二者必须原子 |
| 3. SELECT 回读 | ❌ | 读发生在事务提交后读才是 canonical 版本；事务里没必要再读一次 |
| 4. syncNoteLinks | ❌ | 本就是弱一致（fire-and-forget），且内部是 DELETE + 多条 INSERT，放事务里会让写集合扩大 5–10 倍，延长持锁时间 |
| 5. Redis invalidate | ❌ | **事务里绝不做网络 IO**——RTT 波动会把事务时长放大到数十毫秒，期间别的写被阻塞 |
| 6. Vercel Cache invalidate | ❌ | 同上 |

**两个核心原则**：

- **事务越短越好**，不是越完整越好。
- **事务里只做同 DB 的写**，任何跨进程/跨网络的调用都必须留在事务外。

这个拆法也暴露了 B6 要解决的真正问题——现在 step 1/2 进事务了，但 step 5/6 的 Redis/Vercel Cache 失效**不是事务的一部分**，理论上存在"事务提交了但 Redis 没清成功"的窗口。这就是为什么未来需要 outbox：把"失效缓存"也变成一条写进 outbox 表的记录，由后台 worker 保证它最终执行。今天不做，只是在代码里为它铺好路径。

### enqueueJob 支持事务透传

让 `enqueueJob` 参与 `notes.update` 的事务，必须改它的签名接受一个 runner：

```ts
// src/server/jobs/queue.ts
type DbRunner = Pick<typeof db, "insert">;

export async function enqueueJob(
  input: { sourceType: JobSourceType; sourceId: string; reason: string },
  runner: DbRunner = db
) {
  await runner.insert(knowledgeIndexJobs).values({ ... });
}
```

关键点：**Drizzle 的 `tx` 在结构上兼容 `db`**——它们都有 `insert / update / select / run` 方法，所以用 `Pick<typeof db, "insert">` 作为参数类型是合法的。调用方不传 runner → 走模块级 `db`，老行为；传 `tx` → 跟随事务。

`enqueueNoteIndexJob` 和 `enqueueBookmarkIndexJob` 也相应加一个可选的 `tx` 参数透传。**其他原来的调用点（notes.create / appendToJournal / bookmarks 入队）保持不传**——它们不在事务里，不需要改。

### claimNextJob 重写：从"两步 + CAS 守卫"到"一条 SQL"

旧版（省略同步日志）：

```ts
const [candidate] = await db.select().from(jobs).where(...);
if (!candidate) return null;
await db.update(jobs).set({ status: "running", ... })
  .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "pending")));
const [claimed] = await db.select().from(jobs).where(eq(jobs.id, candidate.id));
if (!claimed || claimed.status !== "running") return null;
```

新版：

```ts
const result = await dbClient.execute({
  sql: `
    UPDATE knowledge_index_jobs
    SET status = 'running', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM knowledge_index_jobs
      WHERE status = 'pending' AND queued_at <= ?
      ORDER BY queued_at ASC
      LIMIT 1
    )
    RETURNING id, source_type, source_id, reason, status, error,
              attempts, queued_at, finished_at
  `,
  args: [nowSeconds],
});
const row = result.rows[0];
if (!row) return null;
// 手动构造返回对象，字段名对齐原 Drizzle select 的 camelCase
```

**好处**：

- **代码量从 3 次 DB round-trip 降到 1 次**——claim 一条 job 的 DB 往返从 3 次降到 1 次，延迟直接 ÷3
- **原子性在 SQL 层面就显然**：没有"两步之间"可言
- **不再依赖"旧注释承诺了什么"**：原实现的头部注释里有句 "Drizzle 对 libsql 的 `.returning()` 尚不稳定" 的过时说法，B1-2 实验里已经证伪，顺手删掉

**代价**：

- 用了 `dbClient.execute` 而不是 Drizzle 的链式 API，字段类型转换要手写（`queued_at` / `finished_at` 是 Unix 秒，要 `new Date(n * 1000)`；`status` 是 enum union，要手动 cast）。这是**精度换 DX** 的典型交换。
- 如果未来 `knowledge_index_jobs` 加新列，要记得更新 `RETURNING` 子句和手动构造对象。
- 老注释里"先 update 再二次读取"的回退方案被删了——它原本的价值就是"Drizzle returning 不稳"，这个前提已经不成立。

### 踩坑记录

1. **`queued_at` 的存储格式**。schema 声明是 `integer("queued_at", { mode: "timestamp" })`，Drizzle 会把 Date 和 Unix 秒互转。新版 `claimNextJob` 走原始 SQL 不走 Drizzle，必须手动 `Math.floor(Date.now() / 1000)`。忘了这一步会把条件错成"比 1970 年晚 55 万年"，整张表都匹配不上 → 静默空结果。写完第一版我没信，跑了一个 smoke test 插一条 job 再 claim 一次才敢继续。

2. **改 `queue.ts` 的 imports 时一度砍太多**。`and / asc / eq / lte` 在 `claimNextJob` 里被干掉了，但 `completeJob / failJob / queueSnapshot` 还在用 `eq`。TypeScript 会告诉我，但先 build 再改比先改再修漂亮得多——把 imports 放到"所有函数都改完之后再扫一遍"就不会走回头路。

3. **`processOneJob` 返回的 `job.attempts` 含义**。新版 UPDATE 里有 `attempts = attempts + 1`，RETURNING 出来的已经是加 1 后的值——和旧版语义一致（旧版先 UPDATE 加 1 再 SELECT 回读，也是加 1 后的值）。worker.ts 里的 logger 打的 `attempts` 数字不会变。这是我在改代码前专门核对的一个点，因为如果语义悄悄变了，failJob 里的 backoff 公式 `2^(attempts-1)` 会偏移一代。

### 验证

- `pnpm build` ✅（通过）
- `pnpm lint` ✅（通过）
- **smoke test**：往 DB 插一条真实的 pending job，跑新版 `claimNextJob` 的 SQL，确认返回的行 `id / source_type / source_id / status / attempts / queued_at` 都正确，然后清理。通过。
- **e2e**：本 Phase 学习向，跳过。验证焦点在"改动的具体行为"而不是整套产品路径。

### 学到了什么（after state）

1. **"事务"不是一种标签，是一种写集合的定义**。我以前画事务边界时总倾向"反正都相关就一起包进去"，这次被迫拆解每一步，才意识到**把网络 IO 塞进事务是危险操作**——它让事务的"理论持锁时间"变成了"外部系统的 RTT 波动区间"。
2. **Drizzle 的 `tx` 和 `db` 在类型上兼容，这让"可选事务透传"的函数签名变得非常优雅**。用 `Pick<typeof db, "insert">` 作为参数类型，调用方不知情的情况下也能继续传 `db`。比显式接受 `SQLiteTransaction<...>` 这种长类型友好得多。
3. **"一条 SQL 压多步"的好处是把正确性写进 SQL 层面，不依赖代码读者会不会看注释**。旧版安全是因为 UPDATE 的 WHERE 有 CAS 守卫，但这件事是隐含的、容易被重构时丢失。新版的原子性是 SQL 引擎给的硬保证，没人能 "重构掉"。
4. **outbox 模式的核心不是"保证消息发出去"，是"把 DB 写和消息投递绑定"**。今天这一次改动只是让 "notes 写" 和 "jobs 写" 同事务——这已经是 outbox 的基因了。B6 要做的剩下一半是：让后台 worker 扫 outbox 并负责真正投递。

### 关键文件

- `src/server/jobs/queue.ts` — 重写 `claimNextJob`，`enqueueJob` 加 runner 参数
- `src/server/ai/indexer.ts` — `enqueueNoteIndexJob` / `enqueueBookmarkIndexJob` 加可选 tx 透传
- `src/server/routers/notes.ts` — `update` mutation 用事务包 UPDATE + enqueue

---

## B1-3 — notes.version：加单调递增版本号，**不做乐观锁**

### 原计划 vs 实际决定

B1 原计划是"给 notes 加 version 列 + 每次 UPDATE 用 `WHERE version = ?` 做 CAS 检测冲突 + 冲突返回 409 / CONFLICT"。也就是**经典的乐观锁**。

**动手之前我停了一下问自己："这个乐观锁真的对 Second Brain 有价值吗？"** 把这个问题认真想清楚之后，我改了主意——**只加 version 列做单调递增，不做 CAS，不做前端冲突处理**。这份文档把"为什么"写完整，避免以后自己忘了又绕回来。

### 先讲一个事实：现在这个版本有什么问题？

**答案是：没有真实的、正在发生数据丢失的问题**。

现状是 LWW（Last-Write-Wins，最后写入者赢）：

```sql
UPDATE notes SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?
```

没有 version、没有 CAS，谁的 UPDATE 后到谁就覆盖谁。但这个方案在 Second Brain 的真实使用场景里几乎不会出 bug：

| 场景 | 会不会丢数据？| 发生频率 |
|---|---|---|
| 单 tab 单用户编辑同一篇笔记 | 不会 | 99% |
| 多 tab / 多设备同时编辑同一篇笔记 | **会**（后到的静默覆盖先到的） | 罕见，个人工具里可能一年一次 |
| `appendBlocks` (Ask AI 追加) 和编辑器编辑同一篇笔记撞车 | **会** | 极少，需要用户主动同时操作 |
| 系统写（normalize journal titles / folder delete 搬笔记） | 不会（和用户写不在同一字段） | — |

**乐观锁能保护场景 2 和 3，但代价是给 99% 的单 tab 情况都加一层复杂度**。这笔账值不值得——取决于你对"宁可多一次错误弹窗也不要丢一次数据"的偏好。

### 为什么 Notion / Google Docs / Figma 都不用乐观锁？

这是我在这次决策里学到的最核心的一件事：**工业级协同产品几乎都绕过乐观锁，直接走 CRDT 或 OT 路线**。原因不是乐观锁太难，而是**乐观锁的 UX 注定糟糕**。

#### 乐观锁的 UX 天花板

乐观锁的核心是 "检测冲突 → 拒绝 → 让用户决定"。这句话翻译成用户视角：

> **"你刚才写的那段话没保存成功。请刷新页面看看别人改了什么，然后手动合并。"**

对普通用户来说这是灾难级体验：

1. **丢失的是哪段修改？** 用户不知道。乐观锁只告诉他"冲突了"，不告诉他"你的哪几行输没了"。
2. **合并怎么做？** 用户不会 git merge。即使给他看 diff，也很难在两段自然语言段落里决定"保留哪段"。
3. **多久一次？** 如果这个弹窗每小时出现一次（协同场景的真实频率），用户会放弃使用。

#### CRDT / OT 的根本不同

Google Docs（历史上用 OT — Operational Transformation）、Notion / Figma / Linear（现在主要用 CRDT — Conflict-Free Replicated Data Type）都不检测冲突——**它们让冲突不可能发生**。

核心思想：**不发送"最终文档状态"，发送"操作"**。

```
乐观锁的世界里，客户端发送：
  "把笔记的 content 改成这个 JSON" → 服务器 CAS 检查 version
  两个客户端同时发，后到的被拒绝，用户丢修改

CRDT 的世界里，客户端发送：
  "在位置 42 插入 'hello'"
  "在位置 100 删除 5 个字符"
  服务器把所有操作合并，任何顺序都能得到同一个最终状态
  两个客户端同时操作不同位置 → 自然无冲突
  两个客户端同时操作同一位置 → CRDT 算法保证合并结果确定
```

关键差别：
- **乐观锁**：冲突是个**状态**（"version 3 ≠ version 4，失败"）。需要人处理。
- **CRDT**：冲突是个**概念错误**。操作集合是可交换半群，任何顺序合并结果相同。不需要人处理。

所以当你在 Google Docs 里两个人同时打字，**不会有任何对话框弹出来**——文字自动交错插入。这件事乐观锁永远做不到。

#### 为什么不是所有场景都该用 CRDT

CRDT 的代价巨大：

1. **引入完整的 CRDT 运行时**（Yjs / Automerge），客户端和服务端都需要
2. **编辑器必须 CRDT-aware**——Tiptap 支持 Yjs collab extension，但必须切换到 Yjs 文档模型，不再是 JSON 字符串
3. **持久化变成事件流**（每次都是"操作"），不是"整段 content 覆盖"——数据库 schema 要大改
4. **Undo / redo 语义要重做**——本地 undo 必须只撤销本地操作，不能撤销远端的
5. **调试变难**——你不再能简单地 "看数据库里的 content 是什么"，要看操作历史

对**个人 KM 工具**来说这笔账很容易算：
- 单用户场景 → CRDT 的好处（自动合并）几乎没机会触发
- 单用户场景 → CRDT 的代价（复杂度、schema 改造）照单全收
- 结论：**单用户工具用最简单的 LWW 就够**，除非你真的想引入协同

#### 那为什么 Notion 还是用了 CRDT-like 方案？

因为 Notion 从第一天就是**多人协作工具**——它的 "mention / comment / 实时 cursor" 都建立在"多人同时编辑同一文档"的假设上。对它来说"加 CRDT" 不是可选项，是产品定义的一部分。

Second Brain 不是。它本质上是"我个人的 markdown 文件夹，加了些 AI"。所以**继承 Google Docs / Notion 的决策**不合理——它们的约束和你的约束不是同一套。

### 反过来想：乐观锁的真正主场

上一节说"Notion / Google Docs 不用乐观锁"很容易被误读成"乐观锁过时了"。完全不是。它只是**和自然语言协同编辑不匹配**而已。换到另外几类场景里，乐观锁是最合适、甚至是唯一能用的方案。

核心观察：**乐观锁的 UX 烂是针对"人类用户在写自然语言"这个场景**。换到别的场景，它反而最合适。

#### 乐观锁真正擅长的 5 类场景

**1. 结构化数据的字段级更新（最经典的主场）**

银行账户余额、电商库存、工单状态、订单金额。这些数据的共同特征：

- **字段是结构化的**（一个数字、一个枚举）——不是一大段文字
- **语义是可判定的**（100 - 30 = 70 是精确的，没有"合并两种写法"的说法）
- **冲突必须被拒绝**（丢失一次扣款就是事故）
- **冲突的 UX 是机器的，不是人的**——调用方是另一段代码，它会 retry

举例：两个人同时给同一张工单改状态
```
User A: "todo" → "in_progress"  (version 3)
User B: "todo" → "done"          (version 3)
```
CRDT 的答案："合并成什么？in_progress_and_done？"— 无解。
乐观锁的答案：第二个到达的被拒绝，返回"状态已被别人修改，请刷新"— 正确。

这里乐观锁**不是次优解，是正解**。CRDT 在这种场景下无法工作，因为状态机的状态不是"可合并"的。

**2. 后台 job / 任务调度**

这就是 B1-1 在 `claimNextJob` 里做的事，只是用的是 `status` 字段的 CAS 不是 `version` 字段。多个 worker 竞争同一条 pending job，"合并两个 worker 声明自己抢到了"是没意义的——只能一个赢。

注意 **UX 在这里不存在**——调用方是另一个 worker 进程，对"失败返回"的处理是"看到 rowsAffected=0 就认输，去找下一条"，没有任何人被打扰。

**3. 配置 / 设置类数据**

用户设置面板、feature flag、系统配置。冲突极少（一个用户不会同时在两个地方改自己的设置），如果真的冲突了，"刷新重改"代价低（设置只有几个字段，用户看得懂）。这里乐观锁是**比 LWW 更保险**的选择，UX 代价很小。

**4. "所有权转移"类操作**

文档转让、账户绑定、资源分配。一个 resource 只能有一个 owner，"合并"在语义上不存在。CRDT 根本没法表达"所有权"——它是单值字段，不是可合并的数据结构。乐观锁是唯一合理方案。

**5. 对账 / 财务记录**

账单、发票、报销单。**不允许静默覆盖**是硬性合规要求。宁可拒绝写入让用户重试，也不能把别人的修改悄悄抹掉——审计会查出来的。乐观锁在这里是"法律要求的设计"。

#### 一张对照表：什么时候用什么

| 场景 | 数据形状 | 冲突处理 | 合适方案 |
|---|---|---|---|
| 自然语言文档协同编辑 | 长字符串 / 富文本 | 自动合并 | **CRDT / OT** |
| 结构化字段并发更新 | 单个数值 / 状态 | 必须拒绝 | **乐观锁** |
| 后台任务竞争 | 状态机 | 必须拒绝 | **CAS on status** |
| 所有权 / 配额转移 | 单值引用 | 必须拒绝 | **乐观锁** |
| 个人单用户场景 | 任何 | 不存在冲突 | **LWW（最简单）** |
| 计数器（如点赞数） | integer | 合并 | **CRDT counter / atomic INCR** |
| 购物车 | 集合 | 合并 | **CRDT set** 或乐观锁都可以 |
| 财务 / 对账 | 金额 | 必须拒绝 | **乐观锁 + 审计日志** |

#### 同一个系统里可以做不同的选择

你可能会想："Second Brain 的 `notes.version` 不做 CAS，但 `claimNextJob` 里 `status='pending'` 做 CAS，不矛盾吗？"

不矛盾——**同一个系统里，不同子系统可以做不同的选择**。

- **`notes` 的 content 字段** → 自然语言，人类编辑，LWW 够用，未来上 CRDT。**不做乐观锁**。
- **`knowledge_index_jobs` 的 status 字段** → 状态机，机器消费，必须拒绝双抢。**必须做 CAS**。

这两个判断背后是同一条原则：**数据形状 + 冲突处理语义 共同决定方案**。notes 的 content 是"一大段文字"，语义是"最终看起来对就行"；jobs 的 status 是"有限状态机"，语义是"不能有两个 worker 同时声称拿到"。形状不同 → 方案不同。

#### 真正的结论

B1-3 不用乐观锁**不是因为乐观锁技术烂**，而是因为它和"笔记内容字段"的数据形状不匹配——自然语言 + 人类编辑 + "冲突需要看起来合理的合并"这个组合，正好是乐观锁的弱点。

如果哪天 Second Brain 要加一个"任务看板"（结构化 status 字段）、或者"待办清单的优先级排序"（单值字段），那时候**就应该毫不犹豫用乐观锁**。同样一个系统里，notes 用 LWW（最后走向 CRDT），tasks 用乐观锁，jobs queue 用 CAS——这不是不一致，这是"**每块数据配它应得的方案**"。

### 所以这次 B1-3 的决定

**结论**：

- **加 `notes.version` 列**，`integer NOT NULL DEFAULT 0`
- **每次 UPDATE 时 `version = version + 1`**（单调递增，永不回退）
- **`notes.get` 返回里带 version**
- **不做 CAS 检查**，WHERE 里不加 `AND version = ?`
- **不改前端**，`doSave` 照常发全量 content

这样做我换到了三样东西：

1. **为 B9 事件溯源铺路**：每次编辑都有一个单调递增的 sequence，将来把 `notes` 的编辑历史做成事件流时，这个 version 就天然是 event id。
2. **为"编辑历史"这个产品功能留接口**：以后想做"查看第 N 版笔记"时，后端已经在跟踪版本数了。
3. **为 CAS 概念留一个真实的锚点**：CAS 的概念在 B1-2 讲过，B1-1 在 `claimNextJob` 里落地过（那是用 `status='pending'` 字段做 CAS）。B1-3 这里我本来想在 `version` 上再做一次，但**意识到对这个产品没收益**——这件事本身就是学习点。**不是所有学过的模式都应该用**。

### 学到了什么（after state）

这次的学习比原计划更有价值，因为它是**"应该但不要"** 的典型案例：

1. **学术上正确 ≠ 产品上合适**。乐观锁是经典答案，但"经典答案"是针对"经典问题"的——"多用户协同冲突"。我的问题不是那个问题，直接套经典答案就是错。
2. **选择技术方案时要先问"我真实的用户场景是什么"**。Second Brain 的主战场是单 tab 单用户，这个事实一旦承认，后面的技术选型就完全不一样。
3. **"乐观锁 vs CRDT"的真正对立不是技术复杂度，是 UX 哲学**。乐观锁承认冲突存在 → 让用户处理；CRDT 让冲突不可能存在。选哪条路线本质上是"是否接受冲突作为用户可感知的概念"。
4. **"加一个没用的字段"比"加一个错的功能"更便宜**。单调递增的 version 几乎零成本，还留下了三条未来路径（事件溯源 / 编辑历史 / 潜在的未来乐观锁）；加乐观锁 + 前端冲突处理是一笔立即生效的复杂度债，且 99% 时间不会被用到。
5. **决策留档的价值**：这份文档的目标读者是 6 个月后的我自己——那时候可能完全忘了"B1-3 为什么没做乐观锁"，翻开这段就能 30 秒恢复记忆。代码里的一个 `// B1-3: 只递增不 CAS` 注释做不到这件事。

### 下一步什么时候回来做真正的冲突处理？

**B10 — 实时与协同**。那是 CRDT / Yjs 合适的地方：当我真的想做"多设备实时同步编辑同一篇笔记"时，不应该先做乐观锁、再推翻改成 CRDT——应该直接一步到位做 CRDT。乐观锁作为"中间过渡方案"既不省事也不省学习曲线。

### 代码变动范围

- **schema**：`notes.version` (`integer NOT NULL DEFAULT 0`)
- **`notes.create` / `createFromTemplate`**：不用改，插入时走默认值 0
- **`notes.update`**：事务里 UPDATE 时显式 `set({ version: sql\`${notes.version} + 1\` })`
- **`notes.appendBlocks`**：同上（这里也是 content 写）。顺手也给它包了 `db.transaction`，和 `notes.update` 的"写 + 入队索引"事务结构保持一致
- **`notes.enableShare` / `disableShare`**：**不递增**。这两个改的是 share 元数据，不是内容，不应该让 "分享一次" 也计入笔记的版本号
- **`folders.ts` 批量 move**：**不递增**。这是管理性的 folderId 迁移
- **`journal-titles.ts` normalize**：**不递增**。系统性标题规范化
- **`notes.get`** / **`notes.list`**：两个查询都用 `db.select().from(notes)` 不带字段投影，整个 row 自动返回，**version 列 "免费"进了 return**，前端暂时不用
- **production Turso rollout**：`ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 0`

### 踩坑记录

1. **`drizzle-kit push` 拒绝本地同步**。schema 里明明写了 `.default(0)`，drizzle-kit 还是提示 "You're about to add not-null version column without default value"，并因为 "data-loss" 而要求交互式确认——而我的 Bash 环境没有 TTY。这是 drizzle-kit 对 SQLite ALTER 的一个已知保守策略。对策：**直接用 `@libsql/client` 发原始 SQL**，和我对生产做的是同一条命令，不依赖 drizzle-kit 的启发式判断。这也让 rollout 脚本和本地应用命令完全对齐——可重现、可对比。

2. **`notes.ts` smoke test 一开始触发 FK constraint failure**。我最初写的 smoke 脚本往 `notes` 插了一条带假 `user_id = "b1-3-smoke-user"` 的测试记录——被 `FOREIGN KEY (user_id) REFERENCES users(id)` 拒绝。对策：不插新记录，**直接对一条已有 note 做 UPDATE，事后把 version 回滚到原值**。这也是"smoke test 应该尽量零副作用"的好实践——生产数据就不要瞎动了。

3. **`appendBlocks` 原本没有缓存失效**。我在读代码时发现 `notes.appendBlocks` 改了 content 但没调 `invalidateNotesListForUser`，这是一个已经存在的 bug。但**这不是 B1-3 的作用域**，我有意识地不顺手修——保持 commit 的 "一次只做一件事" 原则。在本 changelog 和本段都做了明确记录，留给未来的 Phase 处理。

### 验证

- `pnpm build` ✅（通过，无 type error）
- ESLint 对 `notes.ts / schema.ts` ✅（exit 0，干净）
- **smoke test**：对本地 DB 里一条真实 note 做两次 "UPDATE ... version = version + 1"，确认 version 从 0 → 1 → 2 单调递增，然后回滚到 0 保持本地数据干净。通过。
- **production rollout**：运行 `node scripts/db/apply-2026-04-11-notes-version-rollout.mjs`，对生产 Turso（60 条现存笔记）执行 ALTER + 验证：
  ```
  column present: name=version type=INTEGER notnull=1 dflt=0
  sample rows: 全部 version=0
  stats: total=60 min_version=0 max_version=0
  ```
  完整记录在 `docs/changelog/2026-04-11-notes-version-rollout.md`。
- **e2e**：本 Phase 学习向，跳过。

### 关键文件

- `src/server/db/schema.ts` — 加 `notes.version` 列声明
- `drizzle/0026_bright_puppet_master.sql` — Drizzle 生成的 migration
- `src/server/routers/notes.ts` — `update` 和 `appendBlocks` 里 `version = version + 1`
- `scripts/db/apply-2026-04-11-notes-version-rollout.mjs` — 生产 rollout 脚本（幂等）
- `docs/changelog/2026-04-11-notes-version-rollout.md` — rollout 留档
