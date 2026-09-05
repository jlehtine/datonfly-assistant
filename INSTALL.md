# Installation Guide

## Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Docker** and **Docker Compose** (for PostgreSQL, Qdrant, Infinity)

## Quick Start (Local Development)

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# By default this points at a local fixture playback harness (no API key or
# billing needed) — see "Fixture Playback Harness" below to use the real API.

# Start infrastructure services
docker compose up -d

# Start all packages in dev/watch mode
pnpm dev
```

This runs all library packages with `tsc --watch`, the backend with `tsx watch`
(auto-restart on changes), and the frontend with Vite HMR — so any code change
across the repo is reflected on the fly.

Open http://localhost:5173 — the frontend proxies WebSocket connections to the
backend on port 3000.

Alternatively, to build and run without watch mode:

```bash
pnpm build
pnpm start
```

This starts the backend, which also serves the pre-built frontend to the
browser.

By default, `DF_AUTH_MODE=fake` is used — no login is required for local
development.

## Authentication

Datonfly Assistant supports two authentication modes, controlled by the
`DF_AUTH_MODE` environment variable:

| Mode   | Use case                  | Login required? |
| ------ | ------------------------- | --------------- |
| `fake` | Local development, E2E CI | No              |
| `oidc` | Production                | Yes             |

> All Datonfly configuration variables use the `DF_` prefix. The only exceptions
> are `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, which keep their canonical names
> because the vendor SDKs read them directly, and `PORT` / `DATABASE_URL`, whose
> unprefixed forms remain accepted as a fallback. Unprefixed legacy names are no
> longer read — see [ENV_MIGRATION.md](ENV_MIGRATION.md).

### Fake Mode (`DF_AUTH_MODE=fake`)

The default. A hardcoded dev user is automatically authenticated on every
request. No OIDC provider is needed.

Optional configuration:

```env
DF_FAKE_USER_EMAIL=dev@localhost
DF_FAKE_USER_NAME=Dev User
```

### OIDC Mode (`DF_AUTH_MODE=oidc`)

Uses OpenID Connect Authorization Code flow with PKCE. Any standards-compliant
OIDC provider works (Google, Azure AD, Keycloak, Auth0, etc.).

Required environment variables:

```env
DF_AUTH_MODE=oidc
DF_OIDC_ISSUER_URL=https://accounts.google.com
DF_OIDC_CLIENT_ID=your-client-id.apps.googleusercontent.com
DF_OIDC_CLIENT_SECRET=your-client-secret
DF_OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
DF_JWT_SECRET=a-strong-random-secret
```

