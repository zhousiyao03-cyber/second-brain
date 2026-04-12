# @knosi/cli

Knosi CLI for [Second Brain](https://github.com/zhousiyao03-cyber/second-brain).

Runs on your machine and supports three workflows:

1. the existing Claude Code daemon
2. OAuth login against your Knosi deployment
3. explicit raw AI capture saves for Claude Code skills

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

Press Ctrl+C to stop.

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
| `--url <url>` | Second Brain server URL | `https://second-brain-self-alpha.vercel.app` |
| `--model <model>` | Override Claude model | (from task) |
| `--once` | Process one round then exit | `false` |
| `--claude-bin <path>` | Path to Claude CLI binary | `claude` |
