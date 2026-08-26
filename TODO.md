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

- [x] **Offset pagination over a list that reorders while paging.** Threads are
      ordered by `updated_at DESC` and move to the top whenever they receive a
      message, so `LIMIT 20 OFFSET n` can return duplicates or silently skip
      threads when activity arrives mid-scroll. Switch to keyset (seek)
      pagination on `(updated_at, id)` — the index is already in the right
      shape. This is a correctness issue, not just performance.

      Implemented as a `(updatedAt, id)` seek cursor end-to-end:
          `ListThreadsOptions.cursor` (core), a keyset `WHERE` predicate replacing
          `OFFSET` in `PostgresPersistenceProvider.listThreads()`, a new
          `threadListQuerySchema` (`cursorUpdatedAt`/`cursorId`, required together)
          replacing the old raw `offset` query param on `GET /threads`, and
          `useThreadList`'s `fetchPage()` taking a cursor instead of an offset.

- [x] **No virtualization in the rendered list.** `ThreadListPanel` renders
      every loaded thread (`filtered.map(...)`), and `useThreadList` keeps all
      loaded pages plus any threads prepended by `thread-created` events, so DOM
      nodes and in-memory state grow without bound as the user scrolls. Add
      windowing, and/or cap what is retained in memory.

      The `thread-created` half (unbounded, background growth) is fixed below
          (capped at `maxLoadedThreads`, default 500). **Decided against** doing
          anything further for `loadMore`-driven growth: that growth is paced by
          the user's own deliberate scrolling, not background events, so it
          naturally self-limits to however far someone actually scrolls — not the
          unbounded, silent growth the other two bullets describe. A real fix would
          need an actual windowing library (e.g. `react-window`); not worth adding
          for a self-limiting case with no observed problem.

- [x] **`thread-created` grows the list without bound, independent of
      scrolling.** The handler prepends every newly created thread to `threads`
      and nothing ever evicts. A tab left open accumulates every thread the user
      creates from any device or tab, for the lifetime of the tab — **observed:
      a dev-UI tab left open during an E2E run crashed Chrome with
      out-of-memory** after the suite created ~1500 threads under the shared
      fake user. Cap or evict, and reconcile against the loaded window rather
      than growing it.

      New `UseThreadListOptions.maxLoadedThreads` (default 500). The
          `thread-created` handler now evicts the oldest loaded thread (array tail,
          since the list is sorted most-recent-first) once at capacity, and forces
          `hasMore = true` when it does, since there is now provably more history
          than what's cached. `loadMore`'s own growth is intentionally not capped
          (see above).

- [x] **`loadMore` derives its offset from `threads.length`,** which the
      unbounded `thread-created` prepending inflates, so the next page is
      fetched from the wrong offset and skips threads. Keyset pagination (above)
      removes this coupling; until then the two bugs compound.

      `loadMore` now seeks from the last-loaded thread's own `(updatedAt, id)`
          rather than counting `threads.length`, so `thread-created` prepends (or
          the new eviction above) can no longer desync it from the server's
          position.

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
