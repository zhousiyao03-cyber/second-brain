/**
 * Schema barrel — re-exports every Drizzle table grouped by domain.
 *
 * Files are split by business domain, not technical layer:
 *   auth       — Auth.js users / accounts / credentials
 *   oauth      — OAuth2 authorization server (clients, codes, tokens)
 *   notes      — folders, notes, note-links, bookmarks, todos
 *   chat       — Ask AI chat tasks + daemon streaming deltas
 *   knowledge  — RAG chunks, embeddings, index job queue
 *   workflows  — workflow definitions + runs
 *   learning   — learning paths, lessons, notebook topics/notes/reviews
 *   usage      — AI token usage entries, records, daily counters
 *   focus      — focus tracker activity sessions, device pairing, summaries
 *   portfolio  — portfolio holdings, AI-generated news summaries
 *   projects   — open-source project analysis (projects, prompts, tasks, messages)
 *   ops        — daemon/job heartbeats, CLI tokens
 *   preferences — cross-agent preferences (Agent Context Layer Phase 1)
 *
 * Drizzle-kit picks up every `schema/*.ts` via the config glob, so migrations
 * see the complete set the same way the old single-file schema did.
 *
 * Consumers should keep importing from `@/server/db/schema` — this index
 * resolves that path and avoids needing to know which domain file each table
 * lives in. Drizzle's `import * as schema` pattern also still works.
 */

export * from "./auth";
export * from "./oauth";
export * from "./notes";
export * from "./chat";
export * from "./daemon-conversations";
export * from "./knowledge";
export * from "./workflows";
export * from "./learning";
export * from "./usage";
export * from "./focus";
export * from "./portfolio";
export * from "./projects";
export * from "./ops";
export * from "./billing";
export * from "./council";
export * from "./drifter";
export * from "./ai-providers";
export * from "./preferences";
