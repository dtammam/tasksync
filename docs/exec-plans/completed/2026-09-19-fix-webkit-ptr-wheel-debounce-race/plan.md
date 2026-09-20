---
plan: fix-webkit-ptr-wheel-debounce-race
harness: v2 · lean
anchor: outcome
status: Shipped (superseded — #051 landed via PR #154, merged to main @31c76e8)
next: Done. This standalone branch was folded into fix/e2e-flake-elimination; see that plan.
gate: APPROVED — the combined change landed via #154 (r4 @2c0f344); this standalone plan's own verdicts are historical (below).
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

## Fix revision r2 (post QA-CHANGES @90666af → new sha)

QA's r1 CHANGES was correct: the first attempt (single `page.evaluate()` for
the *dispatch*, followed by an `await expect(indicator).toHaveCSS('opacity',
'1')` locator assertion) still left the *closing assertion's* own Node↔WebKit
round trip inside the 150ms debounce window — it shrank the race, it never
closed it. Under load that single remaining round trip loses the race a large
fraction of the time, which is exactly what QA reproduced (19/40 failed).

r2 folds the dispatch **and the observation** into one `page.evaluate()`:
dispatch the 5 `WheelEvent`s, then poll the computed opacity in-page across
microtasks (bounded by a wall-clock deadline of 120ms, safely under the 150ms
debounce) until Svelte has flushed its reactive DOM update, and read the
content `style` in the same in-page execution; the test asserts on the
returned values. The 150ms `setTimeout` runs on the same in-page event loop as
this script, so it provably cannot fire before we read — a tight microtask
loop does not yield to the macrotask (timer) queue. Deliberately **not**
`requestAnimationFrame`: rAF is frame-throttled, so on a CPU-starved 2-core
GitHub free runner (the actual failure surface — local timing on this shared
6-core box is only indicative) a single frame could itself stall past 150ms.
Microtask yields are not frame-throttled and resolve sub-millisecond. No
automation-channel round trip remains inside the timed window — the race is
closed by construction, not merely narrowed, and the argument holds
independent of core count/CPU load. The mid-gesture `content` translateY
assertions (which had the *same* race and would have become the next flaky
line) are folded into the same read.

## Verification (local, pre-gate) — r2

