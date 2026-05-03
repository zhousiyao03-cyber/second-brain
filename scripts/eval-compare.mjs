// Diff two eval result JSONs (RAG or agent). Prints aggregate delta and
// per-case regressions/fixes — the bare minimum needed to answer "did my
// change improve or hurt quality".
//
// Usage:
//   pnpm eval:compare eval/results/baseline.json eval/results/run-X.json
//   pnpm eval:compare eval/results/agent/baseline.json eval/results/agent/run-X.json
//
// Auto-detects RAG vs agent by inspecting top-level keys.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: pnpm eval:compare <baseline.json> <experiment.json>");
  process.exit(1);
}

const [basePath, expPath] = args.map((p) => resolve(process.cwd(), p));
const base = JSON.parse(readFileSync(basePath, "utf8"));
const exp = JSON.parse(readFileSync(expPath, "utf8"));

const isAgent = "perCase" in base;
const isRag = "perQuery" in base;
if (!isAgent && !isRag) {
  console.error("Unrecognized result shape — expected perCase or perQuery key.");
  process.exit(1);
}
if (isAgent !== ("perCase" in exp)) {
  console.error("Cannot compare RAG result against agent result.");
  process.exit(1);
}

console.log(`\nComparing:\n  baseline   = ${basePath}\n  experiment = ${expPath}\n`);

// --- Aggregate delta ---------------------------------------------------------
function fmtDelta(a, b, fmt = (x) => x.toFixed(3)) {
  const delta = b - a;
  const sign = delta > 0 ? "+" : "";
  const arrow = delta > 0.001 ? "↑" : delta < -0.001 ? "↓" : "─";
  return `${fmt(a)} → ${fmt(b)} (${sign}${fmt(delta)} ${arrow})`;
}

console.log("Aggregate:");
const ba = base.aggregate;
const ea = exp.aggregate;
if (isRag) {
  console.log(`  Recall@5     : ${fmtDelta(ba.recall5, ea.recall5)}`);
  console.log(`  Recall@10    : ${fmtDelta(ba.recall10, ea.recall10)}`);
  console.log(`  MRR          : ${fmtDelta(ba.mrr, ea.mrr)}`);
  console.log(`  p50 latency  : ${fmtDelta(ba.p50LatencyMs, ea.p50LatencyMs, (x) => `${Math.round(x)}ms`)}`);
} else {
  console.log(`  Pass rate    : ${fmtDelta(ba.passRate, ea.passRate, (x) => `${(x * 100).toFixed(1)}%`)}`);
  console.log(`  Citation     : ${fmtDelta(ba.meanCitationScore, ea.meanCitationScore)}`);
  console.log(`  Mention      : ${fmtDelta(ba.meanMentionScore, ea.meanMentionScore)}`);
  console.log(`  Negative     : ${fmtDelta(ba.meanNegativeScore, ea.meanNegativeScore)}`);
  console.log(`  p50 latency  : ${fmtDelta(ba.p50LatencyMs, ea.p50LatencyMs, (x) => `${Math.round(x)}ms`)}`);
  console.log(`  Runtime errs : ${ba.runtimeErrors} → ${ea.runtimeErrors}`);
}

// --- Per-case / per-query delta ----------------------------------------------
const baseRows = isAgent ? base.perCase : base.perQuery;
const expRows = isAgent ? exp.perCase : exp.perQuery;
const expById = new Map(expRows.map((r) => [r.id, r]));

const regressions = [];
const fixes = [];
const movements = [];

for (const b of baseRows) {
  const e = expById.get(b.id);
  if (!e) continue;
  if (isAgent) {
    if (b.pass && !e.pass) regressions.push({ id: b.id, query: b.query, b, e });
    if (!b.pass && e.pass) fixes.push({ id: b.id, query: b.query, b, e });
    const dC = e.citationScore - b.citationScore;
    const dM = e.mentionScore - b.mentionScore;
    if (Math.abs(dC) > 0.01 || Math.abs(dM) > 0.01) {
      movements.push({ id: b.id, query: b.query, dC, dM, b, e });
    }
  } else {
    const dR = e.recall10 - b.recall10;
    const dMrr = e.mrr - b.mrr;
    if (Math.abs(dR) > 0.01 || Math.abs(dMrr) > 0.01) {
      movements.push({ id: b.id, query: b.query, dR, dMrr, b, e });
    }
  }
}

if (isAgent) {
  if (regressions.length > 0) {
    console.log("\n⚠️  REGRESSIONS (PASS → FAIL):");
    for (const r of regressions) {
      console.log(`  ${r.id}  ${r.query.slice(0, 50)}`);
      console.log(`     C ${r.b.citationScore.toFixed(2)}→${r.e.citationScore.toFixed(2)}  M ${r.b.mentionScore.toFixed(2)}→${r.e.mentionScore.toFixed(2)}  N ${r.b.negativeScore.toFixed(2)}→${r.e.negativeScore.toFixed(2)}`);
    }
  }
  if (fixes.length > 0) {
    console.log("\n✅ FIXES (FAIL → PASS):");
    for (const f of fixes) {
      console.log(`  ${f.id}  ${f.query.slice(0, 50)}`);
    }
  }
}

if (movements.length > 0) {
  console.log(`\nNotable per-case movements (${movements.length}):`);
  movements.sort((a, b) => {
    const am = isAgent ? Math.abs(a.dC) + Math.abs(a.dM) : Math.abs(a.dR) + Math.abs(a.dMrr);
    const bm = isAgent ? Math.abs(b.dC) + Math.abs(b.dM) : Math.abs(b.dR) + Math.abs(b.dMrr);
    return bm - am;
  });
  for (const m of movements.slice(0, 20)) {
    if (isAgent) {
      const sC = m.dC > 0 ? "+" : "";
      const sM = m.dM > 0 ? "+" : "";
      console.log(`  ${m.id}  ΔC ${sC}${m.dC.toFixed(2)}  ΔM ${sM}${m.dM.toFixed(2)}  | ${m.query.slice(0, 50)}`);
    } else {
      const sR = m.dR > 0 ? "+" : "";
      const sMrr = m.dMrr > 0 ? "+" : "";
      console.log(`  ${m.id}  ΔRecall@10 ${sR}${m.dR.toFixed(2)}  ΔMRR ${sMrr}${m.dMrr.toFixed(2)}  | ${m.query.slice(0, 50)}`);
    }
  }
}

if (regressions.length === 0 && fixes.length === 0 && movements.length === 0) {
  console.log("\nNo per-case movements > 0.01 — likely identical or below noise floor.");
}
console.log();
