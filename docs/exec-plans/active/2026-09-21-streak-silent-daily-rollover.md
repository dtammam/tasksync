---
plan: streak-silent-daily-rollover
harness: v2 · lean
branch: fix/streak-silent-daily-rollover
anchor: outcome
status: In gate
next: adversary + qa verdicts bound to HEAD
gate: pending
---

# Fix: no "combo dropped" fanfare on first launch of a new day

## Request (restated)

> If I go to bed with some tasks not complete, then launch for the first time
> the next day (after midnight) with streak settings on, I get a "combo dropped"
> visual and noise. It feels off — I know I missed tasks, it shouldn't do that.

Outcome-driven and deliberately small. The theatrical combo-drop (drop sound +
red-flash overlay) should not replay for a miss the user already knows about
when they simply re-open the app on a new day.

## Blind-spot pass (root cause by measurement)

- **Two paths zero the combo.**
  - *Active, in-session* — punt/skip/cancel/delete call `streak.break()`
    directly from `web/src/lib/stores/tasks.ts:796,829` (and cancel/delete). This
    is the correct home for the theatrical break (sound + red flash + overlay).
  - *Passive, on-load* — `checkMissedTasksAndApplyDailyReset()` is called at
    boot / sync / focus from `web/src/routes/+layout.svelte:213,216,277,280,358,361`.
- **The bug is in the passive path.** Pre-fix, that function *also* called the
  theatrical `streak.break()`: the daily-mode day-rollover branch
  (`streak.ts:493`) and the endless-mode branch (`streak.ts:510`). So opening the
  app the morning after replayed a combo-dropped moment for yesterday's miss.
- **Fix.** The passive path now **always zeros the combo silently** — count → 0,
  `lastResetDate` advanced, once-per-day guard set — with no sound and no
  overlay, in both daily and endless modes. `streak.break()` is untouched, so
  active in-session actions still animate.
- **Both modes, deliberately.** The same "open app → get yelled at" friction
  exists in daily (day-rollover) and endless (pre-existing overdue tasks) modes,
  and the user's mode is unknown. In both, the count still correctly drops to 0;
  only the fanfare is removed. This is a UX judgment applied uniformly, not a
  daily-only literal fix.
- **Guards preserved.** `lastMissedCheckDate` (once-per-day), `lastResetDate`
  advancement (resolves the deferred flag so it doesn't re-trigger next boot),
  and `dayCompleteDate` (day-complete guard) all preserved exactly as before.
- **Assumptions.** Web-only. No schema, server, wire-format, or persisted-state
  shape change — `StreakState` is unchanged; only the animate-vs-silent decision
  moves. No data is deleted.

## Acceptance (outcome — measurable)

1. **Passive path is silent.** `checkMissedTasksAndApplyDailyReset()` never calls
   `streak.break()`; after it runs on a new-day rollover with missed tasks (daily)
   or missed+live combo (endless), the display shows no combo-dropped state
   (`isComboDropped`, `breaking`, `visible` all false) and no drop sound plays.
   *Measured:* read the diff; unit tests assert the display flags stay false with
   sound enabled.
2. **Count still resets.** The combo count still reaches 0 in both scenarios, so
   the streak correctly reflects the miss — it just doesn't announce it.
   *Measured:* unit tests assert `count === 0`.
3. **Active break unchanged.** An in-session `streak.break()` (punt/skip/cancel/
   delete) still shows the overlay (`isComboDropped`/`breaking`/`visible` true).
   The `tasks.ts` call sites are untouched. *Measured:* new unit test + diff.
4. **Guards intact.** Once-per-day (`lastMissedCheckDate`), `lastResetDate`
   advancement, and `dayCompleteDate` preservation behave as before.
   *Measured:* existing tests (same-day no-op, silent zero, dayCompleteDate
   preserved) stay green; read the diff.
5. **Gates green, scope contained.** `npm run lint`, `npm run check`, `npm run test`
   (web) pass; the diff touches only `web/src/lib/stores/streak.ts` (+ its test)
   and one doc (`docs/ARCHITECTURE.md`). No server/Rust files. *Measured:* gate
   output + `git diff --stat`.

## Build

- **Fix:** `web/src/lib/stores/streak.ts` — `checkMissedTasksAndApplyDailyReset()`
  rewritten so both the daily-rollover and endless branches fall through to a
  single **silent** zero (no `streak.break()`); `isComboDropped` explicitly
  cleared on the display. Doc comments on the function, `deferredDailyReset`,
  `applyResetRuleIfNeeded`, and `break()` corrected to match.
- **Tests:** `web/src/lib/stores/streak.test.ts` — the two former "breaks with
  animation" cases now assert the **silent** outcome (sound enabled, display flags
  false, count 0); added a positive case pinning that an active `break()` **does**
  show the overlay (guards against over-silencing).
- **Doc:** `docs/ARCHITECTURE.md` — streak bullet now states the active-vs-passive
  distinction (change-hygiene rule).
- **Local gates:** `streak.test.ts` 53 passed · `tasks.test.ts` 83 passed ·
  `npm run lint` clean · `npm run check` 0 errors/0 warnings.

## Out of scope

- Any change to the active-action break behavior or its sounds/visuals.
- Streak persistence shape, sync, or server behavior.
