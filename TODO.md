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

## Thread list scalability with an ever-growing history

Not tackled now — recorded while investigating E2E flakiness against a dev
database that had grown to ~1500 threads. The sidebar itself is **not** the
naive case: `useThreadList` pages 20 at a time by offset with load-on-scroll,
and the ordering is indexed (`thread_updated_at_idx (updated_at DESC, id)`), so
the initial load does not grow with history size. Two real issues remain, both
of which only bite once a user has a long history:

- [ ] **Offset pagination over a list that reorders while paging.** Threads are
      ordered by `updated_at DESC` and move to the top whenever they receive a
      message, so `LIMIT 20 OFFSET n` can return duplicates or silently skip
      threads when activity arrives mid-scroll. Switch to keyset (seek)
      pagination on `(updated_at, id)` — the index is already in the right
      shape. This is a correctness issue, not just performance.
- [ ] **No virtualization in the rendered list.** `ThreadListPanel` renders
      every loaded thread (`filtered.map(...)`), and `useThreadList` keeps all
      loaded pages plus any threads prepended by `thread-created` events, so DOM
      nodes and in-memory state grow without bound as the user scrolls. Add
      windowing, and/or cap what is retained in memory.
- [ ] **`thread-created` grows the list without bound, independent of
      scrolling.** The handler prepends every newly created thread to `threads`
      and nothing ever evicts. A tab left open accumulates every thread the user
      creates from any device or tab, for the lifetime of the tab — **observed:
      a dev-UI tab left open during an E2E run crashed Chrome with
      out-of-memory** after the suite created ~1500 threads under the shared
      fake user. Cap or evict, and reconcile against the loaded window rather
      than growing it.
- [ ] **`loadMore` derives its offset from `threads.length`,** which the
      unbounded `thread-created` prepending inflates, so the next page is
      fetched from the wrong offset and skips threads. Keyset pagination (above)
      removes this coupling; until then the two bugs compound.

Worth revisiting the message list on the same grounds: it pages history on
scroll-up and never drops what it has loaded.

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

## Persist raw provider turns for reliable multi-turn replay

**Problem.** Anthropic's server-side tools (`web_search`, `web_fetch`,
`code_execution`) return extra content blocks (`server_tool_use`,
`web_search_tool_result`, `web_fetch_tool_result`, `code_execution_tool_result`,
…) embedded in the assistant's own response. None of these are captured today:
`stream.ts` only reads them to emit a transient `"Searching the web…"` status,
and when a stored AI message is turned back into a provider request
(`assistantBlocks()`/`toolResultBlocks()` in `messages.ts`), there is no path
back for anything but `text`, client-side `tool_use`, and the `compaction`
opaque part. The entire server-tool exchange — queries and results — is silently
dropped once the turn ends, so on a later turn the model has no memory of having
searched or fetched anything and re-does the work.

**Design.** Capture the full raw provider exchange for the turn — every
assistant/user turn pushed internally during the tool-calling loop (client tool
calls, pause_turn/compaction continuations), **plus the final answer's content
array**, which today is never pushed anywhere once the loop breaks — so any
current or future Anthropic block type is preserved for replay without needing
its own mapping. `content: ContentPart[]` keeps holding the existing decomposed
parts (text, thinking, tool-call, tool-result, citations) exactly as today,
purely for rendering, search indexing, and title generation; the raw exchange is
a second, parallel representation of the same turn, duplicating data on purpose.

Store that raw exchange in a **new dedicated nullable column** rather than as an
`OpaqueContentPart` inside `content`, mirroring the existing `message.metadata`
column (already a sibling JSONB column with its own merge method,
`updateMessageMetadata()`) rather than the compaction block's approach (an
opaque part inline in `content`):

- A message-level `content` rewrite to drop old data (needed if it were bundled
  inside the `content` JSON array) means reading, filtering, and rewriting a
  whole array per row. A dedicated column turns the same cleanup into
  `UPDATE message SET provider_replay_data = NULL WHERE content_at < $1` — a
  single indexed statement, no JSON surgery, trivially cheap even at scale. This
  purge job is **not being built now** — just the column, so it's a one-line job
  whenever it's needed.
