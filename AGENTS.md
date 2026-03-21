<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Second Brain Working Agreement

## Project Context

- This repository is a learning-oriented full-stack project for building a personal knowledge management platform with AI capabilities.
- The implementation plan lives in `PLAN.md`. Treat the phase definition there as the delivery baseline.
- `README.md` is the project-facing overview. `docs/changelog/` is the task-by-task engineering log.

## Before You Change Code

1. Read the relevant section in `PLAN.md` and confirm the current task belongs to the active phase or is an explicit exception.
2. Read the relevant Next.js guide in `node_modules/next/dist/docs/` before changing Next.js code.
3. Check whether the task affects UI flows, server/data behavior, or both, then choose a matching verification strategy up front.

## Definition Of Done

Do not consider a task complete until all of the following are true:

1. The implementation is finished.
2. The affected documentation is updated.
3. The change is verified with real commands or real checks.
4. The final handoff includes what changed, how it was verified, and any remaining risks.

Do not stop at "code compiles in theory" or "the logic looks right".

## Documentation Rules

- After every non-trivial task, append an entry to `docs/changelog/`.
- Each entry must include:
  - date
  - task / goal
  - key changes
  - files touched
  - verification commands and results
  - remaining risks or follow-up items
- If the project status, setup steps, architecture, or phase progress changes, update `README.md` in the same task.
- Do not leave scaffolded default docs in place once the project has meaningful custom code.

## Verification Rules

- Never claim a change is verified unless you actually ran a verification step.
- Prefer the strongest realistic check for the scope of the change:
  - UI, navigation, forms, cross-page flows: prefer e2e coverage.
  - Server logic, database logic, utilities: prefer unit or integration tests.
  - Broad repository changes: run lint and build in addition to targeted checks when the toolchain is available.
- If a user-facing flow changes and no e2e exists yet, prefer adding a minimal e2e test rather than skipping verification.
- If e2e is too heavy for the task, use the next best executable validation and explain why.
- For schema or persistence changes, verify the resulting tables, queries, or migration output.
- For bug fixes, reproduce the issue before fixing it when feasible, then verify the fix after the change.

## Handoff Rules

The final response for any substantive task must include:

1. What changed.
2. Which docs were updated.
3. Which verification commands/checks were run, with actual outcomes.
4. Any blockers, assumptions, or residual risks.

If the environment prevents execution, state the exact blocker and do not pretend the check passed.

## Repository Hygiene

- Do not commit local SQLite artifacts such as `data/*.db`, `data/*.db-shm`, or `data/*.db-wal`.
- Prefer small, reviewable increments that keep the repo runnable.
- If a task completes only partially, leave a clear log entry describing what is done and what remains.
