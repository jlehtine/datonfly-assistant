# Copilot Instructions

Follow the architecture described in [README.md](../README.md) and the coding
conventions in [CONVENTIONS.md](../CONVENTIONS.md).

## Key Points

- **Monorepo** managed with pnpm workspaces and Turborepo. All packages live
  under `packages/`.
- **`core`** declares shared types, interfaces, and the REST/WebSocket endpoint
  contract (paths + Zod schemas). All other packages depend on `core` — never
  duplicate its definitions.
- **Pluggable providers** — the AI agent (`agent-langchain`) and persistence
  layer (`persistence-pg`) implement generic interfaces from `core`. Keep
  provider-specific details out of `chat-server` and `chat-client`.
- **`chat-server`** is a NestJS module. Authentication is delegated to the host
  app; chat-server only enforces authorization via `RequireUserGuard`.
- **`chat-client`** provides framework-agnostic logic plus React hooks (subpath
  `@datonfly-assistant/chat-client/react`). No concrete UI here.
- **`chat-ui-mui`** provides the React/MUI components. Use MUI components and
  Material Icons for all UI work.
- **`backend`** and **`frontend`** are thin standalone shims — keep them
  minimal.
- Strict TypeScript everywhere. Public APIs documented with JSDoc.
- Prettier for formatting (`printWidth: 120`, `tabWidth: 4`). ESLint with
  `strictTypeChecked` + `stylisticTypeChecked`.
- Database: PostgreSQL, `dfa` schema, singular table names, `snake_case`
  columns, Kysely migrations with ISO 8601 timestamp prefixes.

## E2E Test Selectors

- Add `datonfly-*` CSS marker classes to UI elements that E2E tests need to
  locate (e.g. `datonfly-thread-item`, `datonfly-unread-badge`). Never rely on
  MUI internal class names in tests.
- When an element needs a dynamic identifier (e.g. a specific thread or
  message), use `data-` attributes (e.g. `data-thread-id`).

## Decision Making

Stick to the agreed plan. If during implementation you encounter unforeseen
complications, inconsistencies, or ambiguities — stop, describe the problem and
the available options to the user, and ask how to proceed before continuing.

## Testing

After implementing a feature, decide whether the feature warrants unit tests or
end-to-end tests. If so, implement the required tests and verify they pass.

**Run only the specific test file(s) relevant to the change** (e.g.
`pnpm exec playwright test tests/thread-management.spec.ts`). Running the entire
test suite at once easily triggers LLM rate limits, causing spurious failures.

E2E tests require the dev server (`pnpm dev`) to be running. If it is not known
whether the dev server is running, ask the user to start it. If the user
previously started the dev server in the session, assume it is still running. Do
not start the dev server unless asked to or after receiving explicit permission.
