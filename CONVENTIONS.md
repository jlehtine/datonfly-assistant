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

## Database

- **Table names** use **singular** form: `user`, `thread`, `thread_member`,
  `message`.
- **Column names** use `snake_case`.
- **Schema changes** are managed via Kysely migrations in
  `packages/persistence-pg/src/migrations/`. Each migration file is prefixed
  with an ISO 8601 timestamp.
