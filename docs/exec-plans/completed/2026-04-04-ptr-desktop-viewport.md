# Pull-to-Refresh on Desktop Viewports

## Goal

Enable the existing pull-to-refresh gesture on desktop browsers by adding pointer event handlers alongside the existing touch handlers. Desktop users (mouse/trackpad) should be able to click-and-drag downward to trigger a refresh with identical gesture semantics.

## Non-goals

- Migrating existing touch handlers to pointer events (avoid mobile regression risk)
- Keyboard-triggered refresh
- Trackpad scroll-gesture refresh (two-finger swipe)
- Visual design changes beyond cursor feedback
- Drag handle or other visible affordance

## Constraints

- **Performance**: Primary UI actions must remain under 16ms per interaction (docs/RELIABILITY.md)
- **Offline-first**: PTR triggers sync but must not break if offline
- **`overscroll-behavior-y: none`** on `<main>` must not be weakened or removed
- **Accessibility**: `aria-live="polite"` announcements must work identically for pointer-initiated refreshes
- **`prefers-reduced-motion`**: Must be respected (no spin animation, static emoji)
- **Browser support**: Chromium, Firefox, WebKit (the project's test matrix)

## Current state

`PullToRefresh.svelte` listens to `touchstart`, `touchmove`, `touchend`, `touchcancel` events. Desktop browsers never fire touch events from mouse/trackpad input, so PTR is non-functional on desktop. All gesture logic (damping, threshold, emoji selection, refresh dispatch) lives in reusable utilities in `pullToRefreshUtils.ts`.

## Proposed approach

1. Add `pointerdown`/`pointermove`/`pointerup` event listeners alongside existing touch handlers
2. Filter by `pointerType === 'mouse'` to prevent double-firing on hybrid/touch devices
3. Use `setPointerCapture()` on `pointerdown` for reliable gesture tracking even if the cursor leaves the element
4. Reuse all existing gesture logic: damping (`applyPullDamping`), threshold (`meetsRefreshThreshold`), emoji (`pickRandomPullEmoji`), and `doRefresh()`
5. Add `cursor: grab` (at rest, when at scroll top) and `cursor: grabbing` (during active drag) behind `@media (pointer: fine)`
6. Toggle `user-select: none` on the content wrapper during active drag to prevent text selection
7. Call `preventDefault()` on `pointermove` during active gesture to suppress default browser behaviors

## Alternatives considered

1. **Raw mouse events (`mousedown`/`mousemove`/`mouseup`)**: Works but lacks `pointerType` filtering and `setPointerCapture`. Would require manual hybrid-device handling. Pointer events are the modern standard.
2. **Migrate touch handlers to pointer events entirely**: Cleaner long-term but higher regression risk on mobile. Better as a future tech-debt item.
3. **Unified handler (single set of pointer events for both touch and mouse)**: Same regression concern as #2. Keep touch handlers intact for now.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Double-fire on hybrid devices (touch + pointer both fire) | Filter pointer handlers to `pointerType === 'mouse'` only |
| Text selection during drag | Toggle `user-select: none` during active gesture |
| Scroll interference (page scrolls instead of PTR activating) | Same `scrollTop === 0` guard as touch; `preventDefault()` on pointermove during gesture |
| Pointer capture lost unexpectedly | Handle `lostpointercapture` event as gesture cancel (same as `touchcancel`) |
| Performance regression from additional listeners | Listeners are passive where possible; active gesture path is identical to existing touch path |

## Acceptance criteria

1. Desktop user can click-and-drag downward on the task list (when scrolled to top) to trigger a refresh
2. Pull distance uses the same exponential rubber-band damping as touch (`applyPullDamping`, `PULL_MAX=140`, `PULL_DAMPING=0.9`)
3. Refresh triggers at the same threshold as touch (default 64px)
4. A single random emoji is chosen per gesture and remains fixed for the entire drag
5. Content translates downward during drag, identical to touch behavior
6. `doRefresh()` dispatches the same `refresh` CustomEvent with `detail.promise` support
7. On hybrid/touch devices, touch gestures continue to work -- no double-fire or regression
8. Pointer events only activate for `pointerType === 'mouse'` -- pen and touch are excluded
9. `setPointerCapture` is used so the gesture tracks reliably even if the cursor leaves the element
10. Text selection is suppressed during active drag (`user-select: none`)
11. Cursor shows `grab` at rest (when at scroll top) and `grabbing` during drag, behind `@media (pointer: fine)`
12. `aria-live="polite"` region announces "Tasks refreshed" or "Refresh failed" for pointer-initiated refreshes
13. `prefers-reduced-motion` is respected (no spin animation, static emoji) for pointer gestures
14. Scrolling works normally when not at scroll top -- pointer handlers do not interfere
15. New unit tests cover: pointer gesture start/move/end, threshold behavior, pointerType filtering, pointer capture
16. New or updated E2E test verifies desktop PTR gesture in Chromium

## Test plan

- **Unit tests**: Extend `PullToRefresh.test.ts` with pointer event cases (gesture lifecycle, filtering, capture)
- **E2E**: Add or update Playwright smoke test for desktop PTR (mouse drag gesture)
- **Regression**: Existing touch PTR tests must continue to pass unchanged
- **Cross-browser**: E2E matrix covers Chromium, Firefox, WebKit

## Rollout / migration plan

No migration needed. Additive change -- new event listeners alongside existing ones. No data model or sync changes.

## Design

### Approach

Add pointer event handlers (`pointerdown`, `pointermove`, `pointerup`, `lostpointercapture`) to `PullToRefresh.svelte` alongside the existing touch handlers. The pointer handlers are filtered to `pointerType === 'mouse'` so they never fire on touch or pen input, completely eliminating double-fire risk on hybrid devices. The existing touch handlers remain untouched -- zero mobile regression risk.

The pointer handlers reuse all existing gesture state variables (`isTracking`, `pullDistance`, `startTouchY`, `pendingGesture`, `gestureEmoji`, `isRefreshing`) and all existing utility functions from `pullToRefreshUtils.ts` (`applyPullDamping`, `meetsRefreshThreshold`, `pickRandomPullEmoji`). The gesture state machine is identical: pointerdown enters pending mode, pointermove resolves tracking activation (scrollTop check + downward direction), pointermove accumulates damped pull distance, and pointerup settles by either triggering `doRefresh()` or retracting. `lostpointercapture` maps to the cancel path (same as `touchcancel`).

`setPointerCapture` is called on `pointerdown` to ensure reliable gesture tracking when the cursor leaves the element bounds during drag. This is released automatically on `pointerup` or handled explicitly by `lostpointercapture`. CSS changes are scoped to `@media (pointer: fine)` to add `cursor: grab`/`grabbing` feedback and `user-select: none` during active drag.

### Component changes

- **`web/src/lib/components/PullToRefresh.svelte`**: Primary change target. Add four new handler functions and register them in `onMount`/cleanup. Add a reactive `isPointerDragging` flag for CSS cursor state. Add scoped `@media (pointer: fine)` styles. Details below.
- **`web/src/lib/components/PullToRefresh.test.ts`**: Add a new `describe('PullToRefresh pointer gesture', ...)` block with tests mirroring the touch gesture suite. Add `pointerType` filtering tests. Add pointer capture tests.
- **`web/src/lib/components/pullToRefreshUtils.ts`**: No changes required. All utility functions are input-type-agnostic and work identically for pointer events.
- **`web/src/routes/+layout.svelte`**: No changes required. The `overscroll-behavior-y: none` on `<main>` already prevents browser-native PTR. The `handlePullRefresh` handler receives the same `refresh` CustomEvent regardless of input source.
- **`web/tests/e2e/pull-to-refresh.spec.ts`**: Add a new test case (or separate test block) that uses Playwright's `page.mouse` API to simulate a desktop click-and-drag PTR gesture in Chromium. The existing touch test remains unchanged.

### Pointer event lifecycle

The four handlers map directly to the existing touch gesture state machine:

**`handlePointerDown(event: PointerEvent)`**

- Guard: `if (event.pointerType !== 'mouse' || isRefreshing) return`
- Call `containerEl.setPointerCapture(event.pointerId)` for reliable tracking outside bounds
- Set `startTouchY = event.clientY` (reuses existing variable; rename not required since the variable is internal)
- Set `pendingGesture = true`, `isTracking = false`, `pullDistance = 0`, `animateOut = false`
- Set `isPointerDragging = false` (cursor state; will become `true` on first qualifying pointermove)
- Registered as a standard (non-passive) listener since no `preventDefault` is needed here but the signature must allow it for consistency

**`handlePointerMove(event: PointerEvent)`**

- Guard: `if (event.pointerType !== 'mouse') return`
- Guard: `if (!pendingGesture && !isTracking) return`
- Pending resolution path (identical logic to `handleTouchMove`):
  - Check `getScrollContainer().scrollTop <= 0 && currentY > startTouchY`
  - On match: set `isTracking = true`, `pendingGesture = false`, rebase `startTouchY = currentY`, pick `gestureEmoji`, set `isPointerDragging = true`, call `event.preventDefault()`
  - On `scrollTop > 0`: return (allow normal scroll)
  - Otherwise: cancel pending
- Tracking accumulation path (identical to touch):
  - Compute `rawDelta = currentY - startTouchY`
  - If `rawDelta <= 0`: reset `pullDistance = 0`, `preventDefault()`
  - Else: `pullDistance = applyPullDamping(rawDelta)`, `preventDefault()`
- Registered as non-passive (must `preventDefault` during active gesture)

**`handlePointerUp(event: PointerEvent)`**

- Guard: `if (event.pointerType !== 'mouse') return`
- Set `pendingGesture = false`, `isPointerDragging = false`
- If not `isTracking`: return
- Set `isTracking = false`
- If `meetsRefreshThreshold(pullDistance, threshold)`: call `doRefresh()`
- Else: retract (same animateOut logic as `handleTouchEnd`)
- `releasePointerCapture` is called automatically by the browser on pointerup, but if needed explicitly, call it here as a safety measure

**`handleLostPointerCapture(event: PointerEvent)`**

- Guard: `if (event.pointerType !== 'mouse') return`
- Set `pendingGesture = false`, `isPointerDragging = false`
- If not `isTracking`: return
- Set `isTracking = false`
- Retract without refresh (same logic as `handleTouchCancel`)

**Registration in `onMount`:**

```typescript
containerEl.addEventListener('pointerdown', handlePointerDown);
containerEl.addEventListener('pointermove', handlePointerMove, { passive: false });
containerEl.addEventListener('pointerup', handlePointerUp);
containerEl.addEventListener('lostpointercapture', handleLostPointerCapture);
```

Cleanup removes all four listeners in the returned destructor (same pattern as touch).

### Hybrid device safety

The `pointerType === 'mouse'` filter on every pointer handler ensures:

1. On pure touch devices: pointer handlers are registered but never activate (touch events produce `pointerType === 'touch'`), so existing touch handlers run exclusively.
2. On hybrid devices (e.g., Surface with touch + mouse): touch input is handled by touch handlers, mouse input by pointer handlers. They never overlap because `pointerType` is checked first in every handler.
3. On pen input: excluded by the same `pointerType` check. Pen users are not a target for this feature (see non-goals).

The existing touch handlers (`handleTouchStart`, `handleTouchMove`, `handleTouchEnd`, `handleTouchCancel`) are not modified in any way. They continue to use the same gesture state variables. There is no state collision because a single physical interaction produces either touch events or mouse-type pointer events, never both simultaneously for the same gesture.

### CSS changes

All CSS changes are scoped to the component's `<style>` block in `PullToRefresh.svelte`:

```css
/* Desktop cursor feedback -- only for fine-pointer devices (mouse/trackpad). */
@media (pointer: fine) {
  .ptr-wrap {
    cursor: grab;
  }
  .ptr-wrap.ptr-dragging {
    cursor: grabbing;
    user-select: none;
  }
}
```

- `cursor: grab` signals that the area is draggable when the scroll container is at top. This is always-on behind the media query; the visual cost is negligible and consistent with scroll-to-top behavior.
- `cursor: grabbing` and `user-select: none` activate during drag via the `ptr-dragging` class, toggled by the `isPointerDragging` reactive variable.
- The `ptr-dragging` class is applied to the `.ptr-wrap` div via `class:ptr-dragging={isPointerDragging}`.
- `user-select: none` is only applied during active drag to avoid interfering with normal text selection. It is removed when the gesture ends (pointerup or lostpointercapture sets `isPointerDragging = false`).
- No global styles are added. No changes to `+layout.svelte` styles.

### Data model changes

None. This is purely a UI gesture change. No new fields, entities, or schema modifications.

### API changes

None. No new endpoints or changed signatures. The `refresh` CustomEvent interface is unchanged.

### Risks and mitigations

- **Risk**: Double-fire on hybrid devices (touch + pointer both fire for same gesture) -- **Mitigation**: Filter all pointer handlers with `pointerType === 'mouse'`. Touch and pointer paths are mutually exclusive per-gesture.
- **Risk**: Text selection during mouse drag -- **Mitigation**: Toggle `user-select: none` via CSS class during active drag; removed on gesture end.
- **Risk**: Scroll interference (page scrolls instead of PTR activating) -- **Mitigation**: Same `scrollTop === 0` guard as touch path; `preventDefault()` on pointermove during active gesture.
- **Risk**: Pointer capture lost unexpectedly (e.g., window blur, system dialog) -- **Mitigation**: `lostpointercapture` handler acts as gesture cancel (identical to `touchcancel`), resetting all state cleanly.
- **Risk**: Performance regression from additional listeners -- **Mitigation**: Four listeners added at mount; handler guards early-return on non-mouse pointerType. Active gesture path is identical to touch (same utility functions, same state machine). Well within the 16ms budget.
- **Risk**: Shared gesture state between touch and pointer handlers could theoretically collide -- **Mitigation**: A single physical gesture produces either touch events or mouse-type pointer events, never both. The `pointerType` filter prevents any cross-contamination. If paranoia warrants it, a `gestureSource: 'touch' | 'pointer' | null` discriminator could be added, but this is not expected to be necessary and would add complexity for no practical gain.
- **Risk**: `cursor: grab` on the entire `.ptr-wrap` may feel unexpected when the page is scrolled (PTR only activates at scrollTop === 0) -- **Mitigation**: The cursor hint is a minor visual affordance. Adding scroll-position-reactive cursor toggling would require a scroll listener and add complexity disproportionate to the benefit. Accept the always-on cursor as a reasonable tradeoff for V1; can be refined later if user feedback warrants it.

### Alternatives considered

1. **Raw mouse events (`mousedown`/`mousemove`/`mouseup`)**: Lacks `pointerType` for filtering and `setPointerCapture` for reliable tracking. Would need manual capture simulation. Pointer events are the modern standard and supported in all three target browsers. Rejected.
2. **Migrate all touch handlers to pointer events (unified handler)**: Cleaner long-term architecture but carries mobile regression risk. Better suited as a tech-debt item after desktop PTR is validated. Rejected for now.
3. **Single set of pointer events for both touch and mouse with no pointerType filter**: Would eliminate touch handlers entirely. Same regression concern as option 2. Rejected.
4. **Scroll-position-reactive cursor** (`cursor: grab` only when at scrollTop === 0): Would require a passive scroll listener on the `<main>` element to track scroll position and toggle a class. Adds complexity and a continuous scroll listener for a minor visual refinement. Rejected for V1; can be added as a follow-up if users find the always-on grab cursor confusing.

### Performance impact

No expected impact on performance budgets. The four new pointer event listeners are lightweight (early `pointerType` guard returns in ~0.01ms). During an active gesture, the code path is identical to the existing touch path -- same `applyPullDamping` call, same reactive state updates, same CSS transform. All operations are well within the 16ms interaction budget defined in `docs/RELIABILITY.md`.

The `@media (pointer: fine)` CSS rule is evaluated once by the browser at stylesheet parse time and does not add runtime cost. The `ptr-dragging` class toggle is a single DOM attribute change per gesture start/end.

## Tasks

### T1: Add pointer event handlers to PullToRefresh.svelte
- **Files**: `web/src/lib/components/PullToRefresh.svelte`
- **What**: Add `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, and `handleLostPointerCapture` handler functions. All four guard on `pointerType === 'mouse'`. `handlePointerDown` calls `setPointerCapture(event.pointerId)` and enters pending gesture mode (reuses existing state variables). `handlePointerMove` resolves pending gestures and accumulates damped pull distance (same logic as `handleTouchMove`). `handlePointerUp` settles via `doRefresh()` or retract. `handleLostPointerCapture` cancels cleanly. Register all four in `onMount` with correct passive/non-passive options; clean up in destructor.
- **Done when**: Four pointer event handlers registered and cleaned up. All filter on `pointerType === 'mouse'`. `setPointerCapture` called on pointerdown. Gesture lifecycle matches touch path. Existing touch handlers unchanged. `npm run check` passes.

### T2: Add CSS cursor feedback and user-select suppression
- **Files**: `web/src/lib/components/PullToRefresh.svelte`
- **What**: Add `isPointerDragging` boolean state variable. Set true on pointer tracking activation, false on gesture end. Apply `class:ptr-dragging={isPointerDragging}` to `.ptr-wrap`. Add scoped CSS in `@media (pointer: fine)`: `.ptr-wrap { cursor: grab }`, `.ptr-wrap.ptr-dragging { cursor: grabbing; user-select: none }`.
- **Done when**: Desktop (fine pointer) shows `cursor:grab` at rest, `cursor:grabbing` + `user-select:none` during drag. No cursor changes on touch devices. `npm run check` passes.

### T3: Add unit tests for pointer gesture lifecycle
- **Files**: `web/src/lib/components/PullToRefresh.test.ts`
- **What**: Add `describe('PullToRefresh pointer gesture', ...)` block covering: (1) gesture triggers refresh past threshold, (2) retracts below threshold, (3) pointerType filtering (touch/pen ignored), (4) setPointerCapture called on pointerdown, (5) lostpointercapture cancels without refresh, (6) no activation when scrollTop > 0, (7) isRefreshing blocks new gestures.
- **Done when**: All new tests pass (`npm run test`). Existing touch tests unchanged and passing.

### T4: Add E2E test for desktop PTR mouse gesture
- **Files**: `web/tests/e2e/pull-to-refresh.spec.ts`
- **What**: Add a `@smoke`-tagged test using Playwright `page.mouse` API with desktop viewport (not Pixel 5). Navigate to `/`, verify indicator hidden, simulate mouse down + drag down past threshold + mouse up on `.ptr-wrap`, verify refresh triggers and settles.
- **Done when**: New test passes in Chromium (`npm run test:e2e:smoke`). Existing touch test unchanged and passing.

## Progress log

- 2026-04-04: Requirements gathered and exec plan created (discovery phase)
- 2026-04-04: Technical design completed (design phase) -- pointer event handlers alongside touch, pointerType filtering, setPointerCapture, CSS cursor feedback behind @media (pointer: fine)
- 2026-04-05: Feature complete. All 4 tasks implemented, verified, reviewed, and accepted. Moved to completed.

## Decision log

- 2026-04-04: Chose pointer events over raw mouse events -- modern API with `pointerType` filtering and `setPointerCapture` support
- 2026-04-04: Keep existing touch handlers intact -- avoid mobile regression risk; migration is a future tech-debt item
- 2026-04-04: Filter to `pointerType === 'mouse'` only -- prevents double-handling on hybrid devices
