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

An exchange's `response` may also carry a `frames` array — `{ atMs, text }[]`,
timestamps relative to the request being sent — captured automatically by the
recording proxy since this field was added. It is optional and absent on every
fixture committed so far; the playback server below synthesizes pacing for those
instead of requiring a re-recording.

## Fake API playback server

`packages/agent-anthropic/src/testing/playback-server.ts` replays these fixtures
over real HTTP, so a real backend can be pointed at it via the Anthropic SDK's
own `ANTHROPIC_BASE_URL` for deterministic, free, fast E2E testing. It runs
automatically as part of `pnpm dev` (the `fake-api` turbo task,
`agent-anthropic`'s own `fake-api` script) on `http://localhost:4010`, whether
or not anything is currently pointed at it.

`FAKE_API_SPEED` divides the replayed delays (default `8`, so replay is eight
times faster than the recording); set it to `1` for a spec that needs realistic
pacing. The server reloads fixtures when the directory changes, and the script
runs under `node --watch`, so neither editing a fixture nor editing the server
needs a manual restart.

Selection is content-based, not positional: each scenario's trigger is simply
the human text its own first exchange was recorded with (see
`scenario-registry.ts`) — no separate registry to keep in sync with the
fixtures. A request matches whichever scenario's trigger text appears anywhere
in its `messages`; a multi-exchange scenario's own numbered fixtures then replay
in order, inferred from how many `assistant` turns the (always fully resent)
history already contains — no server-side session state. Requests that match
nothing, or continue past a scenario's own recorded exchanges (e.g. a retry
after `overloaded-mid-stream`), fall back to `plain-text`.

Non-streaming calls (`title`, `triage`) are routed structurally instead, since
they have no human turn to key off: a forced `record_decision` tool choice
selects `triage`, anything else non-streaming selects `title`.

**Fixtures are hot-reloaded.** The harness watches this directory and reloads
when a fixture is added or edited, so no restart is needed. This matters because
an unloaded fixture does not error — it simply never matches, and the request
quietly falls back to `plain-text`, which surfaces as a confusing assertion
failure rather than an obvious problem. Harness _code_ changes are covered too,
by `node --watch` in the `fake-api` script (fixtures are read rather than
imported, so the two mechanisms cover different things).

### Specs that cannot use fixtures

Most E2E specs assert on UI behaviour and run against the harness unchanged. A
few assert on what the _model_ produces — `thread-history`, for instance, checks
that the assistant recalls a word from an earlier turn. A canned reply
containing that word would make such a test pass without exercising conversation
history at all, so those specs call `requiresLiveApi()` from `tests/helpers.ts`
and are skipped unless `DF_E2E_LIVE_API=true`.

The distinction is whether a fixture preserves what the test verifies.
`thread-routing`'s "response still renders after initial send navigates to
thread URL" is about _rendering_, not about the model, so it gets the
`routing-render` fixture and keeps its full value.

### Timing model

Fixtures without recorded `frames` (all of them, currently) are paced by a
synthesized model in `testing/timing.ts`, grounded in a handful of observational
captures against the deployment's own model rather than guessed constants:

```bash
pnpm --filter @datonfly-assistant/agent-anthropic experiment:timing
# TIMING_DEBUG=1 prefix prints the raw per-chunk timestamps behind the stats
```

The captures found genuine, non-obvious pacing that the original placeholder got
wrong in two ways:

- **Time to first byte is ~800-1000ms**, not the tens of milliseconds a
  co-located mock server would suggest — `message_start` is the slowest single
  gap in an exchange.
- **Opus-class answer text streams in chunks roughly 600-800ms apart.** This
  looked at first like a measurement bug (huge gaps, tiny sample), but the raw
  per-chunk timestamps confirmed it is genuine: `claude-opus-5` really is this
  much slower per chunk than a smaller/faster model would be. This is also what
  makes the playback server's speed multiplier worth having at all — a
  placeholder fast enough to look realistic on its own would have made the
  multiplier redundant.
