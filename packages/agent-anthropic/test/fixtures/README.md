# Anthropic streaming fixtures

Raw Anthropic API exchanges captured from the **`agent-langchain`**
implementation. They are the regression baseline for the rewrite onto
`@anthropic-ai/sdk`: the new provider must turn the same bytes into the same
`AgentStreamChunk` sequence.

Capture had to happen while `agent-langchain` still runs — once that package is
deleted these recordings cannot be reproduced from the old code path.

## File format

One JSON file per exchange:

```jsonc
{
  "scenario": "plain-text",
  "request": {
    "method": "POST",
    "path": "/v1/messages?beta=true",
    "headers": {
      "content-type": "application/json",
      "anthropic-version": "...",
    },
    "body": {
      /* the request Anthropic received */
    },
  },
  "response": {
    "status": 200,
    "headers": { "content-type": "text/event-stream" },
    "body": "event: message_start\ndata: {...}\n\n…", // verbatim SSE
  },
}
```

A scenario that issues several API calls (the tool loop, compaction) produces
numbered files: `tool-loop-01.json`, `tool-loop-02.json`, …

## Recording

```bash
pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- --list
pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- plain-text
pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- --all
```

`ANTHROPIC_API_KEY` is read from the environment or the repository-root `.env`.

> **Every scenario is a real, billable API call.** Record selectively; `--all`
> runs the whole matrix, including the server-tool scenarios that are the most
> expensive.

The recorder (`packages/agent-langchain/src/fixtures/`) starts a pass-through
proxy on localhost and points the agent at it via
`AnthropicAgentConfig.baseUrl`, so the capture is the exact wire format rather
than whatever LangChain surfaces.

## Scrubbing

The proxy never writes credentials to disk:

- `x-api-key`, `authorization`, `proxy-authorization` and `cookie` request
  headers are dropped.
- Response headers are reduced to `content-type` and `retry-after`.
- Every recorded byte is passed through a scrubber that replaces `sk-ant-…` keys
  and `Bearer …` tokens with `<REDACTED>`.

**Re-read a new fixture before committing it.** The scrubber is a safety net,
not a guarantee — prompts and responses can still contain deployment-specific or
personal content that does not belong in the repository.

## Scenarios

| Fixture             | Exercises                                                      |
| ------------------- | -------------------------------------------------------------- |
| `plain-text`        | Plain streamed text; no tools, no thinking.                    |
| `thinking-adaptive` | Adaptive thinking with summarized reasoning blocks.            |
| `thinking-enabled`  | Manual thinking with an explicit `budget_tokens`.              |
| `web-search`        | Server-side `web_search`, including citation blocks.           |
| `web-fetch`         | Server-side `web_fetch` against a URL from the prompt.         |
| `code-execution`    | Server-side `code_execution`.                                  |
| `tool-loop`         | Multi-iteration local tool loop (two dependent calls).         |
| `attachment-image`  | Image attachment → `image` block.                              |
| `attachment-pdf`    | PDF attachment → `document` block.                             |
| `attachment-text`   | Text attachment decoded and inlined as a text block.           |
| `compaction`        | Provider-side compaction, trigger lowered so it fires cheaply. |
| `abort-mid-stream`  | Caller aborts partway through the response.                    |
| `error-400`         | Invalid request rejected by the API.                           |
| `error-429`         | Rate limit. **Synthetic** — see below.                         |
| `error-529`         | Overloaded. **Synthetic** — see below.                         |

### Synthetic fixtures

`error-429` and `error-529` cannot be triggered on demand, so they are written
by hand from Anthropic's documented error shapes and marked with
`"synthetic": true`. Treat them as a description of the contract rather than a
recording; correct them if a real capture ever contradicts them.
