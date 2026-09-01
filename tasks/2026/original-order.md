# Original content ordering for assistant messages

Branch: `jlehtine/original-order`

## Goal

An assistant message's content parts are stored, streamed, and rendered in the
order the model actually produced them. Today three layers independently discard
that order:

1. `agent-anthropic/src/stream.ts` collapses **all** text of an entire
   tool-calling loop into one part (`textPartIndex ??= nextPartIndex++`), and
   defers `thinking-part`, `opaque-part`, and `generated-file` chunks until
   after the loop finishes.
2. `chat-server/src/chat.gateway.ts` rebuilds the final array as fixed buckets:
   `[...thinking, ...toolParts, ...opaqueParts, ...attachments, text]`.
3. `chat-ui-mui/src/MessageBubble.tsx` hoists **all** thinking runs into a block
   rendered above `message.parts.map(renderPart)`, so thinking is visually first
   even mid-stream when the underlying array is already correctly ordered.

## Key constraints discovered

- **A single API response can contain many `text` blocks.** `web-search.json`
  has text blocks at indices 0, 5, 6, 7, 8, 9, 10, 11 — the 6/8/10 ones carry
  `citations`. Allocating a part per text _block_ would fragment one cited
  answer into 8 separate `<Markdown>` renders, breaking paragraphs mid-sentence.
  Text runs must therefore be **merged until a visible part intervenes**.
- **Generated-file IDs are available mid-stream**, but are placed at end of turn
  anyway (D2). `code-execution-with-file.json` carries `file_id` inside the
  `content_block_start` payload for the `bash_code_execution_tool_result` block
  (index 5), followed by a text block (index 6), so exact placement _is_
  possible — it is simply not worth the extra reader. Consequence: an attachment
  lands after all the text of the turn that produced it, i.e. the mirror image
  of today's "attachment before text", which reads naturally ("here's the
  script" → file).
- **Tool-call / tool-result parts are not rendered at all** today (`renderPart`
  returns `null`), and are only delivered at `message-complete`.
- **Only text and thinking are streamed to clients at all.** `PartDeltaEvent` is
  typed `type: "text" | "thinking"`, so tool calls, tool results, attachments,
  and opaque parts have no mid-stream transport — the client's `handleDelta`
  handles two types because two types are all it can receive. This is the single
  root cause behind decisions D5–D7.

## Design

### Text-part boundary rule

`streamAgent` keeps a `currentTextPartIndex: number | null`. A text delta uses
`currentTextPartIndex ??= nextPartIndex++`. The value is reset to `null` — i.e.
the next text starts a **new** part — only when a _visible_ content part is
emitted in between:

| Event                                                         | Starts a new text part? |
| ------------------------------------------------------------- | ----------------------- |
| Another `text` block (incl. citation-split blocks)            | No                      |
| Non-empty `thinking` block claims a part index                | Yes                     |
| `tool-call` / `tool-result` yielded                           | Yes                     |
| `generated-file` yielded                                      | Yes                     |
| Empty `thinking` block (adaptive, no text)                    | No                      |
| `opaque-part` (compaction) — stripped before reaching clients | No                      |
| `status` (server-tool activity)                               | No                      |
| `container` / `replay-data` / `citations` / `usage`           | No                      |
| Overload retry continuation                                   | Yes (D3)                |

The overload-retry row is a **change of behaviour**, not just of ordering: the
mid-word continuation machinery is removed (D3), so a salvaged turn resumes as a
new text part with a plain paragraph break rather than being stitched into the
cut-off sentence.

### Ordering ownership

The provider keeps its part-index space for **text and thinking only** (as
today) but now yields every chunk in true chronological order. `chat-server`
owns the final ordered array and maps provider part index → array position. No
new fields on the tool/file chunk types.

