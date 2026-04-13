# Claude to Knosi Capture Design Spec — 2026-04-12

## Date

- 2026-04-12

## Task / Goal

- Write and validate a design spec for saving Claude conversations into Knosi, covering both Claude Web and Claude Code entrypoints.

## Key Changes

- Added a new design spec at `docs/superpowers/specs/2026-04-12-claude-knosi-capture-design.md`.
- Locked the V1 architecture to a dual-entry, single-kernel model:
  - Claude Web -> remote MCP
  - Claude Code -> personal skill + local CLI
  - both converge on one Knosi capture service
- Locked the V1 save semantics to:
  - explicit save only
  - fixed `AI Inbox` destination
  - one save creates one note
  - raw conversation data only, with minimal metadata
  - no extra AI post-processing
- Documented auth direction:
  - reuse existing Knosi accounts
  - issue separate OAuth credentials for connectors and CLI

## Files Touched

- `docs/superpowers/specs/2026-04-12-claude-knosi-capture-design.md`
- `docs/changelog/2026-04-12-claude-knosi-capture-design.md`

## Verification Commands And Results

- `rg -n "TODO|TBD|placeholder" docs/superpowers/specs/2026-04-12-claude-knosi-capture-design.md` -> exit code `1` (`no matches`)
- `sed -n '1,260p' docs/superpowers/specs/2026-04-12-claude-knosi-capture-design.md` -> spec content reviewed after write
- `sed -n '261,520p' docs/superpowers/specs/2026-04-12-claude-knosi-capture-design.md` -> remainder reviewed after write

## Remaining Risks Or Follow-Up Items

- No implementation was performed yet.
- OAuth authorization-server details and Anthropic remote MCP integration details still need to be validated during implementation.
- The user must review and approve the written spec before implementation planning begins.
