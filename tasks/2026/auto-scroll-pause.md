# Pausing auto-scroll while the user reads

Branch: `auto-scroll-pause`

## Problem

[MessageList](../../packages/chat-ui-mui/src/MessageList.tsx) unconditionally
scrolls its container to the bottom on every append, every streaming content
update, while the thinking indicator is shown, and once more when streaming
ends. During a long streamed answer the view therefore races ahead and the user
cannot read anything above the last few lines — scrolling up is immediately
undone by the next streaming chunk.

## Goal

Standard chat behaviour: auto-scroll ("stick to bottom") is the default, but
scrolling **up** (away from the bottom) suspends it. It resumes when the user
scrolls back to within a small distance of the bottom, clicks a "jump to bottom"
affordance, or sends a message of their own.

## Design decisions

**Where the state lives.** Entirely inside `MessageList`; no new props are
required for the core behaviour, so `ChatEmbed`/`ChatHistoryEmbed` need no
changes beyond what section 3 adds. Keep the logic in `MessageList.tsx` rather
than extracting a hook — it is used in exactly one place.

**Distinguishing user scrolling from our own scrolling** is the crux. A purely
position-based rule ("`scroll` event fired far from the bottom → unstick")
breaks because `scrollTo({ behavior: "smooth" })` emits `scroll` events at every
intermediate position, which would unstick us immediately during our own
animation. Approach:

- **Unstick on user intent, not on position**: listen for `wheel` and
  `touchmove` on the container and unstick when the gesture is directed upwards
  (`event.deltaY < 0` for wheel; track the previous `touchstart`/ `touchmove` Y
  for touch). Intent events are never synthesised by our own `scrollTo`, so they
  are unambiguous. Dropped `keydown` (PageUp/ArrowUp/Home): those keys only
  scroll the container natively if it holds focus, which it normally doesn't
  (focus stays in the composer), so the handler would rarely fire — not worth
  the added complexity of making the list focusable.
- **Re-stick on position**: in the existing `scroll` handler, when the container
  is within `STICK_TO_BOTTOM_THRESHOLD` of the bottom, set stuck again. This is
  safe to run during our own animation because it only ever _enables_ the
  behaviour we are already performing.
- **Cancel the in-flight smooth scroll when unsticking**, otherwise the running
  animation fights the user's wheel for a few hundred milliseconds. Re-issuing
  `el.scrollTo({ top: el.scrollTop, behavior: "auto" })` retargets it at the
  current position, which stops it (the `el.scrollTop = el.scrollTop` self-jump
  trick works too but trips the `no-self-assign` lint rule).

**Threshold.** `STICK_TO_BOTTOM_THRESHOLD = 64` px, next to the existing
`LOAD_MORE_SCROLL_THRESHOLD`. Must stay above the ~30 px tolerance used by the
e2e helper `isScrolledToBottom` so the two never disagree.

**Stuck flag is a ref, not state** — it is read inside the scroll effect and
must not re-run effects or re-render on every wheel tick. A separate
`showJumpToBottom` state (mirroring `!stuck`) drives the button and is updated
only on transitions.

**Interaction with history loading.** Scrolling up to the top already triggers
`onLoadMore`; unsticking happens first (the user scrolled up), so prepended
history no longer causes a fight with auto-scroll. Confirm the prepend does not
change `scrollTop` enough to land within the bottom threshold on short threads —
if a thread is short enough that top and bottom are within 64 px, sticking is
the correct outcome anyway.