- `npm run lint` / `npm run check`: both clean.
- `npx playwright test --project=webkit --grep "wheel gesture" --repeat-each=20 --retries=0 --workers=1` (unloaded): **20/20 passed.**
- **Controlled load A/B (same machine, 2× `yes > /dev/null` background, `--workers=2`, load avg 5.8→7.9 on 6 cores — comparable-to-heavier than QA r1's 4.39–6.08):**
  - r2 fix, `--repeat-each=20`: **20/20 passed.**
  - main's old `page.mouse.wheel()` pattern (restored into the working file), same command under the same live load: **7 failed / 13 passed (35%).**
  - This reproduces the historical failure on this machine *right now* on the old pattern and shows the r2 fix eliminating it under identical conditions — resolving the r1 Adversary-vs-QA conflict (both were honest measurements at different ambient load; the discriminating A/B settles it).
- `npx playwright test tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit --retries=0`: **5 passed, 1 pre-existing skip** (webkit touch-gesture, CDP-only, unrelated), 0 failed — no regression to the sibling pointer/touch tests (those hold the pointer down with no debounce, so their `opacity:1` assertion is not subject to this race) or to the wheel test's fade-out path.
- `grep -c "page\.mouse\.wheel(" web/tests/e2e/pull-to-refresh.spec.ts`: **0 call sites** (r1's false "no matches for `page.mouse.wheel`" claim is dropped — the bare string no longer appears at all in r2, since the explanatory comment was rewritten).
- Firefox project not locally runnable (browser binary absent in this sandbox) — unrelated to this change; CI covers it.

The load A/B is not a formal proof the CI-load race is impossible, but it is a direct causal demonstration under reproduced failure conditions, not the "60 consecutive passes at unknown ambient load" that r1 (correctly) got challenged on. Will confirm against real CI in the gate cycle.

## CI confirmation (real GitHub free runners) @63b99d2

The actual arbiter — CI on GitHub's shared free runners, the true failure
surface (not this 6-core box). Pushed sha `63b99d2` (= `cf23684` fix + gate/
bookkeeping doc commits; code identical):
- **`web-e2e-matrix (webkit)`: success** — the `wheel gesture triggers sync
  @smoke` test passed on the real webkit runner. This is the acceptance
  criterion #051 was reopened for.
- `web-e2e-matrix (chromium)`: success. `web` (unit/lint/build): success.
  `server`: success.
- **Two CI jobs went red, both on the SAME unrelated test**
  `tests/e2e/offline.spec.ts:588` ("@smoke offline title edit survives reload
  and syncs once after reconnect") — firefox full suite failed at :604
  (`toHaveCount`, 56 passed / 1 failed); the push smoke gate failed on chromium
  at :637 (`toHaveAttribute`, 23 passed / 1 failed). This is **tech-debt #050**
  (the pre-existing offline flake, open/unassigned), NOT this change: this diff
  touches only `pull-to-refresh.spec.ts` + docs, nothing `offline.spec.ts`
  depends on. #050 is what currently keeps PR #153 red; #051's own fix is green
  on CI across all browsers.

Net: #051's fix is verified on the real failure surface. PR #153 cannot go
fully green (and so should not merge) until #050 is addressed separately.

## Gate

### QA r1 @90666af2bfa55c5e4ace5ddd5e8d43a97e48143a

**Instruments run (verbatim counts):**
- `cd web && npm run lint`: clean (`eslint .`, no output, exit 0).
- `cd web && npm run check`: `svelte-check found 0 errors and 0 warnings`.
- `cd web && npx vitest run`: **28 test files passed (28), 411 tests passed (411)**, 0 failed.
- `cd server && cargo test`: **107 passed; 0 failed; 0 ignored**. `cargo fmt -- --check`: clean. `cargo clippy --all-targets -- -D warnings`: clean. Confirms server is unaffected and at main-parity — this diff touches no `server/**` file (see scope check below).
- `npx playwright test tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit --retries=0`: **5 passed, 1 skipped** (webkit touch-gesture — pre-existing `test.skip(browserName !== 'chromium', ...)`, CDP-only, unrelated to this change), 0 failed.
- `npx playwright test --project=webkit --grep "wheel gesture" --repeat-each=20 --retries=0 --workers=1`, run twice independently: **run 1: 16 passed, 4 failed. run 2: 5 passed, 15 failed.** Combined: 21/40 passed, **19/40 failed (47.5%)**.

**CRITICAL — the fix does not eliminate the race it claims to fix** (`web/tests/e2e/pull-to-refresh.spec.ts:181-251`, and by extension the plan's Acceptance and Verification sections). Independently re-running the exact command the plan itself prescribes for verification reproduces failures with the *identical* signature `tech-debt-tracker.md` #051 documents: `toHaveCSS('opacity','1')` timeout, first polled value already mid-fade (`0.879534`, `0.495999` — the same literal value cited in the tracker row and PR #146's original writeup — decaying through `0.41399` / `0.000074` to `0`). This was reproduced twice, at 20% and 75% failure rates respectively (system load average 4.39–6.08 on 6 cores during both runs — i.e. comparable to the "CI load" condition the plan's own root-cause theory names as the trigger). This directly contradicts the plan's stated local verification (`10/10`, `30/30`, "60 consecutive webkit passes with zero failures") and its Acceptance criterion ("passes when run repeatedly... target: 10 consecutive runs... with no `page.mouse.wheel`/mouse-position code remaining" — the code criterion is met, the reliability criterion is not, empirically).

Root-cause read (for the fix, not just the symptom): removing the 5 automation-channel round trips for the wheel dispatch itself doesn't remove the *closing assertion's* own round trip. `page.evaluate()`'s dispatch loop already burns part of the 150ms debounce window before it even returns; the subsequent `await expect(indicator).toHaveCSS('opacity', '1')` still requires one full WebKit-automation-channel round trip (locator resolution + computed style) to land before that window closes. Under load, that single remaining round trip is still enough to lose the race a large fraction of the time — same race, smaller window, not closed. This is evidence-based (both runs' Call logs show the debounce firing and completing its fade-out before the first poll lands), not speculation.

This blocks: tech-debt #051 is correctly left open/unassigned in this diff (see below — that part is right), but the fix as implemented does not meet its own bar and should not be merged as "the fix" while it fails at this rate under load.

**WARNING** — `docs/exec-plans/active/2026-09-19-fix-webkit-ptr-wheel-debounce-race/plan.md:78`: the Verification section asserts `grep -n "page.mouse.wheel" web/tests/e2e/pull-to-refresh.spec.ts`: no matches. Re-run verbatim: **3 matches** (lines 206, 214, 223) — all inside the new explanatory comments referencing the old API by name (e.g. "page.mouse.wheel() dispatches through the full automation-channel round trip per call"). The underlying acceptance intent (no actual `page.mouse.wheel()` *calls* left) is satisfied — this is a documentation-accuracy gap, not a functional one — but the plan's own "verified — not just asserted" framing makes this worth fixing: either drop the literal grep claim or scope it to `page\.mouse\.wheel\(\)` call sites.

**Comment accuracy (verified against `web/src/lib/components/PullToRefresh.svelte`):**
- "`handleWheel`'s `normalizeDeltaY()` reads `deltaY`/`deltaMode` off whatever `WheelEvent` it receives" — confirmed (`normalizeDeltaY(event)` switches on `event.deltaMode`, default branch reads `event.deltaY` as-is; lines 363–373). No `isTrusted` check anywhere in `handleWheel`, so a synthetic, untrusted `dispatchEvent()` is handled identically to a real one.
- "150ms debounce" — confirmed (`setTimeout(..., 150)`, line 427/443).
- "registered as `{ passive: false }`" — confirmed (line 474).
- "deltaMode 0 matches `page.mouse.wheel()`'s `DOM_DELTA_PIXEL`" — this is a claim about Playwright/browser-internal behavior, not verifiable from this repo's source; it is consistent with documented Playwright/DOM convention and doesn't affect correctness either way since `deltaMode: 0` is the correct default regardless of what `page.mouse.wheel()` itself emits.

**Standards/idiom check:** `page.evaluate()` dispatching synthetic events is an established pattern in this suite, not a new style — `offline.spec.ts` dispatches `new Event('visibilitychange')` this way four times, `auth.spec.ts` and `myday.spec.ts` use `page.evaluate()` for in-page state manipulation, and this very file already uses `page.evaluate()` for scroll reset immediately above the changed block. No standards violation.

**tech-debt-tracker.md #051:** correctly left in the Active/Open table as "Reopened 2026-09-19", `unassigned`, with "before re-closing" language intact — not prematurely re-closed. `git log --oneline --all | grep -iE "146|152"` confirms both PR merge commits exist (`8d6d566` PR #146, `b6b930b` PR #152); `git log -S "Root-caused and fixed"` shows the now-removed Closed-table entry was added in a separate docs-only commit (`affeece`), consistent with this PR's own choice to defer re-closing until CI confirms rather than repeat that mistake. Given the CRITICAL finding above, this deferral turns out to be the right call — do not close #051 until the actual race is fixed.

**Scope:** `git diff --name-only main...HEAD` → exactly 3 files (`docs/exec-plans/active/2026-09-19-fix-webkit-ptr-wheel-debounce-race/plan.md`, `docs/exec-plans/tech-debt-tracker.md`, `web/tests/e2e/pull-to-refresh.spec.ts`). Nothing under `server/**`.

**Security surface:** none. This diff touches only a Playwright test file (dispatches hardcoded-literal synthetic `WheelEvent`s inside an already-fully-trusted browser automation context — no external/untrusted input reaches `dispatchEvent`) and two Markdown docs (static prose, no templating/execution). No injection, traversal, SSRF, auth, or data-exposure surface.

**Tree state:** `git status` clean at `90666af` other than this verdict write; no untracked files.

Gate: CHANGES r1 @90666af2bfa55c5e4ace5ddd5e8d43a97e48143a — qa

## Gate

**Adversary review (r1 @90666af2bfa55c5e4ace5ddd5e8d43a97e48143a)**

Verified by measurement (not by trusting the plan doc):

- **Code path parity confirmed at source.** `containerEl` (`PullToRefresh.svelte`
  line 552, `bind:this`) IS `.ptr-wrap`; the `wheel` listener is registered on it
  with `{ passive: false }` (line 474); `handleWheel` calls `event.preventDefault()`
  on the accumulation path (line 423). `normalizeDeltaY` (lines 358-370) reads
  only `event.deltaMode`/`event.deltaY` — no `deltaX`, `wheelDelta`, or vendor
  property anywhere in the handler. `grep -rn "isTrusted"` across `web/src` and
  `web/tests` returns zero matches — nothing in the codepath distinguishes a
  `dispatchEvent()`-constructed `WheelEvent` from a browser-native one.
- **Threshold math confirmed at source.** `pullToRefreshUtils.ts`:
  `PULL_MAX = 140`, `PULL_DAMPING = 0.9`,
  `applyPullDamping = PULL_MAX * (1 - exp(-rawDelta * PULL_DAMPING / PULL_MAX))`
  — matches the test's own comment exactly. 5×40px = 200px raw yields ≈101px,
  past the 64px threshold as claimed.
- **Fresh, independent test runs (new evidence, not the plan doc's own numbers):**
  - `--project=webkit --grep "wheel gesture" --repeat-each=15 --retries=0 --workers=1`: **15/15 passed.**
  - `tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit --retries=0`: **5 passed, 1 skipped** (webkit touch-gesture, pre-existing/unrelated), 0 failed.
  - `npm run lint` (web/): clean, no output.
- **Mutation test (controlled A/B, same machine, same induced load).** Restored
  main's pre-fix test body (5 awaited `page.mouse.wheel()` calls + `page.mouse.move`
  positioning, assertion order unchanged) into a scratch copy of the committed
  file, ran it under artificial CPU contention (`yes > /dev/null` ×2 background
  processes + `--workers=2`), then restored the committed fix and repeated the
  identical load:
  - **Mutant (old `page.mouse.wheel()` pattern) under load: 7/20 failed**, every
    failure at the exact opacity assertion line, with opacity values matching
    the historical bug signature verbatim — including `"0.495999"`, the same
    first-observed value cited in both PR #146's own root-cause writeup and
    this PR's tracker entry.
  - **Fixed `page.evaluate()` pattern under identical load: 20/20 passed.**
  - This is a direct, reproduced repro of the mechanism this PR claims to fix,
    and a clean before/after under matched conditions — not just "should work."
  - (An earlier, much heavier stress attempt — 4× `yes` + 3 webkit workers on 6
    cores — broke basic page load for both mutant and fixed versions alike,
    i.e. it was overloading the harness itself, not isolating the debounce
    race; discarded in favor of the lighter, discriminating load above.)
  - Tree restored after mutation testing; `git status`/`git diff` clean, only
    gitignored `web/test-results/` artifacts were produced and have been removed.
- **Scope.** `git diff --name-only main...HEAD` — exactly 3 files: the test
  file, `tech-debt-tracker.md`, and this plan doc. Nothing under `server/` or
  unrelated `web/src/**`.
- **tech-debt-tracker.md honesty check.** #051 is reopened in the Open table
  (not moved back to Closed), correctly not claiming this fix as verified-closed
  yet, per the plan's own acceptance bullet 4. The cited recurrence evidence
  (`0.495999` first-observed opacity) is corroborated against
  `docs/exec-plans/completed/2026-09-19-chore-ci-trace-uploads-and-ptr-race-fix.md`
  (PR #146's own doc), which independently quotes the same value in the same
  context — not fabricated.

**Finding — WARNING (disclosed, not blocking):** the plan doc's Verification
section and one of its own Acceptance bullets both assert
`grep -n "page.mouse.wheel" web/tests/e2e/pull-to-refresh.spec.ts` returns "no
matches." Measured directly: it returns **3 matches** — all inside the new
explanatory prose comments the diff itself added (describing the old,
now-removed approach for future readers), not an actual `page.mouse.wheel(`
call site. `grep -n "page\.mouse\.wheel\("` (call-site only) returns zero
matches, and no CI/tooling step keys off the bare-string grep, so this doesn't
block: the acceptance criterion's actual intent (no round-trip-heavy dispatch
API left in the test) is satisfied. But the plan doc's own claim, as literally
written, is false — flagging so it isn't restated uncritically in a future
doc. Non-blocking; recommend a follow-up wording tweak to the plan doc and/or
the comment text if this is touched again.

No CRITICAL or blocking WARNING findings.

Gate: r1 adversary verdict SUPERSEDED by r2 below — it approved @90666af, but that sha's code is stale (now @cf23684); superseded, not re-endorsed.

## Gate

**Adversary review (r2 @cf23684100297bd351a31b68dbe4c8738c3c6036)**

Delta re-review of r2 (r1 QA CHANGES @90666af was the correct blocker; r1
Adversary approval @90666af is void — the tree moved). Verified by measurement:

- **Instruments (verbatim).** `cd web && npm run lint`: clean, no output, exit 0.
  `npm run check`: `svelte-check found 0 errors and 0 warnings`. Server untouched
  (`git diff --name-only b6b930b HEAD | grep -E '^server/|^web/src/'` → none), so
  cargo skipped per brief.
- **Regression (full file, all projects).** `npx playwright test
  tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit
  --retries=0`: **5 passed, 1 skipped** (webkit touch-gesture, pre-existing
  CDP-only skip), 0 failed. Sibling pointer/touch tests and the wheel test's
  fade-out (`opacity 0`, line 270) path unaffected.
- **Race closure — controlled A/B, same machine, 2× `yes > /dev/null`,
  `--workers=2`, load avg peaking 8.9–10.2 on 6 cores (heavier than QA r1's
  4.39–6.08):**
  - r2 fix (committed), `--repeat-each=20 --retries=0`: **20/20 passed.**
  - main's old `page.mouse.wheel()` pattern (`git show b6b930b:` restored into
    the working file), same command under the same live load: **6 failed / 14
    passed (30%)** — every failure at the old `toHaveCSS('opacity','1')`
    assertion line, first polled value already mid-fade (`0.417219`, `0` …), the
    historical #051 signature. Tree restored (`git checkout --`) and
    gitignored `web/test-results/` removed afterward; `git status` clean.
  - This is a direct causal before/after under reproduced failure conditions on
    this box right now. My old-pattern rate (30%) is consistent in magnitude with
    the plan's r2 A/B (35%) and QA r1 (47.5%); the fix's 0% is consistent with the
    plan's 20/20 and the Adversary r1 A/B (20/20).
- **Microtask reasoning verified at primary source (Svelte 5.48.2).**
  `Batch.ensure()` schedules `batch.flush()` via `queue_micro_task(...)`
  (`svelte/src/internal/client/reactivity/batch.js:487-495`), and
  `queue_micro_task` uses `queueMicrotask` (`.../dom/task.js:16-19`). So the DOM
  flush queued during the synchronous 5-event dispatch is a microtask that drains
  (FIFO) before any macrotask; `getComputedStyle(indicatorEl).opacity` after
  `await Promise.resolve()` reliably reflects the flushed inline `style="opacity:
  1"` (indicator opacity is inline, no transition while `animateOut` is false).
  The tight microtask loop keeps the queue non-empty, so the 150ms
  `wheelEndTimer` macrotask (armed at end of dispatch, PullToRefresh.svelte:443)
  cannot fire until the loop exits at its 120ms deadline — ~30ms margin, closed by
  construction. `indicatorOpacity = min(pullDistance/threshold, 1)` reaches exactly
  1 at ~99px/64px (line 108), so `'1'` is reachable — no false deadline read; the
  120ms deadline was never hit across 40 loaded + 20 unloaded runs.
- **Assertion strength not weakened vs r1.** r2 preserves all three checks with
  equal strength: `opacity === '1'`, `contentStyle` matches `/translateY\(/`,
  and NOT `/translateY\(0px\)/` — both reading the same sources (computed opacity;
  inline `style` attr) r1 used.
- **Comment/source honesty.** 150ms debounce (line 443), `normalizeDeltaY` reads
  `deltaMode`/`deltaY` with deltaMode-0 as-is (lines 363-372), `wheel` listener
  `{ passive: false }` (line 474), no `isTrusted` gate anywhere (zero matches) —
  all confirmed. r1's false grep claim is corrected: `grep -c
  "page\.mouse\.wheel(" web/tests/e2e/pull-to-refresh.spec.ts` → **0**, and the
  bare string `page.mouse.wheel` no longer appears at all (grep exit 1). #051
  correctly left Reopened (not re-closed) pending CI, per acceptance bullet 4.
- **Scope.** Exactly 3 files (this plan, tech-debt-tracker, the spec); nothing
  under `server/` or `web/src/**`. **Security surface:** none (hardcoded synthetic
  `WheelEvent`s in a trusted automation context; two Markdown docs).
- **Tree state:** clean apart from this verdict line; only pre-existing gitignored
  `web/test-results/` was produced during A/B and has been removed. No other
  untracked files.

No CRITICAL or blocking WARNING findings. The r1 CHANGES is resolved: the race is
closed by construction (verified at Svelte's source) and by a discriminating
load A/B on this machine.

Gate: r2 adversary verdict (approved @cf23684) SUPERSEDED — the combined change re-gated on fix/e2e-flake-elimination at r2 @484e65c; historical.

## Gate

**QA re-review (r2 @cf23684100297bd351a31b68dbe4c8738c3c6036)**

Delta re-review of my r1 CHANGES @90666af. My r1 CRITICAL was: folding only the
*dispatch* into `page.evaluate()` left the closing `toHaveCSS('opacity','1')`
locator assertion's own Node↔WebKit round trip inside the 150ms debounce window,
so the race was narrowed, not closed. r2 folds dispatch AND observation into one
`page.evaluate()`. Verified by measurement:

**Instruments (verbatim):**
- `cd web && npm run lint`: `> eslint .`, no output, `LINT_EXIT=0`.
- `cd web && npm run check`: `svelte-check found 0 errors and 0 warnings`.
- `cd web && npx vitest run`: **Test Files 28 passed (28), Tests 411 passed (411)**, 0 failed.
- Server untouched — `git diff --name-only b6b930b HEAD -- server/` is empty; cargo suite skipped per brief (scope: exactly 3 files — this plan, tech-debt-tracker, the spec).
- `npx playwright test tests/e2e/pull-to-refresh.spec.ts --project=chromium --project=webkit --retries=0`: **5 passed, 1 skipped** (webkit touch-gesture, pre-existing CDP-only `test.skip`), 0 failed. No regression to sibling pointer/touch tests or the wheel test's fade-out path (line 270 `opacity 0`).

**R1 CRITICAL resolved — verified by discriminating load A/B (same machine, my own 2× `yes > /dev/null`, load avg ~3–6 on 6 cores, comparable to my r1's 4.39–6.08):**
- r2 fix (committed HEAD), `--project=webkit --grep "wheel gesture" --repeat-each=20 --retries=0 --workers=1`: **20/20 passed** (EXIT=0), zero opacity failures, zero connection-refused artifacts.
- main's old `page.mouse.wheel()` pattern (`git show b6b930b:` restored into the working file), identical command under the same live load: **8 failed / 12 passed (40%)** — every failure the old `toHaveCSS('opacity',…)` race, first polled values already mid-fade (`0.879534`, `0.001753`, `0.012188`, `0.012753` …), the documented #051 signature family. Zero connection-refused artifacts (confirmed the failures are the debounce race, not harness overload).
- (An earlier heavier attempt — 5× `yes`, load ~11 — produced `page.goto: Could not connect to localhost:4173` on BOTH patterns, i.e. it overloaded the vite-preview webServer itself rather than isolating the race; discarded in favor of the lighter, discriminating load above.)
- Direct causal before/after on this box right now: the old pattern reproduces the historical failure at 40% where the r2 fix is 0%. My 40%-old/0%-fix is consistent with the Adversary r2 A/B (30%/0%) and my own r1 (47.5% old-family). Tree restored via `git checkout HEAD --` afterward; gitignored `web/test-results/` is not tracked.

**Correctness of the microtask read (focus #2):** sound.
- `.ptr-indicator` opacity is inline `style="opacity: {indicatorOpacity}"` (line 562) with `transition: none` while `animateOut` is false (line 610; the 0.3s transition only attaches via `.ptr-animate`, applied on animate-out) — so opacity is set instantly on Svelte flush, no interpolation, `getComputedStyle().opacity` reads exactly `'1'`. `indicatorOpacity = min(pullDistance/threshold, 1)` = `min(99/64,1)` = 1 (line 108), so `'1'` is reachable — no false-deadline read. Svelte's reactive flush is queued as a microtask, which drains (FIFO) before the 150ms `wheelEndTimer` macrotask (armed at end of the synchronous dispatch loop, PullToRefresh.svelte:443); the tight `await Promise.resolve()` loop keeps the microtask queue non-empty so the timer cannot fire before the read, and the 120ms deadline (< 150ms, ~30ms margin) never triggered across 40 loaded + 20 unloaded runs (any deadline-with-opacity≠1 would have surfaced as a failure; none did).
- No coverage weakening vs r1: all three checks preserved with equal strength — `opacity === '1'` (computed, same source as r1's `toHaveCSS`), `contentStyle` matches `/translateY\(/` and NOT `/translateY\(0px\)/` (inline `style` attr via `getAttribute`, same source and same regexes as r1's `toHaveAttribute`). Both `indicatorOpacity` and `contentTranslateY` derive from `pullDistance` and are applied in the same Svelte flush, so reading `contentStyle` after the opacity loop confirms it is already applied.

**R1 WARNING resolved:** `grep -c "page\.mouse\.wheel(" web/tests/e2e/pull-to-refresh.spec.ts` → **0** call sites, and the bare string `page.mouse.wheel` no longer appears at all (`grep` exit 1). The plan's r2 Verification claim now matches reality; the false "no matches" framing is dropped.

**Comment/source accuracy (verified against PullToRefresh.svelte):** 150ms debounce (line 443), `normalizeDeltaY` reads `deltaMode`/`deltaY` with `deltaMode 0` as-is (lines 363–372), `wheel` listener `{ passive: false }` (line 474), no `isTrusted` gate anywhere — all confirmed. Test comments (lines 213–226, 235–243) accurately describe the mechanism.

**tech-debt-tracker.md #051:** correctly moved from the Closed table back into Active/Open as "Reopened 2026-09-19", `unassigned`, "before re-closing" language intact — not prematurely re-closed while CI is unconfirmed. Honest diff.

**Security surface:** none. The diff dispatches hardcoded-literal synthetic `WheelEvent`s inside an already-trusted browser-automation context (no external/untrusted input reaches `dispatchEvent`); the other two files are static Markdown. No injection, traversal, SSRF, auth, or data-exposure surface.

**Tree state:** clean apart from this verdict write and the Adversary's own r2 block; test file restored byte-identical to HEAD after the A/B (`git diff HEAD` = 0 lines); no untracked files (`web/test-results/` is gitignored). Firefox not locally runnable (binary absent) — CI covers it.

No CRITICAL or WARNING findings. My r1 CRITICAL is resolved by construction (microtask-vs-macrotask ordering) and empirically (discriminating load A/B); my r1 WARNING is resolved.

Gate: r2 qa verdict (approved @cf23684) SUPERSEDED — the combined change re-gated on fix/e2e-flake-elimination at r2 @484e65c; historical.

Gate: APPROVED — landed via PR #154 (combined e2e-flake-elimination change, r4 @2c0f344, merged to main @31c76e8). This standalone plan is superseded; verdicts above are historical.
