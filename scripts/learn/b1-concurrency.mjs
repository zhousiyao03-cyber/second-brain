#!/usr/bin/env node
/**
 * B1 — 并发冲突复现脚本
 *
 * 目标：证明 src/server/jobs/queue.ts#claimNextJob 的 "select 然后 update"
 * 两步法在多进程/多连接并发时会出现 "双抢"（两个 worker 都认为自己拿到了同
 * 一条 job），然后对比三种修正方案的行为：
 *
 *   Variant A — naive: 完全复制现有 claimNextJob 的两步逻辑
 *   Variant B — atomic-where: 一条 UPDATE ... WHERE id=(SELECT ... LIMIT 1)
 *                             RETURNING *，把挑选+标记原子化
 *   Variant C — transaction: BEGIN IMMEDIATE + select + update + COMMIT，
 *                            用 SQLite 的写锁互斥
 *
 * 实验步骤（每个 variant 重复 ROUNDS 次）：
 *   1. 清空 knowledge_index_jobs 表里 test 用的行（status='bench'）
 *   2. 插入 1 条 status='bench-pending' 的 job
 *   3. 并发起 WORKERS 个 promise，每个在独立 libsql client 上跑对应的
 *      claim 逻辑（WORKERS 个独立 client 模拟多进程/多 worker 进程）
 *   4. 统计成功 claim 的 worker 数；> 1 = 双抢
 *
 * 运行：
 *   node scripts/learn/b1-concurrency.mjs
 *
 * 输出：表格 + 最终结论。
 */

import { createClient } from "@libsql/client";
import crypto from "node:crypto";

const DB_URL = process.env.SQLITE_DB_PATH
  ? `file:${process.env.SQLITE_DB_PATH}`
  : "file:data/second-brain.db";

const WORKERS = Number(process.env.B1_WORKERS ?? 8);
const ROUNDS = Number(process.env.B1_ROUNDS ?? 30);

const BENCH_STATUS_PENDING = "bench-pending";
const BENCH_STATUS_CLAIMED = "bench-claimed";

/** 用独立的 client 跑一段操作，关闭时释放。 */
function withClient(fn) {
  const client = createClient({ url: DB_URL });
  return fn(client).finally(() => client.close());
}

/** 插入一条测试用 job，返回 id。 */
async function insertOneBenchJob() {
  const id = crypto.randomUUID();
  await withClient((c) =>
    c.execute({
      sql: `INSERT INTO knowledge_index_jobs
              (id, source_type, source_id, reason, status, attempts, queued_at)
            VALUES (?, 'note', ?, 'b1-bench', ?, 0, unixepoch())`,
      args: [id, id, BENCH_STATUS_PENDING],
    })
  );
  return id;
}

/** 把本轮遗留的 bench 行清空。 */
async function cleanupBenchRows() {
  await withClient((c) =>
    c.execute({
      sql: `DELETE FROM knowledge_index_jobs WHERE status IN (?, ?)`,
      args: [BENCH_STATUS_PENDING, BENCH_STATUS_CLAIMED],
    })
  );
}

// ─────────────────────────────────────────────
// Variant A0 — truly-naive：完全没有 status guard 的两步
// ─────────────────────────────────────────────
// 模拟 "我相信 SELECT 回来的一定归我" 的直觉式代码
async function claimTrulyNaive(jobId, workerId) {
  return withClient(async (client) => {
    const pick = await client.execute({
      sql: `SELECT id FROM knowledge_index_jobs
            WHERE status = ? AND id = ?
            ORDER BY queued_at ASC LIMIT 1`,
      args: [BENCH_STATUS_PENDING, jobId],
    });
    const row = pick.rows[0];
    if (!row) return { won: false, workerId };

    await new Promise((r) => setImmediate(r));

    // ★ 注意：WHERE 只匹配 id，不判 status —— 所有抢到 SELECT 的人都会声称自己赢了
    const upd = await client.execute({
      sql: `UPDATE knowledge_index_jobs
            SET status = ?, attempts = attempts + 1
            WHERE id = ?`,
      args: [BENCH_STATUS_CLAIMED + `:${workerId}`, row.id],
    });
    return { won: upd.rowsAffected === 1, workerId };
  });
}

// ─────────────────────────────────────────────
// Variant A — naive with status guard：现有 claimNextJob 的写法
// ─────────────────────────────────────────────
// UPDATE 本身带 "AND status = pending" 这个 CAS 条件，天然把两步变成原子
async function claimNaive(jobId, workerId) {
  return withClient(async (client) => {
    const pick = await client.execute({
      sql: `SELECT id FROM knowledge_index_jobs
            WHERE status = ? AND id = ?
            ORDER BY queued_at ASC LIMIT 1`,
      args: [BENCH_STATUS_PENDING, jobId],
    });
    const row = pick.rows[0];
    if (!row) return { won: false, workerId };

    // ★ 故意留出窗口期：让其他 worker 也能进到这里
    await new Promise((r) => setImmediate(r));

    const upd = await client.execute({
      sql: `UPDATE knowledge_index_jobs
            SET status = ?, attempts = attempts + 1
            WHERE id = ? AND status = ?`,
      args: [BENCH_STATUS_CLAIMED + `:${workerId}`, row.id, BENCH_STATUS_PENDING],
    });
    return { won: upd.rowsAffected === 1, workerId };
  });
}

