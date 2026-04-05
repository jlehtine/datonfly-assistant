# Plan: Verbal Assistant

> **Verbal Assistant** — _Verbal Assistant for teams of people_

## TL;DR

Build **Verbal Assistant**, a full-stack AI chat platform for teams. NestJS
backend, React/MUI frontend (custom chat UI), LangChain + Claude with built-in
tools, PostgreSQL for chat persistence, Qdrant for semantic search, OIDC auth
(Google initially), and **multi-user chat rooms** with WebSocket real-time sync.
The AI participates in all threads — always responds in personal chats,
selectively responds in rooms based on conversation context. Plugin architecture
with `@verbal-assistant/*` npm packages. pnpm monorepo, Docker Compose +
Kubernetes deployment.

---

## Architecture Overview

```
┌──────────────────────────────────────────┐
│  Verbal Assistant (Frontend)             │
│  React + MUI (Custom Chat)              │
│  Socket.IO client for all real-time      │
└────────────┬─────────────────────────────┘
             │ WebSocket (Socket.IO) + REST
             │ JWT auth on handshake + headers
             ▼
┌──────────────────────────────────────────┐
│  Verbal Assistant (Backend)              │
│  NestJS                                  │
│  ├─ AuthModule (OIDC → JWT)              │
│  ├─ ChatGateway (WebSocket, Socket.IO)   │
│  ├─ ChatModule (LangGraph agent)         │
│  ├─ ThreadModule (CRUD, membership)      │
│  ├─ MemoryModule (long-term memory)      │
│  └─ SearchModule (semantic search)       │
└──┬──────────┬───────────┬────────────────┘
   │          │           │
   ▼          ▼           ▼
PostgreSQL   Qdrant    HF TEI (Embeddings)
(threads,    (semantic  (BGE-large-en-v1.5)
 messages,   indices)
 users,
 membership)
```

---

## Project Structure (pnpm Monorepo)

