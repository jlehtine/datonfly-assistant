# Datonfly Assistant

AI assistant platform providing both a set of generic embeddable library
components and a standalone assistant application built on those same
components.

The library packages can be used to embed assistant functionality into any
application — backend, frontend, or both. The standalone implementation serves
as a ready-to-run assistant and as a reference for how the libraries are
composed.

Core functionality is extensible through pluggable service providers. The AI
agent and persistence layer are implemented behind generic API interfaces,
making it straightforward to replace the bundled implementations with custom or
alternative providers. On the frontend, the user interface is decoupled from the
client logic through hooks, allowing applications to use the bundled React/MUI
components, customize them, or provide a completely independent user interface.
Application specific assistant tools can be injected to give the assistant
access to application data and control.

See [INSTALL.md](INSTALL.md) for detailed setup instructions and
[CONVENTIONS.md](CONVENTIONS.md) for coding and database conventions.

## Features

- **Real-time streaming chat** — AI responses stream incrementally as they are
  generated, with live tool status updates (e.g. "Searching the web…", "Running
  code…").
- **Multi-user conversations** — Invite other users to threads by email, with
  real-time message delivery, typing indicators, presence awareness, and member
  role management (owner / member). Configurable member search strategy supports
  a privacy-preserving mode where user search is limited to existing co-members.
- **Thread management** — Create, rename, and archive conversations. Threads
  support automatic AI-generated titles, unread message counts, and per-user
  archive state.
- **Rich text & code** — Messages support full Markdown formatting with a
  toggleable rich text editor (bold, italic, strikethrough, code, lists, links).
  Code blocks render with syntax highlighting.
- **AI agent tools** — The default implementation uses Claude as the AI model,
  with built-in Claude tools for web search (with source citations), web page
  fetching, and code execution. Application-specific tools can be injected by
  the host app.
- **Context management** — Long conversations are automatically compacted to
  stay within context limits. Compaction can be handled natively by the AI
  provider (e.g. Claude's built-in compaction) or externally by the gateway
  using AI-generated summaries.
- **Emoji picker** — Quick emoji insertion from an integrated picker.
- **User customization** — Set a personal alias for how the AI addresses you,
  choose between simple or rich text input, and manage profile settings.
- **Flexible authentication** — Supports OIDC (Google, Azure AD, Keycloak,
  Auth0, etc.) for production and a zero-config fake mode for development.
- **Embeddable architecture** — All library packages can be embedded
  independently into existing applications, with pluggable AI agent and
  persistence providers.

## Prerequisites

- Node.js >= 22
- pnpm >= 10

## Quick Start

Configure required details in `.env` (see `.env.example` for a starting point).

```bash
# Install dependencies
pnpm install

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

## End-to-End Tests

Tests use Playwright and require both the backend and frontend dev server to be
running (see Quick Start above).

```bash
# First-time setup: install the Chromium browser
npx playwright install chromium

# Run tests
pnpm test:e2e
```

> **Note:** Running the entire test suite at once easily triggers LLM rate
> limits, causing spurious failures. Prefer running individual test files:
>
> ```bash
> pnpm exec playwright test tests/thread-management.spec.ts
> ```

## Package Structure

The project is organized as a monorepo with library packages and a standalone
implementation. All libraries use strictly-typed TypeScript API interfaces.

### Libraries

Used for embedding assistant functionality into any application. Also used by
the standalone implementation.

#### `@datonfly-assistant/core`

Generic types and interfaces shared among the other library packages,
applications embedding assistant functionality and pluggable provider
implementations. Also declares the REST and WebSocket endpoint contract (path
constants and Zod wire-format schemas) used by both server and client packages.

Dependencies: `zod`.

#### `@datonfly-assistant/chat-server`

NestJS based backend for assistant functionality. Provides REST endpoints and a
WebSocket gateway for real-time chat. Uses pluggable service providers to
implement assistant functionality — for example, the default AI agent and
persistence layer implementations are provided as pluggable providers that can
be replaced with custom or alternative providers.

Authentication is delegated to the host application. The host application is
responsible for authenticating requests and populating `req.user` with a
`UserIdentity`. Chat-server provides a `RequireUserGuard` that resolves the
identity to a full `User` record and enforces thread-level membership checks.
For WebSocket connections, an optional `validateToken` callback is accepted to
verify tokens during the Socket.io handshake.

Configured and initialized by application specific logic. Designed to be
embedded into the Node.js backend of the host application or to be used as a
building block of an application specific assistant backend. Provides hooks for
custom logic such as assistant tools that can access application data or control
the application. Supports a configurable member search strategy that can limit
user discovery to existing co-members for privacy-sensitive deployments.

Uses pluggable provider packages only indirectly through the generic API
interfaces declared by `core`. The application logic initializes and configures
the selected providers and passes them as parameters to the backend server.

Dependencies: `@datonfly-assistant/core`.

#### `@datonfly-assistant/chat-client`

Implements the web client side assistant logic. Connects to the endpoints
declared by `core`. Maintains the client side assistant state, sending requests
to and receiving updates from the server. Provides a validated fetch wrapper
(`typedFetch`) that builds URLs from a configurable `basePath` and validates
responses through Zod schemas. Authentication is handled automatically via
HTTP-only cookies.

Also provides React hooks (via the `@datonfly-assistant/chat-client/react`
subpath export) for thread listing, message history, real-time streaming, and
connection management. The hooks source their configuration from a
`ChatClientContext` and do not require per-call URL or token options.

Does not include a concrete user interface implementation. Instead, provides
hooks for pluggable user interface implementations. Configured and initialized
by application specific logic. Designed to be embedded into application web
frontends and can be used with `chat-ui-mui` or with a completely custom user
interface.

Dependencies: `@datonfly-assistant/core`.

#### `@datonfly-assistant/chat-ui-mui`

React & Material UI based assistant user interface. Uses the hooks provided by
`chat-client` to hook into assistant state and backend functionality.

Configured and initialized by application specific logic. Provides hooks for
customizing the user interface and functionality. Designed to be embedded into
React/MUI based application user interfaces as a generic assistant or for
application features that build on assistant functionality.

Dependencies: `@datonfly-assistant/core`, `@datonfly-assistant/chat-client`,
React, MUI.

#### `@datonfly-assistant/agent-langchain`

Provides an AI agent service implementation based on LangChain. Implements the
AI agent service API declared by `core` and used by `chat-server`. When using
Claude, leverages built-in provider compaction for context management; for other
providers, external compaction via the gateway is used as a fallback.

Configured and initialized by application specific logic and passed to
`chat-server` as AI agent service.

Dependencies: `@datonfly-assistant/core`, LangChain.

#### `@datonfly-assistant/persistence-pg`

Provides a persistence service implementation based on PostgreSQL. Implements
the persistence service API declared by `core` and used by `chat-server`.

Configured and initialized by application specific logic and passed to
`chat-server` as persistence service.

Dependencies: `@datonfly-assistant/core`, PostgreSQL drivers.

### Standalone Implementation

A thin shim over the generic libraries for running the assistant as a standalone
application.

#### `@datonfly-assistant/backend`

Standalone backend using `chat-server`, `agent-langchain` and `persistence-pg`.
Also hosts the static files of `frontend` for web users. Implements
authentication (OIDC for production, fake mode for development) via a global JWT
guard that populates `req.user` with a `UserIdentity` expected by `chat-server`.
Also provides login, OIDC callback, and user info endpoints.

#### `@datonfly-assistant/frontend`

Standalone web frontend using `chat-client` and `chat-ui-mui`. Extends the
generic user interface with sign in functionality coupled with the `backend`
OIDC authentication support.