**Thread switching / own messages.** Re-stick unconditionally when the last
message is authored by the current user (`useCurrentUserId` is already imported)
and when the message list is replaced wholesale (thread change — detect via the
first message's id changing, or a shrinking list). Opening a thread must always
land at the bottom, as the existing e2e test asserts.

## Phase 0 — Behaviour

- [x] 0.1 Add `STICK_TO_BOTTOM_THRESHOLD` and a `stickToBottomRef` (default
      `true`) to `MessageList`.
- [x] 0.2 Guard the existing auto-scroll effect with `stickToBottomRef.current`.
- [x] 0.3 Add the intent listeners (`wheel`, `touchstart`/`touchmove`) that
      unstick on upward movement and cancel the in-flight smooth scroll. Dropped
      `keydown`: PageUp/ArrowUp/Home only scroll the container natively if it
      holds focus, which it normally doesn't (focus stays in the composer), so
      it's not worth making the list focusable for it.
- [x] 0.4 Extend the existing `scroll` listener to re-stick when within the
      bottom threshold. Note that the current listener is only attached when
      `hasMore && onLoadMore` — it must now be attached unconditionally, with
      the load-more call kept behind those conditions.
- [x] 0.5 Re-stick when the newest message is from the current user, and when
      the thread's message list is replaced (detected via a shrink to a shorter
      length — confirmed that's how `useMessages` clears state on thread switch
      in `packages/chat-client/src/react/useMessages.ts`).

No visible UI change yet — `showJumpToBottom` state is introduced in Phase 1
alongside the button that reads it. Verified via the existing suite
(`tests/auto-scroll.spec.ts`), which exercises the default sticky path.

## Phase 1 — Affordance

- [x] 1.1 Render a "jump to bottom" button (MUI `Fab`, `size="small"`,
      `KeyboardArrowDownIcon`) absolutely positioned at the bottom-right of the
      list, visible only while unstuck. Implemented by wrapping the scrollable
      `Box` in an outer `position: relative` flex column `Box`, with the `Fab`
      as its sibling — keeps `datonfly-message-list` on the actual scroll
      container unchanged.
- [x] 1.2 Clicking it re-sticks and scrolls to the bottom.
- [x] 1.3 Give it the class `datonfly-scroll-to-bottom` for e2e selection, plus
      an `aria-label`.
- [x] 1.4 Add the `scrollToBottom` string to
      [en.ts](../../packages/chat-ui-mui/src/i18n/locales/en.ts) and
      [fi.ts](../../packages/chat-ui-mui/src/i18n/locales/fi.ts) under the
      `MessageList` section.
- [ ] 1.5 Optional, decide during review: badge the button when new messages
      arrived while unstuck.

Verified manually against the running dev server: with enough messages to
overflow, scrolling up shows the button and holds position; sending a message
while unstuck re-sticks and returns to the bottom, hiding the button again. On a
thread barely taller than the viewport, scrolling to the top already lands
within the 64px bottom threshold, so it correctly never unsticks — matches the
design note above. `pnpm lint:fix` and the existing `tests/auto-scroll.spec.ts`
both still pass.

## Phase 2 — Tests

Extend [tests/auto-scroll.spec.ts](../../tests/auto-scroll.spec.ts); the
existing two tests must keep passing unchanged (they are the regression guard
for the default sticky behaviour). New cases:

- [ ] 2.1 During a streaming reply, `mouse.wheel(0, -300)` over the message list
      suspends auto-scroll: the container stays away from the bottom until the
      reply completes.
- [ ] 2.2 The jump-to-bottom button becomes visible while suspended and hidden
      again once back at the bottom.
- [ ] 2.3 Clicking the button returns to the bottom and resumes auto-scroll for
      the next message.
- [ ] 2.4 Manually scrolling back to the bottom (without the button) also
      resumes auto-scroll.
- [ ] 2.5 Sending a message while suspended jumps back to the bottom.

Run only this spec: `pnpm exec playwright test tests/auto-scroll.spec.ts` (dev
server must already be running).

## Phase 3 — Wrap-up

- [ ] 3.1 `pnpm lint:fix` and fix anything the change introduced.
- [ ] 3.2 Update the `MessageList` doc comment, which currently claims it
      "Automatically scrolls to the bottom whenever the message list or
      streaming state changes".