```
verbal-assistant/
├── pnpm-workspace.yaml
├── package.json              # root: scripts, devDeps (prettier, eslint, turborepo)
├── turbo.json                # Turborepo config for build orchestration
├── .prettierrc
├── eslint.config.mjs
├── docker-compose.yml
├── docker-compose.prod.yml
├── k8s/                      # Kubernetes manifests (later phase)
│
├── packages/
│   │
│   │  ─── SHARED CONTRACTS ───
│   │
│   ├── core/                         # @verbal-assistant/core
│   │   └── src/                      # TypeScript interfaces & types (peer dep: @langchain/core)
│   │       ├── types/                # Message, Thread, User, ContentPart, ToolCall
│   │       ├── events/               # WebSocket event discriminated unions (client↔server)
│   │       ├── interfaces/           # Plugin contracts:
│   │       │   ├── agent.ts          #   IChatAgent — run(), stream(), shouldRespond()
│   │       │   ├── persistence.ts    #   IPersistenceProvider — threads, messages, users, membership
│   │       │   ├── search.ts         #   ISearchProvider — semanticSearch(), index(), delete()
│   │       │   ├── embeddings.ts     #   IEmbeddingsProvider — embed(), embedBatch()
│   │       │   ├── tool.ts           #   ITool — name, description, schema, execute()
│   │       │   └── memory.ts         #   IMemoryProvider — save(), search(), list(), delete()
│   │       └── dto/                  # API request/response DTOs, Zod schemas
│   │
│   │  ─── BACKEND LIBRARIES (framework-agnostic) ───
│   │
│   ├── realtime/                     # @verbal-assistant/realtime
│   │   └── src/                      # WebSocket protocol handler (Socket.IO)
│   │       ├── server.ts             # ChatRealtimeServer — bootstrap with injected providers
│   │       ├── handlers/             # Event handlers: message, join, leave, typing, invite
│   │       ├── presence.ts           # In-memory presence tracker
│   │       └── middleware/           # Auth middleware (accepts token validator function)
│   │
│   ├── agent-langchain/              # @verbal-assistant/agent-langchain
│   │   └── src/                      # IChatAgent implementation: LangGraph + ChatAnthropic
│   │       ├── agent.ts              # LangGraphAgent — implements IChatAgent
│   │       ├── graph.ts              # LangGraph graph definition (ShouldRespond → Agent → Stream)
│   │       ├── should-respond.ts     # Gating node for rooms
│   │       └── tool-adapter.ts       # Adapts ITool plugins to LangChain tool() format
│   │
│   ├── persistence-pg/               # @verbal-assistant/persistence-pg
│   │   └── src/                      # IPersistenceProvider + IMemoryProvider via PostgreSQL
│   │       ├── provider.ts           # PostgresPersistenceProvider — implements IPersistenceProvider
│   │       ├── memory-provider.ts    # PostgresMemoryProvider — implements IMemoryProvider (relational side)
│   │       ├── entities/             # TypeORM entities: User, Thread, Message, ThreadMember, Memory
│   │       └── migrations/           # TypeORM migrations
│   │
│   ├── search-qdrant/                # @verbal-assistant/search-qdrant
│   │   └── src/                      # ISearchProvider + IMemoryProvider (vector side) via Qdrant
│   │       ├── provider.ts           # QdrantSearchProvider — implements ISearchProvider
│   │       ├── memory-search.ts      # QdrantMemorySearch — vector side of IMemoryProvider
│   │       └── collections.ts        # Collection schemas & initialization
│   │
│   ├── embeddings-local/             # @verbal-assistant/embeddings-local
│   │   └── src/                      # IEmbeddingsProvider via HuggingFace TEI HTTP API
│   │       └── provider.ts           # TEIEmbeddingsProvider — implements IEmbeddingsProvider
│   │
│   ├── tool-web-search/              # @verbal-assistant/tool-web-search
│   │   └── src/                      # ITool implementation: Anthropic built-in web_search
│   │       └── tool.ts               # WebSearchTool — implements ITool
│   │
│   ├── tool-code-execution/          # @verbal-assistant/tool-code-execution
│   │   └── src/                      # ITool implementation: Anthropic built-in code_execution
│   │       └── tool.ts               # CodeExecutionTool — implements ITool
│   │
│   │  ─── FRONTEND LIBRARIES ───
│   │
│   ├── chat-client/                  # @verbal-assistant/chat-client
│   │   └── src/                      # Socket.IO client wrapper — React-independent
│   │       ├── client.ts             # ChatClient class — connect, auth, emit, subscribe
│   │       ├── reconnection.ts       # Reconnection strategy with backoff
│   │       └── types.ts              # Re-exports event types from @verbal-assistant/core
│   │
│   ├── chat-hooks/                   # @verbal-assistant/chat-hooks
│   │   └── src/                      # Headless React hooks — ZERO UI, any design system
│   │       ├── useChatConnection.ts  # Manages ChatClient lifecycle, auth token refresh
│   │       ├── useMessages.ts        # Message list, streaming, history loading, optimistic updates
│   │       ├── useComposer.ts        # Input state, send, typing indicator emission
│   │       ├── useThreads.ts         # Thread list, CRUD, active thread
│   │       ├── usePresence.ts        # Online users, typing indicators per thread
│   │       ├── useMemory.ts          # Long-term memory search/list/delete
│   │       └── context.ts            # ChatProvider context (wraps ChatClient for hook tree)
│   │
│   ├── chat-ui-mui/                  # @verbal-assistant/chat-ui-mui
│   │   └── src/                      # MUI-based components — uses @verbal-assistant/chat-hooks
│   │       ├── ChatEmbed.tsx         # <ChatEmbed config={...} /> — all-in-one embedding component
│   │       ├── MessageList.tsx       # Virtualized message list (MUI + react-window)
│   │       ├── MessageBubble.tsx     # Markdown + code blocks + tool results + author
│   │       ├── Composer.tsx          # MUI TextField + send button + typing
│   │       ├── ThreadList.tsx        # MUI List sidebar with context menus
│   │       ├── MemberList.tsx        # Room member list + presence dots
│   │       ├── InviteDialog.tsx      # Invite by email dialog
│   │       ├── TypingIndicator.tsx   # "[User] is typing..."
│   │       ├── StreamingText.tsx     # Progressive text rendering
│   │       └── tools/               # WebSearchResult, CodeExecutionOutput renderers
│   │
│   │  ─── STANDALONE APPLICATION ───
│   │
│   ├── backend/                      # @verbal-assistant/backend — Standalone NestJS app
│   │   └── src/
│   │       ├── main.ts               # Bootstrap: wires all library providers together
│   │       ├── app.module.ts         # Root module — imports & configures everything
│   │       ├── config/               # Environment config, provider factory (wires interfaces → impls)
│   │       ├── auth/                 # OIDC + JWT (standalone-specific auth strategy)
│   │       └── api/                  # REST controllers (threads, search, memory, health)
│   │
│   └── frontend/                     # @verbal-assistant/frontend — Standalone React + Vite app
│       └── src/
│           ├── main.tsx
│           ├── App.tsx               # Routing, auth wrapper
│           ├── theme/                # MUI theme (dark/light)
│           ├── pages/                # ChatPage, LoginPage, SettingsPage
│           ├── auth/                 # OIDC login flow, token management
│           └── layout/               # AppShell, Sidebar, Header (standalone chrome)
│
└── e2e/                              # Playwright tests
    ├── package.json
    ├── playwright.config.ts
    └── tests/
```

