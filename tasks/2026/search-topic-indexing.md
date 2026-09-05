# Semantic search accuracy: topic-level dense indexing

Branch: `search-topic-indexing`

## Problem

Thread search returns too many irrelevant threads and sometimes misses a thread
that clearly discusses the queried topic.

Diagnosis of the current design (`packages/search-qdrant/src/qdrant-search.ts`,
`packages/chat-server/src/chat.gateway.ts` → `indexMessage`,
`packages/chat-server/src/admin.controller.ts` → `createDocumentStream`):

1. **Every message becomes a dense point, regardless of content.** "Hello",
   "That's all, thanks", "ok" all get a 1024-dim BGE-M3 vector. Short,
   contentless texts embed into a generic region of the space and end up
   moderately close to almost any query, so they act as a noise floor.
2. **The dense unit of retrieval is a message, not a topic.** A conversation
   about a topic rarely has one message that states the topic; the semantics are
   spread across a run of messages plus the thread title. A per-message vector
   therefore under-represents exactly the thing users search for.
3. **There is no relevance cutoff anywhere.** `ThreadController.search` asks for
   `limit * 3` groups, RRF assigns every candidate a positive score
   (`1 / (k + rank)`), and no threshold is applied at any stage — so the result
   list is padded with the best of the irrelevant until `limit` is reached.
   Anything that matched at all is shown.
4. **Sparse (BM25) is fine as-is.** IDF already drives "hello"/"thanks" to
   near-zero weight, and per-message granularity is exactly right for exact
   words, names and identifiers.

## Approach

Split the two channels by granularity instead of running both over the same
per-message documents:

- **Lexical channel — unchanged.** Per-message points, sparse `lexical` vector
  only, still the way to find an exact word, name or identifier and to link to
  the precise message.
- **Dense channel — moves to LLM-generated thread topics.** One dense point per
  topic, plus a thread card (title + topic list), replacing per-message dense
  vectors entirely.

Both kinds live in the **same Qdrant collection**, distinguished by a `kind`
payload field, with each point carrying only the vector its channel uses (Qdrant
already accepts points with a subset of the named vectors — the existing
sparse-only fallback relies on it). The dense prefetch then only ever sees topic
points and the sparse prefetch only ever sees message points; RRF fuses the two
rankings and `group_by: threadId` merges them per thread exactly as today. No
change to the overall query shape.

This addresses (1) — a bare "Hello" no longer has a dense vector of its own —
and (2) — the dense unit is now an explicit statement of what the thread is
about, in the vocabulary a user searches with rather than the vocabulary the
conversation happened to use.

### Key decisions

- **Topics, not message segments.** The dense channel could instead index
  overlapping runs of contiguous messages. Both aim at the same queries, but
  segments cost far more machinery (open/closed segment tracking, per-message
  debounced re-embedding, dirty rebuilds on edit, delete and rename, a
  delete-by-filter provider API, deterministic segment ids, and a per-thread
  restructuring of the admin reindex stream). Topics need a delete-and-reinsert
  cycle anyway, and being persisted in Postgres they reindex straight from a
  table. See _Alternatives considered_ for what this gives up.
- **Title and topics come from a single request.** They are the same task at two
  granularities, so one call returns `{ title, topics }`. This halves the number
  of context-sized requests, keeps the two consistent, and gives the model the
  summarisation task whole rather than twice in isolation. `generateTitle` is
  replaced outright by `generateThreadSummary`.
- **That request runs on the main model against the live prompt cache.**
  Summarisation is only ever triggered immediately after an assistant response,
  so the cache the turn just wrote is still hot. Phase 2 covers the mechanism,
  the economics, and the several ways to accidentally invalidate it.
- **Cadence follows the existing title-generation pattern** (power-of-two
  message counts, plus an elapsed-time gate), and generation stays
  fire-and-forget: on model failure nothing is written and the previous values
  stand.
- **Small-talk threads produce no topics.** The request asks for a `topics` list
  and an empty list is an explicitly documented valid answer for greetings and
  acknowledgements. A typed empty list expresses "nothing to report" natively,
  so there is no placeholder-string convention and no sentinel to pattern-match.
