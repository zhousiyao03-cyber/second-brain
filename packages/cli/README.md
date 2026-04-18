# @knosi/cli

Knosi CLI for [Second Brain](https://github.com/zhousiyao03-cyber/second-brain).

Runs on your machine and supports four workflows:

1. the Claude Code task daemon (chat + structured)
2. OAuth login against your Knosi deployment
3. explicit raw AI capture saves for Claude Code skills
4. local Claude Code / Codex token usage reporting

## Prerequisites

- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude --version`)
- Node.js >= 20

## Usage

```bash
npx @knosi/cli --url https://your-second-brain.vercel.app
```

The daemon will:
1. Poll the server for queued AI tasks (chat + structured data)
2. Execute them using your local Claude CLI
3. Stream results back to the server
4. Scan local Claude Code / Codex logs every 5 min and upload token usage to `/api/usage`
5. Fire a daily Claude "hello" ping at 05:59 local time to keep the CLI warm

Press Ctrl+C to stop.

### One-shot Usage Sync

```bash
npx @knosi/cli usage report
```

Scans `~/.claude/projects/**/*.jsonl` (and `~/.codex/state*.sqlite` when `better-sqlite3` is available), aggregates token counts per `(date, provider, model)`, and POSTs to the configured server. Requires `knosi auth login` first.

### OAuth Login

```bash
npx @knosi/cli auth login https://www.knosi.xyz
```

This starts a local callback server on `127.0.0.1:6274`, opens the browser, completes OAuth against Knosi, and stores CLI credentials in `~/.knosi/cli.json`.

### Save a Raw AI Capture

```bash
cat payload.json | npx @knosi/cli save-ai-note --json
```

Payload shape:

```json
{
  "sourceApp": "claude-code",
  "title": "Optional custom title",
  "capturedAtLabel": "2026-04-12 15:20 SGT",
  "messages": [
    { "role": "user", "content": "Question" },
    { "role": "assistant", "content": "Answer" }
  ],
  "sourceMeta": {
    "projectPath": "/Users/bytedance/second-brain"
  }
}
```

### Install the Claude Code Skill

```bash
npx @knosi/cli install-skill
```

This copies the bundled template to:

```text
~/.claude/skills/save-to-knosi/SKILL.md
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Second Brain server URL | `https://www.knosi.xyz` |
| `--model <model>` | Override Claude model | (from task) |
| `--once` | Process one round then exit | `false` |
| `--claude-bin <path>` | Path to Claude CLI binary | `claude` |

## Releasing

`@knosi/cli` is published automatically by the `Publish @knosi/cli` GitHub Actions workflow (`.github/workflows/publish-cli.yml`):

1. Bump `packages/cli/package.json` → `version`.
2. Commit + push to `main`.
3. The workflow runs the CLI unit tests, compares the local version with the one on the npm registry, and publishes only if the local version is strictly greater.

The workflow needs a repo secret named `NPM_TOKEN` holding an **npm automation token** (not a classic one — automation tokens bypass 2FA, which is what lets CI publish non-interactively). Create one under npmjs.com → Access Tokens → "Generate New Token" → **Automation**, scope it to `@knosi/cli` publish access, then add it to GitHub repo **Settings → Secrets and variables → Actions** as `NPM_TOKEN`.
