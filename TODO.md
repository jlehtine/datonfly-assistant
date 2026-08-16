# TODO

## How to use this file

`TODO.md` is the working record of planned and in-progress work for this
repository. It captures concrete, sequenced steps and tracks their status; it is
not permanent documentation.

**Structure.** Group work under `##` sections (features or workstreams) and
optional `###` subsections. Express individual steps as GitHub-style task list
items so progress is visible at a glance:

- `- [ ]` — not started or in progress
- `- [x]` — completed

**Numeric identifiers.** When work is sequenced into phases, number them so they
sort and read in execution order. Top-level phases are `## Phase N — <title>`
with an increasing integer `N` (`Phase 0`, `Phase 1`, …); subsections use a
dotted `### N.M <title>` form where `M` increases within the phase (`0.1`,
`0.2`, `1.1`, …). Always assign the next unused number to later work — never
renumber existing phases/steps to insert in the middle. If something must slot
between existing items, append it with the next free number (or a deeper `N.M.K`
level) rather than shifting the others.

Keep steps concrete and actionable, ordered by dependency where it matters. Put
brief context, decisions, or rationale inline under a section when it helps a
future reader pick the work up.

**Tracking progress.** As work lands, flip its checkbox to `- [x]` in the same
change. Add newly discovered steps as you go rather than leaving them implicit,
and split a step that grew too large into smaller checkable items.

**Cleanup.** Do not delete completed steps as part of normal work — leave them
as `- [x]` so the file shows what has been done. Remove (clean up) completed
entries only when the user explicitly asks, and only after any durable facts in
those entries have been migrated into the permanent docs
([README.md](README.md), [CONVENTIONS.md](CONVENTIONS.md), and related files).
Cleanup is a documentation step, not a plain deletion: nothing of lasting value
should be lost when entries are removed.

## Agent provider — Anthropic enhancements

The rewrite from LangChain onto `@anthropic-ai/sdk` is complete and
`agent-langchain` is gone. Durable outcomes of that work now live in the
permanent docs rather than here: the provider rules in
[CONVENTIONS.md](CONVENTIONS.md) ("AI Agent Providers", "Agent Tools"), the
package description in [README.md](README.md), the reasoning and caching
behaviour in `.env.example`, and the capture traps in
`packages/agent-anthropic/test/fixtures/README.md`.

These are the follow-ups, in dependency order.

### 1. Verify provider-side compaction end to end

**Verified live — compaction works, and `pauseAfterCompaction` should stay
off.** No fixture had ever exercised the transparent (`pauseAfterCompaction`
unset) path: every earlier capture set it to `true` from the start, so it was
never established whether the default path fires against a real conversation at
all. `packages/agent-anthropic/src/fixtures/compaction-experiment.ts`
(`pnpm --filter @datonfly-assistant/agent-anthropic experiment:compaction`) runs
both configurations back to back against the same 6-batch, ~72k-token
conversation and reports the raw wire facts. Real, billable API calls — record
selectively.

Anthropic's docs describe two modes for `compact_20260112`, and the experiment
confirmed both against `claude-opus-5`:

- **Default (`pauseAfterCompaction` unset):** compaction happens inside the
  _same_ request. One HTTP exchange came back with content block types
  `["compaction", "thinking", "text"]`, `stop_reason: end_turn`, and
  `usage.iterations` of `["compaction", "message"]` — the summary and the actual
  answer, together, in a single round trip. `agent.stream()` correctly emitted
  an `opaque-part` chunk carrying the compaction block.
- **`pauseAfterCompaction: true`:** two HTTP exchanges. The first returns only
  the compaction block with `stop_reason: compaction` and
  `usage: {input: 0, output: 0}` (the real cost is under `usage.iterations`);
  the second is a full extra round trip to get the answer.

