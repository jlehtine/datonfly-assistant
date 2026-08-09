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

## Agent provider — replace LangChain with the Anthropic SDK

Rewrite `packages/agent-langchain` as `packages/agent-anthropic`, dropping
`@langchain/anthropic` and `@langchain/core` in favour of `@anthropic-ai/sdk`
used directly. Motivation: LangChain has repeatedly lagged the Anthropic API,
and the package works around those gaps rather than benefiting from the
framework.

### Why this is cheap

- No `@langchain/*` symbol escapes `packages/agent-langchain/src`. The
  `@langchain/core` entries in `backend`, `chat-client`, `chat-ui-mui`, and
  `frontend` `package.json` are **dead dependencies** — nothing imports them.
- `chat-server` consumes only `IAgentProvider` from `core` and needs no change
  beyond the capabilities rename in Phase 1.2.
- Nothing from the framework is actually used: no LCEL chains, no LangGraph, no
  `AgentExecutor`, no prompt templates, no output parsers, no memory, no
  callbacks/tracing. `Runnable` is imported as a type only. LangChain functions
  as a leaky HTTP client, and the leaks are already visible as
  `as unknown`/`as ServerTool` casts, hand-built Anthropic content blocks, and
  the `detectToolStatus` workaround for LangChain #9911.
- Total surface: ~1300 LOC across `agent.ts` (1063), `tools.ts` (157),
  `title.ts` (68), `index.ts` (9), plus ~490 LOC of tests. Expect the rewrite to
  be _smaller_, because the raw Anthropic event stream is better specified than
  what LangChain surfaces.

### Decisions (resolved)

- **Tool contract:** JSON Schema is canonical on `ITool`; Zod becomes an
  authoring helper. Every wire protocol in this space (MCP `inputSchema`,
  Anthropic `input_schema`, OpenAI `function.parameters`, Gemini
  `functionDeclarations`) is JSON Schema; Zod is a convenience that must be
  compiled down at the boundary. See Phase 0.
- **Single streaming path:** implement `stream()` only; `run()` drains it. The
  current duplicate loops in `run()`/`runToolLoop()` and the stream generator
  are a standing source of divergence.
- **Persisted data is a hard constraint:** `ContentPart` encodings must stay
  byte-compatible, in particular
  `OpaqueContentPart { provider: "anthropic", data: { type: "compaction", content } }`
  and the `tool-call` / `tool-result` / `thinking` part shapes. There are active
  test deployments; no destructive migration.
- **Provider seam stays where it is:** `IAgentProvider`, `ITool`, `AgentMessage`
  / `ContentPart`, and `AgentStreamChunk` in `core` are already vendor-neutral
  and are what make this cheap. Do not move provider concepts into `core`;
  `OpaqueContentPart.provider` remains the escape hatch for provider-specific
  state that must round-trip through persistence.
- **No shared `agent-common` package yet.** Extract shared code only when a
  second provider actually lands. The tool loop specifically should _not_ be
  shared — providers differ in how the loop interleaves with streaming and
  reasoning, and a premature shared abstraction would recreate the LangChain
  problem in-house.
- **Licensing:** `@anthropic-ai/sdk` (MIT) and `@types/json-schema` (MIT) both
  satisfy the permissive-license rule for code linked into shipped artifacts.

### Open decisions

- **Standard Schema vs Zod-only `validate`.** Deferred. `~standard.validate`
  (Zod 4, Valibot, ArkType, Effect) is a strict superset of the Zod-only hook at
  near-zero cost, but is speculative until a non-Zod embedder appears. Revisit
  if one does.
- **MCP `outputSchema` / `structuredContent`.** Deferred. Neither Anthropic nor
  OpenAI consume it; useful only for validating MCP responses locally.
- **Surfacing agent capabilities in the welcome event.** Phase 1.2 introduces
  the descriptor; whether `chat-server` advertises it to clients (so the UI can
  adapt) is a separate decision, deferred to after cutover.

## Phase 0 — Tool contract: JSON Schema as canonical

