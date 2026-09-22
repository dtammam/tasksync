---
plan: streak-silent-daily-rollover
harness: v2 · lean
branch: fix/streak-silent-daily-rollover
anchor: outcome
status: Shipped PR#168
next: Merged via PR #168 — nothing outstanding
gate: APPROVED @5db0049 — adversary + qa (r1)
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

---

Gate: APPROVED r1 @5db0049 — adversary
- Gates verbatim: `npm run lint` clean; `npm run check` 0 errors/0 warnings; `npx vitest run streak.test.ts tasks.test.ts` → 136 passed (53 + 83).
- Surface 5 binding (mutation): inserted pre-fix `streak.break(); return;` in the passive path → the 2 silent-path tests (endless + DDR rollover) went RED (2 failed / 51 passed); no-op'd `break()`'s overlay update → the "active break shows overlay" test went RED (1 failed / 52 passed). Tree restored, `git status` clean.
- Surface 2 re-trigger (measured): temp assertion confirmed `lastResetDate`→today in both `streakState` and the persisted prefs blob, and a second hydrate+check cycle kept count 0 with no overlay (53 passed); reverted.
- Surface 1 state-equivalence (code read): silent path sets count 0, countedTaskIds [], lastResetDate today, dayCompleteDate preserved, nextAnnouncerAt→FIRST_ANNOUNCER_AT, writeStreakStateToPrefsBlob + queueStateSync + isComboDropped:false — every effect of `break()` minus fanfare.
- Surface 4/enumeration: only 2 `streak.break()` callers, both in `tasks.ts` (untouched); `isComboDropped` consumed only by `StreakDisplay.svelte` CSS class; silent path clears it. ARCHITECTURE.md active-vs-passive claim matches the tree.

Gate: APPROVED r1 @5db0049 — qa
- Gates measured: `npm run lint` exit 0 (clean); `npm run check` "0 errors and 0 warnings"; `streak.test.ts` alone 53/53; combined `streak.test.ts + tasks.test.ts` 136/136 on 25 of 26 runs.
- AC1/AC2 verified: `checkMissedTasksAndApplyDailyReset` (streak.ts:486-514) has no `streak.break()` call; silent path sets count 0 + `isComboDropped:false` (streak.ts:513); new tests assert flags false with sound enabled (streak.test.ts:300,310-312,256-259).
- AC3 verified: `break()` call sites in tasks.ts:796,829 untouched; new test streak.test.ts:184-190 pins active break → overlay true; would fail on pre-fix code (break() sets isComboDropped/breaking/visible true) — binding confirmed by inspection.
- AC4 verified: once-per-day guard (streak.ts:489,495), lastResetDate→today (streak.ts:505), dayCompleteDate preserved (streak.ts:507); guard tests streak.test.ts:283,315 green.
- AC5 verified: `git diff --stat` = streak.ts + streak.test.ts + ARCHITECTURE.md + this plan doc; no server/Rust. Comment/doc rewrites (streak.ts:204-208,222-223,411-416,469-484; ARCHITECTURE.md:78) match tree. No security surface: client-side streak state only, no new sink/injection/traversal/SSRF/auth path.
- DISCLOSED non-blocker: 1 failure in 26 combined runs (the two new display-flag assertions), NOT reproduced in 25 subsequent runs and logically impossible from the isolated silent path (deterministically sets flags false; no async, no break() call) — attributed to shared-box/isolation flake per env memory; recommend CI confirmation.