How the client-facing index is derived: a client index is consumed only by parts
that are actually transmitted live — text, thinking, tool calls, and tool
results. Opaque parts (always stripped) and attachments (not resolvable until
the file is downloaded at completion) still occupy a slot in the server's
persisted `orderedParts` but consume no client index, so the client array never
contains a gap. `message-complete` replaces the array wholesale, so the
resulting shift is invisible.

## Phase 0 — Provider: emit in true order

- [x] 0.1 `stream.ts`: replace `textPartIndex` with `currentTextPartIndex` and
      the boundary rule above. Also reset it to `null` when an overload retry is
      scheduled, so the continuation starts its own part (D3).
- [x] 0.2 `stream.ts`: yield `thinking-part` at that block's
      `content_block_stop` instead of buffering into `thinkingParts` and
      flushing after the loop. Drop the `thinkingParts` array.
- [x] 0.3 `stream.ts`: yield `opaque-part` (compaction) as soon as
      `readCompactionParts(finalMessage)` produces it for that turn, instead of
      after the loop. Drop the `opaqueParts` array, and delete the chunk's dead
      `partIndex` field (D7) from `core/src/interfaces/agent.ts`.
- [x] 0.4 `stream.ts`: yield `generated-file` chunks where
      `readGeneratedFileChunks(finalMessage)` already runs inside the loop,
      instead of after it. Replace `deduplicateGeneratedFileChunks`'s final pass
      with an incremental `seen: Set<string>` and drop the `generatedFileChunks`
      array. No new block-level reader (D2).
- [x] 0.5 `stream.ts`: update the `streamAgent` doc comment — it currently
      states "All text collapses into a single part".
- [x] 0.6 `agent.ts` (`run()`): rebuild the accumulator to append parts in
      arrival order instead of
      `[...toolParts, ...thinkingParts,     ...opaqueParts, { text }]`.
- [x] 0.7 `stream.ts`: simplify `continuationInstruction` to a plain "your
      previous message was cut off by a service overload; continue your
      response" — drop the 120-character tail quote and the "do not repeat / no
      preamble / join seamlessly" wording (D3). Keep `buildSalvageContent`
      as-is: the salvaged text has already been streamed to the user, so it must
      still be replayed. Update the function's doc comment, which currently
      records that a generic instruction produced a garbled join — that trade is
      now accepted deliberately.

## Phase 1 — Provider contract and tests

- [x] 1.1 `testing/conformance.ts`: replaced the
      `"all text must accumulate into a single part"` assertion with
      `assertPartIndicesNeverDecrease` — text/thinking part indices (they share
      one counter) never move backwards across the stream.
- [x] 1.2 Extended the existing `web-search` conformance case: citation-split
      text blocks (8 API `text` blocks in that fixture) still merge into one
      text part.
- [x] 1.3 Added a conformance case on `code-execution-with-file`: the
      `generated-file` chunk is emitted after all of that turn's text deltas,
      and the text before/after the code-execution blocks merges into one part.
- [x] 1.4 Not added as planned (see below) — covered by conformance cases
      instead. No committed fixture has text both before _and_ after an empty
      thinking block or a compaction block (compaction always occurs before any
      answer text; the empty-thinking fixture only has text after it), so
      "doesn't split" isn't independently observable without a contrived
      fixture. The existing `thinking-adaptive` case already confirms no
      thinking-part/delta is produced; tool-call-splits and
      overload-retry-splits are covered by 1.5 and the updated overload recovery
      test in `agent.test.ts` respectively.
- [x] 1.5 Added a conformance case on `tool-loop-01/02/03`: exactly three
      distinct text part indices (`assertPartIndicesNeverDecrease` covers the
      ordering).
- [x] 1.6 `agent.test.ts`: `AnthropicAgent.run` "returns the same text the
      stream emitted" now joins all text parts instead of `.find`-ing one. Also
      updated the overload-recovery test: the continuation is asserted to start
      a new text part and the instruction text no longer quotes the salvaged
      cutoff (D3).