Independent of the rewrite and worth landing first: it fixes a live bug. Today
`packages/agent-mcp/src/json-schema-to-zod.ts` silently drops `$ref`/`$defs`,
`oneOf`/`anyOf`/`allOf`, `format`, `minimum`/`maximum`, `minLength`/`pattern`,
`const`, `default`, `additionalProperties`, `minItems`/`uniqueItems`, and
tuple-form `items`. Two consequences:

1. The model sees a **strictly worse schema than the MCP server published** —
   fewer constraints, more malformed calls.
2. `objectSchema()` builds `z.object(shape)`, which strips unknown keys. Since
   `executeToolCall()` passes the _parsed_ value to `execute()`, any property
   the converter dropped is **removed before it reaches the MCP server**.

Keeping Zod canonical would also force the rewrite to add a Zod → JSON Schema
step that LangChain currently hides, per provider dialect.

### 0.1 Redefine `ITool` in `core`

- [x] Add `@types/json-schema` (MIT, types-only) and export a `JsonSchema` alias
      based on `JSONSchema7` from `packages/core`. Keep it loose — each provider
      subsets JSON Schema differently; do not over-constrain.
- [x] Rewrite `packages/core/src/interfaces/tool.ts` to the shape below.

```ts
export interface ITool<TInput = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the tool input, passed to the model verbatim. */
  inputSchema: JsonSchema;
  /** Optional pre-dispatch validation. Omit when the tool validates its own input. */
  validate?: (input: unknown) => TInput;
  execute(input: TInput): Promise<string | Record<string, unknown>>;
}
```

### 0.2 Add the `zodTool()` authoring helper to `core`

- [x] Implement
      `zodTool<S extends z.ZodType>({ name, description, schema, execute })`
      returning `ITool<z.infer<S>>`, preserving full type inference for
      app-authored tools.
- [x] Convert with
      `z.toJSONSchema(schema, { io: "input", target: "draft-7", unrepresentable: "any" })`.
      `io: "input"` so `.default()` and transforms are described on the input
      side; `unrepresentable: "any"` so constructs like `z.date()` degrade
      instead of throwing. Zod 4 is already the workspace-wide version, so no
      new runtime dependency.
- [x] Set `validate` to the schema's `parse`.
- [x] Unit-test the helper: inference holds, emitted schema shape is correct,
      unrepresentable constructs degrade rather than throw.

### 0.3 Pass MCP schemas through untouched

- [x] In `packages/agent-mcp/src/mcp-client.ts`, have `createProxyTool()` assign
      `mcpTool.inputSchema` directly to `ITool.inputSchema`.
- [x] Omit `validate` for MCP tools: the server is the authority on its own
      inputs and returns better errors than a reconstructed schema. This also
      removes the lossy double-validation.
- [x] Delete `packages/agent-mcp/src/json-schema-to-zod.ts` and
      `json-schema-to-zod.test.ts` (~110 LOC plus tests). Drop the `zod`
      dependency from `agent-mcp` if nothing else uses it. (Moved to
      `devDependencies`: production code no longer imports it, but the tests
      still build mock MCP servers with Zod shapes.)
- [x] Add a regression test: an MCP tool declaring `oneOf`, `$ref`, `format`,
      and `additionalProperties` reaches the provider tool definition
      unmodified, and arguments outside the converter's old subset are no longer
      stripped before dispatch.

### 0.4 Update consumers of the old contract

- [x] Update `packages/agent-langchain/src/tools.ts`: `toLangChainToolDef()`
      passes JSON Schema (LangChain accepts it for tool definitions), and
      `executeToolCall()` uses `tool.validate?.(call.args) ?? call.args`. This
      is interim work on a package Phase 3 deletes, so keep it minimal.
- [x] Update `packages/agent-langchain/src/tools.test.ts` for the new contract.
- [x] Update any host-app/example tool definitions to `zodTool()`. (Only the
      `agent-langchain` test fixtures construct tools directly; the backend
      wires MCP tools through, so nothing else needed changing.)
- [x] Document the tool contract in `CONVENTIONS.md`: JSON Schema is canonical,
      `zodTool()` is the ergonomic path, `validate` is optional and should be
      omitted when the tool's own backend validates.

## Phase 1 — Baseline capture and provider seam