---

## Phase 1: Project Scaffolding & Infrastructure

### Step 1.1 — Initialize monorepo

- Create `pnpm-workspace.yaml` with `packages/*`
- Root `package.json` with workspace scripts
- Install Turborepo as devDep for build orchestration
- Configure shared `tsconfig.base.json` with strict TypeScript

### Step 1.2 — Tooling setup

- ESLint flat config (`eslint.config.mjs`) with `@typescript-eslint`, NestJS
  plugin, React plugin
- Prettier config (`.prettierrc`) shared across all packages
- Husky + lint-staged for pre-commit hooks
- `.editorconfig`

### Step 1.3 — Docker Compose (development)

Services:

- `postgres:16` — Port 5432, with init script for DB creation
- `qdrant/qdrant:latest` — Port 6333 (REST) / 6334 (gRPC)
- `ghcr.io/huggingface/text-embeddings-inference:latest` — Port 8080, model
  `BAAI/bge-large-en-v1.5`
- Volumes for persistent data

### Step 1.4 — Core package (`packages/core` → `@verbal-assistant/core`)

Key types to define:

- `ThreadMessage` — role (user/assistant/system), content parts (text,
  tool-call, tool-result), metadata, timestamps, authorId
- `Thread` — id, title, type ('personal' | 'room'), createdAt, updatedAt,
  archived, memoryEnabled
- `ThreadMember` — userId, threadId, role ('owner' | 'member'), joinedAt
- `User` — id, email, name, avatarUrl
- `SearchResult` — for semantic search responses
- **Plugin interfaces** (`interfaces/`):
  - `IChatAgent` — run(), stream(), shouldRespond(). Uses LangChain's
    `BaseMessage`, `AIMessageChunk`, `IterableReadableStream` where applicable
  - `IPersistenceProvider` — threads, messages, users, membership CRUD
  - `ISearchProvider` — semanticSearch(), index(), delete(). Uses LangChain's
    `Document` for results
  - `IEmbeddingsProvider` — embed(), embedBatch(). Aligns with LangChain's
    `Embeddings` interface
  - `ITool` — name, description, schema, execute(). Extends/aligns with
    LangChain's `StructuredTool` / `DynamicStructuredTool` pattern (Zod schema
    input, string|object output)
  - `IMemoryProvider` — save(), search(), list(), delete()
  - **Principle**: Prefer re-exporting or extending `@langchain/core` types
    (e.g., `BaseMessage`, `Document`, `ToolDefinition`) over inventing parallel
    type hierarchies. This minimizes adapter code in
    `@verbal-assistant/agent-langchain` and lets consumers who already use
    LangChain interop naturally.
- **WebSocket events** (`events/` — discriminated union by `event` field):
  - Client→Server: `send-message`, `join-thread`, `leave-thread`,
    `typing-start`, `typing-stop`, `invite-member`
  - Server→Client: `message-delta` (AI streaming token), `message-complete`,
    `new-message` (from other users), `typing` (user X is typing),
    `presence-update`, `member-joined`, `member-left`, `thread-updated`
- REST DTOs (`dto/`): `ChatRequest`, `ThreadCreateRequest`,
  `InviteMemberRequest`, etc.

---

## Phase 2: Backend Libraries & Standalone App

### Step 2.1 — Persistence library (`packages/persistence-pg` → `@verbal-assistant/persistence-pg`) (_depends on 1.4_)

