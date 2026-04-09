# Conventions

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

## Editor Configuration

`.editorconfig` at the monorepo root ensures consistent whitespace settings
across editors.

## Documentation

All public API interfaces are documented with **JSDoc**.

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
