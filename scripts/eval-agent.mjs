#!/usr/bin/env node
// End-to-end agent eval harness — runs annotated cases through the real
// Ask AI pipeline (buildChatContext + runChatStream + buildAskAiTools)
// and scores each case on three dimensions: tool-touched note id coverage,
// must_mention presence, must_not_mention absence.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/eval-agent.mjs --user <id>
//   npx tsx --env-file=.env.local scripts/eval-agent.mjs --user <id> --out eval/results/agent/run-A.json
//   npx tsx --env-file=.env.local scripts/eval-agent.mjs --user <id> --only ask-001,ask-005

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
}

const USER_ID = getArg("--user", process.env.EVAL_USER_ID);
const OUT_PATH = getArg("--out", null);
const ONLY = getArg("--only", null); // comma-separated case ids

if (!USER_ID) {
  console.error(
    "Set EVAL_USER_ID env var or pass --user <id>. " +
      "Run: sqlite3 data/second-brain.db 'SELECT id FROM users LIMIT 1;'"
  );
  process.exit(1);
}

const casesPath = resolve(repoRoot, "eval/agent-cases.json");
const casesFile = JSON.parse(await readFile(casesPath, "utf8"));
let cases = casesFile.cases ?? [];
if (ONLY) {
  const allow = new Set(ONLY.split(",").map((s) => s.trim()));
  cases = cases.filter((c) => allow.has(c.id));
}
if (ONLY) {
  const matched = new Set(cases.map((c) => c.id));
  const requested = ONLY.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = requested.filter((id) => !matched.has(id));
  if (unknown.length > 0) {
    console.warn(`[warn] --only ids not found in agent-cases.json: ${unknown.join(", ")}`);
  }
}
if (cases.length === 0) {
  console.error("No cases to run. Check eval/agent-cases.json or --only filter.");
  process.exit(1);
}

console.log(`Loaded ${cases.length} case(s) from ${casesPath}`);

// Production pipeline imports (TS files — Node 22 strip-types makes this work).
const { buildChatContext } = await import(
  resolve(repoRoot, "src/server/ai/chat-prepare.ts")
);
const { runChatStream } = await import(
  resolve(repoRoot, "src/server/ai/provider/ai-sdk.ts")
);
const { resolveAiCall } = await import(
  resolve(repoRoot, "src/server/ai/provider/resolve.ts")
);
const { maxStepsForKind } = await import(
  resolve(repoRoot, "src/server/ai/provider/types.ts")
);
const { buildAskAiTools, getOrCreateUrlBudget } = await import(
  resolve(repoRoot, "src/server/ai/tools/index.ts")
);

async function runOneCase(c) {
  const t0 = Date.now();

  // 1. Build the chat context exactly like /api/chat does.
  const { system, messages } = await buildChatContext(
    {
      messages: [{ role: "user", content: c.query }],
      sourceScope: "all",
    },
    USER_ID,
  );

  // 2. Resolve the chat provider for this user.
  const provider = await resolveAiCall("chat", USER_ID);
  if (provider.kind === "claude-code-daemon" || provider.kind === "transformers") {
    throw new Error(
      `Eval harness does not support provider kind=${provider.kind}. ` +
        `Switch the user's chat role to an openai-compatible or local provider.`,
    );
  }

  // 3. Derive maxSteps from the resolved provider — mirrors production exactly.
  const maxSteps = maxStepsForKind(provider.kind);

  // 4. Build tools — same as the production /api/chat handler.
  const conversationId = `eval-${c.id}-${Date.now()}`;
  const tools = buildAskAiTools({
    userId: USER_ID,
    conversationId,
    urlBudget: getOrCreateUrlBudget(conversationId),
  });

  // 5. Run streamText via the shared helper.
  const toolPreamble =
    `\n\n---\n\nYou have access to tools to extend your reach: ` +
    `searchKnowledge, readNote, fetchUrl. Stop calling tools as soon ` +
    `as you can answer. Do not exceed ${maxSteps} steps.`;
  const result = runChatStream({
    provider,
    system: system + toolPreamble,
    messages,
    tools,
    maxSteps,
  });

  // 5. Drain textStream to collect the final answer text.
  let answer = "";
  for await (const delta of result.textStream) {
    answer += delta;
  }

  // 6. Pull tool-touched note ids from toolResults.
  const toolResults = await result.toolResults;
  const touchedNoteIds = new Set();
  for (const tr of toolResults ?? []) {
    if (tr.toolName === "searchKnowledge") {
      for (const item of tr.output?.items ?? []) {
        if (item.id) touchedNoteIds.add(item.id);
      }
    }
    if (tr.toolName === "readNote") {
      const noteId = tr.input?.noteId;
      if (noteId) touchedNoteIds.add(noteId);
    }
  }

  return {
    answer,
    touchedNoteIds: [...touchedNoteIds],
    latencyMs: Date.now() - t0,
  };
}