### 1.1 Capture streaming fixtures from the current implementation

Must happen **while `agent-langchain` still runs** — these fixtures are the
regression baseline for the rewrite.

- [x] Stand up a local pass-through recording proxy and point the existing
      client at it via `ChatAnthropic`'s `anthropicApiUrl` option, so raw SSE is
      captured despite LangChain wrapping the transport.
      (`packages/agent-langchain/src/fixtures/recording-proxy.ts`; the base URL
      is plumbed through as `AnthropicAgentConfig.baseUrl`.)
- [x] Record representative scenarios: plain text; thinking (adaptive and
      `enabled`); `web_search` with citations; `web_fetch`; `code_execution`; a
      multi-iteration local tool loop; attachments (image, PDF, text);
      compaction trigger; abort mid-stream; and error responses (400, 429, 529).
      The scenario matrix is implemented in `record-fixtures.ts`
      (`pnpm --filter @datonfly-assistant/agent-langchain record:fixtures`);
      429/529 ship as hand-written synthetic fixtures because they cannot be
      triggered on demand.
- [x] Store fixtures under `packages/agent-anthropic/test/fixtures/` with a
      short README describing what each one exercises.
- [x] Scrub API keys and any deployment-specific content from recordings before
      committing. Automated in the proxy (credential headers dropped, response
      headers reduced to an allowlist, `sk-ant-…` / `Bearer …` redacted) and
      covered by `recording-proxy.test.ts`.
- [x] **Run the captures.** Recorded against `claude-opus-5`. Eleven of twelve
      remaining scenarios landed; each scenario now carries a `verify` predicate
      so a capture that does not exercise its claim is rejected instead of
      written.
- [ ] Record the `compaction` fixture. Blocked on the caching interaction below;
      the request is valid (trigger must be ≥ 50000, not the 1000 first tried)
      but compaction never fires.

**Resolved — manual thinking budgets dropped.** `thinking.type: "enabled"` (with
`budget_tokens`) is rejected by both Opus 5 and Sonnet 5, surviving only on the
4.x generation (verified on `claude-haiku-4-5`). Since the 4.x models are used
only for titles and triage — neither of which passes thinking configuration —
the mode was unreachable in this product. `thinkingType` is now `"adaptive"`
only, `thinkingBudgetTokens` / `DF_ANTHROPIC_THINKING_BUDGET_TOKENS` are gone,
and `DF_ANTHROPIC_THINKING_TYPE=enabled` fails at startup instead of 400-ing on
every request. Use `DF_ANTHROPIC_THINKING_EFFORT` to control thinking depth.

**Finding — blanket prompt caching defeats provider-side compaction.** The agent
sets `cache_control: { type: "ephemeral" }` on every invoke (`agent.ts` lines
706 and 760). A 180 kB prompt was therefore billed as
`cache_creation_input_tokens: 60059` with `input_tokens: 44`, and
`context_management` reported `applied_edits: []`. Since the compaction trigger
is `trigger.type: "input_tokens"`, it cannot fire while every token is
attributed to cache creation — so `DF_ANTHROPIC_ENABLE_COMPACTION=true` is
effectively inert today. This corroborates the Phase 2.6 note that the cache
setting's effect is unverified, and should be resolved there (deliberate cache
breakpoints) before the compaction fixture can be captured.

### 1.2 Replace `externalCompaction` with a capabilities descriptor

- [x] Extend `IAgentProvider` in `packages/core/src/interfaces/agent.ts` with
      the descriptor below, replacing `externalCompaction`.
- [x] Update the two `agent.externalCompaction` reads in
      `packages/chat-server/src/chat.gateway.ts` and the provider wiring in
      `chat.module.ts`. (`chat.module.ts` passes the provider through as
      `IAgentProvider` and needed no change; both reads are now
      `capabilities.compaction === "external"`.)
- [x] Update `agent-langchain` to report the descriptor so the seam change lands
      independently of the rewrite.

```ts
readonly capabilities: {
    compaction: "provider" | "external" | "none";
    webSearch: boolean;
    codeExecution: boolean;
    thinking: boolean;
    attachments: { images: boolean; pdf: boolean };
};
```