- Implements `IPersistenceProvider` and `IMemoryProvider` (relational side) from
  `@verbal-assistant/core`
- TypeORM entities: `UserEntity`, `ThreadEntity`, `MessageEntity`,
  `ThreadMemberEntity`, `MemoryEntity`
- `PostgresPersistenceProvider`:
  - Thread CRUD (list user's threads, create personal/room, rename, archive,
    delete)
  - Membership: `addMember()`, `removeMember()`, `listMembers()`
  - Messages: append (with `authorId`), load history, paginated retrieval (JSONB
    content parts)
- `PostgresMemoryProvider`: save, list, delete memory entries (relational
  metadata)
- TypeORM migrations
- Framework-agnostic: exports plain classes, consumer provides DataSource config

### Step 2.2 — Embeddings library (`packages/embeddings-local` → `@verbal-assistant/embeddings-local`) (_depends on 1.4, parallel with 2.1_)

- Implements `IEmbeddingsProvider` from `@verbal-assistant/core`
- `TEIEmbeddingsProvider`: wraps HTTP calls to HuggingFace TEI container
  (`POST /embed`)
- Batch embedding support
- Configurable base URL (default `http://localhost:8080`)

### Step 2.3 — Search library (`packages/search-qdrant` → `@verbal-assistant/search-qdrant`) (_depends on 2.2_)

- Implements `ISearchProvider` from `@verbal-assistant/core`
- `QdrantSearchProvider` wrapping `@qdrant/js-client-rest`
- Collections: `chat_messages`, `long_term_memory`
- Index: accepts text → calls injected `IEmbeddingsProvider` → upserts vector +
  metadata
- Search: embed query → search collection → return ranked results with metadata
- `QdrantMemorySearch`: vector side of memory (semantic search over memory
  entries)
- Metadata per point: `userId`, `threadId`, `messageId`, `timestamp`, `role`,
  `authorId`

### Step 2.4 — Tool plugins (_depends on 1.4, parallel with 2.1-2.3_)

- `packages/tool-web-search` → `@verbal-assistant/tool-web-search`
  - Implements `ITool` — wraps Anthropic built-in `web_search` tool
- `packages/tool-code-execution` → `@verbal-assistant/tool-code-execution`
  - Implements `ITool` — wraps Anthropic built-in `code_execution` tool

### Step 2.5 — Agent library (`packages/agent-langchain` → `@verbal-assistant/agent-langchain`) (_depends on 2.3, 2.4_)

- Implements `IChatAgent` from `@verbal-assistant/core`
- `LangGraphAgent`:
  - Constructor accepts: model config, `ITool[]`, `ISearchProvider`,
    `IMemoryProvider`, `IPersistenceProvider`
  - `tool-adapter.ts` adapts `ITool` plugins to LangChain `tool()` format
  - Custom tools built from injected providers: `search_chat_history`,
    `search_memory`, `save_memory`
- LangGraph graph (`graph.ts`):
  - `ShouldRespond` node (`should-respond.ts`): personal → always yes; room →
    lightweight Claude call for gating
  - Agent node with tools loop (web_search, code_execution, search_chat_history,
    search_memory, save_memory)
  - Stream response output
- `ChatAnthropic` from `@langchain/anthropic` as the model
- `PostgresSaver` from `@langchain/langgraph-checkpoint-postgres` for agent
  state checkpointing
- System prompt variants (personal vs room, with member names context)

### Step 2.6 — Realtime library (`packages/realtime` → `@verbal-assistant/realtime`) (_depends on 2.1, 2.5_)

- `ChatRealtimeServer`: bootstraps Socket.IO server with injected providers
  (`IChatAgent`, `IPersistenceProvider`, `ISearchProvider`)
- Auth middleware: accepts a `validateToken(token: string) → User | null`
  function
- Event handlers (`handlers/`):
  - `join-thread` / `leave-thread` — validates membership via
    `IPersistenceProvider`, manages Socket.IO rooms
  - `send-message` — saves via `IPersistenceProvider`, broadcasts to room,
    invokes `IChatAgent.stream()`, emits `message-delta`/`message-complete` to
    all members, indexes via `ISearchProvider`
  - `typing-start` / `typing-stop` — broadcasts `typing` event
  - `invite-member` — adds member via `IPersistenceProvider`, broadcasts
    `member-joined`, notifies invited user
