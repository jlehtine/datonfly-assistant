# Verbal Assistant

AI chat platform for teams.

> **Current state:** Stateless single-chat — no persistence, no authentication,
> no tools. All conversation state lives in the browser; refreshing starts a new
> chat.

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

# Start the backend (needs an Anthropic API key)
pnpm --filter @verbal-assistant/backend start

# In another terminal, start the frontend dev server
pnpm --filter @verbal-assistant/frontend dev
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
npx playwright test
```
