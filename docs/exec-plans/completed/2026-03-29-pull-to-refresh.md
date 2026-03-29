# Pull-to-refresh gesture with animated emoji for mobile/PWA

**Date:** 2026-03-29
**Status:** Complete (2026-03-29)

---

## Goal

Give mobile/PWA users a native-feeling way to trigger a data sync by pulling down on list views, with a playful animated emoji cycling during the gesture.

---

## Scope

- A `PullToRefresh` Svelte component that:
  - Detects `touchstart` / `touchmove` / `touchend` events on list-view containers (My Day route and list route)
  - Renders an animated indicator that cycles through a set of emojis proportional to pull distance
  - Triggers the existing sync mechanism on release past a configurable pull threshold
  - Dismisses the indicator automatically on sync completion or failure
- An accessible non-gesture refresh path (e.g., a visible "Refresh" button or equivalent ARIA-labelled action) so the feature is discoverable without touch
- Offline-first behavior: if the app is offline when the gesture fires, the animation still plays, the sync is attempted, and any failure is handled silently
- Unit tests for gesture threshold logic and emoji-cycling behavior
- E2E smoke test covering: pull down -> indicator appears -> release past threshold -> sync triggered -> indicator dismisses

---

## Out of scope

- Mouse / desktop pointer support (gesture is touch-only; desktop users get existing sync mechanisms)
- User-configurable emoji sets (emoji list is hardcoded in this iteration)
- Native app wrapping or OS-level pull-to-refresh integration
- New sync protocol or server-side changes -- the gesture calls the existing sync path
- Per-list vs. global sync distinction (fires global sync as today's manual sync does)

---

## Constraints

1. **Performance budget** -- The gesture handler must not cause jank. Touch event handlers must stay under 16 ms per frame. The animation must be CSS-driven (transform/opacity transitions), not JS animation loops. No layout-thrashing reads inside `touchmove`.
2. **Scroll non-interference** -- The gesture may only activate when the scroll position is at the very top of the container (`scrollTop === 0`). Normal downward scroll must not trigger the refresh UI.
3. **Offline-first** -- If the device is offline when the gesture fires, the component must still animate and attempt sync; failure must be caught and logged (`console.warn`), never surfaced as an unhandled rejection or visible error to the user.
4. **Layer boundaries** (FRONTEND.md) -- `PullToRefresh` is a UI component and must not import from `data/`. Sync must be triggered through the store or service layer.
5. **Type safety** -- TypeScript strict mode; no `@ts-nocheck`; no untyped `any`. Use `event.currentTarget` (typed) for touch event handlers.
6. **Event handler typing** -- Use `event.currentTarget` not `event.target` in Svelte handlers; cast to concrete element type.
7. **No fire-and-forget** -- The sync call must have a `.catch(err => console.warn(...))` handler.
8. **iOS/WebKit PWA** -- Must function correctly on iOS PWA where `overscroll-behavior` support may differ from Android Chrome. Validate that native bounce-scroll does not double-fire the gesture.
9. **Test coverage** (CONTRIBUTING.md) -- Every new component/store module must have at least one unit test. E2E coverage is required because the behavior is user-visible and crosses modules (gesture -> sync -> UI state).

---

## Acceptance criteria

- [x] 1. On a touch device (or Playwright touch emulation), pulling down from the top of the My Day view reveals the animated emoji indicator before the pull threshold is reached.
- [x] 2. The emoji displayed in the indicator cycles as the user pulls further down (at least two distinct emoji states visible across the pull range).
- [x] 3. Releasing the gesture after crossing the pull threshold (>= configured distance, e.g. 64 px) triggers the existing sync/refresh mechanism exactly once.
- [x] 4. Releasing the gesture before crossing the threshold cancels the gesture -- no sync is triggered and the indicator retracts.
- [x] 5. The indicator dismisses (animates out) automatically once the sync call settles (resolved or rejected).
- [x] 6. The pull gesture does not activate when `scrollTop > 0`; normal list scrolling is unaffected.
- [x] 7. While offline: the gesture shows the animation, the sync attempt is made, the failure is caught and logged with `console.warn`, and no error is surfaced to the user.
- [x] 8. A non-gesture refresh affordance (button or equivalent) is present and triggers the same sync path on activation.
- [x] 9. The non-gesture affordance has an accessible label (e.g., `aria-label="Refresh"`) so it is reachable by screen reader and keyboard users.
- [x] 10. `PullToRefresh` has no direct import from `web/src/lib/data/`; all sync is invoked through the store or service layer.
- [x] 11. All TypeScript is strict; `@ts-nocheck` is absent; no untyped `any` without inline justification.
- [x] 12. At least one Vitest unit test covers: (a) threshold not met -> sync not called, (b) threshold met -> sync called once.
- [x] 13. At least one Playwright E2E smoke test (tagged `@smoke`) covers the full gesture flow: pull down past threshold -> indicator visible -> release -> sync triggered -> indicator gone.
- [x] 14. All pre-existing quality gates pass: `npm run lint`, `npm run check`, `npm run test`, `npm run test:e2e:smoke` (Chromium).

---

## Design

### Approach

The pull-to-refresh gesture is implemented as a single reusable `PullToRefresh.svelte` component that wraps the scrollable content area. It is placed inside `+layout.svelte` as a direct child of `<main>`, wrapping the `<slot />`. The component owns the full touch event lifecycle (`touchstart` -> `touchmove` -> `touchend`), manages its own visual state (pull distance, active emoji, animating/settling), and delegates sync invocation to a callback prop (`on:refresh`) provided by the layout.

### Components created or changed

- **`web/src/lib/components/PullToRefresh.svelte`** (NEW): Core component with touch event handling, pull distance state, emoji cycling, CSS animation, scroll guard, and accessible refresh button.
- **`web/src/lib/components/pullToRefreshUtils.ts`** (NEW): Extracted utility functions for emoji cycling logic (testable without component mounting).
- **`web/src/routes/+layout.svelte`** (MODIFIED): Wraps `<slot />` with `<PullToRefresh>`, adds `handlePullRefresh` calling `runSync()`, adds `overscroll-behavior-y: contain` to `<main>`.
- **`web/src/lib/components/PullToRefresh.test.ts`** (NEW): Unit tests for threshold, emoji cycling, scroll guard, double-fire prevention.
- **`web/tests/e2e/pull-to-refresh.spec.ts`** (NEW): Playwright E2E smoke test with mobile touch emulation.

---

## Progress log

*(Append-only, dated entries)*

- 2026-03-29: Exec plan created by product-manager. Feature in discovery. No active plans conflict. No server-side changes required.
- 2026-03-29: Technical design completed by principal-engineer. Approach: layout-level PullToRefresh wrapper component with touch event lifecycle, CSS-only animation, emoji cycling by pull distance bands, event-based sync delegation to layout's requestSync. Four files affected (1 new component, 1 layout mod, 1 unit test, 1 E2E test).
- 2026-03-29: Task breakdown completed by engineering-manager. 4 tasks: T1 (core component), T2 (layout integration), T3 (unit tests), T4 (E2E smoke test). T1 has no deps; T2 and T3 depend on T1; T4 depends on T1+T2.
- 2026-03-29: All 4 tasks implemented. 3 QA review rounds (2 critical fixes applied). Build 7/7 gates pass. Acceptance 14/14 criteria met. Feature complete.

---

## Decision log

*(Append-only, dated entries)*

- 2026-03-29: Gesture is touch-only (out of scope for mouse/desktop). Desktop users continue to rely on existing sync paths. Rationale: pull-to-refresh is a mobile paradigm; adding mouse drag support adds complexity with no clear UX gain on desktop.
- 2026-03-29: Emoji set is hardcoded in this iteration. User-configurable emoji is out of scope to keep scope tight. Can be revisited as a follow-on.
- 2026-03-29: Accessibility fallback is in scope (not deferred). CONTRIBUTING.md requires all user-visible features to be accessible; a gesture-only feature would violate that principle.
