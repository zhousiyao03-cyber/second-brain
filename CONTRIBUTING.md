# Contributing to Knosi

Thank you for your interest in contributing to Knosi! We welcome contributions of all kinds — bug fixes, new features, documentation improvements, and more. This guide will help you get up and running quickly.

---

## Getting Started

### Prerequisites

- **Node.js** 22 or higher
- **pnpm** 9 or higher (`npm install -g pnpm`)

### Setup

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/knosi.git
   cd knosi
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Copy the example environment file and fill in the required values:
   ```bash
   cp .env.example .env.local
   ```

4. Apply the database schema to your local SQLite database:
   ```bash
   pnpm db:push
   ```

5. Start the development server on port 3200:
   ```bash
   pnpm dev
   ```

---

## Development Workflow

### Branch Naming

Create a branch from `main` using one of these prefixes:

| Prefix   | When to use                              |
|----------|------------------------------------------|
| `feat/`  | New features (`feat/markdown-export`)    |
| `fix/`   | Bug fixes (`fix/editor-hydration-error`) |
| `docs/`  | Documentation changes (`docs/setup`)     |
| `chore/` | Tooling, dependencies, config            |
| `test/`  | Test-only changes                        |

### Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must have a type prefix:

```
feat: add mermaid diagram export
fix: resolve table toolbar z-index overlap
docs: update setup steps in README
chore: upgrade drizzle-orm to 0.42
```

Scope is optional but encouraged when the change is localized:

```
feat(editor): add collapsible toggle block
fix(trpc): correct note version CAS logic
```

### Pull Request Process

1. Push your branch to your fork and open a PR against `main`.
2. Fill in the PR template — describe what changed and why.
3. Link any related issues (`Closes #123`).
4. Ensure all CI checks pass before requesting review.
5. Keep PRs small and focused. If your change is large, consider splitting it into multiple PRs or opening a discussion first.

---

## Code Style

- **Follow existing patterns** — read the surrounding code before writing new code.
- **Styling** — use [Tailwind CSS](https://tailwindcss.com/) utility classes. Avoid inline styles. Use the `cn()` helper from `src/lib/utils.ts` for conditional class merging.
- **Client components** — any component that uses hooks, browser APIs, or event handlers must have `"use client"` as its first line.
- **Validation** — use `zod/v4` (`import { z } from "zod/v4"`) for all input validation in tRPC procedures and form schemas.
- **ID generation** — use `crypto.randomUUID()`, not external libraries.
- **TypeScript** — the codebase is fully typed. Avoid `any`; use proper generics or `unknown` instead.
- **No unused files** — every file must have a clear purpose. Remove scaffolding, placeholders, and dead code before submitting.

---

## Testing

### E2E Tests

Knosi uses [Playwright](https://playwright.dev/) for end-to-end tests, located in `e2e/`.

- UI features and user-facing flows require E2E test coverage.
- CRUD flows must cover the full cycle: create → list → edit → delete.
- Use randomized test data (e.g., `uid()`) to avoid conflicts with shared state.

Run the test suite:
```bash
pnpm test:e2e
```

### Before Submitting

Run these checks in order and fix any failures before opening a PR:

```bash
pnpm build   # TypeScript compilation + production build
pnpm lint    # ESLint
pnpm test:e2e
```

Do not submit a PR with known failing checks.

---

## Database Changes

If your change modifies the Drizzle schema (`src/server/db/schema.ts`):

1. Generate the migration file:
   ```bash
   pnpm db:generate
   ```

2. Apply it to your local database:
   ```bash
   pnpm db:push
   ```

3. **Commit the migration files** — migration files in `drizzle/` must be included in your PR. Do not `.gitignore` or delete them.

4. Include a note in your PR description about the schema change so reviewers know to expect a migration.

---

## Pull Request Guidelines

- **Keep PRs focused** — one logical change per PR. A PR that adds a feature, refactors unrelated code, and bumps dependencies is hard to review.
- **Describe the "why"** — the PR title and description should explain the motivation, not just restate the diff.
- **Link issues** — if the PR closes or relates to a GitHub Issue, reference it (`Closes #42`, `Related to #17`).
- **Screenshots** — for UI changes, include before/after screenshots or a short screen recording.
- **No generated files in PRs** — do not commit `.next/`, `node_modules/`, or `data/*.db`.

---

## Reporting Bugs

Please use [GitHub Issues](https://github.com/knosi/knosi/issues) to report bugs. Before opening a new issue:

1. Search existing issues to check if it has already been reported.
2. If not, open a new issue and include:
   - A clear, descriptive title.
   - Steps to reproduce the bug.
   - Expected vs. actual behavior.
   - Your environment (OS, Node.js version, browser if applicable).
   - Relevant error messages or screenshots.

---

## Feature Requests

Have an idea for a new feature? Great — but please **open a discussion first** before building it. This avoids duplicate work and ensures the feature aligns with the project's direction.

Use [GitHub Discussions](https://github.com/knosi/knosi/discussions) to propose new features. Describe the problem you're solving, not just the solution. Once there's consensus, a maintainer will greenlight an implementation PR.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards. Please report unacceptable behavior to the project maintainers.

---

We appreciate every contribution, large or small. Thank you for helping make Knosi better.