### 1.3 Split agent config into neutral base and provider options

- [x] Separate the neutral fields (`modelName`, `apiKey`, `maxTokens`,
      `temperature`, `maxToolIterations`, `defaultTools`, `defaultSystemPrompt`,
      `contextWindowSize`, `logger`) from vendor-specific ones (thinking, server
      tools, compaction) under a `providerOptions` bag. The neutral half is
      `AgentConfig` in `core`; `AnthropicAgentConfig` extends it and adds
      `providerOptions: AnthropicProviderOptions`.
- [x] Align `packages/backend/src/config.ts` mapping with the split so the
      backend's agent config assembly is mostly provider-agnostic. The
      Anthropic-only knobs are already grouped under
      `BackendConfig.agent.anthropic`, so they should map onto `providerOptions`
      directly. (`main.ts` now passes `providerOptions: cfg.agent.anthropic`
      verbatim; `config.ts` needed no change.)

## Phase 2 — `agent-anthropic` implementation

**Finding — the SDK lags the API too, but narrowly.** `@anthropic-ai/sdk@0.74.0`
does not type the 2026 server tools (`code_execution_20260120`,
`web_search_20260209`, `web_fetch_20260209`) or the `xhigh` thinking effort. Two
assertions cover it: one in `serverToolParams()`, one in `buildOutputConfig()`.
That is the whole extent of it — messages, streaming events, usage, citations,
compaction, and context management are all fully typed, so the casts are pinned
to version identifiers rather than spread through the message and streaming
layers as they were with LangChain.

**Deviation — thinking parts no longer merge across turns.** `agent-langchain`
keys reasoning state on `thinking:${blockIndex}` globally, so a thinking block
in the second tool-loop turn merges into the first turn's part (block indices
restart at 0 each turn). The rewrite assigns a fresh part index per block per
turn, which is what the transcript means. No recorded fixture exercises thinking
inside a multi-turn tool loop, so the cross-provider diff below does not show
it; it stays a known difference rather than a measured one.

### 2.1 Scaffold the package

- [x] Create `packages/agent-anthropic` (`@datonfly-assistant/agent-anthropic`)
      with `@anthropic-ai/sdk`, mirroring the existing package layout
      (`tsconfig.json`, `tsconfig.build.json`, workspace and turbo wiring).
- [x] Export `AnthropicAgent`, `AnthropicAgentConfig`, `createTitleGenerateFn`,
      `TitleModelConfig` — matching the current public surface so `backend`
      needs only an import swap. Also exports `AnthropicProviderOptions`, the
      error helpers, and a `./testing` subpath carrying the fixture server and
      the conformance suite.
- [x] Route every request through `client.beta.messages`. `context_management`,
      `output_config`, and the compaction blocks exist only in the beta
      namespace, so a single beta path avoids maintaining two request builders
      for one feature set.

### 2.2 Message mapping

- [x] Map `AgentMessage[]` → `Anthropic.MessageParam[]` using typed
      `ContentBlockParam` unions, replacing the current
      `Record<string, unknown>` construction and casts.
- [x] Port attachment handling (image / PDF `document` / decoded text blocks)
      onto the SDK's typed source blocks.
- [x] Port `trimBeforeCompaction()` and the compaction opaque-block
      encode/decode **preserving the exact persisted shape**.
- [x] Round-trip test: every persisted `ContentPart` variant survives
      `AgentMessage` → request → response → `AgentMessage` unchanged.
- [x] Hoist system messages into the top-level `system` parameter and merge
      consecutive same-role turns. The Messages API has no system role and
      requires alternating turns, but a multi-user thread routinely produces
      several consecutive human messages. Empty text blocks are dropped, since
      the API rejects them.

### 2.3 Streaming state machine

- [x] Consume raw stream events (`message_start`, `content_block_start`,
      `content_block_delta` with `text_delta` / `thinking_delta` /
      `signature_delta` / `input_json_delta` / `citations_delta`,
      `content_block_stop`, `message_delta`, `message_stop`) and emit
      `AgentStreamChunk`.
- [x] Delete the index-keyed thinking dedup map and `materializeThinkingParts()`
      — raw events are already index-addressed and unambiguous.
