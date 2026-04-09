[English](README.md) | [中文](README.zh-CN.md)

# Second Brain

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss) ![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?logo=trpc) ![SQLite](https://img.shields.io/badge/SQLite-libsql%2FTurso-003B57?logo=sqlite) ![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright)

An AI-powered Second Brain for personal knowledge workflows.

Consolidate notes, scattered information, and conversations in one place, then use AI for retrieval, Q&A, and review — no more switching between documents, chat logs, and fleeting ideas.

Live demo:
- https://second-brain-self-alpha.vercel.app/

## Why This Project Is Worth a Look

- **Not a chat wrapper**: The core is a closed loop of "knowledge accumulation -> retrieval -> Q&A -> continuous growth", not one-off conversations.
- **Editor that holds its own**: Built-in block editing experience close to Notion workflows — suitable for real note-taking.
- **Ask AI gives grounded answers**: Chunk-level hybrid RAG based on your knowledge base, with source citations.
- **Engineering-complete**: Includes authentication, data isolation, E2E tests, build pipeline, and a deployed URL — not stuck at the demo stage.
- **Interesting for AI developers too**: Beyond knowledge Q&A, you can view local Codex / Claude Code token usage.

## Who Is This For

- People who want to build their own AI knowledge base instead of scattering content across multiple tools
- People who want to see a learning-oriented project that starts from frontend product sense and progressively builds full-stack capabilities
- People looking for a reference implementation of Next.js 16 + tRPC + Auth.js + AI SDK + SQLite/Turso

## Features

- **Authentication** — Auth.js v5 + GitHub / Google OAuth + email-password registration/login; supports changing nickname, email, and local password in account settings; full multi-user data isolation; PWA / iOS Web App metadata for stable login persistence after home screen installation
- **Notes** — Notion-style block editor with:
  - Full-width 280px cover image with built-in background gallery, lightweight type/tag metadata row
  - Row-level hover insert, 324 x 385 categorized insert panel, block menu (move up/down/copy/delete/transform), Slash commands
  - Drag-and-drop block sorting, Todo/lists, Callout / Toggle, H1–H6 headings
  - Tables (with toolbar), text color, Mermaid diagrams, Excalidraw whiteboard
  - Image upload/drag/paste, four-corner handle resize, drag-merge side-by-side image rows (drag out to split)
  - Code block language selector, search & replace, keyboard shortcut hints
  - TOC block + collapsible TOC sidebar
  - Mermaid diagram full-screen view + inline editing (live preview)
  - Mixed Markdown paste (auto-detects Mermaid code blocks and Markdown tables, converts to rich text)
  - Auto-save + content loss prevention
  - One-click daily journal from home page and notes page; journal title shows "date + day of week", comes with three default template blocks, and can inherit incomplete plans from the most recent journal
- **Learning Notebook** — Organize learning content by topic, with topic cards (editable/deletable), per-topic note lists, tag filtering, AI draft generation, knowledge outline / blind spot analysis / review question generation, and Ask AI based on topic note context
- **Open Source Projects** — Accumulate code reading notes organized by project, with repo metadata, in-project note editing, tag filtering, and long-term analysis archiving
- **Portfolio** — Investment portfolio tracking with position management (stocks/crypto), Yahoo Finance + CoinGecko real-time prices, AI position analysis, GPT news aggregation (Marketaux / Google News RSS) with Vercel Cron auto-refresh
- **Search** — Cmd+K global note search with keyword highlighting
- **Ask AI** — Chunk-level hybrid RAG Q&A based on your knowledge base, supporting semantic retrieval, keyword recall, adjacent paragraph expansion, and clickable source citations
- **Token Usage** — Auto-reads local Codex / Claude Code sessions (including Claude subagents, aggregated across workspaces) to display real token usage; also supports manual entry for OpenAI API / other sources, unified in Dashboard and dedicated page (disabled by default in production, can be enabled for local dev)
- **Focus Tracker** — Server-side ingestion, dashboard focus card, and `/focus` page; web UI accumulates per-app usage duration from same-day raw sessions, collapsing <10m short sessions by default; supports device pairing (pairing code -> per-device token), manual refresh of categorization, and daily summary. Desktop Tauri collector has been migrated to a [separate repository](https://github.com/zhousiyao03-cyber/focus-tracker)
- **Dashboard** — Stats overview + recent entries + token usage aggregate overview
- **Dark Mode** — Global toggle

Frozen modules (code retained but entry points hidden by default): Bookmarks, Todo, AI Explorer

## Product Preview

- **Home**: Aggregates recent notes and token usage — see global status at a glance
- **Notes**: Centered on editing experience, supports quick capture and structured organization (Mermaid, Excalidraw, tables, side-by-side images, TOC, etc.)
- **Learning Notebook**: Continuously write, ask, and review around a learning topic
- **Open Source Projects**: Save code reading conclusions and architecture excerpts per project
- **Portfolio**: Track positions, real-time prices, and related news
- **Ask AI**: Query your knowledge base, get answers with source citations
- **Search**: Use `Cmd+K` to quickly find notes

To see it in action, open the live demo:
- https://second-brain-self-alpha.vercel.app/

If you add the site to your iPhone home screen as an app, it's recommended to delete the old icon after upgrades and re-add from the live URL. iOS home screen Web Apps and Safari tabs use separate website data containers — re-installing and logging in again is more stable.

## Tech Stack

- Next.js 16 (App Router) + React 19
- Tailwind CSS v4
- tRPC v11 + Zod v4
- Drizzle ORM + SQLite (libsql / Turso)
- Auth.js v5 (GitHub / Google OAuth)
- Vercel AI SDK v6 + OpenClaw / Codex OAuth (default `gpt-5.4`) / OpenAI API / local OpenAI-compatible model services
- @excalidraw/excalidraw + mermaid (editor whiteboard and diagrams)
- @mozilla/readability + linkedom
- Playwright (E2E)

## Quick Start

```bash
nvm use          # Use the Node version pinned in .nvmrc (run nvm install first if needed)
pnpm install
cp .env.example .env.local
pnpm db:push       # Initialize the database
pnpm dev            # Start dev server at http://localhost:3200
```

In local development mode, the login page automatically ensures a fixed TEST account exists for quick access:

```text
Email: test@secondbrain.local
Password: test123456
```

This account is only auto-created or reset when `NODE_ENV=development` and does not affect production.

You need to generate `.env.local` from the `.env.example` in the repository, then adjust environment variables as needed. Full environment variable example:

```bash
# .env.local example

# ── Database ─────────────────────────────────────────
TURSO_DATABASE_URL=file:data/second-brain.db  # Local dev

# ── Authentication ───────────────────────────────────
AUTH_SECRET=local-dev-secret
# AUTH_GITHUB_ID=...        # Configure for deployment
# AUTH_GITHUB_SECRET=...
# AUTH_GOOGLE_ID=...
# AUTH_GOOGLE_SECRET=...

# ── AI ───────────────────────────────────────────────
AI_PROVIDER=openai           # Use openai in production
OPENAI_API_KEY=...           # Configure in production
# MARKETAUX_API_KEY=...      # Portfolio news source (recommended)
# For local dev, you can use codex:
# AI_PROVIDER=codex

# ── Feature Flags ────────────────────────────────────
ENABLE_TOKEN_USAGE=true
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=true
```

For local development, the recommended default is to reuse your existing OpenClaw / Codex OAuth login (`AI_PROVIDER=codex`). This path does not use `OPENAI_API_KEY` — at runtime it reads `~/.openclaw/openclaw.json` and `~/.openclaw/agents/main/agent/auth-profiles.json`, using OpenClaw's current default `openai-codex/gpt-5.4` configuration to request `chatgpt.com/backend-api`.

If you want Ask AI's new chunk-level RAG to also enable semantic retrieval, you need to configure an embedding provider. The two simplest options:

```bash
# Option A: Keep Codex for chat, but use OpenAI API for embeddings
AI_PROVIDER=codex
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

```bash
# Option B: Keep Codex for chat, but use a local OpenAI-compatible service for embeddings
AI_PROVIDER=codex
EMBEDDING_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_EMBEDDING_MODEL=nomic-embed-text
AI_API_KEY=local
```

If you don't configure an embedding provider, Ask AI still works but falls back to chunk-level keyword retrieval without semantic recall.

If you later want to switch to the standard OpenAI API:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.4

# Optional: split models by scenario
# OPENAI_CHAT_MODEL=gpt-5.4
# OPENAI_TASK_MODEL=gpt-5.4
```

If you later want to switch to a local OpenAI-compatible service:

```bash
AI_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=qwen2.5:14b

# Optional: split models by scenario
# AI_CHAT_MODEL=qwen2.5:14b
# AI_TASK_MODEL=qwen2.5:14b
# AI_API_KEY=local
```

Common local service examples:
- Ollama: `AI_BASE_URL=http://127.0.0.1:11434/v1`
- LM Studio: `AI_BASE_URL=http://127.0.0.1:1234/v1`

If using local mode, it's recommended to pull a model that has been tested with this project:

```bash
ollama pull qwen2.5:14b
```

Chat model configuration is unified through `src/server/ai/provider.ts`, which reads these environment variables. Three modes are supported: `codex`, `openai`, `local`. If you don't explicitly set `AI_PROVIDER`, the runtime will first try to reuse existing local OpenClaw Codex login state. Embedding configuration is independently parsed by `src/server/ai/embeddings.ts`, supporting `EMBEDDING_PROVIDER=openai|local|none`.

The `/portfolio` news panel now prioritizes the Marketaux news source via `MARKETAUX_API_KEY`, filtering by ticker + position name for more reliable results; if `MARKETAUX_API_KEY` is not configured, it falls back to Google News RSS. It's recommended to configure Marketaux for both local and production — otherwise news quality for ambiguous tickers degrades noticeably.

The `/usage` page also attempts to read local usage data directly, with auto-refresh every 15 seconds by default:
- Codex: Global thread token stats from `~/.codex/state*.sqlite`
- Claude Code: Session and `subagents/*.jsonl` usage aggregation from `~/.claude/projects/` across all projects

To adjust the auto-refresh interval:

```bash
NEXT_PUBLIC_TOKEN_USAGE_REFRESH_INTERVAL_MS=15000
```

If these directories don't exist, the page shows "not found", but manual entry still works.

Focus Tracker's server-side ingestion and `/focus` web page remain in this repository. The desktop Tauri collector has been migrated to a [separate repository](https://github.com/zhousiyao03-cyber/focus-tracker).

For personal deployment, configure server-side:

```bash
FOCUS_INGEST_API_KEY=your-focus-ingest-api-key
FOCUS_INGEST_USER_ID=your-user-id
```

Web `/focus` page features:

- Dashboard has a Focus card linking directly to `/focus`
- App-first page: see top apps by cumulative daily duration first, then selected app's session details and mini timeline, with a global day timeline for time distribution context
- Working Hours helper metric: calculated as cumulative duration minus non-work tags (social-media / entertainment / gaming)
- Manual refresh for session categorization and daily summary
- Generate one-time pairing codes for desktop clients; the desktop collector enters the code and automatically receives a per-device token

## Using Claude Subscription via Local Daemon

If you have a Claude Pro/Max subscription and want Ask AI to use it (instead of paying for the OpenAI API), set:

```bash
# .env.local
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=opus  # or sonnet / haiku / full model id
```

Then run the daemon in a separate terminal:

```bash
pnpm usage:daemon
```

The daemon polls `/api/chat/claim` every 3 seconds, spawns `claude -p` locally using your logged-in session, and streams results back through `/api/chat/progress`. The frontend polls `/api/chat/tokens` every 300 ms for a pseudo-streaming experience. This works identically against local dev (`localhost:3200`) **and** the hosted Vercel deployment — as long as the daemon is running on your machine, any browser you open can use Claude.

When the daemon is not running, `/ask` shows an amber banner telling you to start it. Structured AI calls outside chat (Learn outline generation, OSS project analysis, Portfolio news) automatically fall back to the codex / openai / local provider, so those keep working even without the daemon.

Requires:
- Claude CLI installed and `claude login` completed once
- `pnpm usage:daemon` running on the machine with your Claude credentials

## Common Commands

```bash
pnpm dev            # Dev server
pnpm build          # Production build (includes TypeScript checking)
pnpm lint           # ESLint check
pnpm test:e2e       # E2E tests (uses isolated test database, doesn't pollute data/second-brain.db)
pnpm run browser:install  # Optional: download Chrome for Testing for agent-browser
pnpm db:generate    # Generate database migrations
pnpm db:push        # Apply migrations to database
pnpm db:studio      # Drizzle Studio
```

## Browser Verification

The repository includes `agent-browser` as a local dev dependency, which can be used directly via `pnpm exec agent-browser ...` for page-level verification.

- If your machine already has Chrome installed, `agent-browser` will typically reuse it.
- If you want to use a pinned Chrome for Testing, run `pnpm run browser:install` once first.
- A minimal example:

```bash
pnpm exec agent-browser open http://127.0.0.1:3200/notes
pnpm exec agent-browser snapshot -i
pnpm exec agent-browser close
```

## Project Structure

```
src/
  app/              Next.js App Router pages and API routes
  components/       UI and layout components (toast, search-dialog, editor)
  lib/              Client-side utilities and tRPC client
  server/
    db/             Database connection and schema
    routers/        tRPC routers (notes, learning-notebook, oss-projects, portfolio, etc.)
    focus/          Focus Tracker interval slicing and aggregation logic
    ai/             AI logic (chunking, indexer, hybrid RAG, local/cloud providers, URL content fetching)
e2e/                Playwright E2E tests
docs/
  v1-plan.md        V1 convergence execution plan
  changelog/        Change log
```

Key feature modules:

- Learning: `src/app/(app)/learn/**` + `src/server/routers/learning-notebook.ts` + `src/app/api/learn/draft/route.ts`
- Open Source Projects: `src/app/(app)/projects/**` + `src/server/routers/oss-projects.ts`
- Portfolio: `src/app/(app)/portfolio/**` + `src/server/routers/portfolio.ts`
- Editor Extensions: `src/components/editor/` (mermaid-block, excalidraw-block, image-row-block, toc-block, toc-sidebar, markdown-table-paste, callout-block, toggle-block, etc.)

## Development Progress

### V1 Convergence (Completed)

- [x] Pass 1–6: Product convergence, Bookmark scraping + AI summary, Ask AI RAG, Search enhancement, UX/UI polish + dark mode, E2E wrap-up
- [x] Vercel deployment prep: Auth.js authentication + Turso database + data isolation

### Post-V1 Iterations

- [x] Focus Tracker: Server-side ingestion + Web `/focus` page + desktop Tauri collector (migrated to separate repo)
- [x] Portfolio: Position management + real-time prices + AI analysis + news aggregation
- [x] Learning Notebook & Open Source Projects: Topic/project-oriented notes + AI assistance
- [x] Editor Enhancements: Mermaid diagrams, Excalidraw whiteboard, table toolbar, side-by-side images, TOC sidebar, drag-and-drop sorting, search & replace, H1–H6 headings
- [x] Performance Optimization: Route transition loading skeletons, dynamic imports, query caching
- [ ] Meeting Assistant: Tauri v2 desktop meeting assistant (planned)

See `docs/v1-plan.md` and `docs/changelog/` for details.
