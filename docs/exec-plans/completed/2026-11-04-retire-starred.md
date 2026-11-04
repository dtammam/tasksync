---
plan: retire-starred
harness: v2 · lean
branch: feat/retire-starred
anchor: outcome
status: Shipped (PR #172 — awaiting Dean's merge)
next: Dean — device checks on :beta, then merge the PR
gate: APPROVED r3 @5a84af4 (adversary, qa, security-brief)
builder: smart
---

# Retire "Starred" — the ⭐ tag replaces it

## Request

"Starred" is a legacy hard-coded marker (`task.priority > 0`) that predates the
tag system. Tags fully replace it — the default palette already has a ⭐
"Starred" entry. Owner wants the star feature gone.

## Rulings (owner, 2026-11-04)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Existing starred tasks | **⭐ tag if untagged.** `priority > 0` and no `emoji` → `emoji = '⭐'`. Starred but already tagged → keep its tag; the star is simply dropped. Never overwrite an existing tag. |
| R2 | How deep | **Remove all UI + the starred-first sort; keep `priority` inert in the data.** No SQLite migration, no IDB schema change, no wire-format change. The field stays in types/sync/server and is ignored by the UI. |
| R3 | Palette | The ⭐ "Starred" palette entry stays as-is (it *is* the replacement). |
| R4 | Suggestions (gate r1, 2026-11-04) | **Keep via ⭐.** An undated ⭐-tagged task is a My Day Suggestions source (ranked after due today/tomorrow, ⭐ first), replacing the undated `priority > 0` rule. |

## Outcome Dean will see

- No ★ before task titles, no Star/Unstar in the ⋯ shelf, no Starred toggle in
  the detail drawer.
- My Day and list views sort purely by the chosen sort mode — starred tasks no
  longer float to the top. (Group-by-tag already puts ⭐ first by palette rank.)
- Every task that was starred and untagged now shows the ⭐ tag on every device.

## Blind-spot findings

- **Where the migration runs: client-side, through the normal sync path.**
  Sync is `updated_ts`-cursor delta (`server/src/routes/sync.rs:132`), the
  client is offline-first, and local-only tasks never reach the server. So a
  server SQL migration would miss unsynced tasks and need a schema-adjacent
  `.sql` file (forces the data-loss rule). Instead: a pure, idempotent sweep in
  the tasks store that, for every task with `priority > 0`, sets
  `priority: 0` and — only if `!task.emoji` — `emoji: '⭐'`, marks `dirty`,
  bumps `updated_ts`, persists. Zeroing `priority` is what makes it
  idempotent across devices: once one device's sweep syncs, others pull
  `priority: 0` and have nothing to do; if two devices sweep the same task
  offline, they converge to the same value.
- **When it runs.** After `hydrateFromDb()` (`web/src/lib/stores/tasks.ts:960`)
  **and** after `mergeRemote()` (`tasks.ts:440`, called from
  `web/src/lib/sync/sync.ts:217`) — a pull can deliver a still-starred task
  from a device that hasn't updated yet. The sweep must be a no-op (no write,
  no `updated_ts` bump, no persist call) when no task has `priority > 0`, or
  every pull will churn IDB and re-push.
