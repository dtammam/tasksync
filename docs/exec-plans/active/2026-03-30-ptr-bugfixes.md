# PTR Bug Fixes: Remove Floating Refresh Button and Fix position:fixed Children

## Goal

Remove the unintended floating refresh button introduced as scope creep in `PullToRefresh.svelte`, and fix the `will-change: transform` property on `.ptr-content` that breaks `position: fixed` descendants (e.g. the add-task input field).

## Scope

- Remove all traces of the `.ptr-btn` floating refresh button from `PullToRefresh.svelte`: the DOM element, the `handleRefreshButton` event handler, and all associated CSS rules.
- Fix or remove the static `will-change: transform` declaration on `.ptr-content` so that `position: fixed` descendants are positioned relative to the viewport (not the `.ptr-content` containing block).
- Both changes are confined to a single file: `web/src/lib/components/PullToRefresh.svelte`.
- Unit tests covering both fixes.

## Out of scope

- Changes to any file other than `PullToRefresh.svelte` (and its test file).
- New PTR features or behavior changes beyond restoring the correct pre-regression state.
- Performance optimisation of the PTR animation beyond what is needed to fix the `will-change` regression.

## Constraints

- The pull-to-refresh gesture animation must remain smooth after the `will-change` fix; compositor-layer promotion may be applied conditionally (e.g. only while a gesture is active) if needed, but must not recreate the containing-block side-effect at rest.
- All quality gates must pass: `npm run lint`, `npm run check`, `npm run test`.
- Branch: `feat/ptr-cleanup-polish`.

## Acceptance criteria

- [ ] No element with class `.ptr-btn` exists in the rendered DOM when `PullToRefresh` is mounted.
- [ ] `PullToRefresh.svelte` contains no `handleRefreshButton` function, no `.ptr-btn` markup, and no `.ptr-btn` CSS rules.
- [ ] The `.ptr-content` element does not carry a static `will-change: transform` declaration that creates a new CSS containing block at rest.
- [ ] A `position: fixed` descendant inside `PullToRefresh` (e.g. the add-task input) remains positioned relative to the viewport when the page is scrolled — it does not scroll with the page content.
- [ ] The pull-to-refresh gesture continues to function correctly: pulling down from `scrollTop === 0` reveals the indicator, releasing past the threshold dispatches the `refresh` event, and the retract animation completes.
- [ ] Unit tests assert that `.ptr-btn` is absent from the DOM after render.
- [ ] All existing PTR unit tests continue to pass.
- [ ] `npm run lint`, `npm run check`, and `npm run test` all pass with no errors.

## Design

### Approach

**Remove `will-change: transform` entirely from `.ptr-content`.** The static declaration creates a new CSS containing block (per the W3C spec, `will-change: transform` establishes a containing block for `position: fixed` descendants, identical to applying an actual `transform`). This breaks any `position: fixed` child rendered inside the `<slot />` — e.g. the add-task floating input — by positioning it relative to `.ptr-content` instead of the viewport.

Modern browsers (Chrome 80+, Safari 15+, Firefox 90+) automatically promote elements to their own compositor layer when an active CSS `transform` is applied. The `will-change` hint was originally intended to give the browser advance notice, but for a simple `translateY()` that only activates during touch gestures, the browser handles layer promotion on-demand without any perceptible jank. Removing the static `will-change` eliminates the containing-block side effect at rest *and* during gestures, which is the correct fix — a conditional toggle would still break `position: fixed` descendants during the brief gesture window.

**Revert `.ptr-indicator` from `position: relative; margin-bottom: -56px` back to `position: absolute`.** The negative-margin collapse trick technically works but introduces fragility: (1) the `-56px` value must stay in sync with the `height: 56px` value manually — there is no CSS variable linking them; (2) `position: relative` places the indicator in normal document flow, which can cause subtle layout shifts in flex/grid parents or when CSS containment is applied to ancestors; (3) the original `position: absolute` design is simpler and semantically correct — the indicator is an overlay revealed by content translation, not a flow participant. Reverting to `position: absolute` with `top: 0; left: 0; right: 0` restores the original intent: the indicator sits at the top of `.ptr-wrap` (which already has default `position: static` — add `position: relative` to establish the containing block), completely out of flow, and is revealed when `.ptr-content` translates down.

### Component changes

- **`PullToRefresh.svelte` — `.ptr-content` CSS rule (line 403-405)**:
  Remove `will-change: transform;`. The rule becomes simply `transition: none;` (the `.ptr-content.ptr-animate` transition on lines 409-411 is unaffected — it applies `transition: transform 0.3s ease` only when the `ptr-animate` class is toggled, which works correctly without a prior `will-change` declaration).

- **`PullToRefresh.svelte` — `.ptr-wrap` CSS rule (lines 347-349)**:
  Add `position: relative;` to establish a containing block for the absolutely-positioned indicator.

- **`PullToRefresh.svelte` — `.ptr-indicator` CSS rule (lines 357-368)**:
  Replace `position: relative; height: 56px; margin-bottom: -56px;` with `position: absolute; top: 0; left: 0; right: 0; height: 56px;`. Remove `margin-bottom`. Keep all other properties (`display: flex`, `justify-content: center`, `align-items: center`, `pointer-events: none`, `touch-action: none`, `will-change: opacity`, `transition: none`).

