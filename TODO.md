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
`files-api-2025-04-14`). `packages/agent-anthropic/src/stream.ts` extracts only
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

- **Feature flag: separate `DF_ENABLE_GENERATED_FILES`, default enabled.** Code
  execution is also what powers web search and web fetch, so deployments may
  legitimately want code execution without file output. Default it to enabled
  (matching `DF_ENABLE_CODE_EXECUTION`'s `!== "false"` convention in
  `packages/backend/src/config.ts`) so the capability works out of the box, with
  an explicit opt-out for deployments that need to disable it.

- **Fetch-failure handling: bounded immediate retry, then fail-fast.** The
  download helper retries a generated-file fetch a few times with exponential
  backoff (sane defaults, e.g. 3 attempts, starting at ~500ms) before giving up.
  This stays entirely inside the existing synchronous "download and store when
  the response completes" step — no protocol or persistence changes. If all
  attempts fail, log it through the audit logger and drop that attachment; the
  assistant message still persists with its text and any files that did succeed.
  No persisted "pending" state, no retry endpoint, no UI retry button — a file
  that exhausts its retries is simply not attached. (This also means we don't
  need to know how long Anthropic's Files API keeps a generated file retrievable
  beyond the request; that question only mattered for a later/deferred-retry
  design, which was rejected — confirmed the client protocol has no mechanism to
  patch an already-completed message's content afterward, so deferred retry
  would have needed new plumbing anyway.)

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
  and files from the previous request were still present. Since the LangChain
  removal (see below), the container ID is read straight off the raw SDK
  response as `finalMessage.container`
  (`BetaMessage.container: BetaContainer | null`), and the request accepts
  `container?: BetaContainerParams | string | null` directly — no
  provider-wrapper plumbing needed. So Phase 4 is unblocked. Note that
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

#### Former blocker: LangChain dropped code execution results when streaming (resolved)

This was flagged while the agent ran on `@langchain/anthropic`: its
`content_block_start` handler used a hardcoded allowlist (`tool_use`,
`document`, `server_tool_use`, `web_search_tool_result`) that silently dropped
`bash_code_execution_tool_result`, `text_editor_code_execution_tool_result`, and
`code_execution_tool_result` blocks from streamed responses, making generated
files unreachable in production.

It is now resolved as a side effect of dropping LangChain entirely — the agent
was cut over to `packages/agent-anthropic`, calling `@anthropic-ai/sdk` directly
(see "Agent provider layer" below). `stream.ts` streams via the raw SDK client
and calls `stream.finalMessage()` to get the complete accumulated `BetaMessage`,
with no allowlist filtering: every block type, including
`bash_code_execution_tool_result`, is present in `finalMessage.content`.
`readCompactionParts` in `stream.ts` already relies on exactly this to extract
`compaction` blocks, so Phase 1 can add a sibling function that extracts
generated-file IDs the same way — no separate streaming fix is needed.

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
- [x] Recover result blocks from the streaming path — resolved for free by the
      LangChain removal (see the former-blocker note above); no separate fix
      needed.

### Phase 1 — Agent: surface generated files

- [x] Add a provider-neutral `GeneratedFileChunk` to `AgentStreamChunk` in
      `packages/core/src/interfaces/agent.ts`, carrying an opaque provider file
      reference plus optional filename/MIME hints — no Anthropic specifics in
      `core`.
- [x] Add an optional capability to the agent interface for fetching a generated
      file by reference (returning name, MIME type, and bytes), so the chat
      server stays provider-agnostic.
- [x] In `packages/agent-anthropic/src/stream.ts`, add a function alongside
      `readCompactionParts` that extracts file IDs from
      `bash_code_execution_tool_result` blocks on the completed `finalMessage`,
      deduplicates them, and emits `generated-file` chunks. No path filtering —
      every reported file ID is a deliberate deliverable.
- [x] Implement the fetch side against the Files API using the
      `@anthropic-ai/sdk` client `agent-anthropic` already depends on directly
      (beta `files-api-2025-04-14`), with the size cap applied during download
      and a bounded retry loop with exponential backoff (sane defaults, e.g. 3
      attempts starting at ~500ms) before giving up on a single file.
- [x] Unit-test extraction against the block shapes recorded in the Phase 0
      findings: bash results with and without files, error result blocks,
      duplicate IDs, and string-typed content.

Implemented in `packages/core/src/interfaces/agent.ts` (`GeneratedFileChunk`,
`GeneratedFileData`, optional `IAgentProvider.fetchGeneratedFile`),
`packages/agent-anthropic/src/stream.ts` (`readGeneratedFileChunks`, wired into
the streaming loop and deduplicated across turns), and the new
`packages/agent-anthropic/src/generated-files.ts` (`fetchGeneratedFile` against
the Files API, with the bounded-retry/size-cap behaviour and a
`maxGeneratedFileBytes` provider option).
`packages/chat-server/src/chat.gateway.ts` got a no-op case for the new chunk
type to keep the build green; the real handling is Phase 2.

