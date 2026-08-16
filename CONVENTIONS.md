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
- **Pluggable providers** — the AI agent (`agent-anthropic`) and persistence
  layer (`persistence-pg`) implement generic interfaces from `core`. Keep
  provider-specific details out of `chat-server` and `chat-client`.
- **`backend`** and **`frontend`** are thin standalone shims — keep them
  minimal.

## Configuration

All environment variables owned by Datonfly use a single suite-wide **`DF_`
prefix**, giving one unambiguous namespace shared by the standalone assistant
and the wider Datonfly suite. Three exceptions:

- **`ANTHROPIC_API_KEY` and `OPENAI_API_KEY`** keep their canonical, unprefixed
  names — the official SDKs read them directly from the environment and secret
  scanners recognise them.
- **`PORT` and `DATABASE_URL`** are read as `DF_X ?? X`, because hosting
  platforms and database tooling inject the unprefixed forms. No other
  unprefixed name is read.
- **Frontend build-time variables** keep Vite's mandatory `VITE_` prefix.

Name variables after what they configure, not after the current vendor:

- Knobs describing the agent itself are neutral: `DF_AGENT_MODEL`,
  `DF_AGENT_MAX_TOOL_ITERATIONS`.
- Knobs enabling a vendor-specific capability are namespaced under that vendor:
  `DF_ANTHROPIC_ENABLE_WEB_SEARCH`, `DF_ANTHROPIC_THINKING_TYPE`. Another
  provider's equivalents would not be interchangeable, so a shared name would be
  misleading.

**Only the standalone entrypoint reads the environment.** Every `process.env`
access lives in `packages/backend/src/config.ts`, which centralises the prefix,
validation, and defaults behind `EnvReader` and hands the result to the rest of
the application as plain config objects. Library packages (`core`,
`agent-anthropic`, `chat-server`, `agent-mcp`, …) must never read `process.env`:
they are also consumed as libraries by other Datonfly products, where the
embedding application is the composition root and supplies config itself.

[`ENV_MIGRATION.md`](ENV_MIGRATION.md) records the historical old → new mapping
for deployments upgrading across the renames.

## Agent Tools

`ITool` in `core` describes a tool the agent may invoke. **JSON Schema is
canonical**: `inputSchema` is handed to the model provider as authored. Every
wire protocol in this space speaks JSON Schema (MCP `inputSchema`, Anthropic
`input_schema`, OpenAI `function.parameters`), so anything else has to be
compiled down at the boundary and loses fidelity on the way.

- **Authoring a tool in TypeScript:** use `zodTool()`. It derives the JSON
  Schema from a Zod schema and sets `validate`, so `execute()` receives a typed,
  validated input.
- **Proxying a tool that owns its own schema** (e.g. an MCP server): build the
  `ITool` directly, pass the published JSON Schema through untouched, and **omit
  `validate`**. A reconstructed schema can only narrow the published one — it
  hides constraints from the model and silently strips arguments the backend
  understands. The backend is the authority and reports better errors.

`validate` is optional precisely so the second case is expressible; do not add
it "for safety" where a downstream service already validates.

## AI Agent Providers

An agent provider implements `IAgentProvider` from `core` and is the only place
that may know a vendor's API. Besides streaming a turn it also answers the two
non-streaming questions the server has — `generateTitle()` and `shouldRespond()`
— so no caller ever constructs a second vendor client of its own, and each
provider keeps its own choice of model and strategy for them. Rules that apply
to every provider:

- **Split the configuration.** Neutral fields live in `AgentConfig`; anything
  vendor-specific goes under a `providerOptions` bag. The composition root
  assembles most of an agent's configuration without knowing which provider it
  targets.
- **Report capabilities, do not let callers infer them.** `AgentCapabilities`
  describes the configuration the provider was constructed with, so a feature
  that exists but is switched off reads as unsupported. Callers adapt to the
  descriptor rather than naming a vendor.
- **Context compaction belongs to the provider.** `AgentCapabilities.compaction`
  is `"provider"` or `"none"`; there is no in-app fallback implementation, and a
  provider that cannot compact should report `"none"` rather than have the
  server improvise. The compaction summary round-trips as an
  `OpaqueContentPart`, and `trimBeforeCompaction()` drops everything before it
  when assembling a later request, so a compacted thread stops resending the
  history the summary replaced.
- **Prefer a provider's transparent compaction over a paused one.** Where the
  API offers both, the transparent path returns the summary and the answer in
  one request; pausing costs an extra round trip for the same output and is only
  worth it to preserve specific messages verbatim or to track a budget across
  several compactions.
- **Send optional sampling parameters only when configured.** Newer models
  reject parameters older ones accepted — `claude-opus-5` errors on
  `temperature: 0` — so an unset option must be omitted from the request rather
  than sent as a default.
- **Round-trip provider-specific state through `OpaqueContentPart`.** It is the
  only sanctioned escape hatch for data the server must store and hand back
  without understanding it. Persisted encodings are a compatibility surface:
  live threads contain them, so changing one needs a migration.
- **Honour the usage contract.** See `AgentUsage` — `inputTokens` means the size
  of the submitted context including cached tokens, because the gateway compares
  it against the compaction threshold.
- **Pass the conformance suite.** `@datonfly-assistant/agent-anthropic/testing`
  exports `CONFORMANCE_CASES` plus a fixture replay server. The cases assert the
  behaviour `chat-server` relies on — chunk ordering, part-index semantics,
  tool-call/result pairing, usage on the final chunk. A new provider is
  interchangeable exactly insofar as it passes them, so run them against it.
- **Expect vendor SDKs to lag their own APIs.** Where a documented parameter is
  missing from the SDK's types, assert narrowly at that one call site and say
  why in a comment; never widen the surrounding types to accommodate it.

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

## Logging

- When logging a caught error, do not inline `error.message`, `String(error)`,
  or similar conversions at the call site.
- Use the shared `formatLoggedError()` helper from `@datonfly-assistant/core` to
  produce the logged error string.
- `formatLoggedError()` walks the `Error.cause` chain for as long as each cause
  is an `Error`, so logs include the full nested failure context instead of only
  the top-level message.
- Keep user-facing error messages separate from log formatting. Use the full
  formatted chain for logs and audit entries, but only expose end-user text when
  that is the intended behavior of the API or UI surface.

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
- Tests must not rely on localized human-readable UI text (e.g. labels, button
  names, tooltips, visible copy) for element targeting, because text can change
  by language and wording updates.
- When an element needs a dynamic identifier (e.g. a specific thread or
  message), use `data-` attributes (e.g. `data-thread-id`).
