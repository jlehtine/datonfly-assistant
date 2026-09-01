# TODO

## How to use this file

`TODO.md` is a high-level list of unresolved issues and planned features for
this repository — things worth remembering that have not yet been resolved or
implemented. It is not permanent documentation, and it does not hold detailed,
step-by-step execution plans.

**Structure.** Each item is a `##` section with a short label prefix (typically
`Unresolved: <summary>` for known problems or `Future: <summary>` for planned
work) followed by prose describing the issue, what's been established so far,
and any relevant context or rationale. Keep entries readable as a list to scan,
not as a sequenced plan.

**Detailed plans.** Once an entry moves from idea to active development with a
concrete, sequenced plan, that plan lives in its own file under `tasks/<year>/`,
linked from the entry here.

**Cleanup.** Entries stay until the issue is resolved or the feature is
implemented, and are then removed once any durable facts in them have been
migrated into the permanent docs ([README.md](README.md),
[CONVENTIONS.md](CONVENTIONS.md), and related files). Nothing of lasting value
should be lost when an entry is removed.

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

## Future: custom and MCP tools cannot emit files

Custom and MCP tools still return text only (`ITool.execute` →
`string | Record<string, unknown>`, and `extractText` in
`packages/agent-mcp/src/mcp-client.ts` discards non-text MCP content blocks).
Letting those tools emit files is a separate piece of work that should reuse the
transport built for assistant-generated files: `GeneratedFileChunk` /
`IAgentProvider.fetchGeneratedFile` in `core`, and
`packages/agent-anthropic/src/generated-files.ts` for the download side.

## Future: tool calls and results are never shown to the user

`renderPart` in `packages/chat-ui-mui/src/MessageBubble.tsx` returns `null` for
`tool-call` and `tool-result` parts, so tool activity is invisible beyond the
transient status indicator. The parts are persisted in true chronological order
and delivered to the client live via the `part-added` event, positioned
correctly among the text and thinking parts. What remains is purely a UI design
and rendering task: deciding how a call and its result are presented (collapsed
by default, argument and result formatting, error styling) and implementing it.