- `PresenceTracker` (`presence.ts`): in-memory `Map<userId, Set<socketId>>`,
  computes online members per thread, broadcasts `presence-update`

### Step 2.7 — Standalone backend (`packages/backend` → `@verbal-assistant/backend`) (_depends on 2.1-2.6_)

- NestJS application that **wires all library packages together**
- `main.ts`: bootstrap NestJS + attach Socket.IO via `ChatRealtimeServer`
- `app.module.ts`: imports all providers
- `config/`: environment config, provider factory that instantiates:
  - `PostgresPersistenceProvider` with DB config
  - `TEIEmbeddingsProvider` with TEI URL
  - `QdrantSearchProvider` with Qdrant URL
  - `LangGraphAgent` with model config + tools + providers
  - `ChatRealtimeServer` with all of the above
- `auth/`: standalone-specific OIDC + JWT
  - `OidcStrategy` — configurable with any OIDC provider (Google:
    `https://accounts.google.com/.well-known/openid-configuration`)
  - `JwtStrategy` — validates internal JWT tokens
  - `AuthGuard` — global guard with `@Public()` decorator
  - `AuthController` — `/auth/login`, `/auth/callback`, `/auth/refresh`,
    `/auth/logout`
  - JWT: `sub` (userId), `email`, short-lived access token + refresh token in
    httpOnly cookie
  - Token validator function passed to `ChatRealtimeServer` auth middleware
- `api/`: REST controllers
  - `ThreadController` — `GET/POST/PATCH/DELETE /threads`,
    `GET /threads/:id/messages`, `POST/DELETE /threads/:id/members`
  - `SearchController` — `POST /search/history`, `POST /search/memory`
  - `MemoryController` — `GET/DELETE /memories`
  - `HealthController` — health checks for all services

---

## Phase 3: Frontend Libraries & Standalone App

### Step 3.1 — Chat client library (`packages/chat-client` → `@verbal-assistant/chat-client`) (_depends on 1.4_)

- React-independent Socket.IO client wrapper
- `ChatClient` class:
  - `connect(url, getToken)` — connects Socket.IO, passes JWT in handshake
  - `disconnect()` — clean disconnect
  - `emit(event, payload)` — typed emit using event types from
    `@verbal-assistant/core`
  - `on(event, handler)` / `off()` — typed subscriptions
  - Auto-reconnect with exponential backoff + fresh token on reconnect
- Re-exports event types from `@verbal-assistant/core`

### Step 3.2 — Chat hooks library (`packages/chat-hooks` → `@verbal-assistant/chat-hooks`) (_depends on 3.1_)

- Headless React hooks — ZERO UI, works with any design system
- `ChatProvider` context: wraps `ChatClient` instance for the hook tree
- `useChatConnection(config)` — manages `ChatClient` lifecycle, auth token
  refresh
- `useMessages(threadId)` — message list, streaming state (`message-delta` →
  accumulate tokens), history loading (paginated), optimistic send
- `useComposer(threadId)` — input text state, `send()`, typing indicator
  emission (debounced `typing-start`/`typing-stop`)
- `useThreads()` — thread list, CRUD (create personal/room, rename, archive,
  delete), active thread management
- `usePresence(threadId)` — online users set, typing users list
- `useMemory()` — long-term memory search/list/delete via REST

### Step 3.3 — Chat UI MUI library (`packages/chat-ui-mui` → `@verbal-assistant/chat-ui-mui`) (_depends on 3.2_)

- MUI-based components using `@verbal-assistant/chat-hooks` internally
- `<ChatEmbed config={{url, getToken, threadId}} />` — all-in-one drop-in
  component for embedding
- `MessageList` — virtualized (MUI + `react-window`), author names + avatars in
  rooms
- `MessageBubble` — markdown (`react-markdown` + `remark-gfm`), code blocks
  (`react-syntax-highlighter`), tool call indicators, web search result cards,
  code execution output
- `Composer` — MUI `TextField` (multiline), Shift+Enter for newline, Enter to
  send, typing emission
- `ThreadList` — MUI `List` with context menus, "New Chat"/"New Room" buttons,
  unread indicators, room member count
- `MemberList` — room member list with online presence dots
- `InviteDialog` — search registered users by email
- `TypingIndicator` — "[User] is typing..."
- `StreamingText` — progressive text rendering
- `tools/` — `WebSearchResult`, `CodeExecutionOutput` renderers

