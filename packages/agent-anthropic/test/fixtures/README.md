# Anthropic streaming fixtures

Raw Anthropic API exchanges. The committed recordings were captured from the
**`agent-langchain`** implementation, which makes them an independent regression
baseline for this provider: the same bytes must produce the same
`AgentStreamChunk` sequence.

That capture had to happen before `agent-langchain` was deleted. The recorder
now lives in this package, so anything recorded from here on is captured
_through_ the implementation it tests — it documents current behaviour rather
than validating it. That is fine for adding new scenarios, but a fixture
re-recorded this way is no longer evidence that behaviour was preserved.

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

`triage` and `title` record `shouldRespond()`/`generateTitle()` instead of the
streaming path: the request has no `stream` field and the response body is a
plain JSON message rather than an SSE event stream.

## Recording

```bash
pnpm --filter @datonfly-assistant/agent-anthropic record:fixtures -- --list
pnpm --filter @datonfly-assistant/agent-anthropic record:fixtures -- plain-text
pnpm --filter @datonfly-assistant/agent-anthropic record:fixtures -- --all
```

`ANTHROPIC_API_KEY` is read from the environment or the repository-root `.env`.

> **Every scenario is a real, billable API call.** Record selectively; `--all`
> runs the whole matrix, including the server-tool scenarios that are the most
> expensive.

The recorder (`packages/agent-anthropic/src/fixtures/`) starts a pass-through
proxy on localhost and points the agent at it via `AgentConfig.baseUrl`, so the
capture is the exact wire format rather than whatever the client library
surfaces.

### Choosing the model

The model comes from `--model <name>`, falling back to `DF_AGENT_MODEL` in the
environment or the root `.env`. There is deliberately no built-in default.

The SSE envelope — event names, delta types, `stop_reason`, `usage` — is set by
the API version rather than the model, so the tier is irrelevant for
`plain-text`, the `attachment-*` scenarios and `abort-mid-stream`. It matters
elsewhere:

- **Haiku supports neither code execution nor web search.** `web-search`,
  `web-fetch` and `code-execution` need a Sonnet- or Opus-class model; `--list`
  marks them. When the API rejects a request the recorder reports it and writes
  nothing, rather than enshrining an error response as the baseline.
- Thinking support and the available `thinkingEffort` levels vary by model
  generation, and the rewrite depends on `thinking` blocks carrying `signature`
  fields.
- `tool-loop` and `web-search` depend on the model _choosing_ to make a
  multi-step call or emit a citation. Check that those two recordings actually
  exercise what they claim.

Prefer the model the deployment actually runs: these fixtures are that
deployment's regression baseline, and each fixture's request body records which
model produced it.

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

| Fixture               | Exercises                                                                  |
| --------------------- | -------------------------------------------------------------------------- | --- | -------- | ----------------------------------------------------------------------- |
| `plain-text`          | Plain streamed text; no tools, no thinking.                                |
| `thinking-adaptive`   | Adaptive thinking whose summary came back **empty** — see below.           |
| `thinking-summarized` | Thinking with reasoning text. **Synthetic** — see below.                   |
| `web-search`          | Server-side `web_search`, including citation blocks. Needs server tools.   |
| `web-fetch`           | Server-side `web_fetch` against a URL from the prompt. Needs server tools. |
| `code-execution`      | Server-side `code_execution`. Needs server tools.                          |
| `tool-loop`           | Multi-iteration local tool loop (two dependent calls).                     |
| `attachment-image`    | Image attachment → `image` block.                                          |
| `attachment-pdf`      | PDF attachment → `document` block.                                         |
| `attachment-text`     | Text attachment decoded and inlined as a text block.                       |
| `compaction`          | Provider-side compaction, in two exchanges — see below.                    |
| `abort-mid-stream`    | Caller aborts partway through the response.                                |
| `error-400`           | Invalid request rejected by the API.                                       |
| `error-429`           | Rate limit. **Synthetic** — see below.                                     |
| `error-529`           | Overloaded. **Synthetic** — see below.                                     |     | `triage` | Non-streaming `shouldRespond()` classification through forced tool use. |
| `title`               | Non-streaming `generateTitle()` call.                                      |

### Verification

A 200 is not proof that a capture is useful: the model can answer without
calling the tool, and compaction can be configured without ever firing. Each
scenario therefore carries a `verify` predicate, and a capture that fails it is
reported and **not written** rather than becoming a misleading baseline.

### Compaction

`compaction-01` stops with `stop_reason: "compaction"` and returns the block;
`compaction-02` resumes with that block standing in for the compacted history.
Capturing it took five attempts and exposed three defects, all now fixed:

- The `compact_20260112` edit needs the **`compact-2026-01-12` beta header** in
  addition to `context-management-2025-06-27`. Without it the API rejects the
  edit type outright with a 400.
- **`pause_after_compaction` must be set** for the block to come back at all.
  Otherwise the API compacts internally and returns nothing, so there is nothing
  to persist and the next request resends the full history.
- **`stop_reason: "compaction"` has to be handled.** That turn answers nothing;
  treating it as final yields an empty response.

Two traps worth remembering when re-recording:

- **`applied_edits` stays empty even on success**, so it is useless as a signal.
  The scenario checks `stop_reason` instead.
- **A compacting turn zeroes the top-level usage counts** and reports the real
  numbers under `usage.iterations[]`.

The history must also be spread across several turns: compaction summarises
_earlier_ turns, so one oversized message crosses the trigger without producing
any edit.

### Thinking

Only adaptive thinking is captured, because it is the only mode that exists: the
Claude 5 generation rejects `thinking.type: "enabled"` outright, and the manual
budget option was dropped from the product rather than kept for older models.

`thinking-adaptive` carries a `thinking` block with a `signature_delta` — which
is what the signature-preserving replay in Phase 2.4 needs — but **its
`thinking_delta` payloads are empty**. With `display: "summarized"` and
`effort: "low"` the model returned a block holding only a signature. The capture
verified the block's presence, not its text, so the gap only surfaced when the
rewrite consumed the fixture.

It is kept as recorded, because the empty case is worth pinning: an empty
thinking block must not surface as an empty thinking part. `thinking-summarized`
covers the non-empty path — derived from this recording's envelope with
reasoning text injected into the deltas. Re-record `thinking-adaptive` at a
higher effort level to replace it with a genuine summarized capture.

### Synthetic fixtures

`error-429` and `error-529` cannot be triggered on demand, so they are written
by hand from Anthropic's documented error shapes and marked with
`"synthetic": true`. `thinking-summarized` is likewise derived rather than
recorded (see above). Treat them as a description of the contract rather than a
recording; correct them if a real capture ever contradicts them.