- **Topic hits display as thread title + topic description.** They are
  thread-level match explanations, not links to a particular message.

## Phase 0 — Measurement baseline

Nothing here can be tuned without a before/after comparison; RRF scores are not
interpretable in isolation.

- [ ] 0.1 Add a dev-only CLI in `search-qdrant` (`src/bin/search-eval.ts`) that
      runs a list of queries against a live Qdrant + Infinity and prints, per
      query, the top-k threads with **per-channel** detail: dense rank + cosine
      score, sparse rank + BM25 score, fused rank, and the matched text.
- [ ] 0.2 Support a query file (`queries.jsonl`: `{ q, expectThreadIds? }`) so a
      run is repeatable, and print recall@k / MRR when expectations are given.
- [ ] 0.3 Capture a baseline run against the current index on the test
      deployment; commit the query file (not the results) and note the baseline
      numbers in this file.
- [ ] 0.4 Record the observed dense cosine score distribution for good vs. junk
      hits — this is what sets the Phase 1 threshold.

## Phase 1 — Relevance cutoff and channel weighting

Cheap, no schema change, independently shippable, and worth landing on its own
before any indexing change.

- [ ] 1.1 Add `score_threshold` to the dense prefetch in
      `QdrantSearchProvider.search`, sourced from a new
      `QdrantSearchConfig.denseScoreThreshold` (cosine, BGE-M3 — expect
      something in the 0.4–0.6 range, start from 0.4). Verify Qdrant accepts
      `score_threshold` inside a `prefetch` entry in the version in use.
- [ ] 1.2 Add the equivalent optional threshold for the sparse prefetch
      (`sparseScoreThreshold`); BM25 scores are unbounded so this defaults to
      off.
- [ ] 1.3 Plumb both through `createQdrantSearch` options and
      `packages/backend/src/config.ts` as `DF_SEARCH_DENSE_SCORE_THRESHOLD` /
      `DF_SEARCH_SPARSE_SCORE_THRESHOLD`.
- [ ] 1.4 Stop over-fetching blindly in `ThreadController.search`: the
      `limit * 3` is there to survive the read-time membership re-check, but it
      also means a short result list is always padded. Keep the over-fetch, but
      return only the groups that survived the threshold rather than filling to
      `limit`.
- [ ] 1.5 Re-run the Phase 0 eval; record before/after here.

## Phase 2 — Thread summary generation

One request per summarisation, on the main model, reading the prompt cache the
conversation turn just wrote, with the instruction appended as a trailing user
message.

**The cache is reliably hot.** `maybeGenerateTitle` has exactly one call site —
`chat.gateway.ts:799`, fired immediately after an assistant response — and the
elapsed-time condition is a _gate_ evaluated at that moment, not a timer that
fires independently. Every generation therefore happens seconds after a
main-model turn on the same thread, inside the 5-minute TTL. No cadence runs
cold.

**The uncached delta is one message wide.** `DEFAULT_CACHE_TAIL_MESSAGES = 1`,
so the turn's breakpoint sits at `messages.length - 2` and everything before it
is cached. The summary request is that same prefix plus the last message, the
new assistant reply, and the instruction — three messages at base rate, the rest
read from cache.

Cost for a 50 K-token thread with a ~2 K-token uncached delta, with one request
returning both title and topics:

| Path                                                            | Input cost                               |
| --------------------------------------------------------------- | ---------------------------------------- |
| Opus 5, cache read $0.50 + delta at base $5                     | 48 K × $0.50/M + 2 K × $5/M = **$0.034** |
| Haiku 4.5 at base $1/MTok, two separate calls                   | 2 × 50 K × $1/M = **$0.100**             |
| Opus 5 if the request re-writes the cache instead of reading it | 48 K × $6.25/M = **$0.300**              |

So the cache-aligned main model is roughly a third the cost of a cheap model on
two stripped-down calls — while seeing the _real_ context (tool results,
thinking blocks, attachments) instead of a flattened text rendering. The only
way this goes wrong is row three, and every item in 2.1 exists to prevent it.

### 2.1 Cache alignment