- Compaction blocks stay exactly where they are today (inline `opaque` part in
  `content`): they're small, already deployed in live threads, and not a purge
  target, so there's no reason to move them and take on a data migration for
  existing rows. The dividing line going forward: small/permanent provider
  metadata stays an inline opaque `ContentPart`; large/purgeable replay-only
  data goes in the new column. Only the new raw-turn data uses the new column.
- A `NULL` column is indistinguishable from a pre-feature row or a purged row,
  so the existing "reconstruct from decomposed parts" path automatically serves
  as the fallback for both — no special-casing needed for purge safety, it falls
  out of the design for free.

### Cross-package surface

This does reach outside `agent-anthropic`, following the same shape as the
existing `metadata` column end-to-end (small, mechanical changes per package,
not a new pattern):

- **`persistence-pg`**: new Kysely migration adding a nullable
  `provider_replay_data` jsonb column to `message` (additive, no default, no
  backfill — cheap metadata-only `ALTER TABLE` on Postgres). Add the column to
  `MessagesTable` in `schema.ts`. `provider.ts`'s `appendMessage()` writes it
  and `loadMessages()` selects/maps it, exactly like `metadata` today.
- **`core`**: `ThreadMessage` and `AppendMessageOptions` gain an optional
  `replayData?: { provider: string; data: unknown }` field alongside `metadata`.
  `AgentMessage` (in `interfaces/agent.ts`) gains the same field so chat-server
  can pass stored replay data into the provider and get it back out.
  `AgentStreamChunk` gains a new variant (e.g. `ReplayDataChunk`) distinct from
  the existing `OpaquePartChunk`, which continues to serve compaction only. None
  of this is sent to clients — no `dto`/wire-schema change needed, it's simply
  absent from `NewMessageEvent`/`MessageCompleteEvent`, which is simpler than
  today's `content.filter((p) => p.type !== "opaque")`.
- **`chat-server`**: `ActiveStream` gains a `replayData` slot set when the new
  chunk type arrives; `appendMessage()` calls forward it. `messages.ts`
  (`threadMessagesToAgentMessages`) copies `msg.replayData` onto the constructed
  `AgentMessage` for "ai" role messages.
- **`agent-anthropic`**: `stream.ts` emits the accumulated raw exchange as the
  new replay-data chunk instead of an opaque `content` part. `messages.ts`'s
  `agentMessagesToParams()` reads `message.replayData` (not a part scan) to
  decide raw-verbatim vs. decomposed-reconstruction per message.

### Implementation steps

- [x] Add the `provider_replay_data` migration + `schema.ts` column in
      `persistence-pg`, and thread it through `appendMessage()` /
      `loadMessages()`.
- [x] Add `replayData` to `ThreadMessage`, `AppendMessageOptions`, and
      `AgentMessage` in `core`; add the new `ReplayDataChunk` variant to
      `AgentStreamChunk`.
- [x] In `stream.ts`, accumulate every provider message param appended during
      the tool-calling loop (assistant content, tool-result turns, pause_turn /
      compaction replays) into an ordered array for the turn, and — the current
      gap — also push the **final** assistant message's content once the loop
      concludes with no further tool calls, since that's exactly the turn most
      likely to carry unpaired server-tool blocks. Emit the accumulated array as
      one `ReplayDataChunk`
      (`{ provider: "anthropic", data: { type: "raw-turn", turns: [...] } }`).
- [x] Wire the new chunk through `chat.gateway.ts`'s `ActiveStream` /
      `appendMessage()` call, and through `threadMessagesToAgentMessages()` in
      `chat-server/src/messages.ts`.
- [x] In `agent-anthropic/src/messages.ts`, change `agentMessagesToParams()` so
      an "ai" message with `replayData` contributes its `turns` verbatim to the
      output instead of going through `assistantBlocks()`/`toolResultBlocks()`;
      keep the decomposed-part path as the fallback for messages without one
      (pre-feature history, or a purged row). Confirm `mergeAdjacentRoles()`
      still behaves correctly when turns come from a mix of raw-sourced and
      decomposition-sourced messages.
