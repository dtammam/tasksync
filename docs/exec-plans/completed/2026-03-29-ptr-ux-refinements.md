# Pull-to-Refresh UX Refinements

**Status:** Complete (2026-03-29)
**Created:** 2026-03-29
**Feature ID:** ptr-ux-refinements

## Goal

Refine the shipped pull-to-refresh implementation to feel native (like iOS PTR) and simplify the emoji indicator.

## Requirements

### R1: Native iOS-feeling content translation

The page content must translate down with the pull gesture, revealing the indicator in the vacated space above. Currently the implementation uses a fixed overlay that feels disconnected from the content and can interfere with normal scrolling.

Key behaviors:
- Content `translateY` moves down as the user pulls, creating space for the indicator
- The gesture must ONLY activate when the scroll container is at `scrollTop === 0`
- The transition from normal upward scrolling to PTR pulling must be seamless -- no fighting, no awkwardness
- The indicator appears in the space created by the content moving down, not as a separate overlay

### R2: Single random emoji per pull

Replace the current cycling emoji sequence (`PULL_EMOJIS = ['...', '...', ...]`) with a single randomly-selected emoji per pull gesture from this exact set: rocket, cog, hourglass, sync.

- One emoji randomly selected at pull start (touchstart)
- That emoji displayed for the entire pull duration
- No cycling during drag
- Hourglass shown during the refreshing/loading state (as currently)

## Scope

### In scope
- Reworking PullToRefresh.svelte to use content translation instead of fixed overlay
- Updating pullToRefreshUtils.ts (simplify emoji logic, remove computeEmojiIndex)
- Updating unit tests and E2E tests

### Out of scope
- Changing the refresh button behavior
- Changing the sync logic
- Adding haptic feedback
- Desktop behavior changes

## Acceptance Criteria

1. Pulling down from scrollTop===0 translates the page content downward, revealing the refresh indicator in the space above
2. Normal scrolling (scrollTop > 0) is completely unaffected by the PTR gesture handler
3. A single random emoji from the set [rocket, cog, hourglass, sync] is selected per pull and does not change during the gesture
4. The hourglass emoji is shown during the loading/refreshing state
5. The retract animation smoothly returns content to its original position
6. Reduced-motion preferences are respected
7. All existing unit tests pass (updated as needed)
8. E2E smoke tests pass

## Design

### Approach

**Change 1 — Content translation.** Replace the fixed-position overlay indicator with a
content-translation model. Wrap the `<slot />` in a new `<div class="ptr-content">` that
receives `transform: translateY(pullDistance)` during the gesture. The indicator sits
above the content wrapper via `position: absolute; top: 0` and is revealed as the content
moves down, appearing in the vacated space below the 56px app header. This is purely
compositor-driven (only `transform` and `opacity` change) — no layout thrash.

For the seamless scroll-to-pull transition: stop gating on `scrollTop === 0` only at
`touchstart`. Instead, record `startTouchY` on every `touchstart` unconditionally (the
listener stays passive). On each `touchmove`, if the component is not yet tracking,
check `scrollTop <= 0` on the scroll container. If at top and the finger is moving
downward, begin tracking from the *current* touch position (rebasing `startTouchY`).
This allows a user scrolling up to hit the top and seamlessly transition into the PTR
gesture without lifting their finger. Add `overscroll-behavior-y: none` on the `<main>`
scroll container (via a scoped `:global(main)` rule or inline in the layout) to suppress
the browser's native overscroll/rubber-band that would fight the custom gesture.

**Change 2 — Single random emoji per pull.** Replace the cycling emoji system with a
single randomly-selected emoji. A new `PULL_EMOJIS` array (`['🚀', '⚙️', '⏳', '🔄']`)
replaces the old one. A new `pickRandomPullEmoji()` function selects one emoji at random.
The component calls it once at gesture start and stores the result in a `gestureEmoji`
variable that persists for the entire pull. The `{#key}` block and scale transition are
removed since the emoji no longer changes mid-pull. `computeEmojiIndex()` is deleted.

### Component changes