- [x] Delete the `concat()`-based chunk accumulation; the SDK's `MessageStream`
      accumulates natively.
- [x] Implement `run()` as a drain of `stream()` and delete `tools.ts`'s
      duplicate loop.

### 2.4 Tool loop

- [x] Drive the loop from `stream.finalMessage()`, which returns the exact
      assistant turn.
- [x] Replay thinking blocks **verbatim including `signature`** within a turn.
      This lifts the current limitation recorded in `agent.ts` (persisted
      thinking blocks are not replayed, because Anthropic requires
      thinking/redacted_thinking blocks in the latest assistant message to be
      byte-identical to the original response) and is what interleaved thinking
      with tool use requires.
- [x] Persist thinking _text_ for display; keep exact blocks in memory for the
      loop only.
- [x] Handle `stop_reason` explicitly: `pause_turn` (re-issue for long-running
      server tools), `refusal`, `max_tokens`.
- [x] Enforce the `maxToolIterations` budget and honour `AbortSignal` at every
      await point.

### 2.5 Server tools and status mapping

- [x] Configure `web_search`, `web_fetch`, and `code_execution` through the
      SDK's typed server-tool unions instead of `as ServerTool` casts. Partly
      done: the SDK does not yet know the 2026 versions, so one assertion
      remains in `serverToolParams()` (see the finding above).
