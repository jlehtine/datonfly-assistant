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
- [ ] **Run the captures.** Each scenario is a real, billable Anthropic call, so
      the recording run is left to the operator. Record with `--all` (or a
      subset), re-read each fixture before committing, then tick this off.

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

### 2.1 Scaffold the package

- [ ] Create `packages/agent-anthropic` (`@datonfly-assistant/agent-anthropic`)
      with `@anthropic-ai/sdk`, mirroring the existing package layout
      (`tsconfig.json`, `tsconfig.build.json`, workspace and turbo wiring).
- [ ] Export `AnthropicAgent`, `AnthropicAgentConfig`, `createTitleGenerateFn`,
      `TitleModelConfig` — matching the current public surface so `backend`
      needs only an import swap.

### 2.2 Message mapping

- [ ] Map `AgentMessage[]` → `Anthropic.MessageParam[]` using typed
      `ContentBlockParam` unions, replacing the current
      `Record<string, unknown>` construction and casts.
- [ ] Port attachment handling (image / PDF `document` / decoded text blocks)
      onto the SDK's typed source blocks.
- [ ] Port `trimBeforeCompaction()` and the compaction opaque-block
      encode/decode **preserving the exact persisted shape**.
- [ ] Round-trip test: every persisted `ContentPart` variant survives
      `AgentMessage` → request → response → `AgentMessage` unchanged.

### 2.3 Streaming state machine

- [ ] Consume raw stream events (`message_start`, `content_block_start`,
      `content_block_delta` with `text_delta` / `thinking_delta` /
      `signature_delta` / `input_json_delta` / `citations_delta`,
      `content_block_stop`, `message_delta`, `message_stop`) and emit
      `AgentStreamChunk`.
- [ ] Delete the index-keyed thinking dedup map and `materializeThinkingParts()`
      — raw events are already index-addressed and unambiguous.
- [ ] Delete the `concat()`-based chunk accumulation; the SDK's `MessageStream`
      accumulates natively.
- [ ] Implement `run()` as a drain of `stream()` and delete `tools.ts`'s
      duplicate loop.

### 2.4 Tool loop

- [ ] Drive the loop from `stream.finalMessage()`, which returns the exact
      assistant turn.
- [ ] Replay thinking blocks **verbatim including `signature`** within a turn.
      This lifts the current limitation recorded in `agent.ts` (persisted
      thinking blocks are not replayed, because Anthropic requires
      thinking/redacted_thinking blocks in the latest assistant message to be
      byte-identical to the original response) and is what interleaved thinking
      with tool use requires.
- [ ] Persist thinking _text_ for display; keep exact blocks in memory for the
      loop only.
- [ ] Handle `stop_reason` explicitly: `pause_turn` (re-issue for long-running
      server tools), `refusal`, `max_tokens`.
- [ ] Enforce the `maxToolIterations` budget and honour `AbortSignal` at every
      await point.

### 2.5 Server tools and status mapping

- [ ] Configure `web_search`, `web_fetch`, and `code_execution` through the
      SDK's typed server-tool unions instead of `as ServerTool` casts.
- [ ] Derive tool status from `content_block_start` with
      `type: "server_tool_use"` and delete the three-way `detectToolStatus()`
      probe (LangChain #9911 workaround).

### 2.6 Citations, usage, caching, errors

- [ ] Map the full citation union (`char_location`, `page_location`,
      `web_search_result_location`) onto `Citation`, replacing the URL+title
      scrape.
- [ ] Map `usage` including `cache_creation_input_tokens`,
      `cache_read_input_tokens`, and `server_tool_use` onto `AgentUsage`.
- [ ] Replace the blanket `cache_control: { type: "ephemeral" }` invoke option
      with deliberate breakpoints (system prompt, tool definitions, last-N
      messages; max 4) and an explicit TTL choice. Verify effectiveness via
      `cache_read_input_tokens` — the current setting's effect is unverified.
- [ ] Map `Anthropic.APIError` subclasses (`RateLimitError`,
      `AuthenticationError`, `BadRequestError`, overloaded/529) onto `core`
      error codes via `instanceof`, replacing string parsing. Configure SDK
      `maxRetries` and `timeout`, and handle mid-stream `overloaded_error`.

### 2.7 Title and triage

- [ ] Port `createTitleGenerateFn()` onto `messages.create`.
- [ ] Reimplement `shouldRespond()` with forced tool use
      (`tool_choice: { type: "tool", name: "triage" }`) instead of parsing free
      text — deterministic and cheaper.

### 2.8 Tests

- [ ] Test at the HTTP boundary: override the SDK `baseURL` to a local fake
      server driven by the Phase 1.1 fixtures. Drop the current approach of
      monkey-patching the private `model` field.
- [ ] Write a provider conformance suite (chunk ordering, `text-delta`
      `partIndex` semantics, tool-call/tool-result pairing, abort behaviour,
      usage-on-final-chunk) that any `IAgentProvider` must pass. This is what
      actually makes the seam verifiable rather than aspirational.
- [ ] Run the conformance suite against both `agent-langchain` and
      `agent-anthropic` while they coexist.

## Phase 3 — Cutover and removal of `agent-langchain`

- [ ] Add `DF_AGENT_PROVIDER` (default `anthropic`) and select the provider in
      `packages/backend/src/main.ts` via dynamic `import()`, so an unused SDK is
      never loaded. Each provider package exports
      `createAgent(config): IAgentProvider`.
- [ ] Run both providers side by side against the fixtures and the conformance
      suite; diff emitted `AgentStreamChunk` sequences.
- [ ] Verify persisted-data compatibility against a dump from a live test
      deployment: existing threads with thinking, tool-call, and compaction
      parts must render and replay identically.
- [ ] Run the relevant e2e specs individually (not the whole suite — LLM rate
      limits cause spurious failures): `tests/chat-response.spec.ts`,
      `tests/attachment-context.spec.ts`, `tests/multiuser-interrupt.spec.ts`,
      `tests/thread-history.spec.ts`.
- [ ] Flip the default provider.
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
