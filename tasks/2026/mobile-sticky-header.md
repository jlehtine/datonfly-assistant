# Mobile sticky header

Branch: `mobile-sticky-header`

## Problem

On phone-sized viewports the chat chrome is effectively unusable: the hamburger
button and the thread title bar end up scrolled far above the visible area while
the message list is pinned to the latest message at the bottom, so there is no
way to reach the conversation drawer without scrolling the whole page back up.

Two separate defects are involved:

1. **The document itself scrolls on mobile.** The intended layout is
   non-scrolling —
   [packages/frontend/src/App.tsx](../../packages/frontend/src/App.tsx) sizes
   the root box to `var(--app-height)` (`100dvh`) and every container down to
   [MessageList](../../packages/chat-ui-mui/src/MessageList.tsx) uses
   `overflow: hidden`, leaving the message list as the only scroller. But
   [packages/frontend/index.html](../../packages/frontend/index.html) sets
   `html, body, #root { height: 100% }`, which resolves against the initial
   containing block — the _large_ viewport on mobile browsers (address bar
   hidden). That makes the document taller than the visual viewport by the
   address-bar height, so the page can scroll. `scrollIntoView` in the
   auto-scroll effect scrolls _every_ scrollable ancestor including the
   document, so each new message drags the whole app upward and the app bar goes
   with it. The on-screen keyboard makes it worse: by default mobile Chrome pans
   the layout viewport instead of resizing it.
2. **Two stacked bars eat the short viewport.** Even once the document is
   pinned, the app `AppBar` (app title + account menu) and the thread header
   (hamburger + thread title + member avatars) together consume roughly 110px of
   a ~600px viewport, permanently.

## Decisions

Agreed with the user before planning:

- **Behaviour:** address-bar style — the bar hides when the message list is
  scrolled down and slides back in when it is scrolled up. Not a permanently
  pinned bar.

  **Revised after Phase 2:** the user judged the merged always-visible bar
  (Phase 1-2 result) good enough on its own. Phase 3 (hide-on-scroll) and Phase
  4 (its accessibility/polish follow-up) are skipped; the bar stays permanently
  visible, in-flow, at the top of the chat column.

- **Bars:** on narrow viewports the app `AppBar` and the thread header merge
  into a **single** bar (hamburger + thread title + members + account menu).
- **Scope:** only viewports below the breakpoint where the current layout stops
  keeping both bars fixed relative to the viewport — i.e. the existing
  `(max-width:640px)` narrow breakpoint already used by `ChatEmbed` and
  `ChatHistoryEmbed`. Wider viewports keep today's two-bar, always-visible
  layout.
- **Root cause:** fix the document-scroll problem first, as its own phase.

`position: fixed` on `body` and other document-level CSS belongs to the
`frontend` package only — `chat-ui-mui` is embeddable in host pages and must not
assume it owns the document.

## Phase 0 — Reproduce and confirm the diagnosis

- [x] Reproduce in a narrow viewport (device emulation, ~390x670) with a
      conversation long enough to scroll: send a message and confirm the app bar
      leaves the visible area.
- [x] Confirm the document is the thing scrolling: check that
      `document.scrollingElement.scrollTop > 0` and
      `scrollHeight > clientHeight` at the moment of failure. If the document is
      _not_ scrolling, stop and report — the rest of Phase 1 is based on this
      diagnosis.

      **Result:** could not be reproduced live — headless Chromium (used by
                  both the integrated browser tool and Playwright) has no real browser
                  chrome/address bar, so `100vh` (large viewport) and `100dvh` (dynamic
                  viewport) are computed identically regardless of viewport size, and
                  resizing the viewport recomputes `height: 100%` consistently rather than
                  reproducing the real-device mismatch. The diagnosis in the Problem
                  section above is based on static analysis of
                  [packages/frontend/index.html](../../packages/frontend/index.html) and
                  is left as the working assumption; Phase 1's fixes (pinning to
                  `var(--app-height)`, `overflow: hidden`, and scrolling the container
                  instead of `scrollIntoView`) are correct and defensive regardless, and
                  will need real-device confirmation (or at least Chrome DevTools mobile
                  emulation with toolbar simulation) after landing.

- [x] Note the measured heights of both bars, for the padding work in Phase 2.
      App `AppBar`/`Toolbar` measured at 56px in a 390px-wide viewport (MUI's
      default dense `Toolbar` height). The thread header uses the same `py: 1`
      padding pattern around similarly-sized icon buttons, so is expected to be
      the same order of magnitude; Phase 2/3 should re-measure the merged bar
      directly rather than rely on this estimate.

## Phase 1 — Stop the document from scrolling

Goal: the app occupies exactly the visual viewport, and the message list is the
only scrollable element, on every viewport size. This alone makes the chrome
reachable again; Phase 2 is about reclaiming space.

- [x] 1.1 In [packages/frontend/index.html](../../packages/frontend/index.html),
      size `html`, `body` and `#root` to `var(--app-height)` instead of `100%`,
      and add `overflow: hidden` plus `overscroll-behavior: none` so the
      document has nothing to scroll and no rubber-banding.