Anthropic's cache invalidation table follows the hierarchy `tools` → `system` →
`messages`, and a change at one level invalidates that level and everything
after it. The conversation prefix lives in `messages`, the last and most
expensive level, so anything that invalidates message blocks costs the whole
saving.

- [ ] 2.1.1 Build the summary request through the **same request builder** as a
      normal turn — same system prompt, same tool definitions, same message
      construction. Any parallel simplified builder will drift out of prefix
      alignment and silently land in the $0.300 row.
- [ ] 2.1.2 **Pin the breakpoint to the turn's boundary.** Anthropic only tests
      for a cache hit at a `cache_control` breakpoint, so the breakpoint cannot
      be omitted — but `applyCacheBreakpoints` computes it as
      `messages.length - tail - 1`, and the summary request is two messages
      longer, which would move the boundary forward and bill the delta as cache
      _creation_ instead of reading the existing entry. Place it at the same
      absolute index the turn used, so the call reads and refreshes (both billed
      at the $0.50 hit rate) and creates nothing.
- [ ] 2.1.3 **Do not touch `tool_choice`.** The invalidation table lists **Tool
      choice** as tools ✓, system ✓, **messages ✘** — "changes to `tool_choice`
      parameter only affect message blocks". Forced tool use, which would
      otherwise be the natural way to get a typed result, is therefore
      incompatible with reading the turn's cache. Leave `tool_choice` at its
      default on every request.
- [ ] 2.1.4 **Match the thinking configuration and effort exactly.** **Thinking
      parameters** and **Effort setting** sit in the same ✘ column for message
      blocks: the configuration is rendered into the prompt, so changing it
      always invalidates. The instinct to save money by disabling thinking for a
      background call would cost far more than it saves. Carry
      `DF_ANTHROPIC_THINKING_TYPE`, `THINKING_EFFORT` and any
      `output_config.effort` through unchanged. (Setting effort explicitly to
      the model's default is equivalent to omitting it, so either is fine as
      long as both requests agree.)
- [ ] 2.1.5 **Verify structured outputs (`output_config.format`) — the preferred
      mechanism for a typed result.** The table covers `output_config.effort`
      but says nothing about `format`, and unlisted is not the same as safe, so
      check empirically against `cache_read_input_tokens`. Confirm at the same
      time that `format` coexists with the `tools` array the turn already
      carries, and that the SDK version and `requiredBetas` in
      `packages/agent-anthropic/src/config.ts` support it. If it is
      cache-neutral, use it: a guaranteed schema, no tool, no parsing.
- [ ] 2.1.6 **Fallback if `format` invalidates:** declare a
      `record_thread_summary` tool in the standard tool set so the `tools` array
      stays byte-identical on every request, invoke it by instruction (never by
      `tool_choice`), and parse a line-formatted text reply when the model
      answers instead of calling it — first non-empty line is the title, each
      subsequent non-empty line is one topic, leading list markers stripped.
      That format cannot hard-fail, and a mangled result costs one thread's
      indexing quality until the next regeneration. Only build this branch if
      2.1.5 rules structured outputs out; it carries an executable tool, ~100
      cached tokens on every request, and occasional unprompted invocation.
- [ ] 2.1.7 Watch for the attachment trap: `threadMessagesToAgentMessages` skips
      loading attachment bytes on the title path precisely because they were
      never needed. A cache-aligned request must include them to match the
      prefix, which reintroduces blob loading for a background call. Measure
      whether it matters before optimising it away.
- [ ] 2.1.8 Instrument regardless of branch: log `cache_read_input_tokens` and
      `cache_creation_input_tokens` on every summary call, and audit-log loudly
      if creation tokens are non-trivial — that is the signal that prefix
      alignment has broken and costs have jumped ~10×.
- [ ] 2.1.9 Handle the TTL edge case: the lifetime is measured from the
      **start** of the request that wrote the entry, not the end of its
      response, so a turn that streams for four minutes leaves about one minute
      for the summary call to hit, and long agentic turns can exceed the window
      outright. Either accept the occasional miss or use the already-supported
      `cacheTtl: "1h"`; 2.1.8's instrumentation shows how often it actually
      bites.
