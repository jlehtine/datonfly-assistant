]633;E;cat /tmp/ours.md;d0f4781b-7608-451c-8083-e725ebaaac2f]633;C# TODO

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

## Search — hybrid dense + sparse retrieval overhaul

Thread search currently performs poorly. Add a real lexical (BM25) retrieval
channel computed **in Node**, and fuse it with the existing dense channel using
weighted Reciprocal Rank Fusion inside Qdrant. Infinity and `BAAI/bge-m3` stay
exactly as they are, so this adds no containers and no meaningful resource cost.

Status: Phases 0–4 done. Phases 0–4 are the agreed scope; Phase 5 is decided
against (see below); Phase 6 is deferred and undecided.

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

- [x] Move to **named** vectors:
      `vectors: { dense: { size: 1024, distance: "Cosine" } }`. The collection
      currently uses the unnamed default vector, so this is a breaking schema
      change and is the main reason a full reindex is required.
- [x] Add `sparse_vectors: { lexical: { modifier: "idf" } }`.
- [x] **Drop** the `content` full-text payload index. Once real BM25 scoring
      exists nothing filters on it, and dropping it frees Qdrant memory. Keep
      `content` in the payload — snippets are generated from it.
- [x] Keep the keyword indexes on `threadId` and `memberIds` and the datetime
      index on `createdAt` (now required by the formula query). Set
      `enable_hnsw: false` on `memberIds`, which is only ever used to filter.

      Verified against a live Qdrant v1.17 instance: `getCollection()` reports
                              `vectors.dense` (1024, Cosine) and `sparse_vectors.lexical` with
                              `modifier: "idf"`.

### 2.2 Indexing

- [x] Upsert both vectors as `{ vector: { dense, lexical } }` in `index()` and
      `indexBatch()`.
- [x] On embedding failure, **still upsert the sparse vector** and log the
      degradation. Today the message is dropped entirely and is unfindable by
      any means until someone reindexes.

      `indexBatch()`'s `skipped` counter now only counts genuinely-empty
                              documents (filtered before chunking); a dense-embedding failure inside
                              the chunk loop no longer increments it, since the document ends up
                              indexed (sparse-only), not skipped.

### 2.3 Query

