# Increase PTR maximum drag distance

**Date:** 2026-03-30
**Status:** Complete
**Feature ID:** ptr-increase-max-drag

## Goal

Increase the pull-to-refresh maximum drag distance from 150px to ~400px so the content shifts down to roughly half screen height, giving the gesture a more satisfying, spacious feel on mobile.

## Non-goals

- Viewport-relative logic (e.g., `window.innerHeight / 2`) — explicitly rejected by user.
- Changes to trigger threshold, animation timing, emoji set, or any other PTR parameter.
- Any behavioral or functional changes to PTR beyond the feel of the drag distance.
- Changes outside `pullToRefreshUtils.ts` and its test file.

## Constraints

- `PULL_MAX` must remain a fixed pixel constant. No dynamic/viewport-relative calculation.
- Offline-first and performance budgets are unaffected (this is a constant tweak, no new logic).

## Current state

In `web/src/lib/components/pullToRefreshUtils.ts`:
- `PULL_MAX = 150` — caps damped pull distance at 150px.
- `PULL_DAMPING = 0.5` — raw touch delta is halved before clamping.
- `applyPullDamping(rawDelta)` returns `Math.min(rawDelta * PULL_DAMPING, PULL_MAX)`.

Existing tests in `PullToRefresh.test.ts` reference `PULL_MAX` and `PULL_DAMPING` symbolically (not hard-coded values), so they will pass automatically after the constants change.

## Proposed approach

1. In `pullToRefreshUtils.ts`, change `PULL_MAX` from `150` to `400` (exact value TBD during implementation — target range 380–420px).
2. Evaluate whether `PULL_DAMPING` needs adjustment. At 0.5 damping and 400px max, the user must drag 800px raw to hit the ceiling — this may feel too heavy. A slight increase (e.g., 0.55–0.6) could improve the feel. Decide during implementation via manual testing.
3. Verify all existing tests pass with the new values (they should, since they use symbolic references).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Viewport-relative `PULL_MAX` (e.g., `innerHeight / 2`) | User explicitly rejected — wants a fixed pixel value |
| Leave `PULL_MAX` at 150 and only adjust damping | Doesn't achieve the goal of more content translation |

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| 400px feels too long on small screens | Low | Fixed value is a reasonable compromise; can be tweaked later |
| Damping too heavy at 0.5 with 400px max | Medium | Adjust damping during implementation; manual touch-test on device |

## Acceptance criteria

1. `PULL_MAX` in `pullToRefreshUtils.ts` is set to a value in the 380–420px range.
2. `PULL_DAMPING` is either unchanged (0.5) or adjusted to a value that feels natural at the new max distance, with a brief justification in the progress log.
3. All existing unit tests (`npm run test`) pass without modification.
4. `npm run lint` and `npm run check` pass.
5. No viewport-relative logic is introduced — `PULL_MAX` remains a literal numeric constant.

## Test plan

- Run `cd web && npm run test` — all existing PTR tests pass (they use symbolic constants).
- Run `cd web && npm run lint && npm run check` — no regressions.
- Manual verification: pull gesture on mobile/devtools touch emulation reaches roughly half screen height.

## Rollout / migration plan

None required. This is a CSS/UX constant change with no data model, API, or persistence impact.

## Design

### Approach

This is a single-constant change in `pullToRefreshUtils.ts`. Set `PULL_MAX` from `150` to **400**. Keep `PULL_DAMPING` at **0.5** (unchanged).

**Why 400px:** It is the midpoint of the 380–420px target range, a clean round number, and maps directly to the user's goal of "roughly half screen height" (typical mobile viewports are 700–900px).

**Damping analysis — keep 0.5:** At `PULL_DAMPING = 0.5` with `PULL_MAX = 400`, the raw drag required to hit the ceiling is `400 / 0.5 = 800px`. This sounds high, but the ceiling is not the target — it is the asymptotic resistance cap. In practice:

- A 300px raw drag → 150px damped (current max becomes the natural midpoint).
- A 500px raw drag → 250px damped (comfortable full-thumb swipe).
- A 700px raw drag → 350px damped (aggressive pull, near screen bottom).

The trigger threshold (default 64px) still activates at only `64 / 0.5 = 128px` raw — unchanged and easy to reach. The expanded max just gives the gesture more visual travel before hitting the clamp, which is the stated goal.