- **Permissions.** A contributor's device must not rewrite tasks it can't
  edit (server would reject; client would loop re-pushing dirty rows). Gate
  the sweep on the same rule `TaskRow` uses for `canEditTask` (owner, or the
  task's creator). Tasks it can't edit are left alone and get migrated by the
  owner's device.
- **Drawer save writes `priority`.** `TaskDetailDrawer.svelte:22,52,107` holds
  a local `priority` and includes it in the save payload. Remove the local
  state; the save must not touch `priority` at all.
- **`setPriority` store method** (`tasks.ts:729`) becomes unused once the row
  and drawer stop calling it. Delete it (and its tests) — lint/check will
  catch stragglers. `priority` stays on `Task`, in `createTask` defaults
  (`tasks.ts:134`), sync mapping (`sync.ts:24,56,100,125`), `api/client.ts`,
  and server — **do not touch those** (R2).
- **Sorts.** `compareStarredFirst` in `web/src/routes/+page.svelte:54-59,163`
  and `web/src/routes/list/[id]/+page.svelte:35-47`. Delete both helpers and
  their call sites.
- **Tests that encode starring.** `TaskRow.test.ts:84+` ("toggleStar closes
  the shelf…" ×2) — delete. `web/tests/e2e/myday.spec.ts:~60-80` stars a task
  and checks it survives reload — retire that case; per AGENTS.md, retiring
  an E2E requires cheaper deterministic coverage, which W1's sweep unit tests
  provide (persist + idempotency). Check `tasks.test.ts`, `myDay.parity.test.ts`,
  `grouping.test.ts`, `tasks.bench.ts` for star-sort assumptions; they may
  only set `priority` as fixture data, which is fine.
- **Untouched on purpose:** `tag-palette-settings.spec.ts` and the server test
  at `server/src/routes/mod.rs:2233` use "Starred" only as a palette *label* —
  leave them.
- **Gate size.** `web/src/**` → `core-logic` full gate (adversary + qa). The
  sweep rewrites user data on every device, so the Adversary brief must
  attack it specifically (see Gate). `sync.ts`/`client.ts` are *not* edited, so the
  network-boundary rule does not fire; if the build finds it must edit them,
  that's stop rule 1.

## Acceptance (outcome — each measurable)

1. **Sweep correctness.** Unit tests in `tasks.test.ts` for the sweep:
   (a) starred + untagged → `emoji '⭐'`, `priority 0`, `dirty`, persisted;
   (b) starred + tagged `🎯` → emoji stays `🎯`, `priority 0`;
   (c) no starred tasks → **zero** persist calls and no `updated_ts` change;
   (d) running it twice changes nothing the second time;
   (e) a task the current user can't edit is untouched;
   (f) runs after `hydrateFromDb` and after `mergeRemote` (a merged-in
   starred task gets swept). *Amended at gate r1:* after `hydrateFromDb` it
   sweeps only local-only/dirty rows when signed in (a clean cached server row
   may be stale; pushing it whole would overwrite newer edits); server rows are
   swept from the fresh pull in `mergeRemote` — the first pull of a session is
   full. (g) Regression: stale starred cache → hydrate → pull of a newer 🎯/done
   copy ends 🎯, done, not dirty.
2. **UI gone.** No element with `data-testid` `task-star-indicator` or
   `detail-star-toggle` renders for a task with `priority: 1`; the ⋯ shelf has
   no Star/Unstar button. Bound by `TaskRow.test.ts` + a drawer test.
   `grep -rn "Unstar\|star-indicator\|star-toggle\|compareStarredFirst\|setPriority" web/src --exclude=*.test.ts`
   returns nothing (*amended at gate r1:* the new negative tests name these ids).
3. **Sort.** A `priority: 1` task created later sorts after an earlier one in
   created-asc mode in both views (unit test on the extracted sort, or E2E).
4. **No regressions.** Full web suite (lint, check, vitest, `@smoke`) and
   `cargo test` green; drawer save round-trips a task without changing its
   `priority`.

## Out of scope

- Dropping `priority` from SQLite / IDB / wire / integration API (R2 — a
  later cleanup ticket in `tech-debt-tracker.md`, which W3 adds).
- Changing the palette or the ⭐ label.
- The task-row layout work (separate plan, `2026-11-04-row-fixed-slots.md`).

## Step 0 — builder setup (read before any code)

- **Read order:** `AGENTS.md` → this plan → `tasks.ts` (`hydrateFromDb`,
  `mergeRemote`, `setPriority`, `setEmojiMany`, `updateAndPersist`) →
  `TaskRow.svelte` (`canEditTask`, `toggleStar`) → `TaskDetailDrawer.svelte` →
  both `+page.svelte` sorts → `TaskRow.test.ts`, `myday.spec.ts`.
- **Environment:** worktree `.claude/worktrees/feat/retire-starred` on branch
  `feat/retire-starred` (plan committed there). Web commands from `web/`:
  `npm run lint`, `npm run check`, `npm run test`, `npm run test:e2e:smoke`.
- **Parallel builder:** `feat/row-fixed-slots` runs at the same time and also
  edits `TaskRow.svelte` (the `.sub` strip). **This plan merges first.** Keep
  your `TaskRow.svelte` edits confined to the ★ indicator, its CSS, the
  `toggleStar` function and the Star shelf button.
- **Git rules:** stage files by name (no `git add .`/`-A`), no force-push, no
  `--no-verify`, never self-merge. PR body must lead with `## Summary`
  (12+ char sentence).
- **Stop rules — stop and ask the owner (AskUserQuestion):**
  1. The change appears to need an edit to `sync.ts`, `api/client.ts`, any
     server file, or a schema/migration (R2 says no).
  2. The sweep can't be made a strict no-op when nothing is starred.
  3. A test outside those named above encodes starred-first sorting and
     changing it would change behavior the owner hasn't ruled on.

## Waves

- **W1 — Sweep.** Add the idempotent store sweep (`migrateStarsToTag` or
  similar, owned by `tasks.ts`), wire it after `hydrateFromDb` and
  `mergeRemote`, with Acceptance 1 tests. Commit.
- **W2 — Remove UI + sort.** Row indicator + CSS + shelf button + `toggleStar`;
  drawer toggle + local `priority` + CSS; both `compareStarredFirst`;
  delete `setPriority`; update/remove the tests named above. Acceptance 2–3.
  Commit.
- **W3 — Docs.** Update exactly one of `FRONTEND.md` / `ARCHITECTURE.md`
  (whichever describes starring / sort — `grep -n -i star docs/`), and add a
  `tech-debt-tracker.md` entry: "`task.priority` is inert since retire-starred;
  drop from schema/wire when no pre-2026-11 clients remain." Commit.
- **Gate → PR.** Run `/gate`. The Adversary brief names: the sweep's
  idempotency and no-op path, the contributor guard, the pull-then-sweep
  ordering (a stale device re-pushing `priority: 1` after the sweep), and the
  drawer save no longer writing `priority`. Open the PR; Dean merges.

## Evidence (builder fills)

- W1: `2c057cf` — `migrateStarsToTag` + pure `sweepStarredTasks` in `tasks.ts`, wired after
  `hydrateFromDb` and inside `mergeRemote`'s single write. 12 new tests in `tasks.test.ts`
  (Acceptance 1 a–f, + auth-loading skip, + contributor `my_day` skip); tasks.test.ts 101/101,
  full vitest 492/492. Mutations: always-return-list → 3 tests fail ((c),(d),(f)-no-op);
  drop `!task.my_day` guard → (e) fails. Extra guard beyond TaskRow's rule (deliberate): a
  contributor's `my_day` task is skipped because the server 403s any contributor push carrying
  `my_day: true` (`server/src/routes/tasks.rs` `update_task_meta_for_ctx`). Sweep also skips while
  `auth.status === 'loading'`.
- W2: `389d1fd` — row ★ + CSS + `toggleStar` + shelf button; drawer toggle + local `priority` +
  CSS; `saveFromDetails` no longer takes/writes `priority`; `setPriority` deleted; both
  `compareStarredFirst` removed by extracting one shared `lib/tasks/sort.ts` (My Day modes are only
  `created`/`alpha`, a subset of the list sort, so behaviour is otherwise identical). Tests:
  `TaskRow.test.ts` (2 star tests deleted, 2 negative tests added), new `TaskDetailDrawer.test.ts`
  (no toggle; save payload has no `priority`), new `sort.test.ts` (4, Acceptance 3),
  `tasks.test.ts` drawer round-trip asserts `priority` unchanged. The 4 new UI tests fail against
  the pre-W2 components (verified). E2E: the plan's `myday.spec.ts:~60-80` was actually the
  `seedSuggestions` helper (stars an undated task so Suggestions appear) → now seeds via the
  shelf's Tomorrow (a due-tomorrow task is a suggestion source); two further star-sort E2Es
  (`keeps starred tasks at top…` ×2) retired, covered by `sort.test.ts`; `@smoke Star action
  closes the quick shelf` repurposed to assert no Star button + Close closes. Not stop rule 3: they
  encode exactly the behaviour R2 removes. vitest 498/498; `myday.spec.ts`+`smoke.spec.ts`
  chromium 34/34. Acceptance-2 grep over `web/src` excluding `*.test.ts`: no matches (the only hits
  are the negative assertions in the new tests).
- W3: FRONTEND.md "Task visual affordances" updated (Starred retired, sort, sweep). Tech debt:
  054 (drop inert `priority` from schema/wire), 055 (`myDaySuggestions`/`myDayMissed` still read
  `priority` — out of scope, owner to decide), 049 closed (resolved by this plan), 042 text
  trimmed (`toggleStar` gone).
- Fix r1→r2 (builder): (1) CRITICAL/HIGH stale-cache overwrite (adversary + security-brief) —
  hydrate now sweeps only local-only/dirty rows when signed in (anonymous scope: all);
  `mergeRemote` sweeps only rows the pull just delivered + local-only/dirty. New tests: signed-in
  hydrate eligibility, stale-cache→pull regression (the adversary's repro shape), merge
  fresh-vs-stale, dirty-row-wins. Mutants killed: hydrate eligible→all (2 fail), merge eligible→all
  (1 fail). The LOW stale-role case only arose via the hydrate path, which is gone. (2) WARNING
  Suggestions (qa + adversary) — owner ruled **R4: keep via ⭐**; `myDaySuggestions` now uses
  undated `emoji === '⭐'` (+ ⭐-first rank) instead of `priority`; mutant (back to `priority > 0`)
  → 2 fail. (3) NOTEs: Acceptance 2 grep reworded; FRONTEND.md "one-time"/"inert" corrected;
  debt 055 narrowed to `myDayMissed`. Not changed: route-level sort mutant survives (adversary
  NOTE; UI can no longer create stars); follower-tab IDB write (qa suspicion) now limited to
  local/dirty starred rows.
- Fix r2→r3 (builder): (1) sign-out-during-hydrate race (adversary WARNING, qa CRITICAL,
  security-brief MEDIUM) — removed the anonymous "sweep everything" branch; the post-hydrate sweep
  always uses `isSafeFromCache` (local-only/dirty). Test: `loadAll` mock calls `auth.logout()`
  mid-read → clean account row untouched, zero persists. Mutant (anonymous branch back) → that test
  fails. (2) R4 ⭐-first rank untested (adversary + qa WARNING) — new Suggestions ranking test;
  mutants (rank line deleted / inverted) → it fails. Sweep-block fixtures that relied on the
  anonymous branch now set `local: true`. (3) FRONTEND.md aligned. The perf @smoke 283 ms fail in qa
  r2 was A/B'd by qa as load noise (both shas flake equally; delta doesn't touch toggle).
- Gate: **closed — APPROVED r3 @5a84af4 by adversary, qa, security-brief** (security-brief
  escalated by the builder: the sweep rewrites user data). Rounds: r1 CHANGES ×3 → r2 (security
  APPROVED, adversary + qa CHANGES) → r3 APPROVED ×3. Full suite at 5a84af4 (qa, verbatim): lint
  clean; svelte-check 0/0; vitest 33 files / 505 passed; cargo fmt/clippy clean; cargo test 154
  passed; @smoke chromium 34 passed / 1 failed — `perf.spec.ts:23` toggle 273 ms > 200 ms ceiling at
  load avg 18–29, A/B vs base f9d3a0c fails equally (3/4 vs 3/4) → load noise; CI arbitrates.
  Post-approval bookkeeping bound by `git diff --name-only 5a84af4..HEAD` (docs only; see PR).
  - Gate: CHANGES r1 @202d4fa — qa
    - WARNING `web/src/lib/stores/tasks.ts:1116,1123` + sweep: unruled behaviour change. `myDaySuggestions` uses undated `priority > 0` as a source; the sweep zeroes it, so an undated starred task outside My Day (e.g. "Call dentist") vanishes from Suggestions on first boot. Not in R1–R3 or "Outcome Dean will see"; only parked as debt 055 (the `seedSuggestions` E2E had to be rewritten for exactly this reason). Also inconsistent: a contributor's un-sweepable starred tasks keep surfacing. Resolve with an owner ruling recorded here (keep the loss, or add undated `emoji === '⭐'` as a source) before merge.
    - NOTE plan Acceptance 2: the literal grep returns 4 hits (the negative assertions in `TaskRow.test.ts:231,235,240`, `TaskDetailDrawer.test.ts:59`); amend the criterion to exclude `*.test.ts`. Non-test `web/src` is clean.
    - NOTE `docs/FRONTEND.md:76` calls the sweep "one-time"; it runs on every `hydrateFromDb` and every `mergeRemote` (no-op when nothing starred). Also, AGENTS.md change hygiene says "exactly one" doc; the plan mandates FRONTEND.md + tech-debt, which is owner-sanctioned.
    - NOTE (suspicion) follower tabs now write IDB from `hydrateFromDb` (whole-list `saveTasks`) while starred tasks remain, in the same clobber class as debt 052. Bounded to one write per starred task.
    - Instruments at 202d4fa: lint clean; svelte-check 0/0; vitest 33 files / 498 passed; @smoke chromium 35 passed; cargo fmt/clippy clean; cargo test 154 passed + 0. No security surface beyond the contributor guard, which is a strict subset of `update_task_meta_for_ctx` (creator check + `my_day: true` 403).
  - Gate: CHANGES r1 @202d4fa — security-brief
    - CRITICAL (HIGH, blocks): the hydrate-time sweep makes dirty writes from a stale cache, and those writes beat fresh server state. `hydrateFromDb` → `migrateStarsToTag` (tasks.ts:1011-1014) marks each starred cached copy `dirty` before any pull happens. The next pull then keeps the local copy because `mergeRemote` skips dirty tasks (tasks.ts:508 `if (existing?.dirty) continue`). The push after it (`+layout.svelte:72-76`, pull then push) sends the whole stale row. The server applies it with no `updated_ts` conflict check (`tasks.rs:446`: `emoji = ?11` overwrites outright; title, status, notes, due_date and my_day come from the stale copy through `coalesce`). Example: phone last synced while T was ★ and untagged. On desktop, T has since been tagged 🎯, its notes edited, and it was marked done. The phone upgrades: T comes back ⭐, pending, with the old notes, on every device. The 🎯 tag is overwritten (breaks R1) and real edits are lost silently. This hits every device on upgrade, when caches are at their stalest. Fix: do not sweep server-backed tasks at hydrate. Sweep only `task.local` tasks there, or tasks in an anonymous / never-synced scope. Sweep server tasks only inside `mergeRemote`, and only the rows that just arrived from `remote` (fresh), plus local-only rows. Add a test: a stale starred cache, then hydrate, then a pull bringing priority 0 and 🎯, must end with 🎯 and not dirty.
    - WARNING (LOW): a stale cached role (admin demoted to contributor) means the hydrate sweep dirties tasks the user can no longer edit. Push then returns 403, `applyRejections` runs `clearDirty`, and the user sees a "denied (403)" banner once. Until the server copy changes, this device shows ⭐ while the server keeps ★ (the incremental pull will not send it again). This is bounded: no loop, and the background `reconcileSession` corrects the role. The CRITICAL fix (no hydrate sweep of server rows) removes it too.
    - NOTE (r1): the sweep adds a persist straight after `hydrateFromDb`. If auth/scope changes while `loadAll` is in flight, it could write scope A's tasks into scope B's IDB. That race already exists for any save; this is a suspicion only, I have no reproduced path. Clamping `priority` from IDB or the wire is fine: `mapApiTask` clamps to 0..3, a corrupt IDB value of 0 or less is skipped, and the sweep always writes 0. Collapsing priority 2/3 into ⭐ is irreversible but follows R1. The contributor guard matches `update_task_meta_for_ctx` (creator check, `my_day: true` returns 403). The `emoji || '⭐'` logic never overwrites a non-empty tag in the sweep itself.
  - Gate: APPROVED r2 @ea46a07 — security-brief
    - r1 CRITICAL/HIGH stale-cache overwrite: **fixed as prescribed** (verified by reading). Signed in, `migrateStarsToTag` passes `isSafeFromCache` (`local || dirty`, tasks.ts:298,1029). `mergeRemote` sweeps only `freshIds`, which are rows actually replaced from `remote` (a dirty-skipped row is not added, tasks.ts:520-533), plus local/dirty rows. Sweeping a dirty row adds nothing to the push set, because that row was already going to be pushed; the sweep only changes `priority` and an empty tag. Regression test present (tasks.test.ts:2056+). I did not run the suite.
    - r1 LOW stale cached role: **fixed** for the hydrate path. Under a stale role, dirty rows were already queued for push, so the sweep creates no new 403. One residual (INFO): a fresh row pulled before `reconcileSession` corrects a demoted role can still be swept → one 403 → `clearDirty`. Bounded, no loop.
    - NEW, MEDIUM (fix or accept in writing, does not block): the anonymous branch (tasks.ts:1029) reads the **live** auth status, but the rows come from the scope fixed when hydrate began. Path: boot with a cached user → status `authenticated` → `setDbScope(space:…:user:…)` → `loadAll` is in flight while background `reconcileSession` receives 401 → status becomes `anonymous` → `migrateStarsToTag` sees `anonymous` and sweeps **every** cached row → saves them. The save should land in the user's scope DB, because `dbScope` only changes on the next `hydrateScopedStores`, and the reactive rehydrate waits for `appReady`. This last step is reasoned, not traced in `repo.saveTasks`. On the next sign-in, those stale rows are already dirty, beat the pull and overwrite the server: the r1 HIGH again, but only through a narrow race (token expiry inside the IDB-read window, on the upgrade boot). Fix: drop the anonymous branch and always use `isSafeFromCache` (anonymous-scope rows are local-only anyway), or capture `auth.get().status` before `loadAll` in `hydrateFromDb` and pass it in.
    - R4 (Suggestions read `emoji === '⭐'`): display-only, no security surface.
  - Gate: APPROVED r3 @5a84af4 — security-brief
    - r2 MEDIUM (the anonymous branch racing with auth): **fixed as prescribed**, verified by reading. `migrateStarsToTag` (tasks.ts:1025-1035) no longer reads auth status for eligibility and always passes `isSafeFromCache` (tasks.ts:300). The comment at tasks.ts:296-298 is accurate. The race test at tasks.test.ts:2134 calls `logout()` inside `loadAll` and asserts the row stays clean with zero saves, which is the shape of my path. I did not run the suite.
    - No new holes in the delta. With a null user, `canSweepTask` returns true, but only local or dirty rows are eligible now, and those were already in the push set. The R4 ranking test touches no security surface. The r2 INFO residual (a fresh row pulled under a stale cached role gives one 403, then `clearDirty`) is unchanged, bounded and accepted.
  - Gate: CHANGES r1 @202d4fa — adversary
    - CRITICAL (independently reproduced; concurs with security-brief) — the plan is wrong here, and the code follows it faithfully. The sweep after `hydrateFromDb` (tasks.ts:1014) marks stale cached copies of server-backed rows `dirty` before any pull. On the next pull `mergeRemote` skips them (tasks.ts:508), and the push that follows sends the whole stale row. Scratch vitest through the real `syncFromServer` + `pushPendingToServer`: the IDB copy is {pending, no tag, notes "OLD", priority 1} and the server row is {done, 🎯, notes "NEW", priority 0}. The device pushed `{"status":"pending","priority":0,"emoji":"⭐","notes":"OLD notes",…}`. A completed task comes back to life, the 🎯 tag is overwritten (breaks R1) and the newer notes are lost. Acceptance 1(f) test "runs after hydrateFromDb" pins this behaviour. Fix: at hydrate, sweep only `local` (never-synced) or already-`dirty` rows. Sweep server-backed rows only inside `mergeRemote`, and only rows that arrived fresh in `remote` and were not skipped as dirty. Add the stale-cache regression test (stale ★ cache → hydrate → pull brings 🎯/done → expect 🎯, done, not dirty, nothing pushed).
    - WARNING (concurs with qa; reproduced) — an unruled behaviour loss. Measured: an undated starred task is in `myDaySuggestions` before the sweep and gone after it (`['x1']` → `[]`). Zeroing is irreversible for starred-and-tagged rows: no trace of the star is left that could restore Suggestions membership later. So the owner has to rule before merge, not afterwards through debt 055. Either accept the loss (record it here) or add undated `emoji === '⭐'` as a Suggestions source.
    - NOTE — the starred-first removal in the two route files is held only by grep. Re-adding a starred-first `.sort` in `+page.svelte` breaks no unit test, because no route test imports `sortTasks`, and no E2E fixture creates `priority > 0` any more. This is low risk because the UI can no longer create stars. Disclosed, not blocking.
    - NOTE — contributor guard: no 403 path found for pulled rows. The server checks are creator, `my_day: true`, unchanged assignee and list grant (tasks.rs:383-425), and the client mirrors creator and `my_day`. A 403 does not loop: `clearDirty` runs, and the incremental pull does not redeliver the row. Suspicion only: stale cached rows from a list whose grant was revoked are swept, which would give one 403 banner. The CRITICAL fix (hydrate sweeps only local/dirty rows) removes that path.
    - Measured at 202d4fa: vitest 33 files / 498 passed; lint clean; svelte-check 0/0; chromium `myday.spec.ts` + `smoke.spec.ts` 34 passed / 0 failed. Mutants, all killed: no hydrate sweep, no merge sweep, overwrite tag, guard always true, drop creator check, drop loading skip, no dirty, no ts bump, `>= 0`, persist on null, keep priority, always-changed, saveFromDetails writes priority, sort starred-first, drawer payload has priority, row ★ back. Survived: a route-level starred-first sort (NOTE above). My Day sort modes are `created`/`alpha` only (SortControls.svelte:24-25, +page.svelte:167), so the extraction behaves the same.
  - Gate: CHANGES r2 @ea46a07 — adversary
    - r1 CRITICAL stale-cache overwrite: **fixed as prescribed, verified.** I re-ran my r1 scratch repro, signed in as admin, through the real `hydrateFromDb` → `syncFromServer` → `pushPendingToServer`. Nothing was pushed, and the local row ended as the server's version (`done`, 🎯, "NEW notes", priority 0, not dirty). Mutants killed: hydrate eligible→all (2 fail), merge eligible→all (1), `isSafeFromCache` without dirty (2), without local (2), anonymous branch restricted (5), merge without `freshIds` (2), merge without `isSafeFromCache` (1).
    - r1 WARNING Suggestions: **fixed differently, by owner ruling R4**, and the filter is bound (mutant `priority > 0` → 2 fail).
    - WARNING (NEW, introduced by the fix; reproduced) — anonymous-demotion race brings back the r1 data loss. `migrateStarsToTag` (tasks.ts:1024-1029) decides between `anonymous` → sweep all and `isSafeFromCache` using the live auth status *after* `await repo.loadAll()`. On a boot with a cached user, `auth.hydrate` sets `authenticated` and runs `reconcileSession` in the background (auth.ts:200-213). If its 401 lands during the IDB read, the account's stale rows are all swept dirty. Scratch vitest: sign in admin → `loadAll` mock calls `auth.logout()` mid-read and returns the stale ★ row → saved as `{status:"pending",emoji:"⭐",notes:"OLD notes",dirty:true}`. Re-sign-in → hydrate from that save → pull brings {done, 🎯, "NEW notes"} → pushed `{"status":"pending","priority":0,"emoji":"⭐","notes":"OLD notes",…}`. The save lands in the account DB (verified by reading, not traced end to end): `getDb` uses module `dbScope` (idb.ts:23,45), which only `setDbScope` changes, and the scope-change rehydrate is gated on `appReady` (+layout.svelte:343), while `lastScopeKey` is taken *after* the first hydrate (+layout.svelte:265). Token expiry on boot is an ordinary event, so I block (security-brief rated it MEDIUM, non-blocking). Fix: snapshot `auth.get().status` before `await repo.loadAll()` and sweep everything only when it was `anonymous` both before and after the read. Or drop the branch and always use `isSafeFromCache`, since rows created in the anonymous scope are `local`. Add the race test.
    - WARNING — R4's "⭐ first" rank is unbound, although Evidence "Fix r1→r2" claims it as "(+ ⭐-first rank)". Mutants survive: delete `if (aStar !== bStar) return bStar - aStar;` (tasks.ts ~1151), or invert it to `aStar - bStar`, and tasks.test.ts + myDay.parity.test.ts stay 108/108 green. User-visible: with more than 6 today/tomorrow candidates, `slice(0, 6)` picks which ⭐ rows show. Add a test (two due-today rows, the ⭐ one created later, expect it first).
    - NOTE — dirty-row eligibility is acceptable. A dirty row already wins the merge and gets pushed whole, so sweeping it only changes `priority` and an empty tag. The "first pull is a full pull" assumption holds: the cursor lives in memory (sync.ts:29) and `resetSyncCursor` runs on scope change. Rows that are never delivered (a contributor's revoked list) are now never swept, which is harmless. The route-sort NOTE is accepted as disclosed.
    - Measured at ea46a07: vitest 33 files / 503 passed; lint clean; svelte-check 0/0. Scratch tests were deleted; the tree is unchanged except this block.
  - Gate: CHANGES r2 @ea46a07 — qa
    - r1 WARNING Suggestions: **fixed differently, by owner ruling R4** (recorded). The `myDaySuggestions` filter now uses undated `emoji === '⭐'`, and it is bound (tasks.test.ts R4 tests + the fixture rows `no-due-other-tag` / `no-due-legacy-priority`). R4 also wants "⭐ first" ranking, which no test binds; I concur with the adversary's WARNING there (deleting or inverting `if (aStar !== bStar)` breaks nothing).
    - r1 NOTEs: Acceptance-2 grep reworded (`--exclude=*.test.ts`, verified it returns nothing); FRONTEND.md "one-time" corrected; follower-tab write now limited to local/dirty rows. All three addressed.
    - CRITICAL (NEW, introduced by the fix; reproduced): `tasks.ts:1024-1029`. `migrateStarsToTag` picks between `anonymous` → sweep every row and `isSafeFromCache` using the auth status read *after* `await repo.loadAll()`, while the rows come from the scope set before the read. Boot with a cached user: `auth.hydrate` sets `authenticated` and starts `reconcileSession` without awaiting it. If its 401 lands while IDB is being read, the account's clean, stale server rows are all marked dirty. My scratch vitest (outside the tree): sign in as admin, hold `loadAll`, `auth.logout()`, release the stale ★ row {pending, notes OLD} → result `{"dirty":true,"emoji":"⭐","priority":0,"notes":"OLD"}`. On the next sign-in that row wins the merge and is pushed whole. This is the r1 CRITICAL data-loss outcome again (a done task comes back to life, newer notes and tag overwritten), through a narrow but ordinary trigger: token expiry on a cold boot. I rate it CRITICAL because severity follows the outcome, not the likelihood; the adversary independently blocks on the same path. Fix (one line + test): drop the anonymous branch and always use `isSafeFromCache` (rows created in the anonymous scope are `local`), or snapshot the status before `loadAll` and require `anonymous` both before and after. Add a race test shaped like the repro above.
    - NOTE: `docs/FRONTEND.md:76` says hydrate sweeps "only local-only/dirty rows" but leaves out the anonymous-scope exception. Align it with whichever fix lands.
    - Instruments at ea46a07: lint clean; svelte-check "0 errors and 0 warnings"; vitest "Test Files 33 passed (33)", "Tests 503 passed (503)"; cargo fmt/clippy clean, cargo test "154 passed; 0 failed" + "0 passed". `npm run test:e2e:smoke` gave **34 passed, 1 failed**: `perf.spec.ts:23 @smoke @perf task toggle is fast`, "task toggle took 283 ms, ceiling is 200 ms", at load average about 15 with three seats on the box. Solo re-runs: 428 ms fail, 226 ms fail, pass. Controlled A/B from archived copies on separate ports, 3 rounds alternating: 202d4fa pass / 209 ms fail / pass, ea46a07 pass / 206 ms fail / pass. Same behaviour on both, and the delta does not touch the toggle path, so I judge it load noise and not a regression; CI is the arbiter. Caveat: the playwright config uses `reuseExistingServer` on :4173, so a main-tree smoke run can hit another seat's preview server.
  - Gate: APPROVED r3 @5a84af4 — adversary
    - r2 WARNING (anonymous-demotion race): **fixed as prescribed (the "drop the branch" option), verified.** I re-ran my r2 scratch repro through the real `hydrateFromDb` → `syncFromServer` → `pushPendingToServer`. With `auth.logout()` called mid-`loadAll`, there were zero saves. After re-sign-in and a pull, nothing was pushed, and the local row ended as the server's version (done, 🎯, "NEW notes", not dirty). My r1 stale-cache repro also still holds: nothing pushed. Mutant "re-add the anonymous sweep-all branch" → the new race test fails (1). Dropping the branch loses nothing: an anonymous session renders only `<LoginWall />` (+layout.svelte:416-419) and never syncs, and tasks created signed-out are `local`.
    - r2 WARNING (R4 ⭐-first rank unbound): **fixed.** The two r2 survivors are now killed: deleting the ⭐ rank fails 1, and inverting it fails 1. The due-bucket score mutant fails 2. The hydrate eligible→all mutant fails 3, and merge eligible→all fails 1.
    - Delta attack: the r3 change is only the eligibility predicate plus fixture `local: true` additions. That no fixture became vacuous is shown by the anonymous-branch mutant, which goes red only on the race test while (a)–(d)/(f) still sweep via `local`. A null user plus `canSweepTask` → true is now harmless: only local or dirty rows are eligible, and those were already in the push set. No new findings.
    - Accepted as disclosed: the route-level starred-first sort is held only by grep (r1 NOTE).
    - Measured at 5a84af4: vitest 33 files / 505 passed; lint clean; svelte-check 0/0; chromium `myday.spec.ts` + `smoke.spec.ts` 34 passed / 0 failed. The r1 and r2 adversary blocks are present in the committed plan, identical to what I wrote, so there was nothing to re-add.
  - Gate: APPROVED r3 @5a84af4 — qa
    - Binding: reviewed code at 5a84af4. HEAD 4085f05 is a docs-only bookkeeping commit (`git diff --name-only 5a84af4..4085f05` = this plan file only), so the code is byte-identical; instruments ran at 4085f05.
    - r2 CRITICAL (sign-out during hydrate): **fixed as prescribed**. `migrateStarsToTag` has no anonymous branch and always uses `isSafeFromCache`. The race test calls `auth.logout()` inside `loadAll`, the shape of my r2 repro, and asserts not dirty, priority 1, zero saves; at ea46a07 that path swept.
    - r2 NOTE FRONTEND.md: fixed ("signed in or not", reason stated). ⭐-first rank: now bound (a ⭐ row created later ranks first within the tomorrow bucket, so deleting or inverting the tie-break fails). Fixture `local: true` additions keep each test bound to its original behaviour. No new findings.
    - Instruments at 4085f05: lint clean; svelte-check "0 errors and 0 warnings"; vitest "Test Files 33 passed (33)", "Tests 505 passed (505)"; cargo fmt/clippy clean; cargo test "154 passed; 0 failed" + "0 passed". `npm run test:e2e:smoke`: **34 passed, 1 failed**, `perf.spec.ts:23 @smoke @perf task toggle is fast`, "task toggle took 273 ms, ceiling is 200 ms" (load average 18–29, box shared beyond this worktree). A/B with the perf spec, archived copies on separate ports, 4 alternating rounds: base f9d3a0c 276 fail / 283 fail / 277 fail / pass, 5a84af4 204 fail / pass / 270 fail / 350 fail. The pre-branch base fails the same way, so this is load noise, not a regression; CI on free runners is the arbiter.
- Device checks Dean owes (on :beta, from this branch):
  1. Open the app on a device that had starred tasks: untagged ones now show ⭐; ones that had
     another tag keep it (no ★ anywhere, no Star in ⋯, no Starred in the drawer).
  2. A second device converges after one sync (same ⭐ tags, nothing reverted — notably a task
     completed/edited elsewhere since that device last synced stays completed/edited).
  3. My Day / list sorts: a formerly starred task no longer floats to the top in created/alpha.
  4. Suggestions: an undated ⭐ task outside My Day still appears (R4).
  5. Drawer Save on a task leaves its tag untouched.
- PR: [#172](https://github.com/dtammam/tasksync/pull/172) — opened 2026-11-04; Dean merges. Post-approval diff `5a84af4..HEAD` = this file only (bookkeeping).
