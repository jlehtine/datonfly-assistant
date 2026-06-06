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
# Edit .env — at minimum set ANTHROPIC_API_KEY

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
> because the vendor SDKs read them directly. Legacy unprefixed names are still
> accepted during a deprecation window — see
> [ENV_MIGRATION.md](ENV_MIGRATION.md).

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

The AI agent is powered by Anthropic models. Configure the model and optional
title generation model:

```env
ANTHROPIC_API_KEY=sk-ant-...
DF_ANTHROPIC_MODEL=claude-opus-4-6
DF_ANTHROPIC_TITLE_MODEL=claude-haiku-4-5
```

- **`ANTHROPIC_API_KEY`** — Required. Your Anthropic API key (canonical name,
  read by the SDK — no `DF_` prefix).
- **`DF_ANTHROPIC_MODEL`** _(optional, default: claude-opus-4-6)_ — The model
  used for chat responses.
- **`DF_ANTHROPIC_TITLE_MODEL`** _(optional)_ — Model for auto-generating thread
  titles. Omit to disable title generation.

## Agent Tools and MCP

The agent can call tools while answering. Anthropic's built-in server-side tools
(web search, web fetch, code execution) are enabled by default; set the
corresponding flag to `"false"` to disable any of them:

```env
DF_ENABLE_COMPACTION=true
DF_ENABLE_CODE_EXECUTION=true
DF_ENABLE_WEB_SEARCH=true
DF_ENABLE_WEB_FETCH=true
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