- [ ] 2.1.10 Short threads are not cached at all — the minimum cacheable prompt
      is 512 tokens on Opus 5, and below it nothing is cached and no error is
      raised. Those calls bill at base rate, negligible because the thread is by
      definition tiny, but the instrumentation must not mistake them for broken
      alignment (both cache fields read 0).
- [ ] 2.1.11 The summary call runs outside the thread lock (`void`-dispatched
      after `releaseThreadLock`), so it can overlap the next turn. Both read the
      same prefix and neither writes, so there is no interference — confirm with
      a test that two concurrent requests against one thread produce no cache
      creation.

### 2.2 Provider API and prompt

- [ ] 2.2.1 Replace `IAgentProvider.generateTitle` with
      `generateThreadSummary(messages, threadId)` returning
      `{ title: string; topics: string[] }`.
- [ ] 2.2.2 Instruct explicitly that an **empty** `topics` list is the correct
      answer when the conversation contains only greetings, small talk or
      acknowledgements and has no substantive subject yet.
- [ ] 2.2.3 Cap the number of topics (start: 5) and their length (start: ~100
      chars each) in both the instruction and the post-processing, and drop
      empty or whitespace-only entries.
- [ ] 2.2.4 Do not set `temperature` — newer Claude models reject the parameter
      outright.
- [ ] 2.2.5 Update the fixture recording harness: `SCENARIOS` in
      `packages/agent-anthropic/src/fixtures/record-fixtures.ts` carries a
      `call: "shouldRespond" | "generateTitle"` field that must follow the
      rename, and recorded `generateTitle` fixtures need re-recording.

### 2.3 Persistence

- [ ] 2.3.1 New `thread_topic` table (`id`, `threadId`, `topic`, `ordinal`,
      `generatedAt`, `generatedAtMessageCount`) via a data-preserving migration
      under `packages/persistence-pg/src/migrations/`, following the existing
      `YYYY-MM-DDM000N-label.ts` naming. Cascade-delete with the thread.
- [ ] 2.3.2 Add `listTopics(threadId)` / `replaceTopics(threadId, topics)` to
      `IPersistenceProvider`; replacement is a single transaction so a thread
      never has a partially-updated topic set. Persisting topics keeps a full
      reindex free of LLM calls and lets the UI show topic text without a Qdrant
      round trip.

### 2.4 Trigger and application

- [ ] 2.4.1 Trigger from the existing fire-and-forget slot
      (`chat.gateway.ts:799`), on the existing power-of-two + elapsed-time
      cadence, skipping threads whose message count has not moved since
      `generatedAtMessageCount`. Rename `ThreadTitleGenerator` to a
      thread-summarisation component rather than adding a second scheduler, so
      one trigger evaluation covers both outputs.
- [ ] 2.4.2 Apply the two halves independently: a thread with `titleManuallySet`
      keeps its title but still stores the returned topics. Always request both
      and discard what must not be applied, rather than branching the request.
- [ ] 2.4.3 On model or parse failure, log an audit event and leave both the
      previous title and the previous topics in place — atomic in both
      directions. Never propagate; summarisation must not affect messaging.
- [ ] 2.4.4 Keep the existing re-check before write (the user may have renamed
      the thread while the model was running) and add the equivalent staleness
      re-check for topics.

### 2.5 Cheap-model fallback path

`DF_AGENT_TITLE_MODEL` stays supported for deployments that would rather not
spend main-model tokens on background work. That path cannot reuse the cache, so
it rebuilds the request from a stripped text rendering and has to decide its own
windowing.

This is also where the last-20-message window gets fixed.
`ThreadTitleGenerator.maybeGenerateTitle` loads all messages and then keeps only
`TITLE_MESSAGE_WINDOW = 20` (`packages/chat-server/src/title-generator.ts`), so
a long thread gets a title describing its tail rather than its subject — which
also caps the value of the title prefix on topic vectors (3.1.2). The
cache-aligned path has no such problem: it carries exactly the messages the turn
carried, which _is_ the full compacted history.

- [ ] 2.5.1 `DF_AGENT_TITLE_MODEL` unset → cache-aligned main model (default);
      set → that model on the stripped text rendering.
