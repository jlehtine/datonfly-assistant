# Conventions

## Language

All source identifiers (variables, functions, classes, etc.) and documentation
(comments, JSDoc, READMEs, commit messages) are written in **English**.

## TypeScript

Strict TypeScript everywhere. All packages use strict compiler settings.

## Architecture

- **`core`** declares shared types, interfaces, and the REST/WebSocket endpoint
  contract (paths + Zod schemas). All other packages depend on `core` — never
  duplicate its definitions.
- **Pluggable providers** — the AI agent (`agent-langchain`) and persistence
  layer (`persistence-pg`) implement generic interfaces from `core`. Keep
  provider-specific details out of `chat-server` and `chat-client`.
- **`backend`** and **`frontend`** are thin standalone shims — keep them
  minimal.

## Code Formatting

**Prettier** handles all code formatting. Configuration lives in
`.prettierrc.json` at the monorepo root. Key settings:

- `printWidth`: 120
- `tabWidth`: 4
- Import ordering via `@ianvs/prettier-plugin-sort-imports`

Run `pnpm format` to format all files, or `pnpm format:check` to verify.

## Linting

**ESLint 10** with TypeScript-ESLint `strictTypeChecked` and
`stylisticTypeChecked` rule sets. Configuration lives in `eslint.config.mjs` at
the monorepo root.

Run `pnpm lint` to lint all packages, or `pnpm lint:fix` to auto-fix.

## Commit Messages

- **Sentence case**, ending with a **period**.
- Use **imperative mood** when describing an action (e.g. "Add support for…",
  "Fix an issue with…"). Descriptive noun phrases are acceptable for broader
  changes (e.g. "Multi-user chat backend implementation.").
- Optional **scope prefix** with a colon for scoped changes (e.g. "CoPilot
  instructions: …", "Docker Compose: …").
- Keep to a **single summary line** — no body paragraph.

## Editor Configuration

`.editorconfig` at the monorepo root ensures consistent whitespace settings
across editors.

## Documentation

All public API interfaces are documented with **JSDoc**.

Project-wide conventions belong in this file (`CONVENTIONS.md`) or `README.md`.
Agent-specific instructions (e.g. `.github/copilot-instructions.md`) should only
contain agent workflow rules and reference this file for general conventions —
never duplicate them.

## User Interface

The UI is built with **Material UI** (`@mui/material`). Use Material UI
components for all user-facing elements. For icons, use **Material Icons**
(`@mui/icons-material`).

## Database

- All tables live in the **`dfa`** (Datonfly Assistant) PostgreSQL schema. This
  allows other Datonfly components to share the same database using their own
  schemas.
- **Table names** use **singular** form: `user`, `thread`, `thread_member`,
  `message`.
- **Column names** use `snake_case`.
- **Schema changes** are managed via Kysely migrations in
  `packages/persistence-pg/src/migrations/`. Each migration file is prefixed
  with an ISO 8601 timestamp.

## Record ID Ownership

Each record type has a single party responsible for generating its primary key:

- **Client-generated**: `message` (human / user-submitted messages). The client
  creates a UUID v4 before sending the `send-message` event. The server
  validates the format and rejects duplicate IDs.
- **Server-generated**: everything else — `thread`, `user`, `thread_member`, and
  AI/agent messages.

This split allows the originating client to use the real, permanent ID for
optimistic inserts without needing a server round-trip or reconciliation step,
while keeping ID authority on the server for all records it creates.

## End-to-End Tests

All major features must have **Playwright E2E tests** in the `tests/` directory.
Reusable helpers live in `tests/helpers.ts`.

When a new test requires significant pre-condition state (e.g. creating a
thread, sending messages, inviting members), prefer **extending an existing test
case** that already reaches the required state over creating a new standalone
test. This avoids redundant setup time and keeps the suite fast.

Extract any generic reusable steps (e.g. logging in, sending a message, inviting
a member) into helper functions in `tests/helpers.ts`.

### Selectors

- Add `datonfly-*` CSS marker classes to UI elements that E2E tests need to
  locate (e.g. `datonfly-thread-item`, `datonfly-unread-badge`). Never rely on
  MUI internal class names in tests.
- When an element needs a dynamic identifier (e.g. a specific thread or
  message), use `data-` attributes (e.g. `data-thread-id`).