### Phase 2 — Persistence and chat server

- [x] Migration: `ALTER COLUMN uploader_id DROP NOT NULL` on `dfa.attachment`
      and add an `origin` column (`'user'` / `'agent'`) with
      `DEFAULT 'user' NOT NULL`, which backfills existing rows automatically.
      Additive and data-preserving — no rows dropped or rewritten.
- [x] Widen `uploader_id` to `string | null` in
      `packages/persistence-pg/src/schema.ts` and `AttachmentRecord.uploaderId`
      in `packages/core/src/interfaces/persistence.ts`; add `origin` to both.
- [x] Add optional `threadId`, `messageId`, and `origin` to
      `SaveAttachmentOptions` so agent files can be inserted already associated,
      bypassing the pending state and its uploader-based checks.
- [x] Reorder the two guards in the delete handler of
      `packages/chat-server/src/attachment.controller.ts` so the
      already-associated conflict is reported before the ownership check;
      otherwise agent files return 403 where 409 is correct.
- [x] In `packages/chat-server/src/chat.gateway.ts`, collect `generated-file`
      chunks into the stream state alongside citations and opaque parts,
      download and store each file when the response completes, and append the
      resulting `AttachmentContentPart`s to the assistant message content before
      persisting.
- [x] Apply per-message limits (count and total size) and log skipped or failed
      files through the audit logger; a failed download is dropped, not retried,
      and does not fail the rest of the turn.
- [x] Make sure interrupted/partial responses still persist any files already
      generated, matching the existing partial-content handling.

Implemented via a new migration
(`packages/persistence-pg/src/migrations/2026-08-31M0001-attachment-origin.ts`)
and matching changes to `packages/core/src/interfaces/persistence.ts` /
`packages/persistence-pg/src/{schema,provider}.ts`. In
`packages/chat-server/src/chat.gateway.ts`, `ActiveStream.generatedFileRefs`
collects file references mid-stream; `collectGeneratedFileAttachments` downloads
them (skipping when disabled via the new optional `GENERATED_FILES_ENABLED` DI
token, default enabled, or when the agent doesn't implement
`fetchGeneratedFile`), enforcing `GENERATED_FILE_LIMITS`
(`packages/core/src/attachments/attachments.ts`) and logging skips/failures via
the audit logger; `persistGeneratedFileAttachments` then saves each as an
already-associated, `origin: "agent"` attachment. Both the normal-completion and
`interruptActiveStream` paths use the same two helpers, so partial turns keep
whatever files had already been generated. A generated file with no accompanying
text no longer trips the "empty response" guard. Attachment rows are linked via
a pre-assigned message ID (mirroring the existing client-generated-ID convention
for human messages) so the FK can be set at insert time without a separate
associate step.

### Phase 3 — Client and UI

- [x] Verify assistant-message attachment parts flow through
      `packages/chat-client` and render via the existing `AttachmentPartView`;
      fix any role-based assumptions found along the way.
- [x] Distinguish generated files from user uploads in the UI only if the
      existing chip is genuinely ambiguous — prefer no new component.
- [x] Add the strings needed for any new UI text to both `en` and `fi` locales.

Verified with no code changes needed — the pipeline was already role-agnostic
end to end:

- `useMessages.ts`'s `handleComplete`/`handleNewMessage` set `ChatMessage.parts`
  straight from the event's `content`/`event.content` array, with no filtering
  by message role.
- `MessageBubble.tsx`'s `renderPart` renders an `attachment` part identically
  regardless of role, via the existing `AttachmentPartView` (image thumbnail or
  download chip, both already using the shared `downloadAttachment` i18n key
  present in both `en` and `fi`).
- `attachmentDownloadUrl` builds the download URL from `attachmentId` alone, so
  it works the same for agent- and user-origin attachments.
- No new component is needed to distinguish origins: an assistant-generated file
  already renders inside the assistant's distinctly-styled, left-aligned bubble
  (`datonfly-message-ai`), which already visually separates it from a user's own
  uploads in their own right-aligned bubble.
- Checked two role-gated spots elsewhere in the pipeline that looked relevant
  but turned out fine as-is (not part of the client-rendering path this phase
  covers): `resolveAttachmentData` (chat-server) deliberately only resolves
  bytes for _human_ attachment parts before calling the agent, so a
  previously-generated file's bytes are never re-embedded into later prompts;
  and `assistantBlocks` (agent-anthropic) silently drops `attachment` parts on
  an `ai`-role message when replaying history to the API (`default: break`)
  rather than erroring. Neither blocks rendering, and changing either is out of
  scope here.