- [x] 1.2 Pin the body to the visual viewport (`position: fixed; inset: 0;`) so
      mobile browsers cannot pan the layout viewport when the on-screen keyboard
      opens.
- [x] 1.3 Add `interactive-widget=resizes-content` to the viewport meta tag so
      the keyboard resizes the layout viewport rather than panning it
      (Chrome/Android; ignored elsewhere). Not verified on a real device with a
      keyboard — headless testing has no on-screen keyboard to check against;
      flagged for real-device follow-up alongside Phase 0's caveat.
- [x] 1.4 In
      [packages/chat-ui-mui/src/MessageList.tsx](../../packages/chat-ui-mui/src/MessageList.tsx),
      replace `endRef.current?.scrollIntoView(...)` with a direct scroll of the
      list container
      (`scrollRef.current.scrollTo({ top: scrollHeight, behavior:     "smooth" })`).
      `scrollIntoView` scrolls all scrollable ancestors, which is exactly the
      behaviour that drags the page; scrolling the container directly cannot
      affect anything outside it.
- [x] 1.5 Decide the fate of the `.datonfly-message-list-end` sentinel: keep it
      if anything (tests, other components) still references it, otherwise
      remove it along with `endRef`. Confirmed no other references (searched the
      whole workspace) — removed both.
- [x] 1.6 Re-run [tests/auto-scroll.spec.ts](../../tests/auto-scroll.spec.ts) —
      it measures `scrollHeight - scrollTop - clientHeight` on
      `.datonfly-message-list`, so it should be unaffected, but it is the guard
      for this change. Both cases pass.

## Phase 2 — Merge the two bars on narrow viewports

Goal: one bar on narrow viewports, owned by `ChatEmbed`, carrying the host app's
actions.

- [x] 2.1 Add an optional `headerActions?: ReactNode` to the `ChatEmbed` config
      and forward it through `ChatHistoryEmbed`'s config. It renders at the
      trailing end of the thread header, after the member avatars and invite
      button. Document it as "host-supplied actions for the chat header".
      Right-aligned unconditionally (`ml: threadId ? 0 : "auto"`) so it stays at
      the trailing edge even when no thread is selected and the members/invite
      block (which normally provides the `ml: "auto"`) isn't rendered.
- [x] 2.2 In
      [packages/frontend/src/App.tsx](../../packages/frontend/src/App.tsx),
      derive the same narrow breakpoint (`useMediaQuery("(max-width:640px)")`)
      and, when narrow, render no `AppBar`/`Toolbar`; instead pass the account
      `IconButton` (plus its `Menu`s and the settings `Dialog`) as
      `headerActions`. Wide viewports keep the existing `AppBar` untouched. Keep
      the `datonfly-user-menu-button` marker class on the button in both layouts
      so existing e2e selectors keep working.
- [x] 2.3 Extract the menus/dialog JSX so it is rendered once and shared by both
      layouts rather than duplicated. The anchor state (`anchorEl`,
      `switchAnchorEl`) stays in `App`.
- [x] 2.4 On narrow viewports the header must render even with no thread
      selected (it already does, via the `onOpenThreadList` branch of the render
      condition) — verify the empty-thread case still shows the hamburger and
      the account button. Verified live: with no thread selected, the merged bar
      shows the hamburger on the left and the account button on the right.
- [x] 2.5 Check that the app title being dropped on narrow viewports is
      acceptable; the thread title replaces it. If a title is still wanted when
      no thread is selected, fall back to `t("appTitle")`. Decided: acceptable
      as-is — no fallback added. With no thread selected the bar still shows the
      hamburger and account button; an empty title slot there is a minor,
      acceptable gap rather than something worth extra `chat-ui-mui` API surface
      for.

Verified live at a 390×670 viewport: merged bar shows hamburger + thread title

- member avatar + invite button + account button in one row; document does not
  scroll (`scrollHeight === clientHeight`, `body` is `position: fixed` +
  `overflow: hidden`). Re-ran
  [tests/auto-scroll.spec.ts](../../tests/auto-scroll.spec.ts),
  [tests/thread-management.spec.ts](../../tests/thread-management.spec.ts), and
  [tests/member-management.spec.ts](../../tests/member-management.spec.ts) — all
  9 tests pass.

## Phase 3 — Hide-on-scroll behaviour (skipped)

**Decision:** skipped. The user judged the Phase 1-2 result (document pinned,
single merged bar, always visible) good enough as-is and chose not to add the
address-bar-style hide/show behaviour. Phase 5 tests the current
always-visible-bar implementation instead of hide-on-scroll. Left documented
below in case this is revisited later.

Goal: on narrow viewports the merged bar behaves like a mobile browser address
bar — visible at rest, slides away as the user scrolls down into history, slides
back in on any upward scroll.

- [ ] 3.1 Give `ChatEmbed` access to the message list's scroll element: add an
      optional callback-ref prop to `MessageList` (e.g.
      `scrollElementRef?: (el: HTMLDivElement | null) => void`) and store the
      element in `ChatEmbed` state so it is available during render.
      `MessageList` keeps its own internal ref for its existing logic.