function scoreCase(c, run) {
  // 1. Citation / tool-touched note id coverage.
  const expected = new Set(c.expected_tool_touched_note_ids ?? []);
  const actual = new Set(run.touchedNoteIds);
  const citationScore =
    expected.size === 0
      ? 1
      : [...expected].filter((id) => actual.has(id)).length / expected.size;

  // 2. must_mention presence (case-insensitive substring).
  const ans = run.answer.toLowerCase();
  const mentions = c.must_mention ?? [];
  const mentionHits = mentions.filter((s) => ans.includes(s.toLowerCase()));
  const mentionScore =
    mentions.length === 0 ? 1 : mentionHits.length / mentions.length;

  // 3. must_not_mention absence (binary; any leak fails).
  const negatives = c.must_not_mention ?? [];
  const leaks = negatives.filter((s) => ans.includes(s.toLowerCase()));
  const negativeScore = leaks.length === 0 ? 1 : 0;

  const pass = citationScore === 1 && mentionScore === 1 && negativeScore === 1;

  return {
    citationScore,
    mentionScore,
    negativeScore,
    pass,
    mentionHits,
    leaks,
  };
}

const perCase = [];
for (const c of cases) {
  process.stdout.write(`[${c.id}] ${c.query.slice(0, 40)}... `);
  let run;
  let scored;
  let runtimeError = null;
  try {
    run = await runOneCase(c);
    scored = scoreCase(c, run);
  } catch (err) {
    runtimeError = err.message ?? String(err);
    run = { answer: "", touchedNoteIds: [], latencyMs: 0 };
    scored = {
      citationScore: 0,
      mentionScore: 0,
      negativeScore: 0,
      pass: false,
      mentionHits: [],
      leaks: [],
    };
  }
  perCase.push({
    id: c.id,
    category: c.category,
    query: c.query,
    ...scored,
    answer: run.answer,
    touchedNoteIds: run.touchedNoteIds,
    latencyMs: run.latencyMs,
    runtimeError,
  });
  console.log(
    `${scored.pass ? "PASS" : "FAIL"} ` +
      `(c=${scored.citationScore.toFixed(2)} m=${scored.mentionScore.toFixed(2)} n=${scored.negativeScore.toFixed(2)} ` +
      `${run.latencyMs}ms${runtimeError ? " ERR:" + runtimeError : ""})`,
  );
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const casesWithMentions = perCase.filter((r) => {
  const c = cases.find((x) => x.id === r.id);
  return (c?.must_mention?.length ?? 0) > 0;
});
const casesWithNegatives = perCase.filter((r) => {
  const c = cases.find((x) => x.id === r.id);
  return (c?.must_not_mention?.length ?? 0) > 0;
});

const aggregate = {
  n: perCase.length,
  passRate: perCase.filter((r) => r.pass).length / perCase.length,
  meanCitationScore: mean(perCase.map((r) => r.citationScore)),
  meanMentionScore: mean(perCase.map((r) => r.mentionScore)),
  meanMentionScoreOverNonEmpty:
    casesWithMentions.length === 0
      ? null
      : mean(casesWithMentions.map((r) => r.mentionScore)),
  meanNegativeScore: mean(perCase.map((r) => r.negativeScore)),
  meanNegativeScoreOverNonEmpty:
    casesWithNegatives.length === 0
      ? null
      : mean(casesWithNegatives.map((r) => r.negativeScore)),
  p50LatencyMs: [...perCase.map((r) => r.latencyMs)].sort((a, b) => a - b)[
    Math.floor(perCase.length / 2)
  ],
  runtimeErrors: perCase.filter((r) => r.runtimeError).length,
};

console.log("\nAggregate:");
console.log(`  Pass rate              : ${(aggregate.passRate * 100).toFixed(1)}%`);
console.log(`  Mean citation score    : ${aggregate.meanCitationScore.toFixed(3)}`);
console.log(
  `  Mean mention score     : ${aggregate.meanMentionScore.toFixed(3)} ` +
    `(over non-empty: ${aggregate.meanMentionScoreOverNonEmpty?.toFixed(3) ?? "n/a"}, ` +
    `n=${casesWithMentions.length})`,
);
console.log(
  `  Mean negative score    : ${aggregate.meanNegativeScore.toFixed(3)} ` +
    `(over non-empty: ${aggregate.meanNegativeScoreOverNonEmpty?.toFixed(3) ?? "n/a"}, ` +
    `n=${casesWithNegatives.length})`,
);
console.log(`  p50 latency            : ${aggregate.p50LatencyMs}ms`);
console.log(`  Runtime errors         : ${aggregate.runtimeErrors}/${aggregate.n}`);

const outPath =
  OUT_PATH ??
  resolve(
    repoRoot,
    `eval/results/agent/run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ aggregate, perCase }, null, 2));
console.log(`\nSaved to ${outPath}`);
