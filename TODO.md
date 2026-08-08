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

## Unresolved: composer text can be lost between typing and send

`chat-response.spec.ts`'s "keeps markdown soft breaks and paragraph spacing"
fails intermittently (roughly 1 in 3 full-suite runs, load-dependent). It fills
the composer and clicks Send immediately, and on failure the composer is empty
and Send is disabled.

What was established:

- Not data loss and not a wrong-thread send: the DB shows the second message was
  never persisted, so nothing was sent anywhere.
- Not rate limiting (`DF_RATE_LIMIT_FACTOR=100` changed nothing) and not the
  accumulated-test-data slowdown (it still reproduces against a truncated
  database).
- The thread is still selected and its messages are intact at failure, so the
  `key={threadId ?? "new"}` on `Composer` did not change.
- Nothing resets `useComposer`'s `text` except submitting, so the state can only
  have been lost by the `Composer` remounting — but Playwright's log reporting
  the send button "detached from the DOM" is the only evidence of that, and a
  mount/unmount trace added to `Composer` failed to reproduce across a full
  suite run.

- [ ] Find the remount (or whatever else drops the typed text) and fix it. If it
      is real, a user typing while a background re-render lands would silently
      lose their message. Until then the spec stays as-is rather than being
      papered over with a retry, so the flake keeps surfacing it.

## Assistant-generated files (downloadable outputs)

The assistant regularly tells users it has "saved" a script, chart, or dataset
to a named file, but nothing is downloadable. This is a genuine missing feature,
not a model hallucination.

**Why it happens.** Code execution is enabled by default
(`DF_ENABLE_CODE_EXECUTION`, see `packages/backend/src/config.ts`). Claude runs
`bash_code_execution` / `text_editor_code_execution` in Anthropic's sandbox
container and writes real files there. Anthropic returns the ID of each
generated file in the tool result block (`bash_code_execution_tool_result` →
`bash_code_execution_result.content[].file_id`), and the bytes are retrievable
through the Files API (`GET /v1/files/{file_id}/content`, beta header
`files-api-2025-04-14`). `packages/agent-langchain/src/agent.ts` extracts only
text, thinking, citations, and compaction blocks from the response content — the
code execution result blocks and their file IDs are dropped on the floor. So the
model correctly reports what it did inside the container, and the application
throws the result away.

Three separate gaps compound this:

1. **No extraction/transport.** The agent never surfaces generated files, so
   nothing reaches the chat server, the database, or the client.
2. **Attachments are input-only.** The `attachment` table, the
   `AttachmentContentPart` type, and the REST endpoints all exist, but the
   pipeline only runs user → server. There is no path for server → user. (The UI
   is already role-agnostic: `renderPart` in
   `packages/chat-ui-mui/src/MessageBubble.tsx` renders `attachment` parts on
   any message, so an assistant message carrying one would render today.)
3. **No container continuity.** The `container` request parameter is never
   passed, so every request gets a fresh sandbox. Files "saved" in one turn do
   not exist in the next, which is why follow-ups like "now edit that script"
   silently start from nothing.

### Decisions (resolved)

- **Capture scope: only files the model deliberately presents to the user** —
  and this turns out to be handled natively by the platform, so it needs no
  mechanism of our own. The sandbox exposes an `$OUTPUT_DIR` environment
  variable (`/files/output/<hex>`, freshly generated for each tool call), and
  **only files placed there are exported to the Files API and given a
  `file_id`**. Everything else — the working directory, `/tmp`, arbitrary
  subdirectories — yields nothing. The model already knows this convention and
  applies it unprompted: asked to "save it as output.png", it wrote the file to
  `/tmp` and then copied it to `$OUTPUT_DIR`. So the set of file IDs we receive
  is already exactly the set of files the model chose to deliver. Capture every
  file ID we get; do not filter by path, and do not invent a directory
  convention in the system prompt.

- **Text-editor-created files: moot, no special handling.** Only _bash_-created
  files get a `file_id`, and only when written into `$OUTPUT_DIR`. Since any
  deliverable has to be copied there by a bash command regardless of how it was
  originally written, an editor-created script becomes downloadable through the
  same path as everything else. Do not reconstruct editor-created files from
  tool input.