- **`PullToRefresh.svelte`** (major rework):
  - **Template:** Wrap `<slot />` in `<div class="ptr-content">` with inline
    `transform: translateY({contentTranslateY}px)`. Change indicator from
    `position: fixed; top: 56px` to `position: absolute; top: 0; left: 0; right: 0`
    within the relatively-positioned `ptr-wrap`. Remove the `{#key keyedIndex}` block
    and scale transition; render `currentEmoji` directly in a static `<span>`.
  - **Gesture state:** Add `gestureEmoji: string` variable. Set it via
    `pickRandomPullEmoji()` at tracking start. Add reactive `contentTranslateY`
    derived from `pullDistance` (same damping, capped at `threshold` pixels of
    content movement). During refreshing state, hold `contentTranslateY` at the
    indicator height (56px) until the promise settles, then animate to 0.
  - **Seamless scroll-to-pull:** Rewrite `handleTouchStart` to always record
    `startTouchY` and set a `pendingGesture = true` flag (no scrollTop check).
    In `handleTouchMove`, when `pendingGesture && !isTracking`, check
    `scrollContainer.scrollTop <= 0` and `currentY > startTouchY`. If both true,
    set `isTracking = true` and rebase `startTouchY = currentY`. If scrollTop > 0,
    remain in `pendingGesture` mode (allow normal scroll). This mid-scroll pickup
    is the key UX improvement.
  - **Emoji logic:** Replace `emojiIndex` / `keyedIndex` reactives with a simple
    `currentEmoji` that reads `gestureEmoji` during pull and `'⏳'` during refresh.
    Reduced-motion still shows `'🔄'` as a static fallback.
  - **CSS:** Change `.ptr-indicator` to `position: absolute`. Add `.ptr-content`
    with `will-change: transform` and the same `ptr-animate` transition class for
    the retract animation. Add `overscroll-behavior-y: none` on a scoped
    `:global(main)` selector (keeps the rule co-located with the component that
    needs it).
  - **Animate-out:** Both `.ptr-indicator` and `.ptr-content` receive the
    `ptr-animate` class during retract so they transition back together.

- **`pullToRefreshUtils.ts`** (simplify):
  - Delete `computeEmojiIndex()` and its JSDoc.
  - Replace `PULL_EMOJIS` contents with `['🚀', '⚙️', '⏳', '🔄']`.
  - Add `pickRandomPullEmoji(): string` — returns a random element from
    `PULL_EMOJIS` (excluding hourglass, which is reserved for refresh state).
    Implementation: filter to non-hourglass entries, pick via `Math.random()`.
  - Keep `applyPullDamping()` and `meetsRefreshThreshold()` unchanged.

- **`PullToRefresh.test.ts`** (update):
  - Remove `computeEmojiIndex` tests (function deleted).
  - Add tests for `pickRandomPullEmoji()`: returns a value from the set, never
    returns hourglass.
  - Update component render test for reduced-motion emoji (still `'🔄'`).
  - Touch gesture tests: verify content element receives a non-zero
    `translateY` during pull (check inline style on `.ptr-content`).

- **`pull-to-refresh.spec.ts`** (E2E — update selectors):
  - Gesture test: assert `.ptr-content` has non-zero `translateY` during held
    pull. Update opacity assertion to target the indicator as before.
  - No new E2E tests needed; existing smoke coverage is sufficient.

### Data model changes

None.

### API changes

None.

### Alternatives considered

**Alternative A: Use the indicator as a flow element (not absolute-positioned).**
Place the indicator `<div>` before the slot content in normal document flow and
animate its `height` from 0 to 56px. This would naturally push content down without
needing `transform` on the content wrapper.

- *Pro:* Simpler DOM — no extra wrapper div, no manual translateY math.
- *Con:* Animating `height` triggers layout reflow on every frame during the drag,
  violating the compositor-only animation rule. Would cause visible jank on
  mid-range mobile devices and risks breaching the 16ms interaction budget.
- *Rejected* because performance is a non-negotiable (RELIABILITY.md).

**Alternative B: Keep touchstart scrollTop gate, add a second touchstart on scrollTop===0.**
Instead of checking scrollTop on every touchmove, detect when scrollTop hits 0 via a
`scroll` event listener and synthetically re-initiate tracking.

- *Pro:* Avoids per-touchmove scrollTop reads.
- *Con:* Scroll events fire asynchronously and can be throttled by the browser, causing
  a perceptible gap between reaching the top and PTR activating. The touchmove approach
  reads `scrollTop` only when `pendingGesture && !isTracking` (not on every frame), so
  the cost is negligible.
- *Rejected* because the UX gap would be noticeable.

### Risks and mitigations

- **Risk:** Reading `scrollTop` on touchmove (when not yet tracking) could cause
  forced reflow if the browser hasn't flushed layout. — **Mitigation:** The read
  only happens during the `pendingGesture && !isTracking` phase (a few frames at
  most). Once tracking begins, no further scrollTop reads occur. The scroll container
  is `<main>`, which the browser keeps laid out; `scrollTop` reads on it are
  effectively free (no forced reflow).