- [x] Confirm `trimBeforeCompaction()` needs no changes: it already drops
      everything before the last compaction boundary, replay data included.
- [x] Unit tests for the new helpers and the raw-first reconstruction, including
      the fallback path for a message without `replayData`.
- [x] Extend the fixture-based tests (`web-search.json`, `web-fetch.json`,
      `code-execution.json` already exist under
      `agent-anthropic/test/fixtures/`) with a two-turn scenario: turn 1
      exercises a server tool, turn 2 is a plain follow-up — assert the outgoing
      request for turn 2 includes turn 1's server-tool blocks. Add this as a
      conformance case if it fits `CONFORMANCE_CASES`, since this is exactly the
      behavioural contract other providers should also satisfy.

      Done as regular tests in `agent.test.ts` (`AnthropicAgent raw-turn
                  replay`) rather than a `CONFORMANCE_CASES` entry: that suite's `check()`
                  only inspects the emitted chunk sequence, not a second follow-up call's
                  outgoing request, so the two-turn assertion didn't fit its shape.

- [x] Update `CONVENTIONS.md`'s "AI Agent Providers" section: describe the
      raw-turn replay-data pattern (dedicated column) as the general mechanism
      for provider fidelity, alongside the narrower inline-opaque-part mechanism
      reserved for small/permanent data like compaction, and note the
      purge-safety property so a future storage-reclamation feature doesn't have
      to re-derive it.

## Search — hybrid dense + sparse retrieval overhaul

Thread search currently performs poorly. Add a real lexical (BM25) retrieval
channel computed **in Node**, and fuse it with the existing dense channel using
weighted Reciprocal Rank Fusion inside Qdrant. Infinity and `BAAI/bge-m3` stay
exactly as they are, so this adds no containers and no meaningful resource cost.

Status: Phases 0–1 done. Phases 0–4 are the agreed scope; phases 5 and 6 are
deferred and undecided pending operational verification of phases 0–4.

### Why the current implementation underperforms

Diagnosis of `semanticSearch()` in
[packages/search-qdrant/src/qdrant-search.ts](packages/search-qdrant/src/qdrant-search.ts):

- The "hybrid" query is not hybrid. **Both** RRF prefetches use the same dense
  `queryVector`; the second merely adds a full-text _filter_. There is no
  lexical _scoring_ anywhere in the pipeline.
- Qdrant's `match: { text: ... }` requires **all** tokens to be present (AND
  semantics), so multi-word queries usually make that second prefetch empty and
  RRF degenerates to plain dense search.
- There are no sparse vectors at all, so rare tokens — names, ticket IDs, error
  codes — are effectively invisible to retrieval.
- `group_size: 1` collapses each thread to a single hit, and the snippet is a
  raw 400-character prefix produced in `thread.controller.ts` rather than the
  region that actually matched.
- Recency decay is applied app-side _after_ Qdrant already truncated to `limit`,
  so decay can never surface an older-but-better result that fell outside the
  window.
- When embedding fails, the message is not indexed at all — there is no sparse
  fallback, and the gap persists silently until a full reindex.

### Decisions (resolved)

- **Dense stays primary** (semantic, `BAAI/bge-m3` via Infinity). Sparse is
  added for names, identifiers and exact words that semantic search misses.
- **No new infrastructure.** Infinity and its model are unchanged; the sparse
  vectors are computed in Node and scored by Qdrant. Net infra change: none.
- **Languages:** Finnish and English must both work well; broader multilingual
  support is a bonus.
- **Stemmer:** `snowball-stemmers` plus `@types/snowball-stemmers` — see the
  vetting notes below.
- **No language detection.** Every configured language's stemmer runs over every
  token, at index time _and_ query time (rationale in step 1.3).
- **Full reindex is acceptable.** Postgres is the source of truth and
  `POST /datonfly-assistant/admin/reindex` already drops and rebuilds.
- **Agent search tool is out of scope** here, but `ISearchProvider` should be
  shaped so a future tool can reuse it without another interface change.

### Dependency vetting — `snowball-stemmers`

- GitHub Advisory Database: 0 advisories. Snyk: no known security issues on
  either published version.
