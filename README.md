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

## Prerequisites

- Node.js >= 22
- pnpm >= 10

## Quick Start

Configure required details in `.env` (see `.env.example` for a starting point).

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the backend
pnpm start

# In another terminal, start the frontend dev server
pnpm dev
```

Open http://localhost:5173 — the frontend proxies WebSocket connections to the
backend on port 3000.

## End-to-End Tests

Tests use Playwright and require both the backend and frontend dev server to be
running (see Quick Start above).

```bash
# First-time setup: install the Chromium browser
npx playwright install chromium

# Run tests
pnpm test:e2e
```

## Package Structure

The project is organized as a monorepo with library packages and a standalone
implementation. All libraries use strictly-typed TypeScript API interfaces.

### Libraries

Used for embedding assistant functionality into any application. Also used by
the standalone implementation.

#### `@datonfly-assistant/core`

Generic types and interfaces shared among the other library packages,
applications embedding assistant functionality and pluggable provider
implementations. Does not have any dependencies.

#### `@datonfly-assistant/chat-server`

NestJS based backend for assistant functionality. Provides backend endpoints and
their interface declarations to `chat-client`. Uses pluggable service providers
to implement assistant functionality — for example, the default AI agent and
persistence layer implementations are provided as pluggable providers that can
be replaced with custom or alternative providers.

Configured and initialized by application specific logic. Designed to be
embedded into the Node.js backend of the host application or to be used as a
building block of an application specific assistant backend. Provides hooks for
custom logic such as assistant tools that can access application data or control
the application.

Uses pluggable provider packages only indirectly through the generic API
interfaces declared by `core`. The application logic initializes and configures
the selected providers and passes them as parameters to the backend server.

Dependencies: `@datonfly-assistant/core`.

#### `@datonfly-assistant/chat-client`

Implements the web client side assistant logic. Connects to the endpoints
provided and declared by `chat-server`. Maintains the client side assistant
state, sending requests to and receiving updates from the server.

Does not include a concrete user interface implementation. Instead, provides
hooks for pluggable user interface implementations. Configured and initialized
by application specific logic. Designed to be embedded into application web
frontends and can be used with `chat-ui-mui` or with a completely custom user
interface.

Dependencies: `@datonfly-assistant/core`, `@datonfly-assistant/chat-server`
(endpoint interface declarations only).

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
AI agent service API declared by `core` and used by `chat-server`.

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
Also hosts the static files of `frontend` for web users. Supports OIDC based
authentication for production usage.

#### `@datonfly-assistant/frontend`

Standalone web frontend using `chat-client` and `chat-ui-mui`. Extends the
generic user interface with sign in functionality coupled with the `backend`
OIDC authentication support.