Neither mode needed the disabled path this project never used (`applied_edits`,
which belongs to `clear_tool_uses` / `clear_thinking`, not to compaction — the
true signal is `stop_reason: "compaction"` plus the returned block, as already
reflected in `record-fixtures.ts`'s `verify` predicate).

**Conclusion: keep `pauseAfterCompaction` off (the default).** It buys nothing
here — nothing needs to preserve specific messages verbatim across a compaction,
or track a token budget across many compactions, which are the two documented
reasons to pause — and it costs a guaranteed extra round trip for identical
output.

- [x] Decide whether production sets `pauseAfterCompaction`. **Off** — see
      above; correcting an earlier, wrong assumption here that it was required
      for the `OpaqueContentPart` round-trip to engage at all. It isn't: the
      block is returned either way, just interleaved with the rest of the
      response instead of delivered alone.
- [x] Verify that the SDK/API layer returns a persistable block and that
      `agent.stream()` maps it to an `opaque-part` chunk on a live conversation
      that crosses the trigger. Done via the experiment above.
- [x] Verify the full app-level round trip: a message persisted through
      `chat-server`, then a _subsequent_ top-level request where
      `trimBeforeCompaction()` shortens what goes out.

      **Verified live, through the real running app** (not a synthetic script):
      seeded a thread directly in the dev database with 12 alternating
      human/ai turns (~144k tokens, confirmed via `countTokens` before spending
      anything), opened it in the browser, and sent a real message. Compared to
      the previous unit-level experiment, this exercises the parts that
      matter for "full app round trip" specifically: persistence load/save,
      `chat.gateway.ts` streaming, and a genuine second top-level turn.

      | Turn                        | `inputTokens` | `cacheCreation` | `cacheRead` |
      | ---------------------------- | ------------: | ---------------: | -----------: |
      | 1 (crosses the trigger)      |        151,188 |           151,098 |             — |
      | 2 ("What is 2 + 2?")         |          6,834 |               356 |         6,434 |

      Turn 1's persisted message carries the `opaque` compaction part (696
      chars) followed by the `text` answer, confirming the transparent path
      persists correctly end to end. Turn 2 — a genuinely new top-level
      request — dropped from ~151k tokens to ~6.8k: `trimBeforeCompaction()` is
      finding the compaction message in the persisted history and cutting
      everything before it, exactly as designed. The compaction summary itself
      also correctly referred to the user by their configured alias
      ("MenuAlias"), not their real name — consistent with the privacy-by-default
      behaviour documented elsewhere.

- [x] Verify prompt-cache effectiveness against the live API via
      `cache_read_input_tokens`. Confirmed by the same experiment: turn 2 read
      6,434 of its 6,834 input tokens from cache (94%), and only wrote 356 new
      tokens — caching and compaction coexist correctly under this provider's
      deliberate-breakpoint design. Turn 1 also shows compaction firing
      correctly _despite_ being almost entirely `cacheCreationInputTokens`
      (151,098 of 151,188), which is worth recording: the trigger check
      evidently compares total context size, not a "cache miss only" figure —
      this experiment did not reproduce the earlier finding (recorded against
      the old LangChain blanket `cache_control`) that caching could starve the
      trigger. That earlier case may simply have been under threshold rather
      than an actual interaction bug; not worth chasing further given this
      provider's design already avoids it.

**Section 1 is now fully verified. Step 2 (removing the in-app fallback) is
unblocked.**

### 2. Remove the in-app compaction path

`CompactionService` (303 LOC) is instantiated on every gateway init and can
never fire: it runs only when `capabilities.compaction === "external"`, which no
provider reports. Duplicating a capability the provider already offers is not
worth carrying, and a future provider without compaction would be better served
by a provider-common implementation than by the current gateway-welded one.

No data risk: checked `metadata->>'compacted'` and
`metadata->>'compactionSummary'` on `dfa.message` across every existing
environment (dev and all other test deployments) — zero rows in either,
everywhere. Confirms this is safe independent of the `agent-anthropic` cutover
already having made the exclusion filters inert (`capabilities.compaction`
reports `"provider"`, so `excludeCompacted` has been `false` regardless since
that rewrite). Git history preserves the implementation.

- [x] Delete `packages/chat-server/src/compaction.ts` and its wiring in
      `chat.gateway.ts`.
- [x] Narrow `AgentCapabilities.compaction` to `"provider" | "none"`.
- [x] Remove `excludeCompacted` / `excludeCompactionSummaries` from
      `IPersistenceProvider` and `persistence-pg`, and the `compacted` /
      `compactionSummary` metadata conventions from `chat-server`
      (`messages.ts`, `thread.controller.ts`, `audit-logger.ts`).
- [x] Leave the `metadata` column itself alone — it carries usage metrics and
      citations too.