- [x] Derive tool status from `content_block_start` with
      `type: "server_tool_use"` and delete the three-way `detectToolStatus()`
      probe (LangChain #9911 workaround).

### 2.6 Citations, usage, caching, errors

- [x] Map the full citation union (`char_location`, `page_location`,
      `web_search_result_location`) onto `Citation`, replacing the URL+title
      scrape. Handled structurally across the whole union; only entries carrying
      a URL become a `Citation`, because the core type requires one. Document
      citations need `Citation` to gain a document form — deferred to Phase 4
      with the PDF citation work.
- [x] Map `usage` including `cache_creation_input_tokens`,
      `cache_read_input_tokens`, and `server_tool_use` onto `AgentUsage`. Across
      a multi-turn loop, input tokens take the per-turn maximum (a snapshot of
      the context, which is what compaction keys on) while output and cache
      writes are summed (per-request costs).
- [x] Replace the blanket `cache_control: { type: "ephemeral" }` invoke option
      with deliberate breakpoints (system prompt, tool definitions, last-N
      messages; max 4) and an explicit TTL choice.
- [ ] Verify cache effectiveness against the live API via
      `cache_read_input_tokens`, then re-attempt the blocked `compaction`
      fixture capture from Phase 1.1.
- [x] Map `Anthropic.APIError` subclasses (`RateLimitError`,
      `AuthenticationError`, `BadRequestError`, overloaded/529) onto `core`
      error codes via `instanceof`, replacing string parsing. Configure SDK
      `maxRetries` and `timeout`.
- [ ] Handle mid-stream `overloaded_error` (a 529 delivered inside an already
      open SSE stream, which SDK-level retries do not cover).

### 2.7 Title and triage

- [x] Port `createTitleGenerateFn()` onto `messages.create`.
- [x] Reimplement `shouldRespond()` with forced tool use
      (`tool_choice: { type: "tool", name: "triage" }`) instead of parsing free
      text — deterministic and cheaper.
- [ ] Cover title generation and triage with fixture-backed tests. Neither has a
      recorded fixture yet; both are non-streaming calls, so they need their own
      captures.

### 2.8 Tests

- [x] Test at the HTTP boundary: override the SDK `baseURL` to a local fake
      server driven by the Phase 1.1 fixtures. Drop the current approach of
      monkey-patching the private `model` field.
      (`src/testing/fixture-server.ts` replays recorded exchanges in order over
      an ephemeral port and records the request bodies it received.)
- [x] Write a provider conformance suite (chunk ordering, `text-delta`
      `partIndex` semantics, tool-call/tool-result pairing, abort behaviour,
      usage-on-final-chunk) that any `IAgentProvider` must pass. This is what
      actually makes the seam verifiable rather than aspirational.
      (`src/testing/conformance.ts`, exported via the `./testing` subpath; uses
      `node:assert` rather than a test runner so any package can drive it.)
- [x] Run the conformance suite against both `agent-langchain` and
      `agent-anthropic` while they coexist.
      (`packages/agent-langchain/src/conformance.test.ts` runs the shared cases;
      `provider-diff.test.ts` diffs the emitted chunk sequences scenario by
      scenario. Both report rather than assert — `agent-langchain` is being
      deleted, so the goal is to know the divergences, not to fix them.)

**Divergence catalogue — measured, not assumed.** `agent-langchain` passes all
five conformance cases, so the contract is unchanged. The chunk-sequence diff is
sharper: across `plain-text`, both thinking fixtures, `tool-loop`, `web-search`,
`web-fetch`, `code-execution`, and `attachment-text` the **chunk order, part
indices, and visible text are identical**. Exactly one field differs.

- **`usage.outputTokens` — `agent-langchain` is wrong.** It keeps the streamed
  chunk with the highest `input_tokens`, which is `message_start`, where
  `output_tokens` is the placeholder `1`. Every scenario reports 1–3 against
  real counts of 9–707. Output-token metrics persisted to `message.metadata`
  have therefore been understated for the whole life of the feature; the rewrite
  fixes this, and stored history stays wrong. Nothing else reads the field, so
  there is no behavioural consequence beyond reporting.

Two bugs in the rewrite surfaced through the diff and are fixed:

- **Input tokens must include cached tokens.** Anthropic reports `input_tokens`
  as the _uncached remainder_, with `cache_creation_input_tokens` and
  `cache_read_input_tokens` split out. `AgentUsage.inputTokens` means context
  size — `CompactionService.maybeCompact()` compares it against a threshold — so
  the three are summed. Reporting the remainder alone (4 instead of 5903 on
  `web-search`) would have silently stopped external compaction from ever
  triggering. Pinned by a regression test.
- **An empty thinking block must not claim a part index.** Adaptive thinking can
  return a block carrying only a signature; allocating its part index at
  `content_block_start` shifted the text part to index 1. The index is now
  claimed on the first non-empty delta.

**Request-level divergence.** Comparing only emitted chunks cannot see a change
in what goes _out_ — replayed fixtures return the same bytes whatever was asked
for. The diff now compares request bodies too, which found one difference:
`agent-langchain` sends `thinking: { type: "disabled" }` when reasoning is
unconfigured, whereas this provider omits the parameter. A live probe against
`claude-opus-5` settled what that means:

| `thinking`            | blocks returned    | thinking tokens |
| --------------------- | ------------------ | --------------- |
| omitted               | `thinking`, `text` | 36              |
| `{"type":"disabled"}` | `text`             | 0               |
| `{"type":"adaptive"}` | `thinking`, `text` | 108             |

So **adaptive thinking is the API default** on Claude 5, and the cutover turns
reasoning on where it used to be off. Accepted deliberately, and
`thinkingType: "disabled"` (`DF_ANTHROPIC_THINKING_TYPE=disabled`) now exists to
switch it back off. Thinking tokens are billed as output, and
`capabilities.thinking` reports `true` unless disabled explicitly.

### Reasoning was invisible because `display` was never sent

Reasoning blocks came back empty in live development for the same reason they
did in the `thinking-adaptive` fixture. Probing `claude-opus-5` with a prompt
hard enough to force real reasoning:

| `thinking`                                   | thinking tokens | reasoning text |
| -------------------------------------------- | --------------- | -------------- |
| `{"type":"adaptive"}` (= the API default)    | 2481            | **0 chars**    |
| `{"type":"adaptive","display":"summarized"}` | 2324            | 2547 chars     |
| `{"type":"adaptive"}` + `effort: "high"`     | 2924            | **0 chars**    |

`display: "summarized"` is what produces reasoning text, and effort has nothing
to do with it. The API default therefore reasons, bills the tokens as output,
and returns nothing — the worst combination.

**Resolved: the provider always sends a thinking parameter**, defaulting to
`{ type: "adaptive", display: "summarized" }`. Adaptive matches the API default,
but the display does not, and `display` cannot be sent without `type` — so
omitting the parameter is precisely the invisible-but-billed case. Reasoning is
therefore visible out of the box at the same cost, and
`DF_ANTHROPIC_THINKING_TYPE=disabled` stops paying for it.

One trap remains: **short questions produce no summary even when one is
requested**, which is what the `thinking-adaptive` fixture captured. There has
to be enough reasoning to be worth summarising, so an empty block is not on its
own evidence of misconfiguration.

`display` is absent from `BetaThinkingConfigAdaptive` in SDK 0.74 despite being
honoured by the API, so it needs an assertion — a third instance of the SDK
lagging, alongside the 2026 tool versions and `xhigh` effort.

**Fixture gap found while wiring the suite.** `thinking-adaptive` records a
thinking block whose `thinking_delta` payloads are all empty — with
`display: "summarized"` and `effort: "low"` the model returned only a signature.
The Phase 1.1 `verify` predicate checked for the block, not its text. The
recording is kept (an empty thinking block must not produce an empty part, which
is now a conformance case) and a derived `thinking-summarized` fixture covers
the non-empty path. Re-record at a higher effort level to replace it.

## Phase 3 — Cutover and removal of `agent-langchain`

A **hard cutover**: `backend` swaps one import and `agent-langchain` is deleted
in the same change. No provider switch is introduced for it — both providers
target Anthropic, so a selector between them would only describe which client
library is in use, and it would be removed again immediately.
`DF_AGENT_PROVIDER` is reserved for a genuinely different vendor (e.g. a future
`agent-openai`) and should be added when there is one, not before.

The cross-provider comparison that justified a parallel run is already done (see
the divergence catalogue above), so the remaining risk is in persisted data and
end-to-end behaviour rather than in chunk semantics.

### Development database survey

Run against the local development database to find real persisted data for the
compatibility check. Three findings, all of which change assumptions recorded
earlier:

- **There is no compaction data anywhere.** The only three `opaque` parts in the
  database are not compaction blocks at all: they carry `data.type: "thinking"`
  with an `index`, `thinking`, and `signature`, written by an earlier design
  that persisted signed thinking blocks for verbatim replay. Both providers
  ignore them, but the shape exists in live data, so it is now covered by tests
  (`isCompactionPart()` must reject it, it must be dropped from the request, and
  it must not act as a compaction boundary). Provider-side compaction has
  therefore **never been observed working** in this deployment.
- **Thinking parts stopped in May.** All 24 are dated 2026-05-01 and all came
  from `claude-opus-4-7`. Nothing since. The cause is mundane:
  `DF_ANTHROPIC_THINKING_TYPE` is commented out in the local `.env`, so thinking
  has simply been switched off. No code regression is involved. Note that
  enabling it may still look broken on Claude 5 — see the fixture finding above,
  where `adaptive` + `summarized` + `effort: low` returned a thinking block
  whose text was empty. Try a higher effort level.
- **The longest conversations are ~11k characters**, far below any compaction
  trigger (the API minimum is 50k input tokens). Nothing in this database would
  have exercised compaction regardless.

### Provider-side compaction now works — three bugs found capturing it

Capturing the `compaction` fixture took five attempts and turned up three
independent defects. Compaction had **never** worked in this project, which is
why the database holds no compaction blocks.

1. **A missing beta header made every compaction request fail.** The
   `compact_20260112` edit needs `compact-2026-01-12` _in addition to_
   `context-management-2025-06-27`. Without it the API returns a 400 listing
   only `clear_thinking_20251015` / `clear_tool_uses_20250919` as valid tags.
   `@langchain/anthropic` added the header automatically, so this was a
   regression introduced by the rewrite — and since
   `DF_ANTHROPIC_ENABLE_COMPACTION` defaults to on, it would have failed _every_
   request in production. Betas are now derived from the configuration.
2. **`pause_after_compaction` was never set.** Without it the API compacts
   internally and returns nothing, so no block can be persisted and every later
   request resends the full history to be compacted again — the stored
   `OpaqueContentPart` round-trip this codebase is built around never engages.
   It is now an option, defaulting **off** to keep behaviour unchanged; the
   fixture scenario turns it on. **Decide whether production should enable it**
   — it is what makes compaction actually save anything, at the cost of one
   extra round trip on the compacting turn.
3. **`stop_reason: "compaction"` was unhandled.** The compacting turn answers
   nothing; it returns the block and stops. The loop treated that as the final
   response and returned an empty answer. It is now resumed like `pause_turn`.

Two further discoveries came from the same capture:

- **`applied_edits` stays empty even on success.** The scenario's original
  `verify` predicate looked for it and so rejected working captures. The real
  signals are `stop_reason: "compaction"` and a `compaction` content block.
- **A compacting turn zeroes the top-level usage counts** and reports the real
  numbers under `usage.iterations[]`, whose last entry the SDK documents as the
  true context size. `readPromptUsage()` now prefers it — without that, a
  compacting turn reported 0 input tokens.

Recorded as `compaction-01` (stops with the block) and `compaction-02` (resumes
with the block standing in for the compacted history); both are covered by
tests.

- [x] Verify persisted-data compatibility against a dump from a live test
      deployment. Done against the local development database instead — see the
      survey below; it turned out to contain no compaction data at all, but it
      did reveal a legacy opaque shape that is now covered by tests.
- [ ] Swap the `backend` import to `@datonfly-assistant/agent-anthropic` and map
      `BackendConfig.agent.anthropic` onto `providerOptions`.
- [x] Decide the prompt-cache defaults to ship. `cacheTailMessages` is **1** and
      `cacheTtl` stays at the API default of 5 minutes. The UI has no restore
      points or branch-from-here editing, so only the incoming user turn is
      volatile; caching through the previous assistant turn maximises the
      reusable prefix. A larger hedge costs reuse and buys nothing, because
      caches match by prefix — a tail that later proves wrong simply stops
      hitting at the divergence point. Not exposed as `DF_ANTHROPIC_*`
      variables: there is no deployment-specific reason to vary them, and the
      coupling to UI capabilities makes them a code-level decision. Revisit if
      restore points are ever added.
- [ ] Run the relevant e2e specs individually (not the whole suite — LLM rate
      limits cause spurious failures): `tests/chat-response.spec.ts`,
      `tests/attachment-context.spec.ts`, `tests/multiuser-interrupt.spec.ts`,
      `tests/thread-history.spec.ts`.
- [x] Move the fixture recorder (`recording-proxy.ts` / `record-fixtures.ts`)
      into `agent-anthropic` so re-recording survives the deletion. Recordings
      made from here on are captured through the implementation they test, so
      they document behaviour rather than validate it — noted in the fixtures
      README.
- [ ] Delete `packages/agent-langchain`.
- [ ] Remove the dead `@langchain/core` dependencies from `backend`,
      `chat-client`, `chat-ui-mui`, and `frontend` `package.json`.
- [ ] Update workspace plumbing: `pnpm-workspace.yaml`, `turbo.json`, tsconfig
      project references.
- [ ] Update `README.md`, `CONVENTIONS.md`, and `INSTALL.md` for the package
      rename (`agent-langchain` → `agent-anthropic`), including the
      pluggable-provider description in `CONVENTIONS.md`.

## Phase 4 — Advanced Anthropic capabilities

Post-cutover and individually optional; each is unblocked by direct SDK access.
Sequence by value, not by number.

- [ ] `client.messages.countTokens()` for exact pre-flight context sizing,
      replacing the post-hoc `usage`-based compaction trigger in
      `CompactionService`.
- [ ] Interleaved thinking with tool use (beta), now possible thanks to
      signature-preserving replay from Phase 2.4.
- [ ] Measure and tune cache breakpoints; evaluate the 1-hour TTL for long
      threads.
- [ ] Message Batches API for title generation and external compaction summaries
      (~50% cost reduction on non-interactive calls).
- [ ] Document citations for PDF attachments, building on the Phase 2.6 citation
      union.
- [ ] Evaluate Anthropic's server-side MCP connector as a replacement for local
      proxying of HTTP MCP servers.
- [ ] Fine-grained tool streaming: surface `input_json_delta` so the UI can show
      tool arguments as they are generated.
- [ ] Evaluate the 1M-token context beta for Sonnet.
