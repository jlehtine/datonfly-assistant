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
