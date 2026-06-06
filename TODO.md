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

No rate limiting is applied to any endpoint. Add configurable rate limiting to
protect login, the OIDC callback, thread/message mutations, expensive LLM-backed
operations (agent messages, transcription, semantic search), and WebSocket
message sending against brute-force and abuse. The defaults must work out of the
box for deployments with tens of simultaneous users, and an operator must be
able to disable rate limiting entirely.

Status: not started.

#### Design goals

- **Sane defaults, minimal knobs.** A fresh standalone deployment should be
  protected without configuring anything. The common case (loosen/tighten
  everything a bit) must be a single knob, not one variable per limit.
- **Disable switch.** A single flag turns rate limiting off entirely (useful for
  trusted-network deployments, load testing, or embedding scenarios where the
  host already rate-limits).
- **Per-tier limits, not per-endpoint.** Group endpoints into a few tiers with
  different cost profiles rather than configuring each route individually.
- **Fair keying.** Limit per authenticated user where possible, falling back to
  client IP for unauthenticated requests. IP extraction must respect the
  existing `trust proxy` configuration (`DF_TRUSTED_REVERSE_PROXY`) so limits
  are not applied to the reverse proxy's address.
- **Embeddable.** The `chat-server` library must receive the full configuration
  as an object (no `process.env` reads in the library), consistent with the
  `DF_` config work above; only the standalone backend maps env → config.

#### Decisions (to confirm)

- **Library:** `@nestjs/throttler` (v6, compatible with NestJS 11). Supports
  named throttlers, per-route overrides via `@Throttle({...})`, `@SkipThrottle`,
  a custom `getTracker` for user/IP keying, and pluggable storage. In-memory
  storage is the default; a Redis/shared store is out of scope for now (single
  instance), but the storage should be injectable so a multi-instance deployment
  can swap it in later without code changes to the guards.
- **Scaling model (the single primary knob):** a dimensionless **`factor`**
  (default `1.0`) multiplies every tier's default limit. `factor=2` doubles all
  allowances, `factor=0.5` halves them. This is the recommended way to tune a
  standalone deployment up or down without learning every tier.
  - Rationale: per-client limits are independent per user, so they should _not_
    scale with the number of users — each user gets the same fixed allowance.
    What an operator actually wants is "give everyone a bit more/less headroom",
    which is exactly a multiplier.
  - **Expected-users knob (optional, for the global ceiling only):**
    `expectedUsers` (default sized for ~50) sizes an _aggregate_ ceiling on the
    most expensive shared resource (agent messages, and transcription) to bound
    total load on the LLM/transcription provider independently of per-user
    limits. It does not change per-user limits. Omit/!set ⇒ no global ceiling
    (per-user limits only). This is the "number of expected simultaneous users"
    option, scoped to where it actually makes sense.
- **No per-tier override knob.** The tier defaults are fixed in code; operators
  tune only via `factor` (and the optional `expectedUsers` ceiling). If a tier's
  default proves wrong in practice, change the default in code rather than
  exposing a configuration surface for it.

#### Tiers and default limits (before `factor`)

Limits are per keying-subject (authenticated user id, else client IP) per
window. Tune the exact numbers during implementation; these are starting points
for "tens of simultaneous users":

- **`auth`** — `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`.
  Unauthenticated ⇒ keyed by IP. Strict (brute-force surface): ~10 / minute.
- **`mutation`** — thread create/patch/delete, member invite/remove/role,
  `PATCH .../my-state`, `PATCH /users/me`. Keyed by user. ~60 / minute.
- **`expensive`** — WebSocket `send-message` (triggers an agent run),
  `POST /transcribe`, `GET /threads/search`, `GET /users/search` (embeddings).
  Keyed by user. Lower: ~20 / minute for messages, ~10 / minute for
  transcription; search ~30 / minute.
- **`upload`** — `POST /attachments`. Keyed by user. ~30 / minute (count-based;
  byte/size limits are a separate concern, out of scope here).
- **`read`** — authenticated `GET` endpoints (thread list/detail, messages,
  members, `users/me`). Keyed by user. Generous: ~300 / minute (mostly a
  backstop against runaway clients).
- **`admin`** — `POST /admin/reindex`. Already IP-allowlisted + Bearer-gated;
  add a light throttle (~5 / minute) as defense in depth.

A **global aggregate ceiling** (only when `expectedUsers` is set) caps total
`expensive`-tier requests across all users at roughly
`expectedUsers × per-user-expensive-allowance`, protecting the LLM/transcription
provider from thundering-herd load.

#### Configuration surface

Library (`chat-server`) config object — extend `ChatModuleConfig`:

```
rateLimit?: {
  enabled?: boolean;            // default true
  factor?: number;             // default 1.0, multiplies all tier limits
  expectedUsers?: number;      // optional; sizes the global expensive-tier ceiling
  storage?: ThrottlerStorage;  // optional injectable store (future: Redis)
}
```

Standalone backend env (mapped in `packages/backend/src/config.ts`):

- `DF_RATE_LIMIT_ENABLED` — `true` (default) / `false`.
- `DF_RATE_LIMIT_FACTOR` — positive number, default `1.0`.
- `DF_RATE_LIMIT_EXPECTED_USERS` — optional positive integer; enables the global
  ceiling.

#### Implementation steps

- [ ] Add `@nestjs/throttler` to `chat-server` and (re)move the unused
      `express-rate-limit` dependency if it is not used elsewhere.
- [ ] Define the tier model and a pure function that computes effective limits
      from `{ defaults, factor }` (unit-testable, no Nest/DI).
- [ ] Register `ThrottlerModule` in `ChatModule` from the resolved config; when
      `enabled === false`, skip registration / apply a no-op guard so no limits
      are enforced.
- [ ] Implement a custom tracker (`getTracker`) that keys by authenticated user
      id when present, else by client IP resolved through the existing
      `trust proxy` setting (reuse the IP-extraction logic used by `AdminGuard`
      / `ChatModule` request-IP resolution).
- [ ] Apply tiers: a default `read`/`mutation` throttler at the module level,
      with `@Throttle({...})` / named throttlers on `auth`, `expensive`,
      `upload`, and `admin` routes. Ensure `@SkipThrottle` where a route must be
      exempt.
- [ ] Throttle the WebSocket `send-message` handler in `chat.gateway.ts` (the
      agent-invocation path) using the same storage/limits as the `expensive`
      tier, keyed by the connection's authenticated user; emit a structured
      `error` event when exceeded rather than dropping silently.
- [ ] Implement the optional global aggregate ceiling for the `expensive` tier
      when `expectedUsers` is set.
- [ ] Return proper `429 Too Many Requests` with `Retry-After` for HTTP; define
      the WS error shape for exceeded limits.
- [ ] Map env → config in `packages/backend/src/config.ts`
      (`DF_RATE_LIMIT_ENABLED` / `_FACTOR` / `_EXPECTED_USERS`), validate
      values, and pass `rateLimit` into `ChatModule.forRoot(...)` in
      `packages/backend/src/main.ts`.
- [ ] Document in `.env.example`, `INSTALL.md`, and (briefly) `README.md`: the
      `factor` knob, the disable switch, the optional expected-users ceiling,
      and the per-tier defaults table.
- [ ] Tests: unit-test the limit-computation function (factor scaling and
      disabled state) and add an e2e/integration test that a tight limit yields
      `429` on HTTP and the WS error on `send-message`, and that `enabled=false`
      disables enforcement.
- [ ] Confirm behaviour behind a reverse proxy: with `DF_TRUSTED_REVERSE_PROXY`
      set, limits key on the real client IP, not the proxy address.
