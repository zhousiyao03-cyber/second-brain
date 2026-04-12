---
name: save-to-knosi
description: Save the current Claude Code exchange into Knosi as one raw AI Inbox note. Use only when the user explicitly asks to save or archive something to Knosi.
---

When the user explicitly asks to save the current exchange to Knosi:

1. Collect the message excerpt that should be saved.
2. Build JSON with:
   - `sourceApp`: `claude-code`
   - `title` if the user provided one
   - `messages`: the raw user/assistant turns to preserve
   - `sourceMeta.projectPath` when it is useful
3. Run:

```bash
knosi save-ai-note --json
```

4. Pipe the JSON payload to stdin.
5. After the command succeeds, reply with the created note id or title.
