# Fix task list items hidden behind fixed add-task input overlay

## Problem statement

Task list items at the bottom of a scrollable list cannot be fully scrolled into view. When a list has more tasks than fit on screen, the last few task rows are obscured by the `.mobile-add` bar, which is `position: fixed` at the bottom of the viewport. Users cannot see or interact with those tasks.

This affects both views that render the overlay:
- **My Day** (`web/src/routes/+page.svelte`)
- **List** (`web/src/routes/list/[id]/+page.svelte`)

## Goal

Ensure that every task row in a scrollable list can be fully scrolled into view, without removing or repositioning the fixed add-task input.

## Scope

- Bottom-padding on the scroll container (`<main>` in `+layout.svelte`) or on the per-route page content wrapper (`.page-content` on My Day; the bare route root on the list view) so the last task clears the overlaid input bar.
- Both affected routes: My Day (`+page.svelte`) and List (`list/[id]/+page.svelte`).
- Both desktop and mobile viewport breakpoints.

## Out of scope

- Changing the positioning model of `.mobile-add` (it remains `position: fixed`).
- Changes to any route other than the two identified above.
- Server-side changes.
- Changes to sync, stores, or any data layer.
- New UI features or layout refactors beyond the padding/spacing fix.

## Constraints

- Must not introduce a CSS regression for short lists that fit on screen without scrolling (no excessive blank space at the bottom in the no-scroll case).
- Must respect the 16 ms interaction budget defined in `docs/RELIABILITY.md` — a CSS-only change carries no interaction cost.
- Must work correctly with `overscroll-behavior-y: none` already set on `<main>` (required by `docs/RELIABILITY.md` for pull-to-refresh compatibility — do not change it).
- Must account for `env(safe-area-inset-bottom)` on iOS to avoid double-counting safe-area space already applied to `.mobile-add`.
- Must work on both mobile (≤ 900 px) and desktop (> 900 px) viewports.
- The `.mobile-add` bar must remain visible and fully interactive after the fix.
- No `@ts-nocheck`, no fire-and-forget writes, no new stores — this is a CSS-only change.

## Acceptance criteria

- [x] When a list view (My Day or a named list) contains enough tasks to require scrolling, the last task row is fully visible above the add-task input bar when the user scrolls to the bottom.
- [x] The add-task input bar remains fully visible, accessible, and functional after the fix.
- [x] On a short list that requires no scrolling, there is no excessive blank area beneath the final task on either route.
- [x] The fix applies correctly at mobile viewport widths (≤ 900 px) and desktop viewport widths (> 900 px).
- [x] The fix applies correctly on iOS (safe-area inset is respected and not double-counted).
- [x] Existing Playwright smoke tests continue to pass with no modifications.
- [x] `npm run lint`, `npm run check`, and `npm run test` all pass.

## Design

### Root cause

- **List route** (`web/src/routes/list/[id]/+page.svelte`): Has **zero bottom padding** on its content. The last task rows are hidden behind the `position: fixed` `.mobile-add` bar.
- **My Day route** (`web/src/routes/+page.svelte`): Already has adequate bottom padding on `.page-content` (128px desktop / 108px mobile), so tasks are visible. However, the existing values should be validated against the actual bar height.

### Measured `.mobile-add .bar` height

- Input height: 46px
- Vertical padding: 12px (6px × 2)
- Border: 2px (1px × 2)
- Bottom offset: `env(safe-area-inset-bottom, 0px) + 10px`
- **Total rendered height:** ~70px + safe-area inset

### Approach

Add a `.page-content` wrapper `<div>` to the **list route** with bottom padding that clears the overlay bar:

```css
.page-content {
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 80px);
}
```

The 80px value provides 10px breathing room above the ~70px bar. This matches the pattern already used by My Day.

### Why per-route padding (not on `<main>`)

- Only routes with `.mobile-add` need the extra padding.
- Putting it on `<main>` would add unnecessary blank space to routes without the overlay (e.g., Settings, Login).

### Why a wrapper div (not padding on the last `.block`)

- Robust regardless of which section renders last (completed, pending, empty state).
- No need to track conditional rendering to decide which element gets the padding.

### No CSS custom property needed

Only two consumers (My Day, List). Adding a custom property would be premature abstraction per project guidelines.

### Files to change

| File | Change |
|------|--------|
| `web/src/routes/list/[id]/+page.svelte` | Wrap scrollable content in a `.page-content` div with bottom padding |

### Risks

- **Low:** The wrapper div could affect existing layout if flex/grid children assume a flat structure. Mitigated by inspecting the current structure — the list route content is block-flow, so an extra div is inert.

### Alternatives considered

1. **Padding on `<main>` globally** — Rejected: affects all routes, creates blank space where not needed.
2. **`scroll-padding-bottom` on `<main>`** — Rejected: `scroll-padding` only affects programmatic scroll snapping, not user scroll extent.
3. **`margin-bottom` on last task element** — Rejected: fragile, depends on which section renders last.

## Task breakdown

### T1: Add .page-content wrapper with bottom padding to list route

**File:** `web/src/routes/list/[id]/+page.svelte`

**What to do:**
1. Wrap the scrollable content (from `<header class="page-header">` through the `<TaskDetailDrawer>` component) in a `<div class="page-content">` wrapper div.
2. The `.mobile-add` div must remain OUTSIDE the wrapper (it is `position: fixed` and unaffected by flow padding).
3. Add CSS: `.page-content { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 80px); }`
4. Follow the pattern from My Day (`web/src/routes/+page.svelte`) which already uses this wrapper.

**Done when:**
- The list route has a `.page-content` wrapper with bottom padding that clears the fixed `.mobile-add` bar.
- The `.mobile-add` div is outside the wrapper.
- `npm run lint`, `npm run check`, and `npm run test` all pass.
- Existing Playwright smoke tests pass without modification.

## Progress log

- 2026-05-07 — Discovery complete. Exec plan written. Root cause identified: both route pages render `.mobile-add` as `position: fixed` at the bottom of the viewport, but the scroll container (`<main>`) has no corresponding bottom padding to push content clear of the overlay. My Day already has `.page-content { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 128px) }` on desktop and `108px` on mobile — these values may be insufficient or the list route has no equivalent at all. The fix is expected to be a CSS adjustment to bottom padding values on both routes, verified against the measured height of `.mobile-add .bar` (~58 px rendered: 6 px padding × 2 + 46 px input height) plus its own `bottom` offset of `env(safe-area-inset-bottom, 0px) + 10px`.
- 2026-05-07 — Design complete. Root cause: list route has zero bottom padding. Fix: add `.page-content` wrapper with `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 80px)`. Single file change.
- 2026-05-07 — T1 implemented. `.page-content` wrapper added to list route with bottom padding. All quality gates pass.
- 2026-05-07 — QA review: APPROVE. Code follows existing My Day pattern correctly.
- 2026-05-07 — Build verification: all quality gates pass (lint, check, test, Playwright smoke).
- 2026-05-07 — Acceptance: all 7 criteria validated and passed. Feature complete.

## Decision log

- 2026-05-07 — Confirmed fix scope is CSS-only on the two affected routes. No changes to `+layout.svelte`, stores, or positioning model of the overlay.