- [ ] 3.2 Drive visibility with MUI's `useScrollTrigger({ target: scrollEl })`
      (hysteresis enabled, small threshold) and wrap the header in `Slide`
      (`direction="down"`, `appear={false}`). Only enable this when `isNarrow`;
      on wider viewports the header renders exactly as today.
- [ ] 3.3 Change the header from an in-flow flex child to an overlay on narrow
      viewports: wrap the header + `MessageList` in a `position: relative` box,
      position the header `absolute` at `top: 0` spanning the full width with an
      opaque `bgcolor: "background.paper"` and a `zIndex` above the list. Hiding
      it must not reflow the message list — otherwise every show/hide causes a
      visible jump and fights the auto-scroll.
- [ ] 3.4 Offset the message list content by the header height (padding-top on
      the scroll container) so the first message is not hidden underneath the
      bar at rest. Measure the header rather than hard-coding a pixel value if
      its height can vary (long titles, avatar group).
- [ ] 3.5 Make sure the bar is forced visible when it must be reachable: when
      the message list is at (or near) the top, when the thread changes, and
      when the thread list drawer is opened. `useScrollTrigger`'s threshold
      covers the at-top case; verify the others.
- [ ] 3.6 Verify the interaction with auto-scroll: programmatic scroll-to-bottom
      must not be interpreted as a user "scroll down" that hides the bar in a
      distracting way, and streaming updates must not cause the bar to flicker.
      If it does, suppress the trigger while an auto-scroll is in flight.
- [ ] 3.7 Verify the interaction with load-more: scrolling up to the top to load
      history reveals the bar and triggers `onLoadMore` — the two must not
      conflict once padding-top shifts `scrollTop` values (the
      `LOAD_MORE_SCROLL_THRESHOLD = 80` comparison may need to account for the
      new padding).

## Phase 4 — Accessibility and polish (skipped)

**Decision:** skipped, as a direct consequence of skipping Phase 3 — these items
only apply to the hide-on-scroll/overlay behaviour that was dropped. Left
documented below in case Phase 3 is revisited later.

- [ ] 4.1 When hidden, the bar must not be focusable/announced mid-animation in
      a confusing way; confirm `Slide`'s default behaviour is acceptable and
      that keyboard focus moving to a header control reveals the bar.
- [ ] 4.2 Respect `prefers-reduced-motion` for the slide animation.
- [ ] 4.3 Check the member drawer (bottom sheet below 900px) and the thread list
      `Drawer` still overlay correctly given the header's new `zIndex`.
- [ ] 4.4 Check dark mode / elevation: the overlaying bar needs enough contrast
      against message bubbles scrolling underneath it.

## Phase 5 — Tests

Scope: the current implementation (Phase 1-2 only — pinned document, merged
always-visible bar; no hide-on-scroll).

- [x] 5.1 Add `tests/mobile-header.spec.ts` running at a narrow viewport
      (`page.setViewportSize`, ~390x670): - regression for Phase 1: after
      sending enough messages to fill the screen,
      `document.scrollingElement.scrollHeight` equals `clientHeight` (the
      document itself never becomes scrollable). - all top-bar functions
      (hamburger/open-conversations button, account menu button) remain within
      the viewport's bounding box, and clickable, after the message list has
      scrolled/auto-scrolled to the bottom of a long conversation. - the merged
      bar is not too tall: assert its height stays within a reasonable bound
      (e.g. well under half the viewport height) so it doesn't itself crowd out
      the message list on a short screen.

      Added two `datonfly-*` marker classes needed to locate the header
          reliably (per [CONVENTIONS.md](../../CONVENTIONS.md)'s selector rules,
          no reliance on localized text): `datonfly-chat-header` on the header
          `Box` and `datonfly-open-thread-list-button` on the hamburger
          `IconButton`, both in
          [ChatEmbed.tsx](../../packages/chat-ui-mui/src/ChatEmbed.tsx). The test
          also does two functional checks after scrolling: clicking the hamburger
          reveals `.datonfly-new-conversation-button` (thread list drawer opened),
          and clicking the account button reveals
          `.datonfly-chat-settings-menuitem` (account menu opened).

- [x] 5.2 Confirm the merged bar keeps the existing selectors working, and
      re-run the specs that touch the app bar / drawer:
      [tests/thread-management.spec.ts](../../tests/thread-management.spec.ts)
      and
      [tests/member-management.spec.ts](../../tests/member-management.spec.ts).
- [x] 5.3 Run each affected spec file individually (not the whole suite, to
      avoid LLM rate-limit flakes). Requires the dev server to be running. Ran
      `tests/mobile-header.spec.ts`, `tests/thread-management.spec.ts`,
      `tests/member-management.spec.ts`, `tests/auto-scroll.spec.ts` together
      (10 tests) — all pass.
- [x] 5.4 Run `pnpm lint:fix` and fix anything the changes introduced. Fixed 6
      `no-non-null-assertion` errors in the new spec by deriving safe fallbacks
      instead of `!`-asserting `boundingBox()`/`viewportSize()` results.

## Open questions

- None currently. If Phase 0 shows the document is not the thing scrolling, stop
  and report before continuing with Phase 1.