- **Attachment ownership: nullable `uploader_id` plus an `origin` column.**
  Impact is small because agent-produced attachments are _born associated_ —
  thread and message are known when the assistant message is persisted — so they
  never enter the pending state where uploader-based authorisation applies.
  Verified call sites:
  - `attachment.controller.ts` download — unaffected: `threadId` is non-null, so
    it takes the `isMember(threadId, user.id)` branch.
  - `attachment.controller.ts` delete — returns 403 instead of 409. Refusing
    deletion is correct for agent files; only the status code is wrong.
  - `chat.gateway.ts` send validation — unaffected: it only validates
    client-supplied attachment IDs.
  - `provider.ts` `associateAttachments` `WHERE uploader_id = ?` — bypassed,
    since agent files are inserted already associated.
  - `deleteOrphanAttachments` — unaffected: filters on `thread_id IS NULL` only,
    and agent files are never orphaned.

  `uploaderId` is never sent to clients (absent from `AttachmentContentPart`,
  `AttachmentInfoWire`, and all events), so no DTO or wire-format changes are
  needed.

- **Container reuse: yes, scoped per thread.** Billing does not argue against
  it. Both `web_search_20260209` and `web_fetch_20260209` are bound by default,
  and Anthropic charges nothing for code execution in any request that includes
  web search or web fetch — so under this app's defaults container time is free
  regardless. Even when it is billed, the charge is per container with a
  five-minute minimum, so a fresh container per request is the more expensive
  pattern, not the cheaper one. The real constraint is scoping: a reused
  container holds files for up to 30 days and is workspace-scoped, so it must be
  bound to exactly one thread and never shared across threads.

- **Feature flag: separate `DF_ENABLE_GENERATED_FILES`.** Code execution is also
  what powers web search and web fetch, so deployments may legitimately want
  code execution without file output.

### Phase 0 findings (probe completed 2026-08-08)

Probed against the live API with `claude-opus-5` and `code_execution_20260120`.
The probe scripts and their raw dumps have been removed; everything of lasting
value is reproduced below, including the exact block shapes needed as Phase 1
test fixtures.

- **`$OUTPUT_DIR` is the export boundary.** Files written to `/`, `/tmp`, or any
  ad-hoc directory produce `content: []` in the bash result — no file ID,
  nothing retrievable. Copying a file into `$OUTPUT_DIR` produces a populated
  `content` array. `$OUTPUT_DIR` (`/files/output/<hex>`) is regenerated for
  every tool call, so it is a hand-off point rather than storage. `$INPUT_DIR`
  is the matching location for `container_upload` inputs.
- **File IDs appear only on bash results.**
  `text_editor_code_execution_create_result` carries just `is_file_update`, as
  documented.
- **Files API metadata is a basename only.** Retrieving a generated file returns
  `{ type, id, size_bytes, created_at, filename, mime_type, downloadable }`,
  e.g. `filename: "output.png"` — no directory component. The originating path
  is therefore _not_ recoverable, which no longer matters given the
  `$OUTPUT_DIR` finding. `mime_type` and `size_bytes` are reliable and can feed
  `AttachmentContentPart` directly; generated files report `downloadable: true`.
- **Container reuse works.** Passing `container` returned the same container ID
  and files from the previous request were still present. The container ID is
  also exposed by LangChain as `additional_kwargs.container` on both the
  streaming and non-streaming paths, so Phase 4 is unblocked. Note that
  `expires_at` is a rolling value roughly an hour out; it does not report the
  30-day container lifetime, so it must not be used to decide whether a stored
  container ID is still usable.

Observed block shapes, to be used verbatim as Phase 1 fixtures:

```jsonc
// bash command that copied a file into $OUTPUT_DIR
{
  "type": "bash_code_execution_tool_result",
  "tool_use_id": "srvtoolu_…",
  "content": {
    "type": "bash_code_execution_result",
    "stdout": "…",
    "stderr": "",
    "return_code": 0,
    "content": [{ "type": "bash_code_execution_output", "file_id": "file_…" }]
  }
}

// bash command that created files anywhere else: same shape, empty content
// "content": []

// file written with the text editor sub-tool: no file ID at all
{
  "type": "text_editor_code_execution_tool_result",
  "tool_use_id": "srvtoolu_…",
  "content": {
    "type": "text_editor_code_execution_create_result",
    "is_file_update": false
  }
}
```

#### Blocker: LangChain drops code execution results when streaming

`@langchain/anthropic` surfaces `bash_code_execution_tool_result` blocks on the
non-streaming `invoke()` path (file ID reachable at
`content[i].content.content[j].file_id`) but **not** when streaming. Streamed
`content` contains only `text`, `server_tool_use`, and `input_json_delta`; the
result blocks are absent from `content`, `additional_kwargs`, and
`response_metadata` alike.