- **Risk:** `overscroll-behavior-y: none` on `<main>` could suppress the native
  iOS rubber-band effect globally, not just during PTR. — **Mitigation:** This is
  intentional — the custom PTR gesture replaces native overscroll entirely. If
  users report missing bounce on non-PTR pages, the rule can be scoped to only
  apply when the PTR component is mounted (it always is in the current layout, so
  this is moot).

- **Risk:** The `.ptr-content` wrapper div could break existing CSS selectors or
  layout assumptions in child pages. — **Mitigation:** The wrapper is a transparent
  flex/block container with no styling other than `will-change: transform`. Child
  pages use their own layout; a neutral wrapper div does not interfere. E2E smoke
  tests will catch any visual regressions.

- **Risk:** `pickRandomPullEmoji()` using `Math.random()` is not deterministic
  in tests. — **Mitigation:** Test that the return value is within the expected
  set (membership test), not a specific value. For the component test, the emoji
  display can be verified as "one of the valid set" rather than a specific emoji.

### Performance impact

No expected impact on performance budgets. The change *improves* animation
performance by ensuring only compositor-friendly properties (`transform`, `opacity`)
are used. The `scrollTop` read during the pending-gesture phase is a single property
access on a laid-out element — well under the 16ms frame budget. The `will-change:
transform` hint on `.ptr-content` promotes the layer for GPU compositing during the
gesture.

## Task Breakdown

### T1: Simplify emoji utilities and unit tests

**Files:** `pullToRefreshUtils.ts`, `PullToRefresh.test.ts`

- Replace `PULL_EMOJIS` contents with `['🚀', '⚙️', '⏳', '🔄']`
- Delete `computeEmojiIndex()` and its JSDoc
- Add `pickRandomPullEmoji(): string` — returns a random element from `PULL_EMOJIS` excluding hourglass (hourglass is reserved for refresh state)
- Remove `computeEmojiIndex` unit tests
- Add unit tests for `pickRandomPullEmoji`: returns a value from the expected set, never returns hourglass

**Done when:** `computeEmojiIndex` deleted, `pickRandomPullEmoji` exists and is tested, `npm run test` passes.

### T2: Rework PullToRefresh component to content-translation model

**Files:** `PullToRefresh.svelte`, `PullToRefresh.test.ts`

- **Template:** Wrap `<slot />` in `<div class="ptr-content">` with inline `transform: translateY({contentTranslateY}px)`. Change indicator from `position: fixed` to `position: absolute`. Remove `{#key}` block and scale transition; render `currentEmoji` directly.
- **Gesture logic:** Add `gestureEmoji` variable set via `pickRandomPullEmoji()` at tracking start. Rewrite `handleTouchStart` to always record `startTouchY` with `pendingGesture` flag (no scrollTop gate). Rewrite `handleTouchMove` for seamless scroll-to-pull: when `pendingGesture && !isTracking`, check `scrollContainer.scrollTop <= 0` and finger moving down; if true, begin tracking and rebase `startTouchY`.
- **Reactive state:** Add `contentTranslateY` derived from `pullDistance` (same damping, capped at threshold). During refreshing, hold at indicator height (56px) then animate to 0.
- **CSS:** `.ptr-indicator` to `position: absolute`. Add `.ptr-content` with `will-change: transform`. Add `overscroll-behavior-y: none` on scoped `:global(main)`. Both indicator and content get `ptr-animate` class during retract.
- **Emoji display:** `currentEmoji` reads `gestureEmoji` during pull, hourglass during refresh, sync for reduced-motion.
- Update component render tests for new DOM structure and emoji behavior.

**Done when:** Content translates down during pull, indicator appears in vacated space, single emoji per pull, seamless scroll-to-pull works, reduced-motion respected, `npm run test` passes.

### T3: Update E2E tests for new DOM structure

**Files:** `pull-to-refresh.spec.ts`

- Update gesture test to assert `.ptr-content` has non-zero `translateY` during held pull
- Update any opacity/selector assertions targeting the indicator for new DOM structure
- Verify existing smoke coverage passes

**Done when:** E2E spec updated, `npm run test:e2e:smoke` passes.

## Progress Log

- 2026-03-29: Feature initiated, bootstrap complete, Discovery skipped (requirements clear from user feedback)
- 2026-03-29: Task breakdown complete — 3 tasks: T1 emoji utils, T2 component rework, T3 E2E updates
- 2026-03-29: All 3 tasks implemented, QA reviewed twice (5 fixes applied), build verified, acceptance criteria validated — feature complete