**Done.** `updateMessageMetadata()` / `deleteMessage()` on
`IPersistenceProvider` were `CompactionService`'s only callers and are now
unused, but they weren't named in scope above and read as reasonable generic
persistence primitives rather than compaction-specific — left in place rather
than expanding this change to remove them too. Build, lint, all 111 unit tests,
and the `chat-response` / `thread-history` e2e specs pass after the removal.

### 3. Refactor title generation into the provider API

`GenerateTitleFn = (messages) => Promise<string>` is a bare function type wired
through its own path in `main.ts`, constructing a **second** Anthropic client
that knows nothing of the agent's betas, caching, or configuration. Folding it
into `IAgentProvider` lets each provider pick its own best strategy and deletes
a parallel wiring path.

- [x] Move title generation onto `IAgentProvider`, replacing the injected
      `GENERATE_TITLE_FN` provider and the separate client construction.
- [x] Keep `DF_AGENT_TITLE_MODEL` meaningful: a provider may still choose a
      cheaper model, but the choice becomes its own rather than the composition
      root's.
- [x] Cover title generation and triage with fixture-backed tests. Neither has a
      recorded fixture yet; both are non-streaming calls, so they need their own
      captures.

**Done.** `generateTitle()` and `shouldRespond()` are now the two non-streaming
methods on `IAgentProvider`/`AnthropicAgent`, both using the agent's single
`this.client` (no second Anthropic client). Title generation is unconditional
now (`ThreadTitleGenerator` is always constructed in `chat.gateway.ts`, calling
`agent.generateTitle()` directly): omitting `DF_AGENT_TITLE_MODEL` falls back to
titling with the main model rather than skipping titling entirely, a deliberate
behaviour change confirmed with the user before implementing. Recording the new
`triage`/`title` fixtures surfaced a live, pre-existing bug: both non-streaming
calls hardcoded `temperature: 0`, which `claude-opus-5` rejects outright (newer
models drop the `temperature` param); fixed by only sending it when configured,
matching the streaming path. Build, lint, all 114 unit tests (including new
fixture-backed `shouldRespond`/`generateTitle` specs), and two e2e specs pass.

**Not worth doing as part of this:** generating titles with the main model to
reuse its prompt cache. It cannot work as currently structured — the title
request sends no system prompt, no tools, and only the last 20 messages, so the
prefix diverges at the first block and nothing is cached. Even restructured, a
cache read at ~0.1x base input only beats a dedicated cheap model when the price
ratio between them is under 10x, which is false for an Opus-class main model.
Revisit only if the main model becomes Sonnet-class, and only after this
refactor makes it expressible.

### 4. Handle mid-stream `overloaded_error`

A 529 delivered _inside_ an already open SSE stream, which SDK-level retries do
not cover: those only apply to the initial HTTP response, and by the time the
stream is flowing the status is long since 200. The SDK surfaces it from
`core/streaming.mjs` as a bare `new APIError(undefined, body, …)` — **not**
`InternalServerError` or `RateLimitError`, which only come from
`APIError.generate()` on a real HTTP status. So `error.status` is `undefined`
and `instanceof` is useless; detection has to read
`error.error.error.type === "overloaded_error"`, which the existing
`readErrorType()` helper in `errors.ts` already does.

Today this surfaces as a generic failure and **the partial answer is discarded**
— `runStream()`'s catch block persists nothing — after the user has already
watched it stream in.

#### Verified API constraints

Established empirically against `claude-opus-5` with
`packages/agent-anthropic/src/fixtures/continuation-experiment.ts`
(`pnpm --filter @datonfly-assistant/agent-anthropic experiment:continuation`),
kept as a live record alongside `compaction-experiment.ts`:

| Strategy                                              | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| Prefill (assistant turn last, model continues it)     | ❌ 400 `does not support assistant message prefill` |
| Partial assistant turn + ephemeral user instruction   | ✅ accepted                                         |
| …replaying a **signed** `thinking` block alongside it | ✅ accepted                                         |
| …replaying an **unsigned** `thinking` block           | ❌ 400 `Invalid signature in thinking block`        |

Three consequences fix the design:

