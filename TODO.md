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

Compaction has **never been observed working in this application**. The
`compaction-01` / `compaction-02` fixtures prove the wire protocol, but no live
thread has produced a compaction block: the development database contains none,
and `pauseAfterCompaction` defaults to off, so the API compacts internally and
returns nothing to persist. Every later request then resends the full history to
be compacted again, which is the opposite of the intended saving.

This has to be settled before step 2 removes the fallback path.

- [ ] Decide whether production sets `pauseAfterCompaction`. It is what makes
      the stored `OpaqueContentPart` round-trip engage at all, at the cost of
      one extra round trip on the compacting turn.
- [ ] Verify on a live thread that crosses the trigger: block returned,
      persisted as an opaque part, and `trimBeforeCompaction()` shortening the
      next request.
- [ ] Verify prompt-cache effectiveness against the live API via
      `cache_read_input_tokens`. Cache creation and compaction interact — a
      blanket cache breakpoint previously starved the input-token trigger
      entirely — so confirm both work together rather than separately.

### 2. Remove the in-app compaction path

`CompactionService` (303 LOC) is instantiated on every gateway init and can
never fire: it runs only when `capabilities.compaction === "external"`, which no
provider reports. Duplicating a capability the provider already offers is not
worth carrying, and a future provider without compaction would be better served
by a provider-common implementation than by the current gateway-welded one.

Low data risk: the development database holds zero compacted messages and zero
compaction summaries, so nothing is stranded. Git history preserves the
implementation.

- [ ] Delete `packages/chat-server/src/compaction.ts` and its wiring in
      `chat.gateway.ts`.
- [ ] Narrow `AgentCapabilities.compaction` to `"provider" | "none"`.
- [ ] Remove `excludeCompacted` / `excludeCompactionSummaries` from
      `IPersistenceProvider` and `persistence-pg`, and the `compacted` /
      `compactionSummary` metadata conventions from `chat-server`
      (`messages.ts`, `thread.controller.ts`, `audit-logger.ts`).
- [ ] Leave the `metadata` column itself alone — it carries usage metrics and
      citations too.

### 3. Refactor title generation into the provider API

`GenerateTitleFn = (messages) => Promise<string>` is a bare function type wired
through its own path in `main.ts`, constructing a **second** Anthropic client
that knows nothing of the agent's betas, caching, or configuration. Folding it
into `IAgentProvider` lets each provider pick its own best strategy and deletes
a parallel wiring path.

- [ ] Move title generation onto `IAgentProvider`, replacing the injected
      `GENERATE_TITLE_FN` provider and the separate client construction.
- [ ] Keep `DF_AGENT_TITLE_MODEL` meaningful: a provider may still choose a
      cheaper model, but the choice becomes its own rather than the composition
      root's.
- [ ] Cover title generation and triage with fixture-backed tests. Neither has a
      recorded fixture yet; both are non-streaming calls, so they need their own
      captures.

**Not worth doing as part of this:** generating titles with the main model to
reuse its prompt cache. It cannot work as currently structured — the title
request sends no system prompt, no tools, and only the last 20 messages, so the
prefix diverges at the first block and nothing is cached. Even restructured, a
cache read at ~0.1x base input only beats a dedicated cheap model when the price
ratio between them is under 10x, which is false for an Opus-class main model.
Revisit only if the main model becomes Sonnet-class, and only after this
refactor makes it expressible.

### Other open items

- [ ] Handle mid-stream `overloaded_error` (a 529 delivered inside an already
      open SSE stream, which SDK-level retries do not cover).
- [ ] E2E coverage for reasoning, provider-side compaction, and server-side
      tools. Nothing exercises these end to end; they are covered only by
      fixture replay. The obstacle is that the suite shares a single assistant
      configuration, so a spec cannot ask for reasoning without imposing it on
      every other spec — options include a per-test configuration override, a
      second backend instance, or grouping configuration-sensitive specs into
      their own Playwright project.
