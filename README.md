# Knosi

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss)](https://tailwindcss.com)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Turn your Claude tokens into a second brain you actually own.**

---

## Your Claude Max runs out. Your notes don't.

Every great insight you pull out of a Claude conversation disappears into the void the moment you close the tab. Knosi closes that loop — it's a self-hosted knowledge platform built for developers who live in AI tools and want a permanent, searchable home for what they learn.

Write notes with a Notion-level editor, index your knowledge with hybrid RAG, and ask questions against your own corpus. Route "Ask AI" through your existing Claude subscription instead of burning extra API credits. Own your data, run it locally, or deploy to Vercel in five minutes.

**Live demo:** [knosi.vercel.app](https://knosi.vercel.app)

---

<!-- screenshots -->

---

## Features

### Core Knowledge

- **Rich Text Editor** — Notion-style block editor powered by Tiptap v3. Code blocks with language selector, Mermaid diagrams, Excalidraw whiteboards, callouts, toggles, tables with toolbar, side-by-side image rows, TOC block and collapsible sidebar, drag-and-drop sorting, slash commands, search & replace, and mixed Markdown paste.
- **Notes** — Full-width cover images, type/tag metadata, hover-to-insert controls, block-level move/copy/delete/transform, auto-save with loss prevention, public read-only sharing links, and one-click daily journal with plan inheritance.
- **Learning Notebooks** — Topic-oriented study sessions with AI-generated outlines, blind-spot analysis, review question generation, and Ask AI scoped to the topic's note context.
- **OSS Project Notes** — Per-project note collections with repo metadata, tag filtering, per-note read-only links, and long-term analysis archiving.

### AI

- **Ask AI** — Chunk-level hybrid RAG: semantic retrieval + keyword recall + adjacent-paragraph expansion + clickable source citations. Falls back gracefully to keyword-only when no embedding provider is configured.
- **Claude Code Daemon** — Route Ask AI through your local Claude Pro/Max subscription. No extra API spend. Works against both local dev and the hosted Vercel deployment.
- **Structured AI Calls** — Learning outline generation, OSS analysis, and portfolio news summarization use the configured provider independently of the chat daemon.

### Developer Workflow

- **Token Usage Dashboard** — Auto-reads local Claude Code session files (`~/.claude/projects/`) and Codex state databases (`~/.codex/state*.sqlite`). Aggregates across all workspaces and subagents. Manual entry supported for OpenAI API and other sources.
- **Focus Tracker** — Server-side ingestion and `/focus` web UI for app-level time tracking. Pairs with the [desktop Tauri collector](https://github.com/zhousiyao03-cyber/focus-tracker) via one-time pairing codes.

### Optional Modules

- **Portfolio Tracker** — Position management with Yahoo Finance and CoinGecko real-time prices, AI position analysis, and news aggregation via Marketaux or Google News RSS with Vercel Cron auto-refresh.
- **Search** — `Cmd+K` global note search with keyword highlighting.
- **Dark Mode** — Global toggle, full dark mode coverage.

---

## Quick Start

### Option A: Docker (recommended for self-hosting)

```bash
git clone https://github.com/zhousiyao03-cyber/knosi.git
cd knosi

# Start with default settings (SQLite, email/password login)
docker compose up -d

# → http://localhost:3000
```

Data is persisted in a Docker volume. To customize, create a `.env` file:

```bash
# Generate a secure auth secret
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env

# Optional: add GitHub/Google OAuth
echo "AUTH_GITHUB_ID=your-id" >> .env
echo "AUTH_GITHUB_SECRET=your-secret" >> .env
```

Then restart: `docker compose up -d --build`

### Option B: Local development

```bash
# 1. Clone
git clone https://github.com/zhousiyao03-cyber/knosi.git
cd knosi

# 2. Install dependencies (npm works; pnpm also supported)
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local — see "Environment Variables" below

# 4. Initialize the database
npm run db:push

# 5. Start the dev server
npm run dev
# → http://localhost:3200
```

In development mode, a test account is automatically provisioned for quick access:

```
Email:    test@secondbrain.local
Password: test123456
```

This account is only created when `NODE_ENV=development` and has no effect in production.

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values you need.

### Required (minimum to run locally)

```bash
# SQLite file for local dev — no auth token needed
TURSO_DATABASE_URL=file:data/second-brain.db

# Auth.js secret — generate with: openssl rand -base64 32
AUTH_SECRET=your-auth-secret
```

### Authentication (OAuth)

```bash
# GitHub OAuth App
AUTH_GITHUB_ID=your-github-oauth-app-id
AUTH_GITHUB_SECRET=your-github-oauth-app-secret

# Google OAuth Client
AUTH_GOOGLE_ID=your-google-oauth-client-id
AUTH_GOOGLE_SECRET=your-google-oauth-client-secret
```

### Production Database (Turso)

```bash
TURSO_DATABASE_URL=libsql://your-db-name-your-org.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token
```

### Feature Flags

```bash
# All optional modules are off by default
ENABLE_TOKEN_USAGE=false
NEXT_PUBLIC_ENABLE_TOKEN_USAGE=false
ENABLE_PORTFOLIO=false
NEXT_PUBLIC_ENABLE_PORTFOLIO=false
ENABLE_OSS_PROJECTS=false
NEXT_PUBLIC_ENABLE_OSS_PROJECTS=false
ENABLE_FOCUS_TRACKER=false
NEXT_PUBLIC_ENABLE_FOCUS_TRACKER=false
```

Set both the server-side and `NEXT_PUBLIC_` variant to `true` to enable a module.

### AI Rate Limit

```bash
AI_DAILY_LIMIT=50   # Per-user daily AI call cap; set to 0 for unlimited
```

---

## AI Provider Setup

Knosi supports four AI provider modes. Set `AI_PROVIDER` in `.env.local`.

### Option A — Claude Code Daemon (recommended for Claude subscribers)

Route Ask AI through your existing Claude Pro/Max subscription. No API key required.

```bash
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=sonnet   # opus | sonnet | haiku | full model id
```

Then run the daemon in a separate terminal:

```bash
npm run usage:daemon
```

The daemon polls for queued chat requests and spawns `claude -p` using your local session. Structured AI calls (outlines, analysis, news) fall back to a secondary provider, so they keep working even when the daemon is not running.

**Requirements:** Claude CLI installed, `claude login` completed at least once.

### Option B — OpenAI API

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o
```

### Option C — Local OpenAI-compatible runtime (Ollama, LM Studio, vLLM)

```bash
AI_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1   # Ollama default
AI_MODEL=qwen2.5:14b
AI_API_KEY=local
```

Pull a model first:

```bash
ollama pull qwen2.5:14b
```

### Option D — Codex / OpenClaw (legacy)

```bash
AI_PROVIDER=codex
# No API key needed — reads ~/.openclaw auth state automatically
```

### Semantic Embeddings (optional)

If no embedding provider is configured, Ask AI uses keyword recall only. To enable semantic search:

```bash
# Use OpenAI embeddings alongside any chat provider
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Or use a local embedding model
EMBEDDING_PROVIDER=local
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_EMBEDDING_MODEL=nomic-embed-text
```

---

## Feature Flags

Optional modules are hidden by default and activated through environment variables. Each module requires both a server-side flag and a `NEXT_PUBLIC_` counterpart so the navigation renders correctly on the client.

| Module | Server flag | Client flag |
|---|---|---|
| Token Usage Dashboard | `ENABLE_TOKEN_USAGE` | `NEXT_PUBLIC_ENABLE_TOKEN_USAGE` |
| Portfolio Tracker | `ENABLE_PORTFOLIO` | `NEXT_PUBLIC_ENABLE_PORTFOLIO` |
| OSS Project Notes | `ENABLE_OSS_PROJECTS` | `NEXT_PUBLIC_ENABLE_OSS_PROJECTS` |
| Focus Tracker | `ENABLE_FOCUS_TRACKER` | `NEXT_PUBLIC_ENABLE_FOCUS_TRACKER` |

Set both to `true` to show the module in the sidebar and enable its routes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4 |
| API | tRPC v11 + Zod v4 |
| Database | Drizzle ORM + SQLite via libsql / Turso |
| Auth | Auth.js v5 (GitHub / Google OAuth + email-password) |
| AI | Vercel AI SDK v6 |
| Editor | Tiptap v3 (ProseMirror) |
| Diagrams | Mermaid + Excalidraw |
| Content fetching | @mozilla/readability + linkedom |
| Testing | Playwright (E2E) |
| Deployment | Vercel |

---

## Project Structure

```
src/
  app/              Next.js App Router pages and API routes
    (app)/          Authenticated route group
  components/
    editor/         Tiptap editor — extensions, blocks, toolbar, paste handlers
    layout/         Sidebar, mobile nav
    ui/             Shared UI primitives
  server/
    db/             Drizzle schema and database connection
    routers/        tRPC routers
    ai/             Chunking, indexer, hybrid RAG, provider abstraction
    focus/          Focus Tracker interval slicing and aggregation
  lib/              Client utilities and tRPC client
e2e/                Playwright E2E tests
docs/changelog/     Engineering change log
```

---

## Common Commands

```bash
npm run dev           # Start dev server at http://localhost:3200
npm run build         # Production build (includes TypeScript check)
npm run lint          # ESLint
npm run test:e2e      # Playwright E2E tests
npm run db:generate   # Generate Drizzle migrations
npm run db:push       # Apply migrations to the database
npm run db:studio     # Open Drizzle Studio
npm run usage:daemon  # Start Claude Code daemon for Ask AI
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

[GNU Affero General Public License v3.0](LICENSE)

AGPL-3.0 means: you can use, modify, and self-host freely. If you run a modified version as a network service, you must publish your source changes under the same license.

---

## Author

Built by [Zhou Siyao](https://x.com/zhousiyao03) — [@zhousiyao03](https://x.com/zhousiyao03)