- **Prefill is off the table.** The rejection reproduces with thinking
  _disabled_, so it is a model-level rule ("the conversation must end with a
  user message"), not an extended-thinking interaction. A synthetic user turn is
  therefore mandatory, not a stylistic choice.
- **Thinking blocks are replayable only once signed.** The `signature` arrives
  in `signature_delta` at `content_block_stop`, so a block still open at the cut
  has none and must be dropped. (An earlier version of the experiment read the
  signature from `content_block_start`, where it is absent, and wrongly
  concluded that signed replay fails — worth remembering when re-running it.)
- **The seam can be made character-perfect.** A generic "please continue"
  produced garbage at the join (`"it pulls o"` ➕
  `"...ic systems), which moves"`). Quoting the exact trailing text in the
  instruction fixed it completely — the model resumed **mid-word**:
  `"…pulls or rele"` ➕ `"ases tension, and a spring…"`. Trimming back to a
  sentence boundary also joins cleanly but requires retracting text the user
  already saw, so it is strictly worse and is not used.

Because the answer can be continued and appended verbatim, no protocol or
persistence change is needed: no partial-output replacement, no permanent error
marker, no new `ContentPart` type. The retry is invisible in the transcript.

#### Plan

- [x] Add `isOverloadedError(error)` to `agent-anthropic/src/errors.ts`, reading
      the Anthropic error `type` rather than matching an SDK error class.
- [x] Track salvageable partial content per attempt in `stream.ts`: all text
      (completed or still open at the cut — proven safe to replay either way),
      plus thinking blocks that reached `content_block_stop` with a non-empty
      signature. An open/unsigned thinking block is dropped; other block types
      (`tool_use`, `server_tool_use`, …) are not salvaged at all.
- [x] On a mid-stream overload, retry the turn with
      `[…conversation, assistant(salvaged), user(continuation instruction)]`.
      The instruction quotes the last ~120 characters verbatim and forbids
      repetition or preamble. It is ephemeral: never yielded as a chunk, never
      persisted, never shown.
- [x] When nothing salvageable was produced, retry the turn as-is instead — the
      simple restart case, with no synthetic turn.
- [x] Bound the retries (2, short exponential backoff: 500ms then 1000ms) and
      honour the abort signal while waiting, so a user interrupt is not delayed
      by a sleep.
- [x] Keep usage accounting correct across the retry: the abandoned attempt's
      output tokens were still billed, so they add to the total, while
      `inputTokens` stays a max rather than a sum.
- [x] Add a `"retrying_overloaded"` value to `StatusCode` in
      `core/src/types/status-code.ts` and emit it as a `StatusChunk` before each
      retry. This reuses the existing `MessageStatusEvent` path end to end — no
      new event type, no `chat-server` change, no frontend change. The client
      clears it on the next delta, which is exactly the desired behaviour.
- [x] Add an `i18n` label for the new status code wherever the existing `tool_*`
      status codes are translated.
- [x] Synthetic fixture `overloaded-mid-stream` (hand-written like `error-429` /
      `error-529`, marked `"synthetic": true`): `message_start` plus some text
      deltas, then an `event: error` SSE frame carrying `overloaded_error`. Pair
      it with a normal fixture as the retry response, and assert the
      continuation request's shape — salvaged assistant turn, quoted-tail
      instruction, no unsigned thinking block — plus that the chunk stream
      carries the status and the concatenated text.
- [x] Document the scenario and the prefill/signature constraints in
      `test/fixtures/README.md`.

**Done.** All retry logic lives in `agent-anthropic/src/stream.ts`, transparent
to `IAgentProvider`/`chat-server` — no interface, persistence, or protocol
changes. Two fixture-backed tests cover it: a successful retry (asserts the
salvaged assistant turn's exact shape, the quoted-tail instruction, and that the
final text is the salvaged partial text with the retry's answer appended with
nothing in between) and exhausted retries (asserts exactly 3 requests — 1
initial + 2 retries — then the call rejects). Build, lint, and all 116 unit
tests across every package pass. **Deliberately out of scope:** persisting
partial output when retries are _exhausted_. That is a real gap (the answer is
dropped today) but it needs the permanent-error-marker discussion — `metadata`
flag versus a new notice `ContentPart` — and is independent of making the retry
work. Revisit separately.

### 5. E2E coverage via a replaying fake Anthropic API

Reasoning, provider-side compaction, and server-side tools are exercised only by
fixture replay in unit tests; nothing covers them end to end.

**Correcting the earlier note here:** it claimed the obstacle was that the suite
shares one assistant configuration, so a spec could not ask for reasoning
without imposing it on every other spec. That is wrong. Every relevant
capability is already **on by default** in the dev configuration —
`enableCompaction` / `enableCodeExecution` / `enableWebSearch` /
`enableWebFetch` are all `reader.prefixed(…) !== "false"`, and thinking defaults
to `adaptive` + `summarized` display. All the lines in `.env.example` are
commented out precisely because the defaults already enable them. No per-test
override, second backend, or separate Playwright project is needed for
configuration reasons.

The real obstacles are different:

- **Nondeterminism.** Adaptive thinking means the model decides whether to
  reason at all — `.env.example` itself warns that short questions produce no
  summary even when one is requested. Web search only fires if the model chooses
  to search. Asserting on this against the live API is inherently flaky.
- **No UI hooks.** Every existing spec keys off `datonfly-*` class names, and
  there is **none** on thinking blocks or citations. `MessageBubble.tsx` renders
  thinking runs with a collapse toggle but no `className`, so a reasoning spec
  currently has nothing stable to select.
- **Compaction cost.** The default trigger is 60% of a 200k window, so a live
  test needs a ~120k-token seeded thread (the technique is proven — see section
  1 — but it is slow and genuinely expensive per run). Note also that
  `compactionTriggerTokens` is **not** exposed as an environment variable;
  `config.ts` wires only `enableCompaction`.

#### Design: one suite, two endpoints

Run the same specs either against pre-recorded/synthesised fixtures (default,
deterministic, free) or against the real API (on demand, to catch upstream
drift). Only the endpoint changes — the specs do not fork, because a prompt like
"Search the web for the current Node.js LTS version" both matches its fixture by
substring _and_ genuinely triggers a search live.

Switching endpoints needs **no code changes at all**: the SDK constructor
already defaults `baseURL` to `readEnv("ANTHROPIC_BASE_URL")`, so pointing the
backend at the fake API is purely an environment matter. Fixture mode still
needs a non-empty `ANTHROPIC_API_KEY` because the SDK defaults it to
`readEnv("ANTHROPIC_API_KEY") ?? null`; use a dummy, matching the
`"sk-ant-test"` convention already used by the unit tests.

**Considered and rejected:** a dedicated `DF_AGENT_ALTERNATIVE_API_URL` paired
with its own key, so that redirecting traffic could never reuse the real
credential. It does close a narrow gap — setting `ANTHROPIC_BASE_URL` alone
redirects traffic with the production key attached — but writing environment
variables on the backend process and reading them are effectively the same
privilege, so an attacker in that position would simply read the key directly.
Not worth the config plumbing; the SDK's own variable is simpler and sufficient.

**Timing does not require re-recording anything.** Record a handful of
observational captures to characterise typical pacing (time to first token,
inter-delta gaps, thinking-block cadence), then **synthesise** timings for every
other fixture from that model with a little randomisation. The committed
fixtures stay byte-identical, and new recordings do not have to carry timing
either. Realistic pacing is worth having beyond fidelity: it makes the
already-timing-sensitive specs deterministic instead of racing real API latency
— `auto-scroll.spec.ts`, `input-focus.spec.ts`, and especially
`multiuser-interrupt.spec.ts`.

**What this does not buy:** conformance to Anthropic's actual behaviour. Replay
tests our code against a frozen snapshot, exactly as `test/fixtures/README.md`
already warns. It is a regression harness; the live mode and the `experiment:*`
scripts remain what catches API changes.

#### Plan

- [x] Add a `className` to thinking runs in `chat-ui-mui` so specs have a stable
      selector, following the existing `datonfly-*` convention
      (`datonfly-message-thinking`, plus a `data-collapsed` attribute for
      asserting expand/collapse state). **Citations were dropped from this
      bullet**: turns out `metadata.citations` is persisted and sent to the
      client but nothing in the frontend renders it at all — not a missing
      className on existing UI, but a whole UI feature that does not exist yet.
      Decided not to build it as part of this: the server-tools spec asserts on
      `metadata.citations` via a REST fetch instead of a UI element. Revisit as
      its own item if citation display is wanted.
- [x] Capture inter-chunk timing in `recording-proxy.ts` (previously every chunk
      was concatenated into one string via `captured.join("")`, discarding
      timing). Stored as an **optional** `frames: [{ atMs, text }]` alongside
      the existing `body`; committed fixtures remain valid untouched (none of
      them carry it yet).
- [x] Record a few observational captures and distil a timing model (time to
      first token, inter-delta distribution, thinking cadence) into a small
      synthesiser used for fixtures without recorded `frames`.
      `agent-anthropic/src/fixtures/timing-experiment.ts`
      (`pnpm --filter @datonfly-assistant/agent-anthropic experiment:timing`)
      captures a couple of live calls and reports the pacing found. Grounded
      `testing/timing.ts`'s constants in what it found — genuinely different
      from the original placeholder, not just retuned: time-to-first-byte is
      ~800-1000ms (not tens of ms); Opus-class answer text streams in chunks
      ~600-800ms apart (confirmed against raw per-chunk timestamps, not a
      measurement bug — this is what makes the speed multiplier worth having at
      all); a thinking block has a long silent pause before its first delta,
      then a fast burst once the summary streams, which needs two constants, not
      the placeholder's single "thinking is slower" one. Also fixed a real bug
      found in the process: `recording-proxy.ts` started its `atMs` clock
      _after_ `await fetch(...)` resolved, so a recorded fixture's first frame
      would never carry real time-to-first-byte, only gaps after the response
      had already started.
- [x] Selection is content-based: a well-known string in the request selects a
      **scenario** (`testing/scenario-registry.ts`), whose numbered exchanges
      then replay in order — inferred from how many `assistant` turns the
      request already contains, so no server-side session state is needed even
      under concurrent Playwright workers. Falls back to `plain-text` on no
      match or once a scenario's own exchanges are exhausted, rather than
      erroring. This is a **new, separate server**
      (`testing/playback-server.ts`) built alongside the existing
      `startFixtureServer`, which keeps its positional replay unchanged for the
      unit tests that already depend on it.
- [x] Build a standalone fake-API server on top of the above, with a replay-rate
      multiplier (default 8x via `FAKE_API_SPEED`, `1` available for specs that
      need real pacing), runnable as a process the e2e environment points
      `ANTHROPIC_BASE_URL` at. **Address: `http://localhost:4010`** — free of
      the ports this project already uses (3000 backend, 5173 frontend, 5432
      Postgres, 6333/6334 Qdrant, 8080 infinity) and the usual mock-server
      convention. Documented in `.env.example` alongside the `sk-ant-test` dummy
      key the SDK still requires. Runs automatically as part of `pnpm dev` via a
      new `fake-api` turbo task (`agent-anthropic`'s own `fake-api` script) —
      verified live: the server starts, logs its URL, and answers a real request
      while `pnpm dev` is running.
- [ ] Add specs for reasoning, server-side tools, and compaction. Compaction
      becomes trivial here — the fake API decides when to emit a compaction
      block, so no 120k-token seeded thread and no cost.
- [x] Point the timing-sensitive existing specs (`auto-scroll`, `input-focus`,
      `multiuser-interrupt`) at the fake API so they stop depending on live
      latency. No spec changes were needed — it follows from the endpoint switch
      — but `multiuser-interrupt` did need a fixture: it has to observe a
      response _while it streams_, and every existing fixture finishes faster
      than the UI can be asserted against at replay speed. Added `long-response`
      (57 deltas, ~5s of streaming, terminates normally unlike
      `abort-mid-stream`).
- [x] Document both modes, and how to add a scenario, in
      `test/fixtures/README.md`.

**Harness infrastructure done** (timing capture and its grounded model,
content-based scenario matching, the standalone server, `pnpm dev` wiring,
self-reloading, thinking's `className`, README): 16 unit tests in
`agent-anthropic` (`scenario-registry.test.ts`, `timing.test.ts`,
`playback-server.test.ts` — the last drives a real `AnthropicAgent` through the
fake API end to end), plus manual verification of multi-exchange indexing
(`tool-loop`), non-streaming structural routing (`triage`/`title`), and the
exhaustion fallback (`overloaded-mid-stream` → `plain-text`). Build, lint, and
all 76 `agent-anthropic` tests pass. `.env`/`.env.example` point at the fixture
harness by default. **Still pending:** the three new specs (reasoning,
server-side tools, compaction).

Note the qualification to "one suite, two endpoints": a spec that asserts on
_model-generated content_ rather than UI behaviour cannot be served by a canned
fixture, because a fixture crafted to satisfy the assertion makes the test pass
without testing anything. `thread-history` (does the assistant recall an earlier
turn?) is the one such case; it calls `requiresLiveApi()` from
`tests/helpers.ts` and is skipped unless `DF_E2E_LIVE_API=true`.
`thread-routing`'s render-after-navigation case looked similar but is really
about rendering, so a fixture (`routing-render`) preserves its value in full.

#### Two findings from running the suite against the harness

Pointing the E2E suite at the harness immediately made `chat-response.spec.ts`
fail intermittently (~1 in 3 runs). Diagnosing it turned up a **real client-side
bug**, not a test problem — worth recording because the harness found it, which
is exactly what it is for.

**1. Live streamed messages were discarded by the history fetch (fixed).**
`useMessages`' "reset and load history when threadId changes" effect cleared
`messages` and then **overwrote** them with the REST snapshot when it resolved.
Anything that streamed in over the websocket while that request was in flight
was silently thrown away. Evidence: instrumented runs showed the assistant
bubble appear and then vanish, and in some runs the user's own message vanished
too; the database confirmed the server had generated and persisted the reply
(~280ms after the user message), and captured websocket frames confirmed the
`part-delta`/`message-complete` events reached the browser. So the data was all
there and the UI dropped it.

This was invisible against the real API only because of timing: the first token
takes 1-3s while the REST round trip takes ~20ms, so the overwrite always landed
harmlessly before any delta. It is not a test-only artefact — a fast model, a
short or cached reply, or a slow REST round trip would reproduce it in
production, with the user watching their message and its reply disappear.

Fixed in two places, because there are two routes into the same clobber:

- Skip the reset and the history fetch entirely on the lazy-create transition
  (`threadId` null → newly created id for a send already in flight). A brand-new
  thread has no history worth loading, and local state is the only copy of the
  optimistic message and the incoming stream.
- Merge rather than overwrite when history does load: keep any locally-known
  message the fetched snapshot does not contain, since it arrived while the
  request was in flight. This also covers the remount path, which does not go
  through the transition above.

**2. The suite outruns the rate limiter (not a bug).** After the fix, the
residual failures were all-or-nothing — both tests failing together, backend
healthy and never restarted. Every E2E test authenticates as the same fake user,
so they share one rate-limit bucket, and replay is ~6x faster than the real API:
a run is 3 agent sends in ~5.5s, so back-to-back runs sustain ~24 sends/minute
against a `message` tier of 20/minute. Spacing runs 20s apart passes 6/6;
running them back-to-back fails ~1 in 9. `.env.example` (and `.env`) now set
`DF_RATE_LIMIT_FACTOR=10`, which is ~5x headroom over the suite's ~40 total
sends; 12 consecutive back-to-back runs then pass. Raised rather than disabled,
so the limiter still gets exercised. Code defaults are unchanged.

**3. Two bugs in the harness's own scenario selection (fixed).** Both were found
by running real specs against it, and both failed _silently_ — an unmatched
request falls back to `plain-text` rather than erroring, which surfaces as a
puzzling assertion failure in whichever spec needed the fixture:

- Grouping stripped a trailing `-\d+`, so `error-400` / `error-429` /
  `error-529` collapsed into one `error` scenario whose "exchanges" would replay
  in sequence. Tightened to `-\d{2}$`, which is what the recorder pads sequence
  numbers to.
- The exchange index counted _every_ assistant turn in the conversation, so a
  scenario triggered partway through a thread (after any earlier reply) started
  past its own last exchange and fell back. Now counts only assistant turns
  after the matching message.

**Harness reloads itself.** Both halves, after repeatedly tripping over stale
state while doing the above: the server watches the fixture directory, and
`node --watch` in the `fake-api` script restarts it when `tsc --watch` rebuilds
`dist`. Fixtures are read rather than imported, so neither mechanism covers the
other.

**Suite status against the harness:** 33 passed, 1 skipped (`thread-history`,
which needs a real model — see above), 0 failed, in ~2 minutes at no API cost.

**Optional, independent of the above:** expose `compactionTriggerTokens` as an
environment variable. The API's minimum is 50k, so it would cut a _live_
compaction test's seed from ~120k to ~50k tokens. Only worth doing if live
compaction testing is wanted alongside the fake API; the fake API removes the
need.
