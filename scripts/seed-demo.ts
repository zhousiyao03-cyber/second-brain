/**
 * Seed demo data into the local dev test account for screenshot taking.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-demo.ts
 *
 * Idempotent — running twice wipes prior seeded rows and rewrites them.
 * Only touches the dev test account (test@secondbrain.local).
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, inArray } from "drizzle-orm";
import path from "path";
import * as schema from "../src/server/db/schema";

const DEFAULT_SQLITE_DB_PATH = path.join("data", "second-brain.db");
const dbUrl =
  process.env.TURSO_DATABASE_URL ?? `file:${DEFAULT_SQLITE_DB_PATH}`;

const client = createClient({
  url: dbUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const db = drizzle(client, { schema });

const TEST_EMAIL = "test@secondbrain.local";

// Marker tag applied to every seeded row so we can wipe them on re-run.
const SEED_TAG = "__demo-seed";

type Doc = {
  type: "doc";
  content: unknown[];
};

function p(text: string): unknown {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function h(level: number, text: string): unknown {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function code(language: string, code: string): unknown {
  return {
    type: "codeBlock",
    attrs: { language },
    content: [{ type: "text", text: code }],
  };
}

function bullet(items: string[]): unknown {
  return {
    type: "bulletList",
    content: items.map((t) => ({
      type: "listItem",
      content: [p(t)],
    })),
  };
}

function callout(
  tone: "tip" | "warning" | "success" | "pinned",
  text: string
): unknown {
  return {
    type: "calloutBlock",
    attrs: { tone },
    content: [p(text)],
  };
}

function mermaid(code: string): unknown {
  return {
    type: "mermaidBlock",
    attrs: { code },
  };
}

function toc(): unknown {
  return { type: "tocBlock" };
}

function toggle(summary: string, ...children: unknown[]): unknown {
  return {
    type: "toggleBlock",
    attrs: { summary, open: false },
    content: children.length > 0 ? children : [p("")],
  };
}

function taskList(
  items: Array<{ checked: boolean; text: string }>
): unknown {
  return {
    type: "taskList",
    content: items.map((it) => ({
      type: "taskItem",
      attrs: { checked: it.checked },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: it.text }],
        },
      ],
    })),
  };
}

function wikiLink(noteTitle: string, noteId: string | null = null): unknown {
  return {
    type: "text",
    text: noteTitle,
    marks: [
      {
        type: "wikiLink",
        attrs: { noteId, noteTitle },
      },
    ],
  };
}

function pMixed(...parts: unknown[]): unknown {
  return { type: "paragraph", content: parts };
}

function textNode(text: string, marks?: Array<{ type: string }>): unknown {
  return marks ? { type: "text", text, marks } : { type: "text", text };
}

function docOf(...nodes: unknown[]): string {
  const doc: Doc = { type: "doc", content: nodes };
  return JSON.stringify(doc);
}

function plainOf(...lines: string[]) {
  return lines.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────
// Note content fixtures
// ─────────────────────────────────────────────────────────────────

const noteBuildingRag = {
  title: "Building a hybrid RAG pipeline",
  folder: "Engineering",
  tags: ["rag", "ai", "architecture"],
  plain: plainOf(
    "Architecture",
    "Hybrid retrieval is the idea of combining lexical search (BM25) with dense vector search.",
    "The query layer blends both scores with a reciprocal rank fusion.",
    "Why hybrid beats vector-only",
    "Vector search misses rare tokens (product names, SKUs, uncommon proper nouns).",
    "BM25 anchors recall on exact matches, dense retrieval fills in the semantic neighbours.",
    "Pipeline",
    "Chunk -> embed -> index -> query",
    "Pitfalls",
    "Chunking window matters more than the embedding model in most cases.",
    "Use overlap but deduplicate on text-hash."
  ),
  content: docOf(
    h(1, "Building a hybrid RAG pipeline"),
    p(
      "Notes from rewiring the Knosi retrieval layer over the last two weeks."
    ),
    toc(),
    pMixed(
      textNode("Pre-req reading: "),
      wikiLink("Turso migration checklist"),
      textNode(" — the storage layer underneath this.")
    ),
    h(2, "Why hybrid beats vector-only"),
    bullet([
      "Vector search misses rare tokens (product names, SKUs, uncommon proper nouns).",
      "BM25 anchors recall on exact matches; dense retrieval fills in semantic neighbours.",
      "Reciprocal rank fusion is surprisingly hard to beat with a learned reranker at small scale.",
    ]),
    callout(
      "tip",
      "If you only remember one thing: chunking window matters more than the embedding model in most real-world corpora."
    ),
    h(2, "Pipeline diagram"),
    mermaid(
      [
        "flowchart LR",
        "  A[Note / Bookmark] --> B[Chunker]",
        "  B --> C[Embedder]",
        "  C --> D[(Vector index)]",
        "  B --> E[(BM25 index)]",
        "  Q[Query] --> D",
        "  Q --> E",
        "  D --> F[RRF fusion]",
        "  E --> F",
        "  F --> G[Top-k context]",
      ].join("\n")
    ),
    h(2, "Fusion math"),
    p(
      "Reciprocal rank fusion assigns each document a score of 1 / (k + rank) in each list, sums across lists, then sorts. k is usually 60."
    ),
    code(
      "typescript",
      [
        "export function rrf<T extends { id: string }>(",
        "  lists: T[][],",
        "  k = 60",
        ") {",
        "  const scores = new Map<string, number>();",
        "  for (const list of lists) {",
        "    list.forEach((doc, idx) => {",
        "      const prev = scores.get(doc.id) ?? 0;",
        "      scores.set(doc.id, prev + 1 / (k + idx + 1));",
        "    });",
        "  }",
        "  return [...scores]",
        "    .sort((a, b) => b[1] - a[1])",
        "    .map(([id, score]) => ({ id, score }));",
        "}",
      ].join("\n")
    ),
    h(2, "Parameters I ended up with"),
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [p("Stage")] },
            { type: "tableHeader", content: [p("Value")] },
            { type: "tableHeader", content: [p("Notes")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("Chunk size")] },
            { type: "tableCell", content: [p("512 tokens")] },
            { type: "tableCell", content: [p("with 64 token overlap")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("Embedding")] },
            { type: "tableCell", content: [p("text-embedding-3-small")] },
            { type: "tableCell", content: [p("1536 dims, fp16 stored")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("BM25 k1 / b")] },
            { type: "tableCell", content: [p("1.2 / 0.75")] },
            { type: "tableCell", content: [p("default, do not over-tune")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("RRF k")] },
            { type: "tableCell", content: [p("60")] },
            { type: "tableCell", content: [p("literature default; stable")] },
          ],
        },
      ],
    },
    callout(
      "warning",
      "Deduplicate aggressively before indexing. Duplicate chunks eat top-k slots and visibly hurt answer quality."
    ),
    h(2, "Further reading"),
    toggle(
      "Papers I actually re-read (click to expand)",
      p(
        "Karpukhin et al., Dense Passage Retrieval (DPR), 2020. Still the baseline any serious retrieval system is benchmarked against."
      ),
      p(
        "Cormack et al., Reciprocal Rank Fusion, 2009. Embarrassingly simple, embarrassingly hard to beat."
      ),
      p(
        "Khattab & Zaharia, ColBERT, 2020. If you outgrow naive dense retrieval, this is where you go next."
      )
    ),
    toggle(
      "Open questions parked for later",
      bullet([
        "Is it worth training a small reranker on user feedback?",
        "Do query rewrites help or hurt when the corpus is the user's own notes?",
        "Should we index code blocks and prose on different embedding models?",
      ])
    ),
    callout(
      "success",
      "Outcome: recall@10 went from 0.61 (vector-only) to 0.82 (hybrid+RRF) on a hand-labelled 200-query eval set. That is the single biggest quality win since the project started."
    )
  ),
};

const noteTursoMigration = {
  title: "Turso migration checklist",
  folder: "Engineering",
  tags: ["infra", "sqlite", "ops"],
  plain: plainOf(
    "Turso migration checklist",
    "Before flipping TURSO_DATABASE_URL to libsql://, verify schema parity, run dry-run queries, back up the local file.",
    "Schema parity: drizzle-kit introspect then diff.",
    "Replica lag: acceptable, reads go to primary until cutover."
  ),
  content: docOf(
    h(1, "Turso migration checklist"),
    p(
      "Pre-flight for moving the production DB off a single SQLite file onto Turso without downtime."
    ),
    h(2, "Before the switch"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Snapshot local SQLite file to S3")],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Run drizzle-kit introspect on Turso primary, diff")],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Verify read-after-write behavior in staging")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("Cut over DNS, keep old SQLite read-only for 24h")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("Delete local file after smoke period")],
        },
      ],
    },
    callout(
      "warning",
      "Turso replicas have eventual consistency. Keep critical writes + reads on the primary until every call site is audited."
    ),
    h(2, "Commands I actually ran"),
    code(
      "bash",
      [
        "turso db create knosi-prod",
        "turso db shell knosi-prod < migrations/0000_init.sql",
        "turso db tokens create knosi-prod",
        "# then update .env.production and redeploy",
      ].join("\n")
    )
  ),
};

const noteProductIdeas = {
  title: "Product ideas — hosted Knosi",
  folder: "Product",
  tags: ["product", "roadmap"],
  plain: plainOf(
    "Ideas for the hosted tier.",
    "Team workspaces, shared folders, per-user AI quota.",
    "Connectors: Notion, Obsidian, GitHub, Linear.",
    "SEO: topic pages, landing per integration."
  ),
  content: docOf(
    h(1, "Product ideas — hosted Knosi"),
    p("Raw dump, no prioritisation yet."),
    callout(
      "pinned",
      "North star: every feature should make AI output easier to capture, retrieve, or reuse. If a proposal does not move any of those three, park it."
    ),
    h(3, "Team workspaces"),
    bullet([
      "Shared folders with read / write / admin roles.",
      "Per-user AI quota so one noisy teammate cannot burn the whole budget.",
      "Audit log in the sidebar.",
    ]),
    h(3, "Connectors"),
    bullet([
      "Notion — read-only sync, keep Knosi as the AI layer.",
      "Obsidian — vault watcher over local REST.",
      "GitHub — issues + discussions as structured notes.",
      "Linear — bring ticket context into Ask.",
    ]),
    h(3, "SEO"),
    bullet([
      "Topic pages generated from popular Ask queries.",
      "Integration landing pages (/integrations/notion, etc).",
      "Open-graph previews for shared notes.",
    ])
  ),
};

const noteDailyJournal = {
  title: "2026年4月17日 星期五",
  folder: null,
  tags: ["journal"],
  type: "journal" as const,
  plain: plainOf(
    "Today's todo",
    "Fix canonical URL redirect",
    "Deploy landing page rewrite",
    "Today's review",
    "Shipped the hosted-product landing page. Fixed three incorrect CTAs.",
    "Tomorrow's plan",
    "Seed demo data, take product screenshots"
  ),
  content: docOf(
    h(3, "Today's todo"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Fix canonical URL redirect")],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Deploy landing page rewrite")],
        },
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [p("Add JSON-LD (SoftwareApplication + FAQPage)")],
        },
      ],
    },
    h(3, "Today's review"),
    p(
      "Shipped the hosted-product landing page rewrite. Three CTAs were still pointing at self-hosted flows and one nav link went to the wrong GitHub repo — all fixed. The big win is the page now sells what is actually live."
    ),
    h(3, "Tomorrow's plan"),
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("Seed demo data locally")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("Take clean product screenshots")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [p("Wire screenshots into landing hero")],
        },
      ],
    }
  ),
};

const noteReadingNotes = {
  title: "Reading — Designing Data-Intensive Applications, ch.5",
  folder: "Reading",
  tags: ["books", "distributed-systems"],
  plain: plainOf(
    "Chapter 5: Replication",
    "Leader-based, multi-leader, leaderless — trade-offs on consistency vs availability.",
    "Sync vs async replication: async is the usual default; sync on just one follower gives you a middle ground.",
    "Replication lag is the dominant source of weird bugs in production."
  ),
  content: docOf(
    h(1, "Designing Data-Intensive Applications — Chapter 5"),
    p("Replication. The part of the book I keep re-reading."),
    h(3, "Three strategies"),
    bullet([
      "Leader-based — easiest to reason about, well-understood failure modes.",
      "Multi-leader — needed for geo-distributed writes, but conflict resolution is painful.",
      "Leaderless (Dynamo-style) — quorums over R + W > N, tolerant but surprising.",
    ]),
    h(3, "Replication lag pathologies"),
    bullet([
      "Reading your own writes — fixable with sticky sessions or read-after-write on primary.",
      "Monotonic reads — make sure subsequent reads hit the same replica.",
      "Consistent prefix reads — important for causally-linked events (chat messages, edits).",
    ]),
    callout(
      "tip",
      "Most production bugs in distributed apps are not exotic — they are replication lag surfacing in edge UI states."
    )
  ),
};

const noteDebuggingSqlite = {
  title: "Debugging: SQLite EBUSY on Windows",
  folder: "Engineering",
  tags: ["debugging", "windows", "sqlite"],
  plain: plainOf(
    "Symptom: Playwright harness fails to create test DB on Windows with EBUSY.",
    "Cause: the dev server still has an open handle to the same .db file.",
    "Fix: set a distinct SQLITE_DB_PATH for e2e, and kill node processes on teardown."
  ),
  content: docOf(
    h(1, "Debugging: SQLite EBUSY on Windows"),
    h(3, "Symptom"),
    code(
      "",
      "Error: EBUSY: resource busy or locked, unlink 'D:\\repos\\knosi\\data\\second-brain.e2e.db'"
    ),
    h(3, "Root cause"),
    p(
      "Windows does not let you unlink a file while another process holds an open handle. The dev server opened a write-through handle to second-brain.db; the e2e harness picked the same path because SQLITE_DB_PATH was not set."
    ),
    h(3, "Fix"),
    bullet([
      "Set SQLITE_DB_PATH=data/second-brain.e2e.db in playwright.config.ts env",
      "Ensure next dev is not pointing at the same file when running e2e",
      "On teardown, kill stray node processes holding the handle",
    ]),
    callout(
      "success",
      "This is a Windows-only failure. macOS and Linux allow unlink with open handles, which is why the CI box never caught it."
    )
  ),
};

const noteAskPrompts = {
  title: "Prompts library — Ask workflows",
  folder: "Prompts",
  tags: ["prompts", "ai"],
  plain: plainOf(
    "Prompt templates I reuse when asking Knosi questions across my own corpus.",
    "Explain like I wrote it",
    "Compare and contrast",
    "Find contradictions",
    "Generate a study quiz"
  ),
  content: docOf(
    h(1, "Prompts library — Ask workflows"),
    p(
      "Templates I paste into Ask. Each one assumes the retrieved context is already injected."
    ),
    h(3, "Explain like I wrote it"),
    code(
      "",
      "Using only the notes attached, summarise what past-me seemed to believe about <TOPIC>. Use my own phrasing where possible. Flag anywhere the notes contradict each other."
    ),
    h(3, "Compare and contrast"),
    code(
      "",
      "Take the attached notes on <A> and <B>. Produce a side-by-side table of positions, evidence, and open questions. Do not invent references that are not in the notes."
    ),
    h(3, "Find contradictions"),
    code(
      "",
      "Look for any claims that mutually contradict across the attached notes on <TOPIC>. Quote the conflicting sentences and their source note titles."
    )
  ),
};

const seedNotes = [
  noteBuildingRag,
  noteTursoMigration,
  noteProductIdeas,
  noteDailyJournal,
  noteReadingNotes,
  noteDebuggingSqlite,
  noteAskPrompts,
];

// ─────────────────────────────────────────────────────────────────
// OS Projects fixtures
// ─────────────────────────────────────────────────────────────────

const seedProjects = [
  {
    name: "zed-industries/zed",
    repoUrl: "https://github.com/zed-industries/zed",
    description:
      "Code at the speed of thought — Zed is a high-performance, multiplayer code editor from the creators of Atom and Tree-sitter.",
    language: "Rust",
    starsCount: 68400,
    aiSummary:
      "Zed is written in Rust and renders the entire UI with a GPU-first framework called gpui. The interesting engineering is: (1) a CRDT-based collaborative buffer shared across processes; (2) an async language-server protocol layer that keeps the main thread free; (3) tree-sitter parses every buffer on every keystroke, fast enough because of incremental re-parsing.",
    notes: [
      {
        title: "Architecture: gpui",
        plain:
          "Zed's UI framework. GPU-accelerated, retained-mode, written from scratch to avoid Electron-class overhead. Closest analogy is Flutter's rendering model but in Rust.",
      },
      {
        title: "Collaboration model",
        plain:
          "Shared buffer is a CRDT. Peers sync via a central relay. The editor is designed around multiplayer from day one — every single buffer is technically replicated.",
      },
    ],
  },
  {
    name: "vercel/next.js",
    repoUrl: "https://github.com/vercel/next.js",
    description:
      "The React Framework — used by some of the world's largest companies, Next.js enables you to create high-quality web applications.",
    language: "JavaScript",
    starsCount: 137200,
    aiSummary:
      "Next.js is a large monorepo. The interesting subdirs are packages/next (the framework itself), packages/next-swc (Rust-based compiler and bundler glue, including Turbopack), and packages/next-codemod (migration tooling). The App Router's data layer is implemented via React Server Components streamed over a custom RSC protocol.",
    notes: [
      {
        title: "App Router vs Pages Router",
        plain:
          "App Router is the strategic direction. Pages Router is maintenance-mode but not going away. Server Components are the differentiating feature — moving the boundary between server and client into the component graph.",
      },
    ],
  },
  {
    name: "drizzle-team/drizzle-orm",
    repoUrl: "https://github.com/drizzle-team/drizzle-orm",
    description:
      "Headless TypeScript ORM with a strong focus on type safety and a SQL-like query builder.",
    language: "TypeScript",
    starsCount: 28800,
    aiSummary:
      "Drizzle is a TypeScript-first ORM that is essentially a typed query builder. Unlike Prisma it does not generate a client at build time — schema is just TS source, and runtime queries are typed against it. Main modules: drizzle-orm (runtime), drizzle-kit (migrations + studio), drizzle-zod (schema -> zod bridge).",
    notes: [
      {
        title: "Why it pairs well with SQLite / Turso",
        plain:
          "Drizzle emits plain SQL and works uniformly against local SQLite, Turso libsql, and PostgreSQL. The same schema file drives all three.",
      },
    ],
  },
  {
    name: "anthropic/claude-code",
    repoUrl: "https://github.com/anthropic/claude-code",
    description:
      "Claude Code is Anthropic's official CLI for Claude, focused on agentic coding workflows.",
    language: "TypeScript",
    starsCount: 15600,
    aiSummary:
      "Claude Code is a terminal agent built on Anthropic's tool-use API. The architecture is a planner + tool-runner loop; tools include file edits, shell execution, and web fetch. It is opinionated about TDD and explicit verification (build + lint + test) — those biases show up in the system prompt.",
    notes: [],
  },
];

// ─────────────────────────────────────────────────────────────────
// Learning notebook fixtures
// ─────────────────────────────────────────────────────────────────

const seedLearningTopics = [
  {
    title: "Distributed systems from scratch",
    description:
      "Working through Designing Data-Intensive Applications plus selected papers. Goal: build intuition for consistency, replication, consensus.",
    icon: "🌐",
    notes: [
      {
        title: "Replication strategies",
        plain:
          "Single-leader vs multi-leader vs leaderless. Trade-offs live on the consistency/availability axis. Most apps should stay single-leader until forced off.",
      },
      {
        title: "Quorum math",
        plain:
          "R + W > N guarantees at least one replica has the latest write. N=3, R=W=2 is the common Dynamo choice.",
      },
      {
        title: "Consensus: Paxos vs Raft",
        plain:
          "Raft trades some theoretical elegance for comprehensibility. If you're writing a new system in 2026, Raft almost always wins on maintainability.",
      },
    ],
  },
  {
    title: "Rust — from 'reads' to 'writes'",
    description:
      "Pushing past ability to read Rust into actually writing it. Focus on ownership intuition, async, and the stdlib.",
    icon: "🦀",
    notes: [
      {
        title: "Ownership as a borrow checker mental model",
        plain:
          "Think of & and &mut as locks, not pointers. The borrow checker is enforcing that no two writers and no writer+reader coexist. That reframing made everything click.",
      },
      {
        title: "Async fundamentals",
        plain:
          "Futures are poll-based, zero-cost until awaited. Tokio is the runtime you will use 95% of the time; async-std is effectively retired.",
      },
    ],
  },
  {
    title: "LLM application engineering",
    description:
      "Notes on building real products around LLMs — prompts, retrieval, evals, cost control.",
    icon: "🤖",
    notes: [
      {
        title: "Evals over vibes",
        plain:
          "The biggest shift in 2025 was moving from 'tweak prompt until it feels better' to a real eval harness. LangSmith / Braintrust / home-grown — pick one, commit.",
      },
      {
        title: "Prompt caching",
        plain:
          "Anthropic prompt cache has a 5-minute TTL. Structure prompts so the cacheable prefix (system + stable context) comes first, user turn last. Real 70%+ cost savings on long-running agents.",
      },
      {
        title: "Retrieval is the quality lever",
        plain:
          "Model choice matters less than retrieval quality at the scales most apps operate at. Invest in chunking, hybrid retrieval, and dedupe before bigger models.",
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
// Seed helpers
// ─────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ─────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────

async function wipePriorSeed(userId: string) {
  // Delete rows where tags contains SEED_TAG marker, or cascade-owned rows
  // below that were bulk-created for demo. Notes/learning notes/os_projects
  // all have userId scoping, so we can be aggressive.

  // 1. Notes — we tag every seeded note with SEED_TAG
  const seedNotesRows = await db
    .select({ id: schema.notes.id })
    .from(schema.notes)
    .where(eq(schema.notes.userId, userId));

  const notesToDelete = seedNotesRows
    .map((r) => r.id)
    .filter((id) => id.startsWith("seed-"));

  if (notesToDelete.length > 0) {
    await db
      .delete(schema.notes)
      .where(
        and(
          eq(schema.notes.userId, userId),
          inArray(schema.notes.id, notesToDelete)
        )
      );
  }

  // 2. Folders — delete seeded folders (we create them with id prefix seed-folder-)
  const seedFolders = await db
    .select({ id: schema.folders.id })
    .from(schema.folders)
    .where(eq(schema.folders.userId, userId));
  const foldersToDelete = seedFolders
    .map((r) => r.id)
    .filter((id) => id.startsWith("seed-folder-"));
  if (foldersToDelete.length > 0) {
    await db
      .delete(schema.folders)
      .where(inArray(schema.folders.id, foldersToDelete));
  }

  // 3. OS projects (+cascade notes)
  const seedProjectsRows = await db
    .select({ id: schema.osProjects.id })
    .from(schema.osProjects)
    .where(eq(schema.osProjects.userId, userId));
  const projectsToDelete = seedProjectsRows
    .map((r) => r.id)
    .filter((id) => id.startsWith("seed-"));
  if (projectsToDelete.length > 0) {
    await db
      .delete(schema.osProjects)
      .where(inArray(schema.osProjects.id, projectsToDelete));
  }

  // 4. Learning topics (+cascade notes)
  const topicsRows = await db
    .select({ id: schema.learningTopics.id })
    .from(schema.learningTopics)
    .where(eq(schema.learningTopics.userId, userId));
  const topicsToDelete = topicsRows
    .map((r) => r.id)
    .filter((id) => id.startsWith("seed-"));
  if (topicsToDelete.length > 0) {
    await db
      .delete(schema.learningTopics)
      .where(inArray(schema.learningTopics.id, topicsToDelete));
  }

  // 5. Focus — activity sessions, daily summaries (all seed data, wipe user-scoped)
  await db
    .delete(schema.activitySessions)
    .where(eq(schema.activitySessions.userId, userId));
  await db
    .delete(schema.focusDailySummaries)
    .where(eq(schema.focusDailySummaries.userId, userId));

  // 6. Usage — token entries + usage records
  await db
    .delete(schema.tokenUsageEntries)
    .where(eq(schema.tokenUsageEntries.userId, userId));
  await db
    .delete(schema.usageRecords)
    .where(eq(schema.usageRecords.userId, userId));
}

// ─────────────────────────────────────────────────────────────────
// Seeders
// ─────────────────────────────────────────────────────────────────

async function seedFoldersFor(userId: string) {
  const folderNames = Array.from(
    new Set(seedNotes.map((n) => n.folder).filter((f): f is string => !!f))
  );
  const idByName = new Map<string, string>();

  for (const [i, name] of folderNames.entries()) {
    const id = `seed-folder-${hashString(name).toString(36)}`;
    idByName.set(name, id);
    await db.insert(schema.folders).values({
      id,
      userId,
      name,
      parentId: null,
      sortOrder: i,
    });
  }
  return idByName;
}

async function seedNotesFor(
  userId: string,
  folderIds: Map<string, string>,
  now: Date
) {
  for (const [i, n] of seedNotes.entries()) {
    const id = `seed-note-${i}-${hashString(n.title).toString(36)}`;
    const createdAt = addDays(now, -i - 1);
    const tags = [...n.tags, SEED_TAG];
    await db.insert(schema.notes).values({
      id,
      userId,
      title: n.title,
      content: n.content,
      plainText: n.plain,
      type: (n as { type?: "note" | "journal" | "summary" }).type ?? "note",
      tags: JSON.stringify(tags),
      folder: n.folder ?? null,
      folderId: n.folder ? folderIds.get(n.folder) ?? null : null,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    });
  }
}

async function seedOsProjectsFor(userId: string, now: Date) {
  for (const [i, proj] of seedProjects.entries()) {
    const id = `seed-project-${hashString(proj.name).toString(36)}`;
    const createdAt = addDays(now, -i - 2);
    await db.insert(schema.osProjects).values({
      id,
      userId,
      name: proj.name,
      repoUrl: proj.repoUrl,
      description: proj.description,
      language: proj.language,
      aiSummary: proj.aiSummary,
      analysisStatus: "completed",
      analysisFinishedAt: createdAt,
      starsCount: proj.starsCount,
      createdAt,
      updatedAt: createdAt,
    });

    for (const [j, note] of proj.notes.entries()) {
      const noteId = `seed-proj-note-${i}-${j}`;
      const paragraphs = note.plain.split(/\n\n+/).map((t) => p(t));
      await db.insert(schema.osProjectNotes).values({
        id: noteId,
        projectId: id,
        userId,
        title: note.title,
        content: docOf(h(2, note.title), ...paragraphs),
        plainText: note.plain,
        tags: JSON.stringify([SEED_TAG]),
        noteType: "manual",
        createdAt,
        updatedAt: createdAt,
      });
    }
  }
}

async function seedLearningFor(userId: string, now: Date) {
  for (const [i, topic] of seedLearningTopics.entries()) {
    const topicId = `seed-topic-${hashString(topic.title).toString(36)}`;
    const createdAt = addDays(now, -i - 3);
    await db.insert(schema.learningTopics).values({
      id: topicId,
      userId,
      title: topic.title,
      description: topic.description,
      icon: topic.icon,
      createdAt,
      updatedAt: createdAt,
    });

    for (const [j, n] of topic.notes.entries()) {
      const id = `seed-lnote-${i}-${j}`;
      const noteCreated = addDays(createdAt, j);
      await db.insert(schema.learningNotes).values({
        id,
        topicId,
        userId,
        title: n.title,
        content: docOf(h(2, n.title), ...n.plain.split(/\n\n+/).map((x) => p(x))),
        plainText: n.plain,
        tags: JSON.stringify([SEED_TAG]),
        createdAt: noteCreated,
        updatedAt: noteCreated,
      });
    }
  }
}

// Focus: 30 days of activity sessions + daily summaries.
// Realistic-looking: 8-11h totals on weekdays, 4-6h weekends, one anomaly day.
async function seedFocusFor(userId: string, now: Date) {
  const deviceId = "seed-device-demo";
  const timezone = "Asia/Shanghai";

  type AppMix = { app: string; title: string; tag: string; weight: number };
  const appMix: AppMix[] = [
    { app: "Visual Studio Code", title: "knosi — src/app", tag: "coding", weight: 40 },
    { app: "Windows Terminal", title: "pwsh — pnpm dev", tag: "coding", weight: 15 },
    { app: "Chrome", title: "GitHub · zhousiyao03-cyber/knosi", tag: "coding", weight: 10 },
    { app: "Chrome", title: "Next.js docs — App Router", tag: "reference", weight: 8 },
    { app: "Chrome", title: "Linear — In Progress", tag: "planning", weight: 7 },
    { app: "Claude", title: "Ask — retrieval pipeline", tag: "ai", weight: 10 },
    { app: "Slack", title: "#engineering", tag: "communication", weight: 6 },
    { app: "Figma", title: "Knosi — landing-v2", tag: "design", weight: 4 },
  ];
  const totalWeight = appMix.reduce((a, b) => a + b.weight, 0);

  for (let offset = 29; offset >= 0; offset--) {
    const day = startOfDay(addDays(now, -offset));
    const dateStr = isoDate(day);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;

    // Total focus minutes for the day — some variance, one anomaly low day (offset==17).
    let totalMin: number;
    if (offset === 17) totalMin = 120; // anomaly low day
    else if (isWeekend) totalMin = 240 + ((offset * 37) % 120);
    else totalMin = 480 + ((offset * 53) % 180);

    // Distribute across sessions of ~20-40 minutes each.
    const tagTotals: Record<string, number> = {};
    let remaining = totalMin;
    let cursor = new Date(day);
    cursor.setHours(9, 0, 0, 0);

    let sessionIdx = 0;
    while (remaining > 0) {
      const sessionMin = Math.min(remaining, 20 + ((sessionIdx * 11 + offset) % 25));
      // Weighted pick
      let pick = appMix[0];
      const r = ((sessionIdx * 17 + offset * 7) % totalWeight) + 1;
      let acc = 0;
      for (const m of appMix) {
        acc += m.weight;
        if (r <= acc) {
          pick = m;
          break;
        }
      }

      const startedAt = new Date(cursor);
      const endedAt = new Date(cursor.getTime() + sessionMin * 60 * 1000);

      await db.insert(schema.activitySessions).values({
        userId,
        sourceDeviceId: deviceId,
        sourceSessionId: `seed-${dateStr}-${sessionIdx}`,
        appName: pick.app,
        windowTitle: pick.title,
        startedAt,
        endedAt,
        durationSecs: sessionMin * 60,
        tags: JSON.stringify([pick.tag]),
        ingestionStatus: "processed",
        ingestedAt: endedAt,
        createdAt: startedAt,
        updatedAt: endedAt,
      });

      tagTotals[pick.tag] = (tagTotals[pick.tag] ?? 0) + sessionMin * 60;
      remaining -= sessionMin;
      cursor = new Date(endedAt.getTime() + 5 * 60 * 1000); // small breaks
      sessionIdx += 1;
    }

    await db.insert(schema.focusDailySummaries).values({
      userId,
      date: dateStr,
      timezone,
      totalFocusSecs: totalMin * 60,
      tagBreakdown: JSON.stringify(tagTotals),
      sourceUpdatedAt: day,
      generatedAt: day,
      createdAt: day,
      updatedAt: day,
    });
  }
}

// Usage: 30 days of token usage, two providers (claude-code, codex).
async function seedUsageFor(userId: string, now: Date) {
  const providers: Array<{
    provider: "codex" | "claude-code";
    model: string;
    dailyBase: number;
  }> = [
    { provider: "claude-code", model: "claude-opus-4-7", dailyBase: 650_000 },
    { provider: "claude-code", model: "claude-sonnet-4-6", dailyBase: 380_000 },
    { provider: "codex", model: "gpt-5-codex", dailyBase: 220_000 },
  ];

  for (let offset = 29; offset >= 0; offset--) {
    const day = startOfDay(addDays(now, -offset));
    const dateStr = isoDate(day);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dayFactor = isWeekend ? 0.35 : 0.8 + ((offset * 29) % 50) / 100;

    for (const [i, p] of providers.entries()) {
      const total = Math.round(p.dailyBase * dayFactor);
      if (total <= 0) continue;

      const input = Math.round(total * 0.35);
      const cacheRead = Math.round(total * 0.4);
      const cacheWrite = Math.round(total * 0.1);
      const output = total - input - cacheRead - cacheWrite;

      // Usage records (daily aggregate)
      await db.insert(schema.usageRecords).values({
        userId,
        date: dateStr,
        provider: p.provider,
        model: p.model,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        createdAt: day,
        updatedAt: day,
      });

      // Token usage entries (individual rows, just one/day/provider — enough for charts)
      const usageAt = new Date(day);
      usageAt.setHours(18 + i, 0, 0, 0);
      await db.insert(schema.tokenUsageEntries).values({
        id: `seed-usage-${dateStr}-${p.provider}-${p.model}`,
        userId,
        provider: p.provider,
        model: p.model,
        totalTokens: total,
        inputTokens: input,
        outputTokens: output,
        cachedTokens: cacheRead,
        source: "import",
        usageAt,
        createdAt: usageAt,
        updatedAt: usageAt,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed] Using database: ${dbUrl}`);

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, TEST_EMAIL))
    .limit(1);

  if (!user) {
    console.error(
      `[seed] Test user not found: ${TEST_EMAIL}. Visit /login once to auto-create it, then rerun.`
    );
    process.exit(1);
  }

  console.log(`[seed] Wiping prior seed for user ${user.id} (${TEST_EMAIL})...`);
  await wipePriorSeed(user.id);

  const now = new Date();

  console.log(`[seed] Folders...`);
  const folderIds = await seedFoldersFor(user.id);

  console.log(`[seed] Notes (${seedNotes.length})...`);
  await seedNotesFor(user.id, folderIds, now);

  console.log(`[seed] OS projects (${seedProjects.length})...`);
  await seedOsProjectsFor(user.id, now);

  console.log(`[seed] Learning topics (${seedLearningTopics.length})...`);
  await seedLearningFor(user.id, now);

  console.log(`[seed] Focus (30 days)...`);
  await seedFocusFor(user.id, now);

  console.log(`[seed] Usage (30 days)...`);
  await seedUsageFor(user.id, now);

  console.log(`[seed] Done. Login at http://localhost:3200/login`);
  console.log(`[seed]   email:    ${TEST_EMAIL}`);
  console.log(`[seed]   password: test123456`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
