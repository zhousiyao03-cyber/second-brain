# @knosi/cli

Local Claude Code daemon for [Second Brain](https://github.com/zhousiyao03-cyber/second-brain).

Runs on your machine, picks up AI tasks from the hosted Second Brain instance, executes them via your local Claude CLI, and pushes results back.

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

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--url <url>` | Second Brain server URL | `https://second-brain-self-alpha.vercel.app` |
| `--model <model>` | Override Claude model | (from task) |
| `--once` | Process one round then exit | `false` |
| `--claude-bin <path>` | Path to Claude CLI binary | `claude` |