- **Zero runtime dependencies**, so there is no transitive supply-chain surface.
  This is why it was chosen over `@nlpjs/lang-fi` / `@nlpjs/lang-en`, which pull
  in `@nlpjs/core`, ship no types, and whose newest release is a two-year-old
  alpha.
- Pure string manipulation: no I/O, no network, no `eval`. Transpiled from the
  official Java Snowball implementations.
- Ships 20+ languages (including `finnish` and `english`) in one prebuilt
  bundle.
- Licence: npm metadata says ISC, the repository `LICENSE` says BSD-3-Clause.
  Both are permissive and acceptable — record the discrepancy accurately rather
  than trusting the npm field.
- Frozen since 2016. Acceptable because the Snowball algorithms are themselves
  stable; there is nothing to keep up with.

### Qdrant capabilities this plan relies on

`docker-compose.yml` pins `qdrant/qdrant:v1.17`, which covers all of these:

- Sparse vectors with `modifier: "idf"` — server-side BM25 IDF (v1.10+).
- Weighted RRF, `query: { rrf: { k, weights: [...] } }` (v1.17).
- Formula queries with `exp_decay` over a `datetime_key` (v1.14).
- Constraint: a main query cannot be both a fusion and a formula, so the fusion
  is nested in a prefetch and the formula becomes the main query. This is only
  correct on a **single shard**, which matches the current single-node
  deployment. Revisit if the collection is ever sharded.

## Phase 0 — Interfaces and wire schema

Blocking prerequisite for every later phase.

### 0.1 Core search interfaces

- [x] In
      [packages/core/src/interfaces/search.ts](packages/core/src/interfaces/search.ts),
      add `id: string` and `highlights?: [number, number][]` to
      `SearchDocument`.
- [x] Extend `SemanticSearchOptions` with `hitsPerThread?: number`,
      `snippetChars?: number` and
      `recency?: { halfLifeDays: number; weight: number }`.
- [x] Introduce
      `SearchResultGroup { threadId: string; score: number; hits: SearchDocument[] }`
      and change the provider method to return `SearchResultGroup[]`.
- [x] Rename `ISearchProvider.semanticSearch` to `search`. The name no longer
      describes the operation now that it is hybrid, and inter-package API
      compatibility is not maintained during initial development.

      `QdrantSearchProvider.search()` still runs the old dense + text-filter RRF
          query internally (grouped by thread, `hitsPerThread` honoured via
          `group_size`) — the real sparse/formula rework is Phase 2. Updated the
          only two callers, `ThreadController.search()` and
          `SearchResultItem` in `ThreadListPanel.tsx`, to the new shape; both kept
          to their prior behaviour (app-side recency decay, single-snippet
          display) since that rework is Phase 3.

### 0.2 Wire schema

- [x] Reshape `threadSearchResultWireSchema` in
      `packages/core/src/endpoints/schemas.ts` to
      `{ threadId, title, updatedAt, score, hits: [{ messageId, createdAt, snippet, highlights, score }] }`.
- [x] Define `highlights` as `[start, end]` offset pairs **relative to the
      snippet**. Never return HTML or pre-marked text — the frontend builds the
      marks from offsets, which keeps message content from becoming an injection
      vector.

      The contract is in place (`highlights: [number, number][]`, always
          present, empty until populated); real highlight computation is Phase 2.4
          (densest-window snippet selection) and is not implemented yet — the
          controller currently always returns `[]`.

## Phase 1 — Lexical BM25 sparse channel

New module `packages/search-qdrant/src/bm25.ts`. Can be developed in parallel
with the Phase 2 design, but Phase 2 depends on it.

### 1.1 Dependencies

- [x] Add `snowball-stemmers` as a dependency and `@types/snowball-stemmers` as
      a devDependency of `packages/search-qdrant`.
- [x] ~~Import it with a **default import**~~ Verified at build and runtime: a
      **named import** (`import { newStemmer } from "snowball-stemmers"`)
      resolves and works correctly, both under `tsc`
      (`module`/`moduleResolution:     Node16`) and at runtime (Node's
      `cjs-module-lexer` picks up the UMD build's `exports.newStemmer = ...`
      assignments). No `createRequire` fallback was needed.