- [ ] 2.5.2 Replace the last-20 window with the full history, trimmed at the
      newest provider compaction boundary. `trimBeforeCompaction` in
      `packages/agent-anthropic/src/messages.ts` already does this for the main
      streaming path; verify it is reachable/appropriate here and that
      `agentMessagesToParams` accepts a compaction block as the leading content.
- [ ] 2.5.3 Keep a safety cap (character budget, not message count) so a very
      long uncompacted thread cannot blow up the request, dropping from the
      **middle** rather than the start — the opening messages are the most
      title-relevant part.
- [ ] 2.5.4 `threadMessagesToAgentMessages` must preserve the opaque compaction
      part for this to work; check and test.
- [ ] 2.5.5 Unit tests covering both paths: compacted thread, long uncompacted
      thread (middle-drop), short thread, manually-set title (topics stored,
      title untouched), and model failure leaving both prior values intact.

## Phase 3 — Dense channel over generated topics

### 3.1 Indexing

- [ ] 3.1.1 Extend the payload with `kind: "message" | "topic" | "thread-card"`
      and add a keyword payload index on `kind` in `ensureCollection`.
- [ ] 3.1.2 Index one dense point per topic. Embedded text is the thread title
      plus the topic (`"<title>\n<topic>"`) so the title contributes context to
      every topic vector. Payload carries the raw `topic` for display, plus
      `threadId`, `memberIds` and `createdAt` (= the thread's `updatedAt` at
      generation time, so the existing recency formula keeps working).
- [ ] 3.1.3 Index one `thread-card` point per thread: title plus all topics
      joined. This catches queries describing the thread as a whole rather than
      any single topic, and gives threads with zero topics (small talk, or
      generation not yet run) a title-based dense representation.
- [ ] 3.1.4 Deterministic point ids so regeneration upserts in place: Qdrant ids
      must be UUID or uint, so derive a UUIDv5 (sha1-based, ~10 lines, no new
      dependency) from `threadId` + ordinal for topics and from `threadId` for
      the thread card.
- [ ] 3.1.5 Regeneration replaces the whole topic set, so stale points must go.
      Add `deleteByFilter(collection, filter)` to `ISearchProvider` and delete
      `threadId = X AND kind = "topic"` before upserting the new set — `delete`
      by id alone cannot express this.
- [ ] 3.1.6 Stop generating a dense vector for `kind: "message"` points — index
      them sparse-only. This is the change that removes the "Hello" noise.
- [ ] 3.1.7 `indexBatch` and `index` must not force a dense embedding for
      sparse-only documents: extend `IndexDocumentOptions` with an explicit
      `channels: { dense: boolean; sparse: boolean }` rather than inferring it
      from content.
- [ ] 3.1.8 Refresh the thread card, and re-embed topics (whose text is
      title-prefixed), when the title changes — manual rename or auto-generated.
- [ ] 3.1.9 `updateThreadMembers` filters by `threadId` only, so topic points
      pick up ACL changes unchanged — confirm with a test.
- [ ] 3.1.10 Config flag `DF_SEARCH_TOPIC_INDEXING`, default **on**. When
      disabled, fall back to today's per-message dense indexing, so a deployment
      that does not want background LLM calls keeps a working dense channel
      rather than silently degrading to sparse-only.

### 3.2 Reindex path

- [ ] 3.2.1 `AdminController.createDocumentStream` keeps its per-message stream
      (now sparse-only) and gains a second pass over `thread_topic` emitting
      topic and thread-card documents. No per-thread grouping of the message
      stream is needed.
- [ ] 3.2.2 Add an admin action to (re)generate topics for threads that have
      none — a backfill for existing threads, rate-limited and resumable, since
      it costs one LLM call per thread. Separate from the reindex action, which
      must stay LLM-free.

### 3.3 Read path and UI

- [ ] 3.3.1 `ThreadController.search`: topic and thread-card hits have no
      `messageId`. Return them with `kind` set and `messageId` null, carrying
      the topic text; message hits keep their current shape.