### Step 3.4 — Standalone frontend (`packages/frontend` → `@verbal-assistant/frontend`) (_depends on 3.3_)

- Vite + React application — the standalone Verbal Assistant UI
- Uses `@verbal-assistant/chat-ui-mui` for all chat components
- Standalone-specific features:
  - `auth/` — OIDC login flow (redirect to `GET /auth/login` → Google →
    callback), JWT in memory, `useAuth` hook, protected routes
  - `layout/` — `AppShell` (MUI `Drawer` sidebar + main content), `Sidebar`,
    `Header`
  - `pages/` — `ChatPage` (ThreadList + ChatView), `LoginPage`, `SettingsPage`
  - `theme/` — MUI theme config (dark/light mode)
- Vite proxy for backend API in dev

---

## Phase 4: Quality Assurance

### Step 4.1 — Playwright setup (_parallel with Phase 3_)

- Install Playwright in `e2e/` package
- Configure for local dev (backend + frontend + Docker services)
- Test scenarios:
  - Authentication flow (OIDC login/logout)
  - Send message and receive streaming response (personal thread)
  - Create/switch/rename/delete threads
  - Create room, invite member, multi-user messaging
  - AI response gating in rooms (AI responds to questions, stays silent on
    chatter)
  - Typing indicators and presence in rooms
  - Long-term memory enable/disable and recall
  - Search chat history
  - Web search tool invocation and result display
  - Code execution tool and output rendering

### Step 4.2 — Backend unit/integration tests

- NestJS testing module for services
- Mock LangChain agent for deterministic tests
- Test auth guards (REST + WebSocket), thread CRUD, membership, message
  persistence
- Test WebSocket gateway: join/leave, message broadcast, presence
- Test ShouldRespond node logic (personal vs room behavior)
- Integration tests against real PostgreSQL + Qdrant (Docker)

---

## Phase 5: Deployment

### Step 5.1 — Docker Compose production

- Multi-stage Dockerfiles for frontend (Vite build → nginx) and backend (NestJS
  build → node)
- `docker-compose.prod.yml` with all services:
  - `frontend` (nginx), `backend` (node), `postgres`, `qdrant`, `tei-embeddings`
- Environment variable configuration
- Health checks

### Step 5.2 — Kubernetes manifests

- Deployments, Services, ConfigMaps, Secrets for each component
- Ingress for frontend + API
- PersistentVolumeClaims for PostgreSQL and Qdrant data
- HorizontalPodAutoscaler for backend

---

## Key Packages (npm dependencies per library)

### `@verbal-assistant/core`

- `zod` (validation schemas)
- `@langchain/core` (peer — re-exports `BaseMessage`, `Document`, `Embeddings`,
  `StructuredTool` types)

### `@verbal-assistant/persistence-pg`

- `typeorm`, `pg`
- `@verbal-assistant/core` (peer)

### `@verbal-assistant/embeddings-local`

- `@verbal-assistant/core` (peer)

### `@verbal-assistant/search-qdrant`

- `@qdrant/js-client-rest`
- `@verbal-assistant/core` (peer)

### `@verbal-assistant/agent-langchain`

- `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`
- `@langchain/langgraph-checkpoint-postgres`
- `zod`
- `@verbal-assistant/core` (peer)

### `@verbal-assistant/tool-web-search` / `@verbal-assistant/tool-code-execution`

- `@verbal-assistant/core` (peer)

### `@verbal-assistant/realtime`

- `socket.io`
- `@verbal-assistant/core` (peer)

### `@verbal-assistant/chat-client`

- `socket.io-client`
- `@verbal-assistant/core` (peer)

### `@verbal-assistant/chat-hooks`

- `react` (peer)
- `@verbal-assistant/chat-client`, `@verbal-assistant/core` (peers)

### `@verbal-assistant/chat-ui-mui`

- `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material`
  (peers)
- `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `react-window`
- `@verbal-assistant/chat-hooks` (peer)

### `@verbal-assistant/backend` (standalone)

- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/config`
- `@nestjs/passport`, `passport`, `passport-openidconnect`, `@nestjs/jwt`,
  `passport-jwt`
- All `@verbal-assistant/*` backend libraries