### Phase 4 — Container reuse

- [x] Persist the Anthropic container ID **per thread** and pass it back on
      subsequent requests, so files and REPL state survive across turns. A
      container must never be shared between threads: it retains files for up to
      30 days and is workspace-scoped.
- [x] Handle expired/invalid containers by retrying once without the parameter.

Added provider-neutral `containerId` (request option) and `ContainerChunk`
(stream output) to `packages/core/src/interfaces/agent.ts`. The container ID is
stored on the `thread` row (`agent_container_id`, migration
`2026-08-31M0002-thread-agent-container.ts`) behind two dedicated persistence
methods, `getThreadContainerId`/`setThreadContainerId`, rather than as a field
on the shared `Thread` domain type — keeping this provider-internal detail out
of anything serialized to clients. `setThreadContainerId` deliberately doesn't
bump `updated_at`, so it never reorders the user-visible thread list.

In `packages/agent-anthropic`, `buildRequest` forwards `containerId` as the
request's `container` string param; `stream.ts` reads `finalMessage.container`
once a turn completes and emits a single deduplicated `container` chunk.
Expired/invalid containers are handled with a one-shot retry: a bounded
`containerRetryAvailable` flag (mirroring the mid-stream overload retry already
in `stream.ts`) strips `container` from the request and retries the same turn
once if the failure looks like Anthropic rejecting a stale reference
(`isInvalidContainerError` in `errors.ts` — a conservative,
**unverified-against-the-live-API** heuristic: a 400 `invalid_request_error`
whose message mentions "container", to avoid masking unrelated bad requests with
a pointless retry). `chat.gateway.ts` loads the stored container ID before
calling `agent.stream`, collects a `container` chunk into `ActiveStream`
alongside the other end-of-turn state, and persists it in both the
normal-completion and interrupted paths.

Covered by new fixture-driven tests in `agent.test.ts` (`invalid-container.json`
/ `plain-text-with-container.json`): container passthrough, container-chunk
emission, the one-shot retry, and that an unrelated 400 is not retried.

### Phase 5 — System prompt

- [x] Extend `buildSystemPrompt` in `packages/chat-server/src/messages.ts` to
      confirm the platform's own convention rather than invent one: files the
      model copies into `$OUTPUT_DIR` become downloadable attachments on the
      message, everything else stays in the sandbox, and it must not claim to
      have delivered a file it never exported. Keep this brief — the model
      already follows the convention unprompted.
- [x] Keep the guidance conditional on `DF_ENABLE_GENERATED_FILES`, so a
      deployment with the feature off does not advertise it.

`buildSystemPrompt`/`threadMessagesToAgentMessages` gained an optional
`generatedFilesEnabled` parameter (default `false`), appending one short
paragraph to whichever prompt variant is in play. `chat.gateway.ts` passes its
resolved `generatedFilesEnabled` getter (the same `GENERATED_FILES_ENABLED` DI
token from Phase 2, default enabled); `title-generator.ts`'s call site is
unaffected by the new default. `DF_ENABLE_GENERATED_FILES` itself still doesn't
exist as an env var yet — that's Phase 6 — but the code path is already wired to
whatever value ends up injected there. Covered by a new
`packages/chat-server/src/messages.test.ts`.

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

## Agent provider layer — re-evaluate LangChain (resolved: dropped)

Decided and executed on `main`: `@langchain/anthropic` was dropped entirely and
replaced by `packages/agent-anthropic`, calling `@anthropic-ai/sdk` directly
behind the existing `IAgent` interface (`packages/agent-langchain` no longer
exists). The evidence below is kept for context; it is what motivated the
cutover, including the streaming blocker recorded above.

Evidence that motivated the decision, all previously in
`packages/agent-langchain/src/agent.ts`:

- Streamed `bash_code_execution_tool_result` blocks were silently dropped by a
  hardcoded allowlist, which blocked assistant-generated files entirely (see the
  resolved blocker above).
- `detectToolStatus` had to inspect `tool_call_chunks` and `invalid_tool_calls`
  in addition to `content`, working around LangChain #9911.
- Server tools were constructed as `Record<string, unknown>` and cast with
  `as ServerTool`, because the typed surface did not model them.
- Anthropic-specific concepts (compaction blocks, thinking blocks, citations,
  container IDs) were already handled by hand, so the abstraction was not
  insulating the codebase from the provider in the places that mattered.

The `IAgent` abstraction in `packages/core` remained the real portability
boundary through the cutover.
