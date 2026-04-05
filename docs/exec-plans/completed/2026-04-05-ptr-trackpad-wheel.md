# Pull-to-Refresh Trackpad/Wheel Gesture Support

## Goal

Enable desktop trackpad users to trigger pull-to-refresh by scrolling up past the top of the page using two-finger swipe or mouse wheel. This completes the desktop PTR story by adding the one remaining input mode -- wheel/trackpad scroll gestures -- alongside the existing touch and pointer (click-and-drag) paths. The gesture reuses the same damping, threshold, emoji, and refresh logic as the existing paths.

## Non-goals

- Migrating existing touch or pointer handlers to a unified event system
- Keyboard-triggered refresh
- Horizontal swipe gestures
- Visual design changes beyond what already exists for touch/pointer PTR
- Changing the damping curve, threshold, or emoji set
- Supporting wheel-based PTR on mobile browsers (touch is the primary input there)
## Constraints

- **Performance**: Primary UI actions must remain under 16ms per interaction (docs/RELIABILITY.md). Wheel event handlers must be lightweight -- early guard returns when not at scroll top.
- **Offline-first**: PTR triggers sync but must work without a server. No change from existing behavior.
- **`overscroll-behavior-y: none`** on `<main>` must not be weakened or removed. This already prevents browser-native PTR; the wheel handler operates within this constraint.
- **Accessibility**: `aria-live="polite"` announcements must work identically for wheel-initiated refreshes. `prefers-reduced-motion` must be respected (no spin animation, static emoji).
- **Browser support**: Chromium, Firefox, WebKit (the project's test matrix). Wheel event behavior varies slightly across browsers -- the debounce approach must handle all three.
- **Non-passive wheel listener**: The wheel listener must call `preventDefault()` during an active gesture to prevent the browser from scrolling. This means it cannot be registered as passive. This is acceptable because the listener only calls `preventDefault` when actively tracking a pull gesture (scrollTop === 0 and accumulated delta).

## Current state

`PullToRefresh.svelte` handles two input modes:
1. **Touch**: `touchstart`/`touchmove`/`touchend`/`touchcancel` -- primary mobile input
2. **Pointer (mouse click-and-drag)**: `pointerdown`/`pointermove`/`pointerup`/`lostpointercapture` -- desktop mouse drag, filtered to `pointerType === 'mouse'`

All gesture logic is shared via `pullToRefreshUtils.ts`:
- `applyPullDamping(rawDelta)` -- exponential rubber-band curve, clamped to `PULL_MAX=140`
- `meetsRefreshThreshold(pullDistance, threshold)` -- checks if pull meets the 64px default threshold
- `pickRandomPullEmoji()` -- selects one emoji per gesture from a 15-emoji set
- `REFRESH_EMOJI` -- hourglass shown during sync

The component uses shared gesture state variables (`isTracking`, `pullDistance`, `startTouchY`, `pendingGesture`, `gestureEmoji`, `isRefreshing`) across touch and pointer handlers. Touch and pointer never fire simultaneously for the same physical gesture, so state sharing is safe.
## Proposed approach

### Wheel event handling

Add `wheel` event listeners to the PTR container alongside existing touch and pointer handlers.

**Event wiring:**
- Register a `wheel` listener on `containerEl` in `onMount` with `{ passive: false }` (must call `preventDefault` during active gesture)
- Clean up in the destructor (same pattern as touch/pointer)

**Gesture lifecycle:**

1. **Activation**: On `wheel` event, check:
   - `isRefreshing` is false (no gesture during active sync)
   - `isTracking` is false (no concurrent gesture from another input mode)
   - `getScrollContainer().scrollTop === 0` (at top of scroll)
   - `event.deltaY < 0` (scrolling up, past the top)
   - If all conditions met: set `isTracking = true`, pick `gestureEmoji`, initialize `wheelAccumulator = 0`

2. **Accumulation**: While tracking, each `wheel` event:
   - Accumulate raw delta: `wheelAccumulator += Math.abs(normalizedDeltaY)`
   - Apply damping: `pullDistance = applyPullDamping(wheelAccumulator)`
   - Call `event.preventDefault()` to prevent browser scroll
   - Reset the debounce timer (see below)

3. **End detection (debounce)**: Since browsers have no `wheelend` event, use a debounce timer:
   - On each `wheel` event during tracking, clear and restart a ~150ms timeout
   - When the timeout fires (no wheel events for 150ms), the gesture is considered complete
   - If `meetsRefreshThreshold(pullDistance, threshold)`: call `doRefresh()`
   - Else: retract with animation (same `animateOut` logic as touch/pointer)

4. **Cancellation**: If during tracking a `wheel` event arrives with `deltaY > 0` (user reversed direction to scroll down), cancel the gesture and retract.

**New state variables:**
- `wheelAccumulator: number` -- raw accumulated deltaY across wheel events in a single gesture. Reset to 0 on gesture start. Needed because `wheel` events fire incrementally (small deltaY per event), unlike touch/pointer where `rawDelta` is computed from `currentY - startTouchY`.
- `wheelEndTimer: ReturnType<typeof setTimeout> | null` -- debounce timer for wheel-end detection. Cleared on destroy.

**Interaction with existing handlers:**
- Wheel events are a completely separate event stream from touch and pointer events. No `pointerType` filtering is needed.
- The `isTracking` guard prevents concurrent gestures: if a touch or pointer gesture is active, wheel events are ignored, and vice versa.
- The shared gesture state variables (`pullDistance`, `gestureEmoji`, `isTracking`, etc.) are safe to reuse because only one input mode can be tracking at a time.

### deltaY normalization

`wheel` event `deltaY` values vary by `deltaMode`:
- `WheelEvent.DOM_DELTA_PIXEL` (0): deltaY is in pixels (trackpad, most common)
- `WheelEvent.DOM_DELTA_LINE` (1): deltaY is in lines (classic mouse wheel)
- `WheelEvent.DOM_DELTA_PAGE` (2): deltaY is in pages (rare)

Normalize to pixels before accumulating:
- Mode 0: use deltaY as-is
- Mode 1: multiply by a line-height estimate (e.g., 24px)
- Mode 2: multiply by viewport height estimate (e.g., 800px, capped)

This ensures consistent pull feel across input devices.
## Alternatives considered

1. **Scroll event listener instead of wheel**: Listen to `scroll` events on `<main>` and detect when `scrollTop` bounces at 0. Rejected because: `overscroll-behavior-y: none` prevents bounce behavior entirely, `scroll` events don't fire when already at `scrollTop === 0`, and there's no delta information to drive the pull distance animation. Wheel events provide the raw delta needed for progressive pull feedback.

2. **Use `scrollTop` momentum/velocity detection**: Track `scrollTop` changes over time and infer a "flick past top" gesture. Rejected because: requires complex velocity calculation, doesn't work when already at `scrollTop === 0` (no scroll events fire), and produces a binary trigger rather than the progressive pull-and-release UX that matches touch/pointer behavior.

3. **requestAnimationFrame-based accumulation instead of debounce for end detection**: Accumulate deltas in a rAF loop and detect gesture end when no new deltas arrive for N frames. Rejected because: adds complexity with no clear benefit over a simple setTimeout debounce, rAF doesn't fire when the tab is backgrounded (edge case), and the 150ms debounce is a well-established pattern for wheel-end detection.

4. **Pointer capture on wheel start (combine with pointer handlers)**: Rejected because: wheel events are a fundamentally different event stream from pointer events. `setPointerCapture` has no effect on wheel events. The two input modes (click-and-drag vs. scroll gesture) require separate handling.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No `wheelend` event -- gesture end detection is heuristic | Certain | Medium | Use 150ms debounce timer. Well-established pattern. If user pauses mid-gesture for >150ms, it settles; they can start a new one immediately. |
| Non-passive wheel listener degrades scroll performance | Low | Medium | Only call `preventDefault` when actively tracking a pull gesture. When not tracking, handler returns immediately without calling `preventDefault`. |
| `deltaY` scale varies across browsers/devices/deltaMode | Medium | Medium | Normalize deltaY by deltaMode (pixel/line/page). The damping curve already provides progressive resistance that absorbs scale differences. Test across all three browsers. |
| Interference between wheel and pointer gestures on same device | Low | Low | `isTracking` guard prevents concurrent gestures. Wheel and pointer events are separate streams -- no event-type collision. |
| Trackpad momentum/inertial scrolling fires extra wheel events after finger lifts | Medium | Medium | The debounce timer naturally handles this -- inertial events reset the timer. Once they stop, the 150ms timeout fires and settles. The damping curve absorbs extra distance gracefully. |
| Reverse scroll (deltaY > 0) during pull gesture | Low | Low | Cancel the gesture and retract immediately. Clean UX -- user can reverse out of a pull they don't want. |
## Acceptance criteria

1. Desktop trackpad user can two-finger swipe up past the top of the page to trigger pull-to-refresh
2. Desktop mouse wheel user can scroll up past the top of the page to trigger pull-to-refresh
3. Pull distance uses the same exponential rubber-band damping as touch/pointer (`applyPullDamping`, `PULL_MAX=140`, `PULL_DAMPING=0.9`)
4. Refresh triggers at the same threshold as touch/pointer (default 64px)
5. A single random emoji is chosen when the wheel gesture activates and remains fixed for the entire gesture
6. Content translates downward during the gesture, identical to touch/pointer behavior
7. `doRefresh()` dispatches the same `refresh` CustomEvent with `detail.promise` support
8. Gesture end is detected via debounce (~150ms after last wheel event)
9. When `scrollTop > 0`, wheel events pass through normally -- no interference with regular scrolling
10. `deltaY > 0` (scroll down) during an active pull cancels the gesture and retracts
11. `deltaY` is normalized across `deltaMode` values (pixel, line, page) for consistent feel
12. `aria-live="polite"` region announces "Tasks refreshed" or "Refresh failed" for wheel-initiated refreshes
13. `prefers-reduced-motion` is respected (no spin animation, static emoji) for wheel gestures
14. No interference with existing touch or pointer (click-and-drag) PTR -- all three input modes coexist
15. `isTracking` guard prevents concurrent gestures across input modes
16. `wheelEndTimer` is cleaned up on component destroy (no stale-closure writes)
17. New unit tests cover: wheel gesture lifecycle, debounce end detection, deltaMode normalization, scroll guard, reverse-scroll cancellation, concurrent gesture prevention
18. New or updated E2E test verifies trackpad/wheel PTR gesture in Chromium

## Test plan

### Unit tests (`PullToRefresh.test.ts`)

Add a new `describe('PullToRefresh wheel gesture', ...)` block:

1. **Gesture triggers refresh past threshold**: Simulate wheel events with cumulative `deltaY` exceeding threshold, advance debounce timer, verify `refresh` event dispatched
2. **Retracts below threshold**: Simulate small wheel delta, advance timer, verify no refresh and pull retracts
3. **Scroll guard -- no activation when scrollTop > 0**: Mount inside a `<main>` with `scrollTop > 0`, simulate wheel events, verify no tracking
4. **Reverse scroll cancels gesture**: Start tracking, then send `deltaY > 0`, verify gesture cancelled and retracted
5. **Debounce timer fires settle**: Verify that gesture settles after 150ms with no new wheel events (use `vi.advanceTimersByTime`)
6. **Debounce timer resets on new wheel event**: Send wheel events at <150ms intervals, verify gesture stays active
7. **No activation during isRefreshing**: Trigger a refresh with hanging promise, attempt new wheel gesture, verify blocked
8. **No concurrent gesture with pointer**: Start a pointer gesture, attempt wheel gesture, verify wheel ignored
9. **deltaMode normalization**: Test that `DOM_DELTA_LINE` and `DOM_DELTA_PAGE` produce reasonable pull distances

### E2E tests (`pull-to-refresh.spec.ts`)

Add a new `describe('PTR wheel gesture', ...)` block:

1. **Trackpad/wheel gesture triggers sync** (`@smoke`): Use Playwright `page.mouse.wheel()` to simulate wheel events with `deltaY < 0` at `scrollTop === 0`. Verify indicator becomes visible, content translates down, and indicator animates out after settle.

### Regression

- All existing touch gesture tests must pass unchanged
- All existing pointer gesture tests must pass unchanged
- Cross-browser: E2E matrix covers Chromium, Firefox, WebKit

## Rollout / migration plan

None. Additive change -- new event listener alongside existing ones. No data model, sync protocol, or API changes. No feature flag needed; the wheel handler simply adds a new activation path for existing refresh behavior.

## Design

(To be filled by principal-engineer)

## Task breakdown

### T1: Add wheel event handler with deltaY normalization and gesture lifecycle
**File:** `web/src/lib/components/PullToRefresh.svelte`

1. Add state variables: `wheelAccumulator: number = 0` and `wheelEndTimer: ReturnType<typeof setTimeout> | null = null`
2. Add deltaY normalization helper: DOM_DELTA_PIXEL pass-through, DOM_DELTA_LINE x24, DOM_DELTA_PAGE x800
3. Add `handleWheel(event: WheelEvent)` with full gesture lifecycle:
   - **Activation**: guard on `!isRefreshing && !isTracking && scrollTop === 0 && deltaY < 0`; set `isTracking = true`, pick emoji, reset `wheelAccumulator = 0`
   - **Accumulation**: `wheelAccumulator += Math.abs(normalizedDeltaY)`, `pullDistance = applyPullDamping(wheelAccumulator)`, call `event.preventDefault()`
   - **End detection**: 150ms debounce timer; on fire: if threshold met call `doRefresh()`, else retract with `animateOut`
   - **Cancellation**: `deltaY > 0` during tracking cancels gesture and retracts
4. Register wheel listener in `onMount` with `{ passive: false }`; remove in cleanup destructor
5. Clear `wheelEndTimer` in `onDestroy`

**Done when:** Wheel gesture works end-to-end. Existing touch/pointer handlers unchanged.

### T2: Add unit tests for wheel gesture lifecycle
**File:** `web/src/lib/components/PullToRefresh.test.ts`

Add `describe('PullToRefresh wheel gesture')` with 9 test cases:
1. Gesture triggers refresh past threshold
2. Retracts below threshold
3. Scroll guard -- no activation when scrollTop > 0
4. Reverse scroll (deltaY > 0) cancels gesture
5. Debounce timer fires settle after 150ms
6. Debounce timer resets on new wheel event within window
7. No activation during isRefreshing
8. No concurrent gesture with pointer (isTracking guard)
9. deltaMode normalization (LINE and PAGE produce reasonable pull distances)

**Done when:** All 9 tests pass. No existing tests broken.

### T3: Add E2E test for wheel PTR gesture
**File:** `web/tests/e2e/pull-to-refresh.spec.ts`

Add `describe('PTR wheel gesture')` with a `@smoke`-tagged test:
- Use `page.mouse.wheel(0, negativeDeltaY)` at scrollTop === 0
- Verify indicator visible and content translates down
- Verify indicator animates out after debounce settle

**Done when:** E2E passes in Chromium. Tagged @smoke. Existing E2E tests unaffected.

## Progress log

- 2026-04-05: Requirements gathered and exec plan created (discovery phase)
- 2026-04-05: Feature complete. All 5 tasks done, all 18 acceptance criteria met. Archived to completed/ (done phase)

## Decision log

- 2026-04-05: Use `wheel` events over `scroll` events -- `wheel` events fire before browser scroll acts, allow `preventDefault()`, and carry `deltaY` for progressive pull animation; `scroll` events are post-fact and cannot be suppressed
- 2026-04-05: Debounce at 150ms for gesture-end detection -- standard interval for wheel idle detection; balances responsiveness with trackpad momentum tail absorption
- 2026-04-05: Accumulate `Math.abs(normalizedDeltaY)` and apply `applyPullDamping()` -- reuses existing utility without modification; keeps damping and threshold logic in one shared place
- 2026-04-05: Normalize `deltaMode` before accumulation -- ensures consistent pull feel across Firefox (line mode), Chromium (pixel mode), and other browsers; named constants for line/page pixel estimates avoid magic numbers
- 2026-04-05: Guard on `isTracking` to prevent concurrent wheel + pointer/touch gestures -- one input mode active at a time; state variables are shared across handlers and must not be written concurrently