### `@verbal-assistant/frontend` (standalone)

- `react`, `react-dom`, `react-router-dom`
- `@mui/material`, `@emotion/react`, `@emotion/styled`, `@mui/icons-material`
- `@verbal-assistant/chat-ui-mui`

### Dev/Root

- `typescript`, `turborepo`
- `eslint`, `@typescript-eslint/*`, `eslint-plugin-react`
- `prettier`, `husky`, `lint-staged`

### E2E

- `@playwright/test`

---

## Relevant Files (to create)

Infrastructure:

- `pnpm-workspace.yaml` — monorepo workspace definition
- `turbo.json` — Turborepo pipeline (build, lint, test)
- `docker-compose.yml` — dev services (postgres, qdrant, tei)

Core (`packages/core`):

- `src/types/message.ts` — `ThreadMessage`, `ContentPart` (with `authorId`)
- `src/types/thread.ts` — `Thread` (with `type: 'personal' | 'room'`),
  `ThreadMember`
- `src/types/user.ts` — `User`
- `src/events/ws-events.ts` — WebSocket event discriminated unions
  (client↔server)
- `src/interfaces/agent.ts` — `IChatAgent`
- `src/interfaces/persistence.ts` — `IPersistenceProvider`
- `src/interfaces/search.ts` — `ISearchProvider`
- `src/interfaces/embeddings.ts` — `IEmbeddingsProvider`
- `src/interfaces/tool.ts` — `ITool`
- `src/interfaces/memory.ts` — `IMemoryProvider`
- `src/dto/` — request/response DTOs

Backend libraries:

- `packages/persistence-pg/src/provider.ts` — `PostgresPersistenceProvider`
- `packages/persistence-pg/src/entities/` — TypeORM entities
- `packages/persistence-pg/src/migrations/` — DB migrations
- `packages/embeddings-local/src/provider.ts` — `TEIEmbeddingsProvider`
- `packages/search-qdrant/src/provider.ts` — `QdrantSearchProvider`
- `packages/agent-langchain/src/agent.ts` — `LangGraphAgent`
- `packages/agent-langchain/src/graph.ts` — LangGraph definition
- `packages/agent-langchain/src/should-respond.ts` — room gating node
- `packages/agent-langchain/src/tool-adapter.ts` — `ITool` → LangChain adapter
- `packages/realtime/src/server.ts` — `ChatRealtimeServer`
- `packages/realtime/src/handlers/` — event handlers
- `packages/realtime/src/presence.ts` — `PresenceTracker`
- `packages/tool-web-search/src/tool.ts` — `WebSearchTool`
- `packages/tool-code-execution/src/tool.ts` — `CodeExecutionTool`

Standalone backend:

- `packages/backend/src/main.ts` — NestJS bootstrap + Socket.IO attach
- `packages/backend/src/app.module.ts` — root module wiring all providers
- `packages/backend/src/config/` — provider factory
- `packages/backend/src/auth/oidc.strategy.ts` — OIDC passport strategy
- `packages/backend/src/auth/jwt.strategy.ts` — JWT validation
- `packages/backend/src/auth/auth.guard.ts` — global guard with `@Public()`
- `packages/backend/src/api/thread.controller.ts` — thread REST endpoints
- `packages/backend/src/api/search.controller.ts` — search REST endpoints
- `packages/backend/src/api/memory.controller.ts` — memory REST endpoints

Frontend libraries:

- `packages/chat-client/src/client.ts` — `ChatClient`
- `packages/chat-hooks/src/context.ts` — `ChatProvider`
- `packages/chat-hooks/src/useMessages.ts` — message state + streaming
- `packages/chat-hooks/src/useComposer.ts` — input + send + typing
- `packages/chat-hooks/src/useThreads.ts` — thread list + CRUD
- `packages/chat-hooks/src/usePresence.ts` — online + typing
- `packages/chat-ui-mui/src/ChatEmbed.tsx` — drop-in embeddable component
- `packages/chat-ui-mui/src/MessageBubble.tsx` — message rendering
- `packages/chat-ui-mui/src/Composer.tsx` — MUI input
- `packages/chat-ui-mui/src/ThreadList.tsx` — sidebar
- `packages/chat-ui-mui/src/MemberList.tsx` — room members + presence

Standalone frontend:

- `packages/frontend/src/App.tsx` — routing + auth wrapper
- `packages/frontend/src/pages/ChatPage.tsx` — main chat page
- `packages/frontend/src/auth/` — OIDC flow
- `packages/frontend/src/layout/AppShell.tsx` — sidebar + main

---

## Verification

1. `pnpm -r build` succeeds from root (Turborepo builds: core → libraries →
   standalone apps)
2. `docker compose up` starts postgres, qdrant, tei; health checks pass
3. Google OIDC login → JWT issued → protected endpoints work → refresh works →
   logout clears
4. **Personal chat**: Send message → WebSocket streams tokens → full markdown
   response rendered → persisted in PostgreSQL + indexed in Qdrant
5. **Room creation**: Create room → invite user by email → invited user sees
   room in thread list
6. **Multi-user room**: User A sends message → User B sees it in real-time → AI
   evaluates and responds (or stays silent) → all members see AI response stream
   simultaneously
7. **Presence**: Join room → online indicator shows → leave → indicator updates.
   Typing → "[User] is typing..." appears for others
8. **AI gating**: In room, casual message → AI stays silent. Direct question →
   AI responds. (Verifiable by checking no `message-delta` emitted for casual
   messages)
9. "Search the web for X" → Claude `web_search` tool → results displayed as
   expandable card
10. "Calculate X with code" → Claude `code_execution` → output rendered in
    collapsible block
11. Enable memory → converse → new thread → "remember X?" → agent retrieves from
    Qdrant memory
12. `POST /search/history` returns ranked semantic results
13. **Embeddability**: `<ChatEmbed />` component from
    `@verbal-assistant/chat-ui-mui` renders and functions in an isolated test
    app (separate Vite project importing only the library packages)
14. Playwright suite passes all scenarios (including multi-user with two browser
    contexts)

---

## Decisions

- **Project name**: Verbal Assistant — "Verbal Assistant for teams of people"
- **npm scope**: `@verbal-assistant/*`
- **LangChain types as interface foundation** — `@verbal-assistant/core`
  interfaces use `@langchain/core` types (`BaseMessage`, `Document`,
  `Embeddings`, `StructuredTool`) rather than inventing parallel type
  hierarchies. Minimizes adapter code and enables natural interop for LangChain
  users.
- **Plugin architecture** — All backend services implement interfaces from
  `@verbal-assistant/core`; swappable implementations (e.g., replace Qdrant with
  Pinecone by implementing `ISearchProvider`)
- **Framework-agnostic backend libs** — Library packages export plain classes;
  only `@verbal-assistant/backend` depends on NestJS
- **Headless frontend hooks** — `@verbal-assistant/chat-hooks` has zero UI;
  `@verbal-assistant/chat-ui-mui` provides MUI components; consumers can use
  hooks with any design system
- **No assistant-ui** — Custom MUI chat UI for full consistency; avoids
  Tailwind/shadcn conflict
- **Monorepo** — pnpm workspaces + Turborepo; each package independently
  publishable to npm
- **Unified Thread model** — Threads have `type: 'personal' | 'room'`; rooms add
  membership + multi-user features
- **WebSocket everywhere** — Socket.IO for all real-time comms (AI streaming +
  multi-user sync + presence)
- **AI response gating** — LangGraph `ShouldRespond` node: always responds in
  personal threads, evaluates whether to respond in rooms via lightweight Claude
  call
- **PostgreSQL + Qdrant** — PG for relational data + JSONB messages; Qdrant
  exclusively for vector search
- **HuggingFace TEI for embeddings** — Self-hosted, open source, quality
  competitive with OpenAI. BGE-large-en-v1.5 recommended.
- **Anthropic built-in tools** — `web_search` and `code_execution` via Claude
  API, no external services
- **Generic OIDC** — `passport-openidconnect` works with any provider; Google
  configured initially
- **Invite by email** — Room members added by email (must be registered). No
  shareable links initially.
- **Presence in-memory** — Simple Map-based presence tracking. For
  multi-instance scaling: Redis pub/sub adapter for Socket.IO (future)
- **LangGraph over plain chains** — Supports checkpointing, tool loops,
  conditional nodes (ShouldRespond), future expansion
- **Excluded scope**: Voice/audio, file uploads, image generation, shareable
  invite links, admin panel, end-to-end encryption