- [ ] 3.3.2 `chat-ui-mui`: render a topic hit as the thread title with the
      matched topic description beneath it; message hits keep the current
      snippet-with-highlights treatment.
- [ ] 3.3.3 `selectSnippet` is built for query-term highlighting, and a
      dense-only topic match may have no lexical overlap at all. Verify it
      degrades to a sensible leading excerpt, or bypass it for topic hits (topic
      text is short enough to show whole).
- [ ] 3.3.4 Re-run the Phase 0 eval; record before/after here.
- [ ] 3.3.5 Update `tests/thread-search.spec.ts` for the changed result shape,
      and add a case whose relevant content is spread across several messages
      with no single message stating the topic — the "misses a clearly matching
      topic" complaint, as a regression test.

## Phase 4 — Documentation

- [ ] 4.1 Update the `@datonfly-assistant/search-qdrant` section of
      [README.md](../../README.md): dense = generated topics + thread cards,
      sparse = messages, point kinds, thresholds.
- [ ] 4.2 Document the new `DF_SEARCH_*` and `DF_SEARCH_TOPIC_INDEXING` vars in
      [INSTALL.md](../../INSTALL.md).
- [ ] 4.3 Note in the README that deploying Phase 3 requires both a full admin
      reindex (existing per-message dense vectors are stale) and the 3.2.2 topic
      backfill for existing threads.

## Alternatives considered

Kept because the reasoning constrains future changes, not as a change log.

- **Per-segment dense indexing (overlapping runs of contiguous messages).**
  Displaced by topics on complexity grounds (see _Key decisions_). What it gives
  up: segments are deterministic, always current, and free of LLM cost, whereas
  topics lag the conversation until the next cadence trigger and depend on a
  model call succeeding. The lag is small — the power-of-two cadence fires at
  message counts 2, 4, 8, 16, so young threads are covered quickly — and sparse
  retrieval covers a thread's newest content meanwhile. Reconsider only if
  evaluation shows topics are too lossy for detail-level queries; a segment hit
  would then be anchored to the first message of its span.
- **Thread title + conversation tail as one per-thread point.** Kept in spirit
  as the thread card (3.1.3), but built from title + topics rather than a raw
  tail, which would miss anything discussed earlier in a long thread.
- **Dropping short messages from the index entirely.** Rejected: they still
  carry exact-match value (a bare name, a pasted error code), and BM25's IDF
  already neutralises genuine filler. Only their _dense_ vector goes away.
- **A placeholder string ("NO_TOPICS") for small-talk threads.** Unnecessary — a
  typed empty list says "nothing to report" natively and cannot be confused with
  a real topic.
- **Forced tool use for the structured result.** The natural choice, rejected on
  documented evidence (2.1.3): a `tool_choice` change invalidates message
  blocks, which is the entire cached conversation. Structured outputs (2.1.5)
  recover the same guarantee without the invalidation.
- **Modelling summarisation as a tool when structured outputs are available.**
  Once `tool_choice` is off the table, a tool's only advantage over structured
  outputs is that a user could ask "summarise this conversation" and have the
  result persisted and indexed. That is a separate feature with its own surface
  (an executable tool, a write path reachable from inside the agent loop,
  tool-result rendering, unprompted-invocation risk) and should not ride along
  on this work. Raise it as its own TODO.md entry if wanted.
- **JSON in the reply text.** Considered as the fallback format and rejected in
  favour of a line-oriented one (2.1.6): truncated or lightly malformed JSON
  yields nothing, whereas "title on the first line, one topic per line after"
  still parses into something usable.
- **Separate title and topic requests.** Merged into one call: two would double
  the number of context-sized requests for no benefit and let the title and the
  topic list drift apart, despite being the same summarisation at two
  granularities.
- **A cheap model (Haiku/Sonnet) as the default summariser.** Displaced by the
  cache-aligned main model, which is both cheaper per generation and better
  informed. Retained as the `DF_AGENT_TITLE_MODEL` escape hatch (2.5).
- **Cross-encoder reranking of the fused top-k.** Out of scope — the standard
  next lever, but it needs another model served next to Infinity and should only
  be considered if Phases 1–3 fall short.