The cause is a hardcoded allowlist in the `content_block_start` handler of
`dist/utils/message_outputs.js`:

```js
["tool_use", "document", "server_tool_use", "web_search_tool_result"];
```

`bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, and
`code_execution_tool_result` are missing, so those blocks are silently
discarded. Verified identical in the latest release (1.5.4; the workspace is on
1.3.26), so upgrading does not help. The chat gateway streams every response, so
as things stand file IDs are unreachable in production regardless of the rest of
the design.

**Options (decide before Phase 1):**

1. **`pnpm patch @langchain/anthropic`** adding the three block types to the
   allowlist. Roughly a four-line change, pnpm-native, reversible. Must be
   re-verified on every upgrade, and it patches compiled `dist` output.
2. **Bypass LangChain on the streaming path**, calling `@anthropic-ai/sdk`
   directly from `agent-langchain` for streamed completions. Full fidelity and
   removes a whole class of pass-through gaps (the codebase already carries
   workarounds for LangChain streaming bugs, e.g. the `invalid_tool_calls`
   handling for LangChain #9911), but it is a substantial rewrite of the stream
   method and adds a direct SDK dependency.
3. **Upstream PR to LangChain**, with option 1 as the interim measure.

**Status: undecided, deliberately.** The choice here is entangled with a broader
question about whether LangChain earns its keep in this codebase at all (see
"Agent provider layer" below), so it is deferred to that evaluation rather than
settled in isolation. If the wider review lands later than this feature, option
1 is the cheapest way to unblock generated files on their own.

### Security constraints (non-negotiable)

- Anthropic file IDs are **workspace-scoped**: any API key in the workspace can
  read any file. They must never be sent to clients or accepted from them.
  Download server-side, re-store the bytes locally, and hand out only our own
  attachment UUIDs.
- Serve generated files exclusively through the existing
  `GET /datonfly-assistant/attachments/:id` endpoint so they inherit thread
  membership checks and the existing `Content-Disposition: attachment` header
  (no inline rendering of attacker-influenced HTML/SVG).
- Treat the filename from the Files API as untrusted: sanitise before storing,
  and keep relying on the endpoint's existing RFC 5987 encoding.
- Enforce a size cap before buffering bytes into memory, and skip oversized
  files with a note rather than failing the whole turn.

### Phase 0 — Probe the API

- [x] Probe the real API for the shape of generated-file results, the Files API
      metadata, and container reuse. Findings recorded above.
- [x] Determine the capture mechanism: none needed — `$OUTPUT_DIR` means the API
      already reports exactly the files the model chose to deliver.
- [x] Remove the throwaway probe scripts and dumps once their findings were
      documented above.
- [ ] Decide how to recover result blocks from the streaming path (see the
      blocker above).

### Phase 1 — Agent: surface generated files

- [ ] Add a provider-neutral `GeneratedFileChunk` to `AgentStreamChunk` in
      `packages/core/src/interfaces/agent.ts`, carrying an opaque provider file
      reference plus optional filename/MIME hints — no Anthropic specifics in
      `core`.
- [ ] Add an optional capability to the agent interface for fetching a generated
      file by reference (returning name, MIME type, and bytes), so the chat
      server stays provider-agnostic.
- [ ] Implement the chosen fix for the streaming blocker so
      `bash_code_execution_tool_result` blocks reach our code.
- [ ] In `packages/agent-langchain/src/agent.ts`, extract file IDs from
      `bash_code_execution_tool_result` blocks in both the streaming and
      non-streaming paths, deduplicate them, and emit `generated-file` chunks.
      No path filtering — every reported file ID is a deliberate deliverable.
- [ ] Implement the fetch side against the Files API using the
      `@anthropic-ai/sdk` client already pulled in by `@langchain/anthropic`
      (beta `files-api-2025-04-14`), with the size cap applied during download.
- [ ] Unit-test extraction against the block shapes recorded in the Phase 0
      findings: bash results with and without files, error result blocks,
      duplicate IDs, and string-typed content.

### Phase 2 — Persistence and chat server

- [ ] Migration: `ALTER COLUMN uploader_id DROP NOT NULL` on `dfa.attachment`
      and add an `origin` column (`'user'` / `'agent'`) with
      `DEFAULT 'user' NOT NULL`, which backfills existing rows automatically.
      Additive and data-preserving — no rows dropped or rewritten.
- [ ] Widen `uploader_id` to `string | null` in
      `packages/persistence-pg/src/schema.ts` and `AttachmentRecord.uploaderId`
      in `packages/core/src/interfaces/persistence.ts`; add `origin` to both.
- [ ] Add optional `threadId`, `messageId`, and `origin` to
      `SaveAttachmentOptions` so agent files can be inserted already associated,
      bypassing the pending state and its uploader-based checks.
- [ ] Reorder the two guards in the delete handler of
      `packages/chat-server/src/attachment.controller.ts` so the
      already-associated conflict is reported before the ownership check;
      otherwise agent files return 403 where 409 is correct.
- [ ] In `packages/chat-server/src/chat.gateway.ts`, collect `generated-file`
      chunks into the stream state alongside citations and opaque parts,
      download and store each file when the response completes, and append the
      resulting `AttachmentContentPart`s to the assistant message content before
      persisting.
- [ ] Apply per-message limits (count and total size) and log skipped files
      through the audit logger.
- [ ] Make sure interrupted/partial responses still persist any files already
      generated, matching the existing partial-content handling.

### Phase 3 — Client and UI

- [ ] Verify assistant-message attachment parts flow through
      `packages/chat-client` and render via the existing `AttachmentPartView`;
      fix any role-based assumptions found along the way.
- [ ] Distinguish generated files from user uploads in the UI only if the
      existing chip is genuinely ambiguous — prefer no new component.
- [ ] Add the strings needed for any new UI text to both `en` and `fi` locales.

### Phase 4 — Container reuse

- [ ] Persist the Anthropic container ID **per thread** and pass it back on
      subsequent requests, so files and REPL state survive across turns. A
      container must never be shared between threads: it retains files for up to
      30 days and is workspace-scoped.
- [ ] Handle expired/invalid containers by retrying once without the parameter.

### Phase 5 — System prompt

- [ ] Extend `buildSystemPrompt` in `packages/chat-server/src/messages.ts` to
      confirm the platform's own convention rather than invent one: files the
      model copies into `$OUTPUT_DIR` become downloadable attachments on the
      message, everything else stays in the sandbox, and it must not claim to
      have delivered a file it never exported. Keep this brief — the model
      already follows the convention unprompted.
- [ ] Keep the guidance conditional on `DF_ENABLE_GENERATED_FILES`, so a
      deployment with the feature off does not advertise it.

### Phase 6 — Configuration, docs, and tests

- [ ] Add the feature flag and any limits to `packages/backend/src/config.ts`,
      `.env.example`, `INSTALL.md`, and `ENV_MIGRATION.md` (new `DF_*` names
      only).
- [ ] Update the attachments and agent-tools bullets in `README.md` to describe
      assistant-generated files as a first-class capability.
- [ ] Add an end-to-end test covering a prompt that generates a file, asserting
      the download chip appears on the assistant message and the bytes are
      retrievable. Run only that spec file.

### Out of scope (record for later)

- Custom and MCP tools still return text only (`ITool.execute` →
  `string | Record<string, unknown>`, and `extractText` in
  `packages/agent-mcp/src/mcp-client.ts` discards non-text MCP content blocks).
  Letting those tools emit files is a separate piece of work that should reuse
  whatever transport Phase 1 establishes.

## Agent provider layer — re-evaluate LangChain

Deferred to a separate session; nothing here blocks other work. The question is
whether `@langchain/anthropic` still pays for itself, given that it abstracts a
single provider that we already use provider-specific features of.

Evidence accumulated so far, all in `packages/agent-langchain/src/agent.ts`
unless noted:

- Streamed `bash_code_execution_tool_result` blocks are silently dropped by a
  hardcoded allowlist, which blocks assistant-generated files entirely (see the
  section above). Not fixed in the latest release.
- `detectToolStatus` has to inspect `tool_call_chunks` and `invalid_tool_calls`
  in addition to `content`, working around LangChain #9911.
- Server tools are constructed as `Record<string, unknown>` and cast with
  `as ServerTool`, because the typed surface does not model them.
- Anthropic-specific concepts (compaction blocks, thinking blocks, citations,
  container IDs) are already handled by hand, so the abstraction is not
  insulating us from the provider in the places that matter.

Weigh that against what LangChain currently provides: client construction,
message/content normalisation, streaming plumbing, and the `bindTools` surface.
Decide between staying on LangChain (with patches), moving the Anthropic path
onto `@anthropic-ai/sdk` directly behind the existing `IAgent` interface, or
some split. The `IAgent` abstraction in `packages/core` is the real portability
boundary and would survive either choice.