- **`DF_OIDC_ISSUER_URL`** — The OIDC provider's issuer URL. The backend
  performs
  [discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
  automatically (`/.well-known/openid-configuration`).
- **`DF_OIDC_CLIENT_ID`** / **`DF_OIDC_CLIENT_SECRET`** — OAuth 2.0 client
  credentials.
- **`DF_OIDC_REDIRECT_URI`** — Must match the redirect URI registered with the
  provider. For local dev: `http://localhost:3000/auth/callback`.
- **`DF_JWT_SECRET`** — Secret used to sign session JWTs. Auto-generated if
  omitted but should be set explicitly in production for persistent sessions
  across restarts.
- **`DF_OIDC_ALLOWED_EMAIL_DOMAIN`** _(optional)_ — If set, only users whose
  email address ends with `@<domain>` are allowed to log in (e.g.
  `example.com`). Useful when the identity provider cannot restrict sign-ins to
  a single organization.
- **`DF_OIDC_ALLOWED_EMAILS`** _(optional)_ — Comma-separated list of allowed
  email addresses. If set, only these addresses can authenticate. Other
  restrictions (e.g. domain) still apply.
- **`DF_SESSION_TTL_SECONDS`** _(optional, default: 604800 = 7 days)_ — Session
  idle timeout. Both the JWT expiry and cookie maxAge are set to this value. The
  session is automatically extended on each authenticated `/auth/me` request.

## AI Model Configuration

The AI agent is powered by Anthropic models. `.env.example` ships pointed at a
local fixture playback harness by default (see "Fixture Playback Harness"
below), so a fresh checkout runs with no key and no billing. For real usage,
comment out the two `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` lines under
"Fixture playback harness" in `.env` and configure the model and a real key
instead:

```env
ANTHROPIC_API_KEY=sk-ant-...
DF_AGENT_MODEL=claude-opus-4-6
DF_AGENT_TITLE_MODEL=claude-haiku-4-5
```

- **`ANTHROPIC_API_KEY`** — Required for real use. Your Anthropic API key
  (canonical name, read by the SDK — no `DF_` prefix).
- **`DF_AGENT_MODEL`** _(optional, default: claude-opus-4-6)_ — The model used
  for chat responses.
- **`DF_AGENT_TITLE_MODEL`** _(optional)_ — Model for auto-generating thread
  titles. Omit to title with `DF_AGENT_MODEL` instead; titling is always on. Set
  it to a cheaper model to keep titling off the main model's bill.

### Fixture Playback Harness

`.env.example` ships with `ANTHROPIC_BASE_URL=http://localhost:4010` and a dummy
`ANTHROPIC_API_KEY=sk-ant-test` active by default:

```env
ANTHROPIC_BASE_URL=http://localhost:4010
ANTHROPIC_API_KEY=sk-ant-test
```

`ANTHROPIC_BASE_URL` is read by the Anthropic SDK itself — there is no `DF_`
variable or application wiring for it. It points at a local playback server
(`packages/agent-anthropic`'s `fake-api` script) that `pnpm dev` starts
automatically, which replays recorded/synthesised fixtures instead of calling
the real API: deterministic, free, and fast, and what a fresh checkout runs
against out of the box with no key and no billing.

To develop or test against the real Anthropic API — required for genuine live
usage, and for anything beyond the fixed set of recorded scenarios — comment out
both lines above and set a real `ANTHROPIC_API_KEY` instead (see "AI Model
Configuration" above). Never leave a real key set while `ANTHROPIC_BASE_URL`
points somewhere other than Anthropic's own API.

## Agent Tools and MCP

The agent can call tools while answering. Anthropic's built-in server-side tools
(web search, web fetch, code execution) are enabled by default; set the
corresponding flag to `"false"` to disable any of them:

```env
DF_ANTHROPIC_ENABLE_COMPACTION=true
DF_ANTHROPIC_ENABLE_CODE_EXECUTION=true
DF_ANTHROPIC_ENABLE_WEB_SEARCH=true
DF_ANTHROPIC_ENABLE_WEB_FETCH=true
```

When the assistant uses code execution to create a file for the user (a script,
chart, dataset, …), it's delivered as a downloadable attachment on the message.
This is enabled by default whenever code execution is; set
`DF_ENABLE_GENERATED_FILES=false` to keep code execution (e.g. for web
search/fetch) without file output. `DF_GENERATED_FILE_MAX_BYTES` caps the size
of a single downloaded file; unset means no cap beyond the provider's own
limits.

```env
DF_ENABLE_GENERATED_FILES=true
# DF_GENERATED_FILE_MAX_BYTES=26214400
```

Custom tools can additionally be provided through external **MCP (Model Context
Protocol)** servers. This is disabled by default; when `DF_MCP_SERVERS` is unset
the agent behaves exactly as before. Set it to a JSON array of server
configurations:

```env
# stdio server (a local process)
DF_MCP_SERVERS=[{"name":"filesystem","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/data"]}]

# remote Streamable HTTP server
DF_MCP_SERVERS=[{"transport":"http","name":"remote","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer TOKEN"}}]
```

- **`DF_MCP_SERVERS`** _(optional)_ — JSON array of MCP servers. Each entry is
  either a stdio server (`{ "name", "command", "args"?, "env"?, "cwd"? }`) or a
  Streamable HTTP server (`{ "transport": "http", "name", "url", "headers"? }`).
  The legacy HTTP+SSE transport is not supported. On startup the backend
  connects to each server, lists its tools, and exposes them to the agent; tool
  names must be unique across all servers. A connection failure aborts startup.
- **`DF_MCP_TOOL_TIMEOUT_MS`** _(optional)_ — Per tool-call timeout in
  milliseconds. Omit to use the MCP SDK default.
- **`DF_AGENT_MAX_TOOL_ITERATIONS`** _(optional, default: 10)_ — Maximum number
  of model turns in a tool-calling loop before the agent aborts the request.
- **`DF_AGENT_MAX_TOKENS`** _(optional, default: 64000)_ — Maximum tokens in a
  chat response. Thinking tokens are billed as output and count against this
  budget, so a low value can cut a response off with `stop_reason: "max_tokens"`
  before the model is done. 64000 is the lowest max-output ceiling among the
  models this project ships with (Haiku 4.5); Opus 5 and Sonnet 5 allow up
  to 128000.

## Audio Input (Transcription)

Users can dictate messages with their microphone. Audio is transcribed
server-side via OpenAI and only the resulting text is sent and stored — the
audio itself is never persisted. The feature is enabled automatically when an
OpenAI API key is configured, and a microphone button then appears in the
composer.

```env
OPENAI_API_KEY=sk-...
DF_OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

- **`OPENAI_API_KEY`** _(optional)_ — Enables audio input when set (canonical
  name, read by the SDK — no `DF_` prefix). Omit to disable transcription (the
  microphone button is hidden).
- **`DF_OPENAI_TRANSCRIBE_MODEL`** _(optional, default: gpt-4o-mini-transcribe)_
  — The OpenAI model used for transcription.

## Logging

```env
DF_LOG_FORMAT=pretty
DF_LOG_LEVEL=info
```

- **`DF_LOG_FORMAT`** _(optional, default: pretty)_ — `"json"` for
  machine-parseable JSON lines, or `"pretty"` for human-readable output.
- **`DF_LOG_LEVEL`** _(optional, default: info)_ — One of `"trace"`, `"debug"`,
  `"info"`, `"warn"`, `"error"`, `"fatal"`.

### Anthropic Traffic Dump

Occasional assistant failures that aren't recovered automatically (a mid-stream
disconnect, a malformed response, …) can be hard to reproduce after the fact.
Setting `DF_ANTHROPIC_TRAFFIC_DUMP_DIR` makes the agent write every raw
Anthropic API request, response, and streamed chunk to that directory as a
timestamped JSON file, so a failure can be inspected — and replayed through
`startFixtureServer()` in `@datonfly-assistant/agent-anthropic/testing` — later.
Off unless set.

```env
DF_ANTHROPIC_TRAFFIC_DUMP_DIR=/tmp/datonfly-traffic-dump
```

Dumped files contain full, unredacted conversation content — only credentials
(the API key, auth headers) are stripped. Enable this only for as long as needed
to capture a failure, and treat the directory as sensitive.

---

## Rate Limiting

Per-subject request limits protect login, mutations, and expensive LLM-backed
operations against brute-force and abuse. They are enabled by default with
limits sized for tens of simultaneous users, so most deployments need to
configure nothing.

```env
DF_RATE_LIMIT_ENABLED=true
DF_RATE_LIMIT_FACTOR=1.0
# DF_RATE_LIMIT_EXPECTED_USERS=50
```

- **`DF_RATE_LIMIT_ENABLED`** _(optional, default: `true`)_ — Set to `false` to
  disable all rate limiting (trusted networks, load testing, or when the host
  already enforces limits).
- **`DF_RATE_LIMIT_FACTOR`** _(optional, default: `1.0`)_ — The single tuning
  knob: a positive multiplier applied to every tier's limit. `2` doubles all
  allowances, `0.5` halves them. This is the recommended way to loosen or
  tighten a deployment without learning every tier.
- **`DF_RATE_LIMIT_EXPECTED_USERS`** _(optional)_ — A positive integer that
  enables an aggregate ceiling on the shared expensive pool (agent messages +
  transcription), sized at `expectedUsers × per-user-expensive-allowance`. This
  bounds total load on the LLM/transcription provider independently of per-user
  limits. Omit for per-user limits only (no global cap).

Limits are keyed by authenticated user id where available, falling back to the
client IP. IP extraction respects `DF_TRUSTED_REVERSE_PROXY`, so limits are
applied to the real client rather than the reverse proxy.

Per-tier defaults (requests per minute, before `DF_RATE_LIMIT_FACTOR`):

| Tier         | Limit | Endpoints                                               |
| ------------ | ----- | ------------------------------------------------------- |
| `read`       | 300   | Authenticated GETs (thread list/detail, messages, etc.) |
| `mutation`   | 60    | Thread/message create/patch/delete, profile updates     |
| `auth`       | 10    | Login / OIDC callback / logout                          |
| `message`    | 20    | WebSocket `send-message` (triggers an agent run)        |
| `transcribe` | 10    | `POST /transcribe` (audio transcription)                |
| `search`     | 30    | Thread/user semantic search (embeddings)                |
| `upload`     | 30    | `POST /attachments`                                     |
| `admin`      | 5     | `POST /admin/reindex`                                   |

Exceeded HTTP limits return `429 Too Many Requests` with a `Retry-After` header;
an exceeded WebSocket `send-message` limit emits a structured `error` event with
code `rate_limited`.

---

## Importing Production-like Thread Data into Dev

Search relevance work needs realistic thread data, but a production-like
database also holds other people's chats and must not be copied wholesale.
`scripts/db/` has three plain-SQL tools for this, run through `psql` — nothing
needs to be installed on the server beyond the `postgres` Compose service
already there.

**Export** (read-only, safe to run against a production-like database) dumps one
user's threads as JSONL. Only _solo_ threads — where that user is both the owner
and the only member — are included, so no other person's messages or identity
(the `dfa.user` row itself is never exported) ever leave the server:

```bash
ssh SERVER 'cd <deploy-dir> && docker compose exec -T postgres \
    psql -U datonfly -d datonfly -q -v ON_ERROR_STOP=1 -v email=user@example.com' \
    < scripts/db/export-threads.sql > threads.jsonl
```

**Import** (dev-only, destructive-adjacent — inserts into the local database)
loads a dump into the local Compose Postgres, re-attached to a chosen dev user
(defaults to the first fake user, `fake.alice@dev.invalid`). Thread, message,
attachment and topic ids are preserved, so importing the same dump twice is a
no-op:

```bash
pnpm db:import-threads threads.jsonl [target-email]
```

**Clear** (dev-only, destructive) deletes thread history in the local database —
either one user's owned threads, or, with no argument, every thread:

```bash
pnpm db:clear-threads [email]
```

After an import (or any change to the message data), rebuild the search index
with `POST /datonfly-assistant/admin/reindex` (see "Rate Limiting" above for its
tier) — these scripts only touch Postgres, never the search index.

---

## Google Cloud OIDC Setup

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.

### 2. Configure the OAuth consent screen

1. Navigate to **APIs & Services → OAuth consent screen**.
2. Choose **External** user type (or **Internal** for Google Workspace orgs).
3. Fill in the required fields:
   - **App name**: Datonfly Assistant
   - **User support email**: your email
   - **Developer contact**: your email
4. Add scopes: `openid`, `email`, `profile`.
5. Add test users if the app is in "Testing" publishing status.

### 3. Create OAuth 2.0 credentials

1. Navigate to **APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth client ID**.
3. Select **Web application**.
4. Set:
   - **Name**: Datonfly Assistant (local) — or any label
   - **Authorized JavaScript origins**:
     - `http://localhost:5173` (local development — Vite dev server)
     - `https://your-domain.com` (production)
   - **Authorized redirect URIs**:
     - `http://localhost:3000/auth/callback` (local development)
     - `https://your-domain.com/auth/callback` (production)
5. Click **Create** and note the **Client ID** and **Client Secret**.

### 4. Configure environment

```env
DF_AUTH_MODE=oidc
DF_OIDC_ISSUER_URL=https://accounts.google.com
DF_OIDC_CLIENT_ID=123456789-abc.apps.googleusercontent.com
DF_OIDC_CLIENT_SECRET=GOCSPX-...
DF_OIDC_REDIRECT_URI=http://localhost:3000/auth/callback
DF_JWT_SECRET=$(openssl rand -base64 32)
```

### 5. Verify

```bash
pnpm build && pnpm start
```

Open `http://localhost:5173` — you should be redirected to Google's login page.
After signing in, you'll be returned to the app authenticated.

---

## End-to-End Tests

E2E tests use `DF_AUTH_MODE=fake` (the default), so no OIDC setup is needed:

```bash
# Start backend + frontend, then:
pnpm test:e2e
```
