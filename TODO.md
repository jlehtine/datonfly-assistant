# TODO

## Configuration — environment variable naming convention

Decide and apply a consistent naming convention for environment variables. Adopt
a **hybrid** scheme: keep canonical names for variables read by third-party SDKs
or that are strong ecosystem standards, and namespace-prefix the application's
own config. This improves clarity and avoids collisions when the standalone
assistant is co-deployed with other services, while preserving "it just works"
behaviour for provider SDKs and platform conventions.

Status: not started — pending a decision on the prefix (see first task). This is
an operational/breaking change for existing test deployments, so it must ship
with a deprecation window, not a hard rename.

### Decisions to make first

- [ ] Choose the prefix scope: a **suite-wide** prefix shared with
      `datonfly-autocode` (e.g. `DF_`) vs. a **per-app** prefix (e.g. `DFA_` for
      datonfly-assistant). Per-app avoids intra-suite collisions when both run
      in one environment; suite-wide is simpler. Recommendation: per-app `DFA_`.
- [ ] Confirm the keep-canonical list (no prefix): `ANTHROPIC_API_KEY`,
      `OPENAI_API_KEY`, `DATABASE_URL`, `PORT`, `LOG_LEVEL`, `LOG_FORMAT`,
      `QDRANT_URL`, `INFINITY_URL`. (SDK-read or ecosystem standards.)

### Variables to prefix (application-owned)

Rename the following from `FOO` to `<PREFIX>_FOO` (default `DFA_`):

- [ ] Auth: `AUTH_MODE`, `JWT_SECRET`, `SESSION_TTL_SECONDS`, `FRONTEND_URL`,
      `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
      `OIDC_REDIRECT_URI`, `OIDC_ALLOWED_EMAIL_DOMAIN`, `OIDC_ALLOWED_EMAILS`,
      `FAKE_USER_EMAIL`, `FAKE_USER_NAME`.
- [ ] Model / agent: `ANTHROPIC_MODEL`, `ANTHROPIC_TRIAGE_MODEL`,
      `ANTHROPIC_TITLE_MODEL`, `ANTHROPIC_THINKING_TYPE`,
      `ANTHROPIC_THINKING_DISPLAY`, `ANTHROPIC_THINKING_BUDGET_TOKENS`,
      `ANTHROPIC_THINKING_EFFORT`, `ENABLE_COMPACTION`, `ENABLE_CODE_EXECUTION`,
      `ENABLE_WEB_SEARCH`, `ENABLE_WEB_FETCH`, `AGENT_MAX_TOOL_ITERATIONS`,
      `DEBUG_API_CONTENT`. (Note: the `ANTHROPIC_*` knobs here are _our_ config,
      not SDK-read — only the bare `ANTHROPIC_API_KEY` stays canonical.)
- [ ] MCP: `MCP_SERVERS`, `MCP_TOOL_TIMEOUT_MS`.
- [ ] Transcription: `OPENAI_TRANSCRIBE_MODEL`.
- [ ] Search: `MEMBER_SEARCH_STRATEGY`, `SEARCH_STEMMER_LANGUAGE`,
      `EMBEDDINGS_TIMEOUT_MS`, `SEARCH_RECENCY_HALF_LIFE_DAYS`.
- [ ] Ops/admin: `TRUSTED_REVERSE_PROXY`, `ADMIN_SECRET`, `ADMIN_IPS`.
- [ ] Frontend (Vite): audit `import.meta.env.VITE_*` usage; Vite already
      enforces a `VITE_` prefix, so align names but keep that prefix.

### Implementation steps

- [ ] Add a single typed config loader (e.g. `packages/backend/src/config.ts`)
      that centralises all `process.env` reads, the prefix, validation, and
      defaults. Replace the inline `process.env.*` reads in
      `packages/backend/src/main.ts` and the logger config in
      `packages/chat-server/src/chat.module.ts` with it.
- [ ] Implement a backward-compatible read helper:
      `read("FOO") => process.env.DFA_FOO ?? process.env.FOO`. When only the
      legacy name is present, log a one-time deprecation warning naming the new
      variable.
- [ ] Update `.env.example`, `README.md`, `INSTALL.md`, `docker-compose.yml`,
      and any deployment manifests to the new names.
- [ ] Add a unit test for the config loader: prefixed name wins, legacy fallback
      works and warns, validation errors are raised for malformed values.
- [ ] After test deployments have migrated, remove the legacy fallbacks and the
      deprecation warnings in a follow-up change.

## Security

### Rate limiting

No rate limiting is applied to any endpoint. Add rate limiting middleware (e.g.
`@nestjs/throttler`) to protect login, OIDC callback, thread creation, and
WebSocket message sending against brute-force and abuse.
