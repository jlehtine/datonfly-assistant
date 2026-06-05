# TODO

## Agent runtime — tool support & MCP (for Autocode codegen reuse)

Extend the reusable agent runtime so an embedder (the sibling
`datonfly-autocode` codegen capability) can drive the agent with **custom,
caller-provided tools** and **MCP servers**, not just Anthropic's built-in
server tools. Today `LangGraphAgent` binds only Anthropic server tools
(code-exec/web) and **drops** `tool-call` / `tool-result` content parts before
calling the model; there is no custom tool-calling loop and no MCP. The `ITool`
contract already exists in `core` but is not wired to the agent, and
`ContentPart` already models `ToolCallContentPart` / `ToolResultContentPart`.

Scope boundary: this work covers the generic **tool-calling loop** and the **MCP
client** only. The concrete codegen file-editing tools and the
application-control **MCP servers** are owned by `datonfly-autocode` / the
sandbox, not by the assistant. Keep all new contracts LLM-vendor-neutral and
single-sourced in `@datonfly-assistant/core`.

Suggested order: A → B → C → D, with tests and docs (E) throughout.
Inter-package API compatibility need not be preserved (pre-release); update
in-repo callers.

### A. Custom tool-calling loop in the agent

Let the agent invoke caller-provided `ITool`s and feed results back to the
model.

- [ ] Extend `IAgentProvider.run` / `stream` in
      `packages/core/src/interfaces/agent.ts` to accept caller-provided tools
      per call (e.g. an optional
      `options: { tools?: ITool[]; systemPrompt?: string }` argument). Keep the
      no-tools call shape behaviourally unchanged.
- [ ] In `packages/agent-langchain/src/agent.ts`, convert each `ITool` (Zod
      schema) into an Anthropic custom tool definition (JSON Schema) and
      `bindTools` them alongside the existing server tools.
- [ ] Stop filtering `ToolCallContentPart` / `ToolResultContentPart` when
      building the provider request; serialize them to the Anthropic `tool_use`
      / `tool_result` block format (both directions).
- [ ] Implement the agentic loop: model turn → detect `tool_use` → validate args
      against the tool's Zod schema → `tool.execute()` → append a `tool_result`
      → re-invoke the model → repeat until no tool calls remain.
- [ ] Guardrails: a `maxToolIterations` budget (config + sane default), honour
      the `AbortSignal` between iterations, and return tool execution failures
      as `tool_result` parts with `isError: true` so the model can recover.
- [ ] Unit tests: a fake `ITool` exercising a multi-step loop (execute → result
      → follow-up turn), schema-validation rejection, the iteration cap, and
      abort mid-loop.

### B. Tool-aware streaming & message persistence

Surface tool activity in the stream and round-trip it through history.

- [ ] Add `ToolCallChunk` and `ToolResultChunk` to the `AgentStreamChunk` union
      in `packages/core/src/interfaces/agent.ts`.
- [ ] Handle mid-stream tool execution in `LangGraphAgent.stream`: accumulate
      the streamed tool-input JSON, emit a `ToolCallChunk`, execute the tool,
      emit a `ToolResultChunk`, then continue streaming the next model turn.
      (This is the most delicate piece — guard partial-JSON assembly and
      ordering.)
- [ ] Round-trip `tool-call` / `tool-result` content parts through
      `packages/chat-server/src/messages.ts` (serialization) and the message
      persistence layer so resumed threads replay tool calls and results.
- [ ] Update the `chat-server` gateway/consumer to handle the new chunk types
      (render or ignore safely) without breaking existing chat behaviour.
- [ ] Tests: streaming tool chunks emit in order; a persisted-then-reloaded
      thread containing tool parts deserializes to equivalent `AgentMessage`s.

### C. MCP client integration

Adapt external MCP servers' tools into the same tool-calling loop.

- [ ] Add an MCP client (`@modelcontextprotocol/sdk`) supporting **stdio** and
      **HTTP/SSE** transports. Decide placement: inside `agent-langchain` or a
      new `@datonfly-assistant/agent-mcp` package (record the decision).
- [ ] On connect, list the server's tools and wrap each as an `ITool` whose
      `execute()` proxies the call to the MCP server (mapping the MCP input
      schema to the `ITool` Zod schema).
- [ ] Lifecycle management: connect / disconnect, a per-session/per-job set of
      servers, and per-call timeout + error handling.
- [ ] Defer (note as out of scope here): MCP resources/prompts and dynamic
      tool-list-changed notifications.
- [ ] Tests: the adapter lists and invokes tools against a mock MCP server;
      transport/connection errors surface as tool errors, not crashes.

### D. Library API & configuration surface

Make the above cleanly consumable by an external embedder.

- [ ] Export the tool, loop-options, and MCP client types/factory from
      `packages/agent-langchain/src/index.ts` (and `core` as needed).
- [ ] Extend `LangGraphAgentConfig` with `maxToolIterations` and optional
      default tools / system prompt; support per-call overrides via the new
      run/stream options object.
- [ ] Keep the public tool contract vendor-neutral (single-sourced via
      `@datonfly-assistant/core` `ITool`); do not leak `@langchain/*` types
      across the package boundary.

### E. Standalone wiring, tests & docs (assistant product — optional)

- [ ] Optionally wire env-configured MCP servers into the standalone chat
      backend behind a feature flag (no behaviour change when unset).
- [ ] Update `README.md` / `INSTALL.md` to document tool and MCP configuration
      (env vars, transports, iteration cap).
- [ ] Run `pnpm lint:fix`; confirm `pnpm build`, `pnpm lint`, and the affected
      unit tests pass.

## Security

### Rate limiting

No rate limiting is applied to any endpoint. Add rate limiting middleware (e.g.
`@nestjs/throttler`) to protect login, OIDC callback, thread creation, and
WebSocket message sending against brute-force and abuse.
