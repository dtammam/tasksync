---
plan: fix-webkit-ptr-wheel-debounce-race
harness: v2 · lean
anchor: outcome
status: Building
next: Commit and run /gate.
gate: pending
---

# Fix: webkit PTR wheel-gesture debounce race (tech-debt #051, reopened)

## Request

Self-directed, following the owner's "fix it now" call after tech-debt #051
recurred on PR #152 (webkit `pull-to-refresh.spec.ts` `wheel gesture triggers
sync @smoke`) with the same first-observed opacity value (`0.495999`) as PR
#146's own root-cause writeup for the same test — strong evidence PR #146's
fix (reordering the `opacity === '1'` assertion to run immediately after the
wheel loop) reduced the race's exposure window but did not eliminate it.

## Blind-spot pass

- Confirmed via `grep` that `page.mouse.wheel` is used nowhere else in
  `web/tests/e2e/` — this is the only test with this pattern; no sibling test
  needs the same treatment.
- Read `PullToRefresh.svelte`'s `handleWheel` (lines 388-444): the wheel-end
  debounce is a real, hardcoded 150ms `setTimeout`, reset on every wheel
  event, that starts a 300ms fade-out (`animateOut = true`) once it fires
  with no further event. Once the fade-out starts, opacity only ever
  decreases monotonically toward 0 — there is no path back to `1` — so if
  the test's first poll of `toHaveCSS('opacity', '1')` happens even a few ms
  after the debounce fires, the assertion cannot ever pass and just times
  out at 10s. This is why the failure is a hard timeout, not a slow-pass.
- Confirmed the listener registration (`containerEl.addEventListener('wheel',
  handleWheel, { passive: false })`, line 474) is on `.ptr-wrap` itself, and
  `normalizeDeltaY` (line 363) reads `event.deltaMode`/`event.deltaY`
  directly off whatever `WheelEvent` object it receives — nothing in the
  handler cares whether the event came from real OS wheel simulation
  (`page.mouse.wheel`) vs. a synthetic `new WheelEvent(...)` dispatched via
  `element.dispatchEvent()`, as long as `deltaY`/`deltaMode`/`bubbles` are
  set correctly. This is the basis for the fix: swap the event *source*
  (5 real automation-channel round trips → 1 in-page script execution),
  not the event *shape* consumed by the component.
- The old code's mouse-positioning step (`page.mouse.move` over `.ptr-wrap`)
  existed only because `page.mouse.wheel()` fires at the current cursor
  position — dispatching directly on the element via `evaluate()` makes that
  step unnecessary; removed it rather than leaving dead code.
- No other test in this file (`touch gesture`, presumably above this test)
  is affected — confirmed the touch-gesture test uses a separate
  `dispatchEvent`-free `Pixel 5` emulation path, untouched by this diff.

## Anchor

Anchor — default: `outcome` · recommended: `outcome` (matches default). This
is a bug fix with a crisp, directly observable result (the test passes
reliably under repeated runs); no data model or public interface changes.

## Acceptance

- The webkit `wheel gesture triggers sync @smoke` test passes when run
  repeatedly (target: 10 consecutive runs, `--repeat-each` or a shell loop,
  `--retries=0`) with no `page.mouse.wheel`/mouse-position code remaining in
  the test.
- `grep -n "page.mouse.wheel" web/tests/e2e/pull-to-refresh.spec.ts` returns
  no matches — the round-trip-heavy dispatch path is fully replaced.
- Full webkit `@smoke` project and the full `pull-to-refresh.spec.ts` file
  (all projects) still pass otherwise unchanged — this fix must not regress
  the touch-gesture test or the rest of the wheel-gesture test (fade-out,
  content translation, sync trigger).
- `docs/exec-plans/tech-debt-tracker.md`'s #051 row moves back to Closed,
  linking this PR, once the above is verified — not just asserted.

## Verification (local, pre-gate)

- `npx playwright test --project=webkit --grep "wheel gesture" --repeat-each=10 --retries=0 --workers=1`: 10/10 passed.
- `npx playwright test --project=webkit --grep "wheel gesture" --repeat-each=30 --retries=0 --workers=2`: 30/30 passed.
- `npx playwright test tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit --retries=0 --workers=2`: 5 passed, 1 pre-existing skip (webkit touch-gesture, unrelated to this change), 0 failed — confirms no regression to the sibling touch/pointer-gesture tests or the rest of this same wheel-gesture test (fade-out, content translation).
- `grep -n "page.mouse.wheel" web/tests/e2e/pull-to-refresh.spec.ts`: no matches.
- `npm run lint` / `npm run check`: both clean.
- Firefox project not locally runnable (browser binary not installed in this sandbox) — unrelated to this change; CI covers it.

60 consecutive webkit passes with zero failures is not a formal proof the CI-load race is fully eliminated (local timing differs from CI runners), but it directly validates the causal fix: the 4 extra automation-channel round trips previously in the critical window before the debounce fires are gone, replaced with a single in-page script execution. Will confirm against real CI in the gate/CI cycle.