- **`PullToRefresh.test.ts`**:
  Add a test asserting that `.ptr-content` does not have `will-change: transform` in its computed/inline styles after render (verifies AC #3). The existing test for `.ptr-btn` absence (AC #6) should already be present or added in the same pass.

### Data model changes

None.

### API changes

None.

### Alternatives considered

1. **Conditional `will-change: transform` (toggle on during gesture, off at rest).**
   This could be done by binding `style:will-change={isTracking || isRefreshing || animateOut ? 'transform' : 'auto'}` on `.ptr-content`. Pros: provides an explicit compositor hint during animation. Cons: (a) during the gesture window, `position: fixed` descendants would still be broken — the add-task input would jump from viewport-relative to `.ptr-content`-relative positioning mid-gesture, causing a visible layout snap; (b) toggling `will-change` on/off forces layer promotion/demotion, which can cause a brief visual flash or repaint on lower-end devices; (c) adds complexity for no measurable benefit, since browsers already handle on-demand layer promotion for active transforms. **Rejected** because it doesn't fully solve the problem and introduces jank risk.

2. **Keep `position: relative; margin-bottom: -56px` on `.ptr-indicator`.**
   This works functionally — the negative margin collapses the indicator's space so it doesn't affect layout at rest. Pros: no containing-block needed on `.ptr-wrap`. Cons: (a) the `-56px` / `56px` duplication is fragile; (b) `position: relative` elements participate in document flow, which can interact unexpectedly with flex/grid layout or `overflow` clipping on ancestors; (c) the original `position: absolute` design is semantically clearer for an overlay element. **Rejected** in favor of reverting to the cleaner original design.

### Risks and mitigations

- **Risk**: Removing `will-change: transform` could theoretically cause frame drops on very old/low-end devices that don't auto-promote transforms to the compositor. → **Mitigation**: The `translateY` animation is a simple property change on a single element; all browsers in our support matrix (Chrome 80+, Safari 15+, Firefox 90+) handle this without `will-change`. If frame drops are observed in testing, a conditional `will-change` can be added back as a follow-up — but the gesture is brief (< 1 second) and the risk is negligible.

- **Risk**: Reverting `.ptr-indicator` to `position: absolute` could cause a visual regression if `.ptr-wrap`'s layout context has changed since the original design. → **Mitigation**: The indicator is a simple flex-centered emoji; visual verification during implementation (manual test of pull gesture) will catch any positioning issues immediately.

### Performance impact

No expected impact on performance budgets. The `translateY` animation drives a single compositor property and remains 60fps-capable without `will-change`. The 16ms interaction budget (RELIABILITY.md) is unaffected — the PTR gesture is a continuous touch-driven animation, not a discrete UI action.

## Task breakdown

### Task 1: Remove will-change:transform from .ptr-content and revert .ptr-indicator to position:absolute

**File:** `web/src/lib/components/PullToRefresh.svelte` (style block only)

Three CSS-only changes, all in the `<style>` block:

1. **`.ptr-content`** (line ~404-406): Remove `will-change: transform;`. The rule keeps only `transition: none;`. Update the CSS comment above to remove the "will-change promotes this element" language.
2. **`.ptr-wrap`** (line ~347-349): Add `position: relative;` so it becomes the containing block for the absolutely-positioned indicator.
3. **`.ptr-indicator`** (line ~358-369): Change from `position: relative; height: 56px; margin-bottom: -56px;` to `position: absolute; top: 0; left: 0; right: 0; height: 56px;`. Remove `margin-bottom`. Update the CSS comment to reflect the absolute positioning approach.

**Done when:** `.ptr-content` has no `will-change` declaration; `.ptr-wrap` has `position: relative`; `.ptr-indicator` uses `position: absolute` with `top: 0; left: 0; right: 0`; pull gesture still works (existing tests pass).

### Task 2: Add unit tests for will-change and ptr-btn absence

**File:** `web/src/lib/components/PullToRefresh.test.ts`

Add two new tests to the existing `PullToRefresh component` describe block:

1. Assert that `.ptr-content` does NOT have `will-change` set to `transform` in its inline styles after render (confirms the CSS fix from Task 1 and guards against regression).
2. Assert that no element with class `.ptr-btn` exists in the rendered DOM (confirms the floating button removal is permanent and guards against regression).

**Done when:** Both new tests pass. All existing PTR tests pass. `npm run test` passes.

## Progress log

- 2026-03-30: Exec plan created by product-manager. Discovery complete.
- 2026-03-30: Design complete (principal-engineer). Approach: remove static `will-change: transform` from `.ptr-content` entirely (fixes containing-block side effect); revert `.ptr-indicator` from `position: relative; margin-bottom: -56px` to `position: absolute` (cleaner, original design). No conditional toggle — modern browsers auto-promote transforms.

## Decision log

- 2026-03-30: Kept scope to a single file (`PullToRefresh.svelte`) — both bugs are self-contained regressions with no cross-domain impact.
- 2026-03-30: Tests are in scope per `docs/CONTRIBUTING.md` mandatory standard ("Every new component/store/module must include at least one unit test"). Bug fixes that alter user-visible behavior require test coverage; this was not flagged as out of scope in the brief.