Increasing damping (e.g., 0.55 or 0.6) would make the ceiling easier to reach but would also reduce the resistance feel that makes the pull gesture feel physical. The 0.5 factor is a standard damping ratio for rubber-band UI interactions (iOS uses a similar value). Changing it is not recommended unless manual device testing reveals a problem — and the exec plan already allows the implementer to adjust during testing if needed (AC #2).

### Component changes

- **`web/src/lib/components/pullToRefreshUtils.ts`**: Change `PULL_MAX` from `150` to `400`. No other changes.

### Data model changes

None.

### API changes

None.

### Alternatives considered

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| Increase damping to 0.55 alongside `PULL_MAX = 400` | Ceiling reachable at 727px raw (fits most screens) | Reduces resistance feel; adds a second variable to validate; trigger threshold drops to 116px raw (minor) | Reject — solve one problem at a time; implementer can adjust per AC #2 if needed |
| Use a higher `PULL_MAX` (e.g., 500) with 0.5 damping | Even more visual travel | Requires 1000px raw to reach ceiling (unreachable on any phone); diminishing returns past ~400px | Reject — 400px already provides ample range |
| Non-linear damping curve (e.g., quadratic ease-out) | More natural feel at extreme distances | Adds complexity to a currently-trivial function; scope creep; requires new tests | Reject — out of scope; file as tech debt if desired later |

### Risks and mitigations

- **Risk**: 400px feels excessive on small screens (e.g., iPhone SE at 568px viewport). → **Mitigation**: At 0.5 damping, a realistic pull on a small screen tops out around 250px damped — well within reason. The 400px cap is only reachable on larger devices with full-screen drags.
- **Risk**: Changing a shared constant could break consumers. → **Mitigation**: Only `PullToRefresh.svelte` imports `PULL_MAX` (confirmed via grep). All tests use symbolic references and pass with any positive numeric value.

### Performance impact

No expected impact on performance budgets. This changes a numeric constant used in a single `Math.min` call during touch events. No new allocations, DOM operations, or async work.

## Task Breakdown

| ID | Task | Files | Definition of Done |
|---|---|---|---|
| T1 | Change `PULL_MAX` from 150 to 400 | `web/src/lib/components/pullToRefreshUtils.ts` | `PULL_MAX` is `400`, `PULL_DAMPING` is `0.5`, `npm run lint` + `npm run check` + `npm run test` all pass with no test file changes |

## Progress log

- **2026-03-30:** Discovery complete. Exec plan written. Existing tests confirmed to use symbolic constant references — no test changes needed.
- **2026-03-30:** Design complete. Recommend PULL_MAX = 400, keep PULL_DAMPING = 0.5. Single-constant change in pullToRefreshUtils.ts; no test modifications needed.
- **2026-03-30:** Feature complete. PULL_MAX changed to 400, all quality gates pass (lint, check, 277 tests), acceptance criteria validated. Moving to completed.
- **2026-03-30:** Post-deploy: contentTranslateY in PullToRefresh.svelte was still capped at INDICATOR_HEIGHT (56px), making the PULL_MAX increase invisible. Fixed by using pullDistance directly for content translation. Also replaced linear damping formula with exponential rubber-band curve (`PULL_MAX * (1 - exp(-rawDelta * PULL_DAMPING / PULL_MAX))`) for progressive resistance. Tests updated to validate diminishing-returns behavior. Scope expanded beyond original "single-constant change" — three files modified: pullToRefreshUtils.ts (formula), PullToRefresh.svelte (translateY), PullToRefresh.test.ts (curve tests). 278 tests passing.
- **2026-03-30:** Iterative tuning: PULL_MAX 400→300→200→140, PULL_DAMPING 0.5→0.7→0.9. Final values: PULL_MAX=140 (~17.5% screen height), PULL_DAMPING=0.9. Gives a snappy, firm rubber-band feel with a noticeable stop. User confirmed "basically perfect."

## Decision log

- **2026-03-30:** User rejected viewport-relative `PULL_MAX`. Fixed pixel value chosen. Target range: 380–420px.
- **2026-03-30:** Final tuned values after iterative testing: PULL_MAX=140, PULL_DAMPING=0.9. User preferred shorter, firmer pull over the originally planned ~half-screen distance.
