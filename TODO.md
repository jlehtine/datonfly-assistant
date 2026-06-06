# TODO

## Configuration — environment variable naming convention

Apply a consistent naming convention for environment variables: a **single
suite-wide `DF_` prefix** for all Datonfly-owned config, with canonical
(unprefixed) names kept only for the two secrets that the official SDKs read
directly from the environment. This gives one unambiguous namespace shared by
the standalone assistant and the wider Datonfly suite (`datonfly-autocode`),
behaves identically whether shared library packages run standalone or embedded,
and still "just works" for the provider SDKs.

Status: not started. This is an operational/breaking change for existing test
deployments, so it must ship with a deprecation window, not a hard rename.

### Decisions (resolved)

- **Prefix:** single suite-wide `DF_` (not a per-app prefix). Each app runs in
  its own container, so the env namespace is already isolated; the prefix is for
  clarity and consistency across shared packages, not collision avoidance. A
  per-app prefix would be ambiguous for packages (`core`, `agent-langchain`,
  `chat-server`, `agent-mcp`) used by both products.
- **Keep canonical (no prefix):** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` only
  — auto-read by the official SDKs and recognised by secret scanners.
- **Canonical fallback (rename + accept legacy):** `PORT` → `DF_PORT` and
  `DATABASE_URL` → `DF_DATABASE_URL`, read as `DF_X ?? X` so platform-injected
  `PORT` (Cloud Run/Render/etc.) and `DATABASE_URL` tooling conventions keep
  working where present. All other infra vars (`LOG_LEVEL`, `LOG_FORMAT`,
  `QDRANT_URL`, `INFINITY_URL`, …) are read only by our own code and become
  plain `DF_*`.
- **Embedded assistant:** when Assistant runs inside Autocode it is consumed as
  a library; Autocode is the composition root and passes config as objects, so
  the standalone `DF_*` names do not apply there. The only env reads that leak
  into the Autocode process are those currently in shared library packages (see
  the architectural step below), which is why those should move out.

### Variables to rename to `DF_*`

- Auth: `AUTH_MODE`, `JWT_SECRET`, `SESSION_TTL_SECONDS`, `FRONTEND_URL`,
  `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `OIDC_REDIRECT_URI`, `OIDC_ALLOWED_EMAIL_DOMAIN`, `OIDC_ALLOWED_EMAILS`,
  `FAKE_USER_EMAIL`, `FAKE_USER_NAME`.
- Model / agent: `ANTHROPIC_MODEL`, `ANTHROPIC_TRIAGE_MODEL`,
  `ANTHROPIC_TITLE_MODEL`, `ANTHROPIC_THINKING_TYPE`,
  `ANTHROPIC_THINKING_DISPLAY`, `ANTHROPIC_THINKING_BUDGET_TOKENS`,
  `ANTHROPIC_THINKING_EFFORT`, `ENABLE_COMPACTION`, `ENABLE_CODE_EXECUTION`,
  `ENABLE_WEB_SEARCH`, `ENABLE_WEB_FETCH`, `AGENT_MAX_TOOL_ITERATIONS`,
  `DEBUG_API_CONTENT`. (The `ANTHROPIC_*` knobs here are _our_ config, not
  SDK-read — only the bare `ANTHROPIC_API_KEY` stays canonical.)
- MCP: `MCP_SERVERS`, `MCP_TOOL_TIMEOUT_MS`.
- Transcription: `OPENAI_TRANSCRIBE_MODEL`.
- Search: `MEMBER_SEARCH_STRATEGY`, `SEARCH_STEMMER_LANGUAGE`,
  `EMBEDDINGS_TIMEOUT_MS`, `SEARCH_RECENCY_HALF_LIFE_DAYS`.
- Logging / infra: `LOG_LEVEL`, `LOG_FORMAT`, `QDRANT_URL`, `INFINITY_URL`.
- Infra with canonical fallback (`DF_X ?? X`): `PORT`, `DATABASE_URL`.
- Ops/admin: `TRUSTED_REVERSE_PROXY`, `ADMIN_SECRET`, `ADMIN_IPS`.
- Frontend (Vite): audit `import.meta.env.VITE_*` usage; Vite enforces its own
  `VITE_` prefix, so keep that prefix (do not apply `DF_` there).

### Implementation steps

- [x] Move env reads out of shared library packages so the prefix governs only
      the standalone entrypoint and embedded Autocode controls config via
      objects. Specifically, lift `LOG_LEVEL` / `LOG_FORMAT` out of
      `packages/chat-server/src/chat.module.ts` and `DEBUG_API_CONTENT` out of
      `packages/agent-langchain/src/agent.ts` into explicit config passed from
      the composition root. Library packages should not read `process.env`.
- [x] Add a single typed config loader (e.g. `packages/backend/src/config.ts`)
      that centralises all `process.env` reads, the `DF_` prefix, validation,
      and defaults. Replace the inline `process.env.*` reads in
      `packages/backend/src/main.ts` with it.
- [x] Implement a backward-compatible read helper:
      `read("FOO") => process.env.DF_FOO ?? process.env.FOO`. When only the
      legacy name is present, log a one-time deprecation warning naming the new
      variable. (`PORT` and `DATABASE_URL` use the same helper, but their
      canonical fallback is permanent rather than deprecated.)
- [x] Update `.env.example`, `README.md`, `INSTALL.md`, `docker-compose.yml`,
      and any deployment manifests to the new names. All other documentation
      must refer to the new `DF_*` names only (no legacy names except where the
      permanent `PORT` / `DATABASE_URL` canonical fallback is explained).
- [x] Write `ENV_MIGRATION.md` documenting every renamed variable (old → new),
      the keep-canonical exceptions (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), the
      permanent `PORT` / `DATABASE_URL` canonical fallbacks, and step-by-step
      instructions for migrating an existing deployment to the new names,
      including the deprecation window and warning behaviour.
- [x] Add a unit test for the config loader: prefixed name wins, legacy fallback
      works and warns, validation errors are raised for malformed values.
- [ ] After test deployments have migrated, remove the legacy fallbacks and
      deprecation warnings (except the permanent `PORT` / `DATABASE_URL`
      canonical fallbacks) in a follow-up change.

## Security

### Rate limiting

No rate limiting is applied to any endpoint. Add rate limiting middleware (e.g.
`@nestjs/throttler`) to protect login, OIDC callback, thread creation, and
WebSocket message sending against brute-force and abuse.