## Phase 2 — chat-server: ordered accumulation

- [ ] 2.1 `ActiveStream`: replace `currentText`, `thinkingPartsByIndex`,
      `toolParts`, `opaqueParts`, `generatedFileRefs`,
      `hasTextSinceToolBoundary`, `pendingToolBoundaryBreak` with
      `orderedParts: ContentPart[]`,
      `positionByProviderIndex: Map<number, number>`, and
      `generatedFileSlots: { fileRef: string; position: number }[]`.
- [ ] 2.2 `text-delta` handling: resolve the position from
      `positionByProviderIndex`, appending a new part and recording the position
      on first sight; update the part in place otherwise. Emit `part-delta` with
      `partIndex` = **array position**.
- [ ] 2.3 `tool-call` / `tool-result` / `opaque-part`: append to `orderedParts`
      at arrival.
- [ ] 2.4 `generated-file`: append a placeholder `attachment` part immediately
      and record its slot, so the file occupies its true position.
- [ ] 2.5 Delete `toolBoundarySeparator` and the `pendingToolBoundaryBreak` /
      `hasTextSinceToolBoundary` machinery — separate text parts now produce the
      paragraph break naturally.
- [ ] 2.6 Delete `orderedThinkingParts` and `attachmentPartsOf`.
- [ ] 2.7 New private helper `finalizeParts(state, downloadedFiles)`: fills each
      placeholder slot with the real attachment part, **splices out** slots for
      files dropped by the count/size limits, and returns the array. Use it from
      both the `runStream` completion path and `interruptActiveStream`, which
      currently duplicate the bucket-rebuild.
- [ ] 2.8 `assistantVisibleLength` / empty-response check: derive from the
      concatenation of all text parts in `orderedParts` instead of
      `streamState.currentText`.
- [ ] 2.9 `interruptActiveStream`: the "anything worth persisting" condition
      becomes `orderedParts.length > 0 || containerId`.

## Phase 3 — Protocol and client state

This phase delivers the _transport_ for complete parts only. Rendering tool
calls and results in the message bubble is explicitly out of scope and stays a
separate task — `renderPart` keeps returning `null` for them.

- [ ] 3.1 `core/src/events/ws-events.ts`: document `PartDeltaEvent.partIndex` as
      a position in the message's client-side content-part array, and note that
      opaque parts and attachments consume no client index.
- [ ] 3.2 `core/src/events/ws-events.ts`: add `PartAddedEvent`
      (`{ event: "part-added"; threadId; messageId; partIndex; part: ContentPart }`)
      and add it to the server→client union.
- [ ] 3.3 `chat.gateway.ts`: emit `part-added` when appending a tool-call or
      tool-result part; track the client index with a counter incremented only
      on live-transmitted appends.
- [ ] 3.4 `chat-client`: register the `part-added` handler in `useMessages.ts`
      and forward the event type through `client.ts`.
- [ ] 3.5 `chat-client/src/react/useMessages.ts` `handleDelta`: the `else`
      branch `push`es when `event.partIndex >= nextParts.length`, which
      misaligns the array whenever the gap is larger than one. Pad up to
      `event.partIndex` first. Under Option 2 this padding is only reached by a
      tab that joined mid-stream and missed earlier events, not during normal
      streaming.

## Phase 4 — Rendering

- [ ] 4.1 `MessageBubble.tsx`: delete the hoisted `thinkingRuns` block rendered
      before `message.parts.map(...)`. Replace with a single ordered pass that
      groups **contiguous** thinking parts into the existing collapsible box at
      their actual position, rendering text/attachment parts inline between them
      via `renderPart`.
- [ ] 4.2 Key thinking-run collapse state by the array index of the run's
      **first part** instead of the run ordinal, so an override does not jump to
      a different run when an earlier run appears mid-stream.
- [ ] 4.3 Keep the existing "skip runs whose combined text is blank" filter and
      the `.datonfly-message-thinking` class name (used by
      `tests/agent-capabilities.spec.ts`).