### 1.2 Tokenizer

- [x] Split on whitespace first and emit lowercased **identifier-like** chunks
      verbatim — those containing a digit, `_`, `-`, `.`, `/`, `@`, or mixed
      case. This keeps `ABC-1234`, `getUserById` and `user@example.com` intact,
      which is the whole point of the sparse channel.
- [x] Segment the full text with
      `Intl.Segmenter(locale, { granularity: "word" })` — built into Node,
      multilingual, no dependency — keeping word-like segments only, lowercased,
      with optional ASCII folding.

      Implemented as two independent passes over the full text (identifier
          extraction + word segmentation), so a chunk like `ABC-1234` contributes
          both the verbatim token and its sub-word segments (`abc`, `1234`) for
          extra partial-match recall. Used locale `"und"` (undetermined) for
          language-neutral generic Unicode word-boundary rules, consistent with no
          language detection. ASCII folding emits an additional folded variant
          alongside the surface form only when it differs (e.g. `café` → `café` +
          `cafe`), mirroring how stems are added as extra terms.

- [x] Do **not** build stopword lists. Qdrant's IDF modifier drives common terms
      to near-zero weight automatically.

### 1.3 Stemming without language detection

- [x] Run every configured language's stemmer over every word token, and emit
      each stem as an additional term alongside the always-present surface form.
      Neither Snowball nor this code detects language: `newStemmer(lang)` is a
      fixed rule set that will happily apply Finnish rules to English text.
- [x] **Namespace stems by language** in the hash input (`fi:kissa`, `en:cat`),
      leaving the surface form un-namespaced. Without this, two unrelated words
      could collapse to the same junk stem across languages, and because such a
      term would be rare, IDF would score the spurious match _highly_.
      Namespacing removes the risk at zero cost — same term count, different
      hash input.
- [x] Construct stemmers once and cache them per language.

Rationale for rejecting per-message detection, recorded so it is not
relitigated: chat messages are short, which is where detectors are least
reliable; mixed-language and code-heavy messages are common in this product; a
misdetection at index time silently breaks that message until a reindex; and the
query would need detection too, so any index/query mismatch breaks retrieval
outright. Emitting all variants on both sides means the two always agree.

**Verified with the real stemmer** (`bm25.test.ts`): English and Finnish
inflections of the same word do share a stem (e.g. `running`/`run`), but
consonant gradation defeats it in some Finnish cases — `Helsingissä` stems to
`helsing`, `Helsinki` to `helsink`, which do **not** match. Snowball is pure
suffix-stripping and does not model Finnish consonant gradation. This affects
the specific example given under "Snippets and highlights" in Phase 2.4 below
and the matching test case planned for 4.3 — flagged for awareness when that
phase is implemented, not fixed here.

### 1.4 Vector construction