// ─────────────────────────────────────────────
// Variant B — atomic where + RETURNING
// ─────────────────────────────────────────────
async function claimAtomicWhere(jobId, workerId) {
  return withClient(async (client) => {
    const res = await client.execute({
      sql: `UPDATE knowledge_index_jobs
            SET status = ?, attempts = attempts + 1
            WHERE id = (
              SELECT id FROM knowledge_index_jobs
              WHERE status = ? AND id = ?
              ORDER BY queued_at ASC LIMIT 1
            )
            RETURNING id`,
      args: [BENCH_STATUS_CLAIMED + `:${workerId}`, BENCH_STATUS_PENDING, jobId],
    });
    return { won: res.rows.length === 1, workerId };
  });
}

// ─────────────────────────────────────────────
// Variant C — BEGIN IMMEDIATE 事务
// ─────────────────────────────────────────────
async function claimTxImmediate(jobId, workerId) {
  return withClient(async (client) => {
    // BEGIN IMMEDIATE 立刻拿写锁，其他连接的写事务会等待或 SQLITE_BUSY
    try {
      await client.execute("BEGIN IMMEDIATE");
    } catch (err) {
      // 拿不到写锁，直接判负（真实场景里应 retry）
      return { won: false, workerId, busy: true, err: String(err?.message ?? err) };
    }

    try {
      const pick = await client.execute({
        sql: `SELECT id FROM knowledge_index_jobs
              WHERE status = ? AND id = ?
              ORDER BY queued_at ASC LIMIT 1`,
        args: [BENCH_STATUS_PENDING, jobId],
      });
      const row = pick.rows[0];
      if (!row) {
        await client.execute("COMMIT");
        return { won: false, workerId };
      }

      // 同样留窗口期，对比 naive
      await new Promise((r) => setImmediate(r));

      const upd = await client.execute({
        sql: `UPDATE knowledge_index_jobs
              SET status = ?, attempts = attempts + 1
              WHERE id = ? AND status = ?`,
        args: [BENCH_STATUS_CLAIMED + `:${workerId}`, row.id, BENCH_STATUS_PENDING],
      });

      await client.execute("COMMIT");
      return { won: upd.rowsAffected === 1, workerId };
    } catch (err) {
      try {
        await client.execute("ROLLBACK");
      } catch {}
      return { won: false, workerId, err: String(err?.message ?? err) };
    }
  });
}

// ─────────────────────────────────────────────
// 一轮实验：插 1 条 job，并发抢，统计结果
// ─────────────────────────────────────────────
async function runOneRound(claimFn) {
  const jobId = await insertOneBenchJob();

  const workers = Array.from({ length: WORKERS }, (_, i) =>
    claimFn(jobId, i).catch((err) => ({ won: false, workerId: i, err: String(err?.message ?? err) }))
  );
  const results = await Promise.all(workers);

  const winners = results.filter((r) => r.won).length;
  const busy = results.filter((r) => r.busy).length;

  return { winners, busy, results };
}

async function runVariant(name, claimFn) {
  let doubleClaim = 0;
  let zeroWinner = 0;
  let totalWinners = 0;
  let totalBusy = 0;

  for (let round = 0; round < ROUNDS; round++) {
    await cleanupBenchRows();
    const { winners, busy } = await runOneRound(claimFn);
    totalWinners += winners;
    totalBusy += busy;
    if (winners === 0) zeroWinner++;
    if (winners > 1) doubleClaim++;
  }

  await cleanupBenchRows();
  return {
    name,
    rounds: ROUNDS,
    doubleClaim,
    zeroWinner,
    avgWinners: (totalWinners / ROUNDS).toFixed(2),
    avgBusy: (totalBusy / ROUNDS).toFixed(2),
  };
}

async function main() {
  console.log("B1 — concurrency benchmark");
  console.log(`db      = ${DB_URL}`);
  console.log(`workers = ${WORKERS}`);
  console.log(`rounds  = ${ROUNDS}`);
  console.log("");

  const variants = [
    ["A0. truly-naive (no status guard)", claimTrulyNaive],
    ["A.  naive with status guard     ", claimNaive],
    ["B.  atomic UPDATE + RETURNING   ", claimAtomicWhere],
    ["C.  BEGIN IMMEDIATE tx          ", claimTxImmediate],
  ];

  const rows = [];
  for (const [label, fn] of variants) {
    process.stdout.write(`  running ${label} ...`);
    const start = performance.now();
    const result = await runVariant(label, fn);
    const ms = Math.round(performance.now() - start);
    process.stdout.write(` done (${ms}ms)\n`);
    rows.push(result);
  }

  console.log("");
  console.log("Results:");
  console.log("┌──────────────────────────────────┬────────┬──────────────┬─────────────┬──────────────┬──────────┐");
  console.log("│ variant                          │ rounds │ double-claim │ zero-winner │ avg winners  │ avg busy │");
  console.log("├──────────────────────────────────┼────────┼──────────────┼─────────────┼──────────────┼──────────┤");
  for (const r of rows) {
    const name = r.name.padEnd(32);
    const rounds = String(r.rounds).padStart(6);
    const dbl = String(r.doubleClaim).padStart(12);
    const zero = String(r.zeroWinner).padStart(11);
    const avg = String(r.avgWinners).padStart(12);
    const busy = String(r.avgBusy).padStart(8);
    console.log(`│ ${name} │ ${rounds} │ ${dbl} │ ${zero} │ ${avg} │ ${busy} │`);
  }
  console.log("└──────────────────────────────────┴────────┴──────────────┴─────────────┴──────────────┴──────────┘");

  console.log("");
  console.log("Legend:");
  console.log("  double-claim = rounds where >1 worker won (correctness bug)");
  console.log("  zero-winner  = rounds where no worker won (liveness bug)");
  console.log("  avg winners  = mean winners per round (healthy = 1.00)");
  console.log("  avg busy     = mean workers that got SQLITE_BUSY (C only)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