- [x] Replace the query with a nested fusion plus a formula rescore, issued via
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

                              The formula rescore only applies when the caller passes `options.recency`
                              — no caller does yet (that's Phase 3), so today's query is always the
                              plain fused (or single-source, degraded) form. `wDense`/`wSparse` are
                              fixed `1.0`/`1.0` constants for now (`DENSE_WEIGHT`/`SPARSE_WEIGHT` in
                              `qdrant-search.ts`); Phase 4 makes them configurable, it does not need to
                              introduce the fields themselves.

- [x] Calibrate `recencyWeight` against RRF magnitude. RRF scores are sums of
      `1/(k + rank)` and peak near `1.0` with `k = 2`, whereas `exp_decay`
      returns `[0, 1]`; an unweighted decay term would dominate the fused score.
      Default to roughly `0.15`.

      Verified live: a same-instant document scored `1.0 + 0.15 * 1.0 = 1.15`
                              with `weight: 0.15`, confirming the formula composes as intended; `0.15`
                              is not hardcoded anywhere since `recency` is a per-call option, but this
                              confirms it's a reasonable default for Phase 4 to wire up.

- [x] Degrade instead of failing: if the embeddings call errors, run the query
      **sparse-only** rather than throwing. Search staying up without Infinity
      is a meaningful availability win.

### 2.4 Snippets and highlights

- [x] Generate snippets in the provider, which owns the analyzer: reuse the
      Phase 1 tokenizer to locate the densest match window in `content`, cut
      `snippetChars` around it, and return highlight offsets relative to the
      snippet.

      New `packages/search-qdrant/src/snippet.ts` (`selectSnippet()`), unit
                              tested in `snippet.test.ts` (7 cases: no-match fallback, short-content
                              passthrough, exact-word offset, stemmed-inflection match, densest-window
                              selection, ellipsis + offset correctness, and an accented/ASCII-folded
                              case). Wired into `QdrantSearchProvider.search()`; `ThreadController`
                              updated to stop re-truncating `pageContent` and pass the provider's
                              snippet/highlights straight through.

- [x] Because the tokenizer is shared, Finnish inflections highlight correctly —
      a query for `Helsinki` marks `Helsingissä` in the snippet.

      **Not true with the real stemmer** — see the Phase 1.3 note above
                              (`helsingissä`/`helsinki` stem to `helsing`/`helsink`, not the same
                              value, because Snowball doesn't model Finnish consonant gradation).
                              Highlighting still works correctly for cases that _do_ share a stem or
                              surface form (verified live with `TICKET-4291` and `getUserById`); this
                              specific cross-inflection example just doesn't hold for Finnish.

Verified end-to-end against a live Qdrant v1.17 + Infinity instance (temporary
script, deleted after use): indexing three messages, then searching for a rare
identifier (`TICKET-4291`), a camelCase identifier (`getUserById`), and a
semantic-only query (`what's the weather like`) each correctly ranked the
matching thread first, with correct highlight offsets in all three cases.

## Phase 3 — Server, client and UI

Depends on phases 0 and 2.

### 3.1 Server

- [x] Delete the app-side decay, sort and dedup block from
      [packages/chat-server/src/thread.controller.ts](packages/chat-server/src/thread.controller.ts);
      Qdrant now does all of it.
- [x] Keep the read-time `persistence.isMember` check as an ACL safety net even
      though the query filters on `memberIds`.
- [x] Map provider groups to the new wire shape. Keep `@RateTier("search")`.
- [x] Pass the recency half-life **and** the new recency weight through
      `packages/chat-server/src/chat.module.ts` to the provider rather than the
      controller.

      New `SEARCH_RECENCY_WEIGHT` DI token (default `0.15`, matching the Phase
                          2.3 calibration) alongside the existing `SEARCH_RECENCY_HALF_LIFE_DAYS`;
                          both are read once in the controller constructor and passed as
                          `options.recency` on every `search()` call. `hitsPerThread` is a fixed
                          `HITS_PER_THREAD = 3` constant in the controller for now — Phase 4 makes
                          it configurable via `DF_SEARCH_HITS_PER_THREAD`, this just needed a
                          concrete value so the "remaining hits" tooltip (3.2) has something to
                          show.

### 3.2 Client and UI

- [x] Update types in `packages/chat-client/src/search.ts` and
      `packages/chat-client/src/react/useThreadSearch.ts` — no behavioural
      change, the hook is a passthrough.

      No changes needed: both already relayed `ThreadSearchResultWire`
                          opaquely and compiled clean against the Phase 0 reshape without edits.

- [x] Update `SearchResultItem` in
      [packages/chat-ui-mui/src/ThreadListPanel.tsx](packages/chat-ui-mui/src/ThreadListPanel.tsx)
      to render the first hit's snippet with mark spans built from the offsets,
      and to list the thread's remaining hits in the tooltip.

      New `HighlightedSnippet` helper renders `[start, end)` offsets as
                          `<mark>` spans around plain-text children (never raw HTML/`dangerouslySetInnerHTML`,
                          so message content can't inject markup). Compact row shows the first
                          hit only (CSS `nowrap`/ellipsis, no client-side re-slicing since that
                          would invalidate the server-computed offsets); the tooltip shows the
                          first hit in full plus every other hit below a divider.

- [x] Add `datonfly-*` marker classes for the E2E selectors.

      `datonfly-search-result-item`, `datonfly-search-result-snippet`,
                          `datonfly-search-result-highlight` (on each `<mark>`),
                          `datonfly-search-result-tooltip`, `datonfly-search-result-other-hit`.

- [x] Keep this minimal — a broader search-UI redesign is out of scope.

Verified against the running dev stack (`pnpm dev` + Qdrant/Infinity): the
existing dev deployment's `messages` collection still had the pre-Phase-2
unnamed-vector schema, so the first live search 500'd with
`Wrong input: Not existing vector name error: dense` — expected per the Phase
4.4 migration note, not a Phase 3 defect. Reindexed via a one-off script
equivalent to `admin/reindex` (admin auth isn't configured in this dev env),
then confirmed in the browser: searching surfaced the matching thread with the
query term correctly wrapped in a `<mark>` in the rendered snippet, and clicking
it navigated to the thread as expected.

## Phase 4 — Configuration, docs, tests and migration

### 4.1 Configuration

- [x] In [packages/backend/src/config.ts](packages/backend/src/config.ts),
      replace the singular `DF_SEARCH_STEMMER_LANGUAGE` with
      `DF_SEARCH_LANGUAGES`, a comma-separated list defaulting to `english`.
- [x] Add `DF_SEARCH_DENSE_WEIGHT` (default `1.0`), `DF_SEARCH_SPARSE_WEIGHT`
      (default `1.0`), `DF_SEARCH_RECENCY_WEIGHT` (default `0.15`) and
      `DF_SEARCH_HITS_PER_THREAD` (default `3`).
- [x] Keep `DF_SEARCH_RECENCY_HALF_LIFE_DAYS` (default `360`), now consumed by
      the provider rather than the controller.

      `QdrantSearchConfig`/`QdrantSearchOptions` gained `languages: string[]`
                      (replacing `stemmerLanguage`), `denseWeight`/`sparseWeight`; `chat-server`
                      gained a `SEARCH_HITS_PER_THREAD` DI token alongside the existing
                      recency tokens. All defaults live where the value is consumed
                      (`QdrantSearchProvider`/`ChatModule.forRoot`), so `config.ts` only
                      returns `undefined` when unset. 7 new `config.test.ts` cases cover the
                      parsing (list splitting, weight validation, defaults).

### 4.2 Packaging

- [x] Add `"test": "vitest run --dir src"` and a `vitest` devDependency to
      `packages/search-qdrant/package.json`, matching the other packages.

      Already done in Phase 1, alongside adding `bm25.ts` itself.

### 4.3 Tests

- [x] `bm25.test.ts` — identifier preservation (`ABC-1234` survives intact),
      Finnish inflections sharing a stem (`Helsingissä` / `Helsinki`), stem
      language namespacing, TF weight maths, and hash determinism.

      Already done in Phase 1 (15 cases). The Finnish/English cross-inflection
                      example doesn't hold with the real stemmer (consonant gradation, noted
                      there); the test instead covers `running`/`run` sharing a stem, which
                      does.

- [x] `snippet.test.ts` — densest-window selection and offset correctness,
      including a multi-byte/accented case.

      Already done in Phase 2 (7 cases).

- [x] `tests/thread-search.spec.ts` — index a message containing a rare
      identifier, assert it is found by exact token and that the snippet
      highlights it. Run **only** this spec file; the full suite trips LLM rate
      limits.

      Sends a message containing a generated `TICKET-<digits>` identifier and
                      waits for the human message bubble — indexing fires on send, so there's
                      no need to wait for (or fixture) an AI reply. Retries the search query
                      (`toPass`) since indexing is async, then asserts a result containing the
                      identifier appears with at least one `<mark>` highlight whose text is a
                      substring of it (the hyphen splits it into separate word segments, so
                      it highlights as two spans, not one covering the whole token — matches
                      live behaviour observed in Phase 3). Verified passing twice in a row
                      against the live dev stack.

### 4.4 Documentation and migration

- [x] Update `.env.example`, [INSTALL.md](INSTALL.md), [README.md](README.md)
      and [ENV_MIGRATION.md](ENV_MIGRATION.md) for the new variables.

      `INSTALL.md` had no search-specific variables to update. Added
                      `DF_SEARCH_STEMMER_LANGUAGE` to `ENV_MIGRATION.md`'s removed-variables
                      table (superseded by `DF_SEARCH_LANGUAGES`) with an explanation of the
                      behavioural difference (list vs. single value, defaults to `english`
                      instead of disabling stemming). Also corrected `.env.example`'s stemmer
                      language list, which listed `greek` (not actually supported) and was
                      missing `armenian`/`basque`/`catalan`/`czech`/`irish`/`slovene`.

- [x] Document in README that search degrades to sparse-only when Infinity is
      unavailable, and that the formula-plus-fusion query assumes a single
      shard.

      `@datonfly-assistant/search-qdrant` had no README section at all before
                      this — added one under "Libraries", alongside the degrade and
                      single-shard notes.

- [x] Migrate deployments with `POST /datonfly-assistant/admin/reindex`, which
      drops and rebuilds the collection under the new schema.

      Done for this dev deployment in Phase 3 (script) and again for real via
                      the actual endpoint once the user enabled `DF_ADMIN_SECRET`/`DF_ADMIN_IPS`
                      for localhost and restarted.

### 4.5 Operational verification

- [x] Confirm via the Qdrant collection info endpoint that the rebuilt
      collection has both a `dense` and a `lexical` vector and that the sparse
      vector carries `modifier: idf`.
- [x] Search for a rare identifier appearing in exactly one old message and
      confirm it ranks first. Dense-only search misses this today, so it is the
      clearest signal the overhaul worked.

      Both verified live in Phase 2/3 and now covered by `thread-search.spec.ts`.

- [x] Stop the Infinity container and confirm search still returns sparse
      results instead of erroring.

      Verified live: stopped Infinity via `docker compose stop infinity`,
                  queried `/threads/search` — still 200s with correct sparse-only results
                  (raw BM25-style scores like `4.559`, not fused RRF), no errors. Restarted
                  Infinity afterwards.

- [x] Sanity-check that recency ordering still looks reasonable now that decay
      runs inside Qdrant, and adjust `DF_SEARCH_RECENCY_WEIGHT` if recent noise
      outranks older strong matches.

      Manually verified against a deployment with a real spread of message
          ages — ordering looks reasonable with the default weight (`0.15`), no
          adjustment made. Revisit if later usage surfaces cases where recent
          noise outranks older strong matches.

## Phase 5 — Long-message chunking (decided against, closed)

Do not start before phases 0–4 are verified in operation.

Messages become a single point truncated at 10 000 characters, so long tails are
unsearchable and BM25 length normalisation is skewed by outliers.

- [x] Decide whether to do this at all, based on how often long messages turn up
      in real searches.

      Measured directly against the `message` table (count of messages whose
          concatenated text content exceeds 10 000 characters, vs. all messages):
          one production-like test environment showed 6/1155 (0.519%), another
          near-production environment showed 10/1749 (0.572%). With long messages
          this rare, chunking's added complexity (multi-point IDs, filter-based
          delete, payload changes) isn't justified now. **Decided against** —
          revisit if usage patterns shift materially (e.g. a feature that
          encourages much longer messages).

- [ ] ~~Split long messages into overlapping chunks.~~
- [ ] ~~Derive point IDs as `UUIDv5(messageId + chunkIndex)`. Qdrant point IDs
      must be a UUID or an unsigned integer, so `messageId#0` is not usable.~~
- [ ] ~~Store `messageId` in the payload and convert `delete()` to a
      filter-based delete on it, since one message will map to several points.~~

## Phase 6 — Runtime metering (relevance evaluation skipped for now)

Do not start before phases 0–4 are verified in operation.

This overhaul introduces knobs that cannot be tuned by intuition — RRF dense and
sparse weights, recency weight and half-life, `k1` / `b` / `avgLen`, stemming on
or off, and `hitsPerThread`. Relevance also regresses quietly rather than
crashing, so a future model swap, chunking change or agent search tool could
degrade results with no visible signal.

- [x] Decide scope after tuning the deployed system by hand, when it is clear
      which knobs actually matter.

      **Decided:** skip the fixture-corpus relevance evaluation (recall@k/MRR)
          for now — it needs a curated `(query, expectedMessageIds)` corpus that
          doesn't exist yet and there's no signal it's needed. Keep runtime
          metering in scope, since it's cheap (structured logging, no new infra)
          and is the only way future regressions would be noticed at all.

- [ ] ~~Build a fixture corpus with `(query, expectedMessageIds)` pairs seeded
      into a throwaway Qdrant collection, reporting recall@k and MRR.~~

### 6.1 Runtime metering — plan

No new infrastructure: no metrics DB, no Prometheus/Loki — `docker-compose.yml`
has neither today. Metering is one structured JSON log line per search call via
the logging that already exists (`ProviderLogger` in `search-qdrant`, pino via
`AuditLogger` in `chat-server`), landing wherever the deployment already ships
its stdout logs. Offline analysis reads those logs (e.g. `jq`) rather than
querying a live metrics backend — acceptable at current search volume.

Two log points, because the data each needs is only available at that layer:

- [x] In `QdrantSearchProvider.search()`
      ([packages/search-qdrant/src/qdrant-search.ts](packages/search-qdrant/src/qdrant-search.ts)),
      time the embedding call and the `queryGroups` call separately and log one
      `info` line via the existing `this.logger` on completion: `collection`,
      `mode` (`"hybrid"` | `"sparse-only"` — the latter when dense embedding
      failed, matching the existing degrade log), `embedLatencyMs`,
      `qdrantLatencyMs`, `elapsedMs`, `groupCount`, `hitCount`. **Not** the
      weights/half-life — those are deployment config, not per-query data, and
      are already visible from the env vars in place at the time. **Not** a
      separate `zeroResult` flag either — it's `groupCount === 0`, negligible to
      derive from the count later. **Not** `queryLength`/`queryTermCount` either
      — neither meaningfully explains latency variance: ANN search cost is
      dominated by collection size and the fixed query shape, and embedding
      latency is dominated by fixed per-request overhead, not input length at
      the sizes a search box produces. **Never log the raw query text** — chat
      content is private.
- [x] In `ThreadController.search()`
      ([packages/chat-server/src/thread.controller.ts](packages/chat-server/src/thread.controller.ts)),
      add an `auditLogger.audit("info", "thread.search", {...})` call with
      request-level numbers the provider can't see: `elapsedMs` (including the
      per-result ACL check and title enrichment loop), `resultCount` (after the
      ACL safety-net filter, i.e. what the user actually saw), and
      `requestedLimit`. This is the more meaningful "zero-result rate" since it
      reflects the post-ACL count, not Qdrant's raw group count. Reuse the
      existing `elapsedMs` field (already used by `admin.reindex.complete`)
      rather than inventing a differently-named duplicate.
- [x] Add the new fields to the `AuditData` interface in
      [packages/chat-server/src/audit-logger.ts](packages/chat-server/src/audit-logger.ts)
      (`resultCount`, `requestedLimit` — `elapsedMs` already existed) rather
      than passing untyped extras.
- [x] Scope note: "dense-versus-sparse contribution" is logged as `mode`
      (whether the dense channel participated at all), not per-result score
      attribution — computing true per-hit contribution would mean issuing the
      dense and sparse prefetches as separate queries to compare against the
      fused result, doubling query cost for a metric nobody has asked for yet.
      Revisit only if `mode` proves too coarse in practice.
- [x] No sampling — log every search call. Current volume doesn't warrant it;
      revisit if log volume becomes a problem.

Implemented as planned: `QdrantSearchProvider.search()` logs
`embedLatencyMs`/`qdrantLatencyMs`/`elapsedMs`/`mode`/`groupCount`/`hitCount`
via its existing `this.logger.info()`; `ThreadController.search()` logs
`elapsedMs`/`resultCount`/`requestedLimit` via
`auditLogger.audit("info", "thread.search", {...})` — reusing `elapsedMs` rather
than the originally-planned `totalLatencyMs`, since `AuditData` already had that
field (used by `admin.reindex.complete`) with the same meaning. `queryLength`/
`queryTermCount` were considered and dropped: neither correlates meaningfully
with latency (ANN cost scales with collection size, not query text; embedding
latency is dominated by fixed per-request overhead at search-box input sizes),
so they'd add noise without answering a real question. `pnpm lint:fix` and the
`search-qdrant`/`chat-server` unit tests pass.
