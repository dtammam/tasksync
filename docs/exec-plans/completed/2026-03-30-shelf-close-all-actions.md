# Close Mobile Task Shelf on ALL Action Button Taps

## Goal

Ensure the `.quick` action shelf in `TaskRow.svelte` closes after every action button tap, so shelf-dismissal behavior is consistent regardless of which view the task is displayed in.

## Scope

- Add `showActions = false` (via the existing `closeActions` helper) to the four handlers that currently omit it:
  - `toggleStar` (line 102)
  - `punt` (line 72)
  - `addTomorrow` (line 38)
  - `addNextWeek` (line 42)
- Unit test coverage for each of the four fixed handlers verifying `showActions` is `false` after the action fires.
- E2E smoke coverage for at least the Star action (most reproducible since it never moves the task out of view).

## Out of scope

- Changes to `deleteTask` or `openDetailFromMenu` — these already call `closeActions`.
- Any change to shelf open/close animation or timing.
- Changes to how actions are dispatched to stores.
- New shelf features or layout changes.

## Constraints

- Must not regress existing delete/details close behavior.
- Must pass pre-commit quality gates: `npm run lint && npm run check && npm run test`.
- Must pass pre-push gates: web unit + Playwright `@smoke` (Chromium).
- All catch blocks must log (no silent swallowing) — existing handlers already conform; do not introduce regressions.
- Follow CONTRIBUTING.md: every user-visible behavior change requires at least one unit test AND an E2E test for cross-module/regression-prone flows. The shelf-close behavior is user-visible, so both are required.

## Acceptance criteria

- [x] After tapping **Star** on a task that remains visible in the current view, the shelf closes immediately.
- [x] After tapping **Unstar** on a task that remains visible in the current view, the shelf closes immediately.
- [x] After tapping **Punt** on a task that remains visible in the current view (e.g., a list view), the shelf closes immediately.
- [x] After tapping **Tomorrow** on a task that remains visible in the current view, the shelf closes immediately.
- [x] After tapping **Next week** on a task that remains visible in the current view, the shelf closes immediately.
- [x] The existing **Delete** and **Details** actions still close the shelf (no regression).
- [x] Unit tests cover each of the four fixed handlers and assert `showActions === false` post-action.
- [x] At least one E2E `@smoke` test covers the Star action's shelf-close behavior.
- [x] All pre-commit and pre-push quality gates pass (lint, check, vitest, Playwright smoke).

## Risk

Low. This is a one-line fix per handler using an already-defined helper (`closeActions`). No store interface changes, no data model changes, no sync path changes.

## Design

### Approach

This is a trivial fix. Four action handlers in `TaskRow.svelte` (`toggleStar`, `punt`, `addTomorrow`, `addNextWeek`) currently perform their store action but never dismiss the `.quick` action shelf. The existing `closeActions` helper (line 107: `const closeActions = () => (showActions = false);`) already encapsulates the dismiss logic and is used by `deleteTask` and `openDetailFromMenu`. Each of the four handlers gets a single `closeActions()` call at the end of the function body, after the store mutation.

Only `TaskRow.svelte` is affected. No stores, no server code, no data model changes.

### Component changes

- **`TaskRow.svelte`**: Add `closeActions()` call to `toggleStar`, `punt`, `addTomorrow`, and `addNextWeek`. Place it after the existing store call in each handler so the action completes before the shelf dismisses. Use `closeActions()` (not inline `showActions = false`) for consistency with `deleteTask` and `openDetailFromMenu`.

### Data model changes

None.

### API changes

None.

### Alternatives considered

- **Reactive close via `$:` block** — e.g., `$: if (actionFired) showActions = false;`. This would auto-close the shelf whenever any action fires, removing the need to touch each handler. Rejected because: (1) it introduces a reactive side-effect that's harder to reason about, (2) it requires a new flag variable and reset logic, and (3) the explicit per-handler approach is only four one-line additions and makes intent clear at each call site.

### Risks and mitigations

- **Risk**: Punt/tomorrow/next-week may cause the task to leave the current view (e.g., punting from My Day removes it from the list). -> **Mitigation**: The `closeActions()` call is cosmetic in those cases (the row disappears anyway), but it's still correct behavior — if the view doesn't remove the task (e.g., viewing a list), the shelf will properly close. No harm either way.
- **Risk**: Regression in existing delete/details close behavior. -> **Mitigation**: Those handlers are not touched. Unit tests will cover all six action handlers.

### Performance impact

No expected impact on performance budgets. This adds zero DOM elements, zero new reactive bindings, and zero async operations.

### Test strategy

- **Unit tests**: One test per fixed handler (`toggleStar`, `punt`, `addTomorrow`, `addNextWeek`) asserting `showActions` is `false` after the action fires. Also verify existing `deleteTask` and `openDetailFromMenu` still close (regression guard).
- **E2E smoke**: One Playwright `@smoke` test for the Star action — tap the actions chip, tap Star, assert the `.quick` shelf is no longer visible. Star is chosen because the task always remains visible after starring (unlike punt/tomorrow/next-week which may remove it from view).

## Task breakdown

### T1: Add closeActions() to all four handlers and write tests

**Code changes:**
- In `web/src/lib/components/TaskRow.svelte`, add `closeActions()` at the end of these four handlers: `toggleStar`, `punt`, `addTomorrow`, `addNextWeek`.

**Test changes:**
- Unit tests: assert `showActions === false` after each of the four fixed handlers fires. Add regression tests for `deleteTask` and `openDetailFromMenu` confirming they still close the shelf.
- E2E: one Playwright `@smoke` test -- tap the actions chip on a task, tap Star, assert the `.quick` shelf is no longer visible.

**Quality gates:** lint, check, vitest, Playwright smoke must all pass.

**Done when:** All four handlers call `closeActions()`, all six action-handler unit tests pass, E2E smoke passes, all quality gates green.

## Progress log

- 2026-03-30: Exec plan created by product-manager. Feature in discovery stage.
- 2026-03-30: Design complete. Approach: add `closeActions()` to four handlers. No architectural changes.
- 2026-03-30: Feature complete. All acceptance criteria passed. Moved to completed.

## Decision log

- 2026-03-30: Scope set to all four non-closing handlers (punt, tomorrow, next-week, star/unstar). Delete and details already correct — no change needed there.
- 2026-03-30: E2E coverage scoped to Star action as it is the most reproducible (task always stays visible after starring). Punt/tomorrow/next-week E2E deferred — their close behavior is harder to isolate without controlling view context — covered by unit tests instead.