## Phase 5 — Text extraction

- [ ] 5.1 `chat-server/src/messages.ts` `extractText` joins text parts with
      `"\n"`. Multiple text parts per AI message become the norm, so switch to
      `"\n\n"` (D4). Affects search indexing (`indexMessage`) and the admin
      export (`admin.controller.ts`); human messages are single-part and
      unaffected.
- [ ] 5.2 Confirm no change needed in `agent-anthropic/src/messages.ts`
      `assistantBlocks` — it already emits one API `text` block per text part
      and `isNonEmptyBlock` filters empties, and the API accepts consecutive
      text blocks.

## Phase 6 — Tests

- [ ] 6.1 Extend `tests/agent-capabilities.spec.ts` "generated files": assert
      the `.datonfly-message-attachment` element now comes **after** the
      assistant text in DOM order. This is the observable flip — with
      `code-execution-with-file` the message renders thinking → text →
      attachment, where today it renders thinking → attachment → text.
- [x] 6.2 Fixture recorded: `test/fixtures/thinking-resumed-after-tool.json`
      (scenario also registered in `record-fixtures.ts` for reproducibility).
      Block sequence:
      `thinking(0) → text(1) → server_tool_use(2) →     code_execution_tool_result(3) → thinking(4) → text(5)`.
      Confirming/ verifying a tool result rarely reopens thinking; the prompt
      manufactures a deliberate discrepancy for the model to reconcile, which
      reliably does. Add an E2E spec asserting a `.datonfly-message-thinking`
      box appears _after_ assistant text in DOM order.
- [ ] 6.3 Run only the touched specs — full-suite runs trip LLM rate limits.
      After adding anything under `test/fixtures/`, run the whole
      `agent-anthropic` vitest suite (flat `readdir` in `loadScenarios`).

## Effect on existing conversations

No schema change and no data migration — the chronological order was already
discarded before persistence, so there is nothing to recover for historical
messages.

Old AI messages keep their bucketed `content` array and the new positional
renderer displays whatever order is stored, which for them is thinking → tools →
attachments → text. That is **visually identical to today's output**, so old
threads render unchanged while new ones render chronologically.

Replay into the model is unaffected: `threadMessagesToAgentMessages` already
scans for the _last_ text part rather than assuming one, and `assistantBlocks`
already iterates all parts in stored order.

## Decisions

Resolved:

- **D1** ✅ Text boundary rule as tabulated above: merge contiguous text, break
  only on a visible part.
- **D2** ✅ Generated files are placed at **end of turn** — move the existing
  `readGeneratedFileChunks(finalMessage)` yield earlier rather than adding a
  block-level streaming reader. Accepted consequence: the attachment follows the
  trailing text of its own turn.
- **D3** ✅ Drop the mid-word continuation logic. An overload retry starts a new
  text part and gets a plain "continue" instruction. Mid-word stitching only
  ever mattered under provider load, and is not worth the complexity.
- **D4** ✅ `extractText` joins text parts with `"\n\n"` instead of `"\n"`.
- **D7** ✅ Delete `OpaquePartChunk.partIndex`. It never reaches a client under
  any option, `chat.gateway.ts` already ignores it, and `stream.ts` fills it
  from an unrelated `opaqueParts.entries()` counter. Dead field.
- **D8** ✅ (supersedes D5 and D6) Add a `part-added` server→client event
  carrying a complete part plus its position, emitted for tool calls and tool
  results. No client-side gaps ever exist, so no placeholder-padding hack is
  needed; the residual padding in `useMessages` reverts to serving only tabs
  that joined mid-stream. Tool-call / tool-result parts stay **visually** hidden
  — this change only makes rendering them possible, and doing so is a separate
  development task (tracked in `TODO.md`).

All decisions resolved and the step 6.2 fixture is in place — ready to
implement.