- **A thinking block's own reasoning happens silently before anything is
  visible.** The observed pattern was a long pause (~2s) before the first
  `thinking_delta`, then a fast burst (~10-20ms between deltas) once the summary
  actually streams. One "thinking is slower" constant (the original
  placeholder's assumption) gets both phases wrong; `syntheticDelayMs` models
  them separately.

Re-run the experiment and adjust `testing/timing.ts`'s constants if the
deployment's model changes, or if the numbers drift over time — this is an
order-of-magnitude model from a couple of runs, not a statistically rigorous
one.

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

### Live experiments

Alongside the recorder, `src/fixtures/` keeps a few scripts that answer
questions about the live API which no fixture can settle, and that are worth
re-running when the model or API version changes. They are kept as an executable
record of how each conclusion was reached — the findings they produced are cited
where the behaviour is documented.

```bash
pnpm --filter @datonfly-assistant/agent-anthropic experiment:compaction
pnpm --filter @datonfly-assistant/agent-anthropic experiment:continuation
pnpm --filter @datonfly-assistant/agent-anthropic experiment:timing
```

`compaction` runs the paused and transparent compaction modes back to back over
the same long conversation and reports the raw wire facts for each;
`continuation` establishes what the API accepts when resuming a cut-off answer
(see "Mid-stream overload" below); `timing` gathers the pacing statistics behind
the timing model above. **All of them make real, billable API calls** — the
compaction one deliberately builds a context large enough to cross the trigger,
so it is the most expensive here.

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

| Fixture                 | Exercises                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| `plain-text`            | Plain streamed text; no tools, no thinking.                                |
| `thinking-adaptive`     | Adaptive thinking whose summary came back **empty** — see below.           |
| `thinking-summarized`   | Thinking with reasoning text. **Synthetic** — see below.                   |
| `web-search`            | Server-side `web_search`, including citation blocks. Needs server tools.   |
| `web-fetch`             | Server-side `web_fetch` against a URL from the prompt. Needs server tools. |
| `code-execution`        | Server-side `code_execution`. Needs server tools.                          |
| `tool-loop`             | Multi-iteration local tool loop (two dependent calls).                     |
| `attachment-image`      | Image attachment → `image` block.                                          |
| `attachment-pdf`        | PDF attachment → `document` block.                                         |
| `attachment-text`       | Text attachment decoded and inlined as a text block.                       |
| `compaction`            | Provider-side compaction, in two exchanges — see below.                    |
| `abort-mid-stream`      | Caller aborts partway through the response.                                |
| `error-400`             | Invalid request rejected by the API.                                       |
| `error-429`             | Rate limit. **Synthetic** — see below.                                     |
| `error-529`             | Overloaded (top-level, at connection time). **Synthetic** — see below.     |
| `overloaded-mid-stream` | Overloaded _inside_ an open stream. **Synthetic** — see below.             |
| `routing-render`        | Serves `thread-routing`'s render-after-navigation case. **Synthetic**.     |
| `long-response`         | Long, complete stream for `multiuser-interrupt`. **Synthetic**.            |
| `triage`                | Non-streaming `shouldRespond()` classification through forced tool use.    |
| `title`                 | Non-streaming `generateTitle()` call.                                      |

### Verification

A 200 is not proof that a capture is useful: the model can answer without
calling the tool, and compaction can be configured without ever firing. Each
scenario therefore carries a `verify` predicate, and a capture that fails it is
reported and **not written** rather than becoming a misleading baseline.

### Compaction

`compaction-01` stops with `stop_reason: "compaction"` and returns the block;
`compaction-02` resumes with that block standing in for the compacted history.
These two were captured with `pause_after_compaction` set, which is what splits
a compaction into two exchanges and makes it recordable as two fixtures. **That
is a recording device, not the production setting** — see below. Capturing it
took five attempts and exposed three defects, all now fixed:

- The `compact_20260112` edit needs the **`compact-2026-01-12` beta header** in
  addition to `context-management-2025-06-27`. Without it the API rejects the
  edit type outright with a 400.
- **`pause_after_compaction` changes the shape of the exchange**, and an earlier
  version of this file wrongly claimed it was required for the block to come
  back at all. `experiment:compaction` disproved that: with it unset the API
  returns content blocks `["compaction", "thinking", "text"]` with
  `stop_reason: "end_turn"` — the summary _and_ the answer in one request, and
  `agent.stream()` emits the `opaque-part` either way. With it set, the first
  exchange returns only the compaction block and a second round trip fetches the
  answer. Production leaves it unset, because the extra round trip buys nothing
  unless specific messages must survive verbatim or a budget is tracked across
  several compactions.
- **`stop_reason: "compaction"` has to be handled.** That turn answers nothing;
  treating it as final yields an empty response.

Two traps worth remembering when re-recording:

- **`applied_edits` stays empty even on success**, so it is useless as a signal.
  It belongs to `clear_tool_uses` / `clear_thinking` rather than to compaction.
  The scenario checks `stop_reason` instead.
- **A compacting turn zeroes the top-level usage counts** and reports the real
  numbers under `usage.iterations[]`.
- **Prompt caching does not starve the trigger.** A turn whose input was almost
  entirely `cache_creation_input_tokens` (151,098 of 151,188) still compacted,
  so the threshold is compared against the whole submitted context rather than
  an uncached subset.

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

### Mid-stream overload

`overloaded-mid-stream` cannot be triggered on demand either, and unlike
`error-529` it cannot be a top-level HTTP status: the connection has to succeed
(200, `text/event-stream`) before the SSE body itself carries an `event: error`
frame with `overloaded_error`, which is what makes it invisible to the SDK's own
request-level retries. The fixture is hand-written: `message_start`, a complete
and **signed** `thinking` block, then a `text` block cut off partway through,
followed by the error frame instead of `content_block_stop`/`message_stop`.

Established empirically against the live API
(`src/fixtures/continuation-experiment.ts`,
`pnpm --filter @datonfly-assistant/agent-anthropic experiment:continuation`)
before this fixture and the retry it drives were written:

- **Assistant message prefill is rejected outright** —
  `"This model does not support assistant message prefill. The conversation must end with a user message."`
  — reproduced with thinking disabled, so it is a model-level rule, not an
  extended-thinking interaction. A retry therefore has to end with a synthetic
  `user` turn asking the model to continue, not just replay the partial
  assistant turn.
- **A `thinking` block is only replayable once signed.** The signature arrives
  in `signature_delta` at `content_block_stop`; a block still open at the cut
  has none, and replaying it gets `"Invalid signature in thinking block"`. Plain
  text has no such constraint and replays whether or not its block closed —
  confirmed by capturing a real cut mid-text-block and replaying exactly that
  partial text successfully.
- **The seam is only clean if the continuation instruction quotes the exact
  trailing text.** A generic "please continue" produced a garbled join; naming
  the last ~120 characters verbatim made the model resume **mid-word**.

Pair `overloaded-mid-stream` with a normal fixture (e.g. `plain-text`) as the
second exchange to play the retried request's response.