- [x] `documentVector(tokens)` → `{ indices, values }` carrying only the BM25
      **term-frequency** component, since Qdrant supplies IDF:
      `w = tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avgLen))` with
      `k1 = 1.5`, `b = 0.75`, and `avgLen` a configurable constant (default
      `256`, matching FastEmbed's `Bm25` reference implementation).
- [x] `queryVector(tokens)` → weight `1.0` per distinct term.
- [x] Map tokens to `u32` indices with an inline 32-bit FNV-1a hash — no
      dependency. Collisions across a 2^32 space are negligible at this
      vocabulary size.

Implemented in
[packages/search-qdrant/src/bm25.ts](packages/search-qdrant/src/bm25.ts), unit
tested in `bm25.test.ts` (15 cases: identifier/camelCase/email preservation,
sub-word recall, stem namespacing, multi-language stemming, ASCII folding, hash
determinism, and the BM25 weight formula). Not yet wired into `qdrant-search.ts`
— that wiring is Phase 2.

## Phase 2 — Qdrant collection schema and hybrid query

Depends on Phase 1. All changes in
[packages/search-qdrant/src/qdrant-search.ts](packages/search-qdrant/src/qdrant-search.ts).

### 2.1 Collection schema

- [ ] Move to **named** vectors:
      `vectors: { dense: { size: 1024, distance: "Cosine" } }`. The collection
      currently uses the unnamed default vector, so this is a breaking schema
      change and is the main reason a full reindex is required.
- [ ] Add `sparse_vectors: { lexical: { modifier: "idf" } }`.
- [ ] **Drop** the `content` full-text payload index. Once real BM25 scoring
      exists nothing filters on it, and dropping it frees Qdrant memory. Keep
      `content` in the payload — snippets are generated from it.
- [ ] Keep the keyword indexes on `threadId` and `memberIds` and the datetime
      index on `createdAt` (now required by the formula query). Set
      `enable_hnsw: false` on `memberIds`, which is only ever used to filter.

### 2.2 Indexing

- [ ] Upsert both vectors as `{ vector: { dense, lexical } }` in `index()` and
      `indexBatch()`.
- [ ] On embedding failure, **still upsert the sparse vector** and log the
      degradation. Today the message is dropped entirely and is unfindable by
      any means until someone reindexes.

### 2.3 Query

- [ ] Replace the query with a nested fusion plus a formula rescore, issued via
      `queryGroups`:

      ```
          prefetch: {                       // fusion nested in a prefetch
            prefetch: [
              { query: denseVec,  using: "dense",   limit: K },
              { query: sparseVec, using: "lexical", limit: K },
            ],
            query: { rrf: { weights: [wDense, wSparse] } },
            limit: K,
          },
          query: { formula: { sum: [ "$score",
                   { mult: [ recencyWeight,
                     { exp_decay: { x: { datetime_key: "createdAt" },
                                    target: { datetime: now },
                                    scale: halfLifeDays * 86400,
                                    midpoint: 0.5 } } ] } ] } },
          filter: membershipFilter,
          group_by: "threadId", group_size: hitsPerThread, limit,
          ```

- [ ] Calibrate `recencyWeight` against RRF magnitude. RRF scores are sums of
      `1/(k + rank)` and peak near `1.0` with `k = 2`, whereas `exp_decay`
      returns `[0, 1]`; an unweighted decay term would dominate the fused score.
      Default to roughly `0.15`.
- [ ] Degrade instead of failing: if the embeddings call errors, run the query
      **sparse-only** rather than throwing. Search staying up without Infinity
      is a meaningful availability win.

### 2.4 Snippets and highlights

- [ ] Generate snippets in the provider, which owns the analyzer: reuse the
      Phase 1 tokenizer to locate the densest match window in `content`, cut
      `snippetChars` around it, and return highlight offsets relative to the
      snippet.
- [ ] Because the tokenizer is shared, Finnish inflections highlight correctly —
      a query for `Helsinki` marks `Helsingissä` in the snippet.

## Phase 3 — Server, client and UI

Depends on phases 0 and 2.

### 3.1 Server

- [ ] Delete the app-side decay, sort and dedup block from
      [packages/chat-server/src/thread.controller.ts](packages/chat-server/src/thread.controller.ts);
      Qdrant now does all of it.
- [ ] Keep the read-time `persistence.isMember` check as an ACL safety net even
      though the query filters on `memberIds`.
- [ ] Map provider groups to the new wire shape. Keep `@RateTier("search")`.
- [ ] Pass the recency half-life **and** the new recency weight through
      `packages/chat-server/src/chat.module.ts` to the provider rather than the
      controller.

### 3.2 Client and UI

- [ ] Update types in `packages/chat-client/src/search.ts` and
      `packages/chat-client/src/react/useThreadSearch.ts` — no behavioural
      change, the hook is a passthrough.
- [ ] Update `SearchResultItem` in
      [packages/chat-ui-mui/src/ThreadListPanel.tsx](packages/chat-ui-mui/src/ThreadListPanel.tsx)
      to render the first hit's snippet with mark spans built from the offsets,
      and to list the thread's remaining hits in the tooltip.
- [ ] Add `datonfly-*` marker classes for the E2E selectors.
- [ ] Keep this minimal — a broader search-UI redesign is out of scope.

## Phase 4 — Configuration, docs, tests and migration

### 4.1 Configuration

- [ ] In [packages/backend/src/config.ts](packages/backend/src/config.ts),
      replace the singular `DF_SEARCH_STEMMER_LANGUAGE` with
      `DF_SEARCH_LANGUAGES`, a comma-separated list defaulting to `english`.
- [ ] Add `DF_SEARCH_DENSE_WEIGHT` (default `1.0`), `DF_SEARCH_SPARSE_WEIGHT`
      (default `1.0`), `DF_SEARCH_RECENCY_WEIGHT` (default `0.15`) and
      `DF_SEARCH_HITS_PER_THREAD` (default `3`).
- [ ] Keep `DF_SEARCH_RECENCY_HALF_LIFE_DAYS` (default `360`), now consumed by
      the provider rather than the controller.

### 4.2 Packaging

- [ ] Add `"test": "vitest run --dir src"` and a `vitest` devDependency to
      `packages/search-qdrant/package.json`, matching the other packages.

### 4.3 Tests

- [ ] `bm25.test.ts` — identifier preservation (`ABC-1234` survives intact),
      Finnish inflections sharing a stem (`Helsingissä` / `Helsinki`), stem
      language namespacing, TF weight maths, and hash determinism.
- [ ] `snippet.test.ts` — densest-window selection and offset correctness,
      including a multi-byte/accented case.
- [ ] `tests/thread-search.spec.ts` — index a message containing a rare
      identifier, assert it is found by exact token and that the snippet
      highlights it. Run **only** this spec file; the full suite trips LLM rate
      limits.

### 4.4 Documentation and migration

- [ ] Update `.env.example`, [INSTALL.md](INSTALL.md), [README.md](README.md)
      and [ENV_MIGRATION.md](ENV_MIGRATION.md) for the new variables.
- [ ] Document in README that search degrades to sparse-only when Infinity is
      unavailable, and that the formula-plus-fusion query assumes a single
      shard.
- [ ] Migrate deployments with `POST /datonfly-assistant/admin/reindex`, which
      drops and rebuilds the collection under the new schema.

### 4.5 Operational verification

- [ ] Confirm via the Qdrant collection info endpoint that the rebuilt
      collection has both a `dense` and a `lexical` vector and that the sparse
      vector carries `modifier: idf`.
- [ ] Search for a rare identifier appearing in exactly one old message and
      confirm it ranks first. Dense-only search misses this today, so it is the
      clearest signal the overhaul worked.
- [ ] Stop the Infinity container and confirm search still returns sparse
      results instead of erroring.
- [ ] Sanity-check that recency ordering still looks reasonable now that decay
      runs inside Qdrant, and adjust `DF_SEARCH_RECENCY_WEIGHT` if recent noise
      outranks older strong matches.

## Phase 5 — Long-message chunking (deferred, undecided)

Do not start before phases 0–4 are verified in operation.

Messages become a single point truncated at 10 000 characters, so long tails are
unsearchable and BM25 length normalisation is skewed by outliers.

- [ ] Decide whether to do this at all, based on how often long messages turn up
      in real searches.
- [ ] Split long messages into overlapping chunks.
- [ ] Derive point IDs as `UUIDv5(messageId + chunkIndex)`. Qdrant point IDs
      must be a UUID or an unsigned integer, so `messageId#0` is not usable.
- [ ] Store `messageId` in the payload and convert `delete()` to a filter-based
      delete on it, since one message will map to several points.

## Phase 6 — Relevance evaluation and metering (deferred, undecided)

Do not start before phases 0–4 are verified in operation.

This overhaul introduces knobs that cannot be tuned by intuition — RRF dense and
sparse weights, recency weight and half-life, `k1` / `b` / `avgLen`, stemming on
or off, and `hitsPerThread`. Relevance also regresses quietly rather than
crashing, so a future model swap, chunking change or agent search tool could
degrade results with no visible signal.

- [ ] Decide scope after tuning the deployed system by hand, when it is clear
      which knobs actually matter.
- [ ] Build a fixture corpus with `(query, expectedMessageIds)` pairs seeded
      into a throwaway Qdrant collection, reporting recall@k and MRR.
- [ ] Add runtime metering: query latency, dense-versus-sparse contribution to
      the final ranking, and zero-result rate.
