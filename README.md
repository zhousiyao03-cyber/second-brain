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

Write notes with a Notion-level editor, index your knowledge with hybrid RAG, and ask questions against your own corpus. Route "Ask AI" through your existing Claude subscription instead of burning extra API credits. Own your data, run it locally, or self-host it with Docker Compose on your own server.

**Product:** [knosi.xyz](https://www.knosi.xyz)

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
- **Claude Code Daemon** — Route Ask AI through your local Claude Pro/Max subscription. No extra API spend. Works against both local dev and the self-hosted web deployment, with Redis-backed live token fan-out for low-latency daemon responses.
- **Structured AI Calls** — Learning outline generation, OSS analysis, and portfolio news summarization use the configured provider independently of the chat daemon.
- **Claude Capture Integrations** — Claude Web can connect through a remote MCP endpoint, and Claude Code can save explicit conversation excerpts through the Knosi CLI + personal skill flow. Both write raw captures into `AI Inbox`.

### Developer Workflow

- **Token Usage Dashboard** — Auto-reads local Claude Code session files (`~/.claude/projects/`) and Codex state databases (`~/.codex/state*.sqlite`). Aggregates across all workspaces and subagents. Manual entry supported for OpenAI API and other sources.
- **Focus Tracker** — Server-side ingestion and `/focus` web UI for app-level time tracking. Pairs with the [desktop Tauri collector](https://github.com/zhousiyao03-cyber/focus-tracker) via one-time pairing codes.
- **Installable PWA** — Ships a standalone web app manifest with dedicated 192x192, 512x512, and Apple touch icons that work on the self-hosted Hetzner deployment.

### Optional Modules

- **Portfolio Tracker** — Position management with Yahoo Finance and CoinGecko real-time prices, AI position analysis, and news aggregation via Marketaux or Google News RSS with server-side cron auto-refresh.
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

### Option C: Hetzner single-server deployment

The repository now includes a production-oriented Docker Compose stack for a single Ubuntu server:

- [`docker-compose.prod.yml`](docker-compose.prod.yml) — app + Redis + Caddy
- [`ops/hetzner/Caddyfile`](ops/hetzner/Caddyfile) — HTTPS reverse proxy
- [`ops/hetzner/bootstrap.sh`](ops/hetzner/bootstrap.sh) — swap, Docker, firewall, `/srv/knosi`
- [`ops/hetzner/deploy.sh`](ops/hetzner/deploy.sh) — server-side deployment entrypoint
- [`ops/hetzner/rsync-excludes.txt`](ops/hetzner/rsync-excludes.txt) — sync exclusions for GitHub Actions
- [`ops/hetzner/knosi.cron.example`](ops/hetzner/knosi.cron.example) — cron jobs for queue processing
- [`.env.production.example`](.env.production.example) — production env template
- [`.github/workflows/deploy-hetzner.yml`](.github/workflows/deploy-hetzner.yml) — push-to-main auto deploy

Recommended first migration cut:

1. Keep `TURSO_DATABASE_URL` pointed at Turso.
2. Configure S3-compatible object storage for note image uploads.
3. Move app hosting, reverse proxy, Redis, and cron to your own server first.

Example flow on a fresh Ubuntu host:

```bash
ssh root@your-server
git clone https://github.com/zhousiyao03-cyber/knosi.git /srv/knosi
cd /srv/knosi

bash ops/hetzner/bootstrap.sh 4
cp .env.production.example .env.production
# edit .env.production

# APP_DOMAIN=www.knosi.xyz
# ROOT_DOMAIN=knosi.xyz
# ACME_EMAIL=you@example.com

docker compose -f docker-compose.prod.yml up -d --build
```

Then install the cron entries:

```bash
crontab -e
# paste ops/hetzner/knosi.cron.example and fill in the secrets
```

Automatic deployments:

1. Add these repository secrets in GitHub:
   - `HETZNER_HOST` — your server IP or hostname
   - `HETZNER_USER` — the SSH user that owns the deployment
   - `HETZNER_SSH_KEY` — the private key for that SSH user
   - `HETZNER_SSH_PORT` — optional, defaults to `22`
   - If you followed the current Hetzner bootstrap flow exactly, the live server currently uses `root` for deployments, so `HETZNER_USER=root` is the drop-in value until you introduce a dedicated deploy user.
2. Push to `main`.
3. GitHub Actions will lint, `rsync` the repository to `/srv/knosi`, then run `ops/hetzner/deploy.sh` on the server.

The deployment script validates `docker-compose.prod.yml`, generates a unique `NEXT_DEPLOYMENT_ID` for every rollout, rebuilds the `knosi` image, restarts `redis + knosi + caddy`, and waits for `http://127.0.0.1:3000/login` to return `200`.

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

### Production Self-Hosting

```bash
APP_DOMAIN=knosi.example.com
ACME_EMAIL=ops@example.com
AUTH_URL=https://knosi.example.com
AUTH_TRUST_HOST=true
CRON_SECRET=your-random-secret
JOBS_TICK_TOKEN=your-random-secret
```

If you enable GitHub or Google login on a self-hosted deployment, set `AUTH_URL` to the public HTTPS origin served by your reverse proxy. OAuth providers validate the callback URL against that origin, so relying on the container's internal `HOSTNAME=0.0.0.0` will produce `redirect_uri_mismatch` errors.

Image uploads on self-hosted deployments use S3-compatible object storage:

```bash
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=knosi-assets
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_PUBLIC_BASE_URL=https://assets.example.com
# S3_FORCE_PATH_STYLE=true
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

Route **all AI features** (Ask AI chat, focus analysis, learning outlines, portfolio summaries, and more) through your existing Claude Pro/Max subscription. No API key required.

```bash
AI_PROVIDER=claude-code-daemon
CLAUDE_CODE_CHAT_MODEL=sonnet   # opus | sonnet | haiku | full model id
```

Then run the daemon on your local machine:

```bash
npx @knosi/cli --url https://your-second-brain.vercel.app
```

Or during local development:

```bash
npm run daemon
```

The daemon polls the server for queued AI tasks (both chat and structured data), executes them via your local Claude CLI, and streams results back. All AI-powered features work through this single daemon process.

**Requirements:** [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude login`).

### Claude Web Connector

Knosi now exposes a remote MCP surface for Claude Web:

```text
/.well-known/oauth-authorization-server
/api/mcp
```

In Claude Web, add a custom connector that points to your Knosi deployment. The OAuth flow uses your existing Knosi account and grants scoped access for:

- `knowledge:read`
- `knowledge:write_inbox`

Saved conversations land in the root-level `AI Inbox` folder as raw captures.

### Claude Code Save-To-Knosi Flow

The local CLI now supports an explicit save path for Claude Code:

```bash
# 1. Log the CLI into your Knosi deployment
npx @knosi/cli auth login https://www.knosi.xyz

# 2. Install the personal Claude Code skill
npx @knosi/cli install-skill

# 3. Save a raw conversation payload
cat payload.json | npx @knosi/cli save-ai-note --json
```

The installed skill template is written to `~/.claude/skills/save-to-knosi/SKILL.md` and is intended for explicit user-triggered saves only.

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
| Object Storage | S3-compatible (R2 / MinIO / S3) |
| Editor | Tiptap v3 (ProseMirror) |
| Diagrams | Mermaid + Excalidraw |
| Content fetching | @mozilla/readability + linkedom |
| Testing | Playwright (E2E) |
| Deployment | Docker Compose / Hetzner-style self-hosting |

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
npm run daemon        # Start local Claude Code AI daemon
npm run usage:daemon  # Start usage reporter + analysis daemon
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
