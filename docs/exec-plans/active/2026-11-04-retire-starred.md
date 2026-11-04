---
plan: retire-starred
harness: v2 · lean
branch: feat/retire-starred
anchor: outcome
status: Gate:CHANGES r1 @202d4fa
next: gate r2 — re-engage adversary, qa, security-brief on the fix commit
gate: CHANGES r1 @202d4fa
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
- Gate:
  - Gate: CHANGES r1 @202d4fa — qa
    - WARNING `web/src/lib/stores/tasks.ts:1116,1123` + sweep: unruled behaviour change. `myDaySuggestions` uses undated `priority > 0` as a source; the sweep zeroes it, so an undated starred task outside My Day (e.g. "Call dentist") vanishes from Suggestions on first boot. Not in R1–R3 or "Outcome Dean will see"; only parked as debt 055 (the `seedSuggestions` E2E had to be rewritten for exactly this reason). Also inconsistent: a contributor's un-sweepable starred tasks keep surfacing. Resolve with an owner ruling recorded here (keep the loss, or add undated `emoji === '⭐'` as a source) before merge.
    - NOTE plan Acceptance 2: the literal grep returns 4 hits (the negative assertions in `TaskRow.test.ts:231,235,240`, `TaskDetailDrawer.test.ts:59`); amend the criterion to exclude `*.test.ts`. Non-test `web/src` is clean.
    - NOTE `docs/FRONTEND.md:76` calls the sweep "one-time"; it runs on every `hydrateFromDb` and every `mergeRemote` (no-op when nothing starred). Also, AGENTS.md change hygiene says "exactly one" doc; the plan mandates FRONTEND.md + tech-debt, which is owner-sanctioned.
    - NOTE (suspicion) follower tabs now write IDB from `hydrateFromDb` (whole-list `saveTasks`) while starred tasks remain, in the same clobber class as debt 052. Bounded to one write per starred task.
    - Instruments at 202d4fa: lint clean; svelte-check 0/0; vitest 33 files / 498 passed; @smoke chromium 35 passed; cargo fmt/clippy clean; cargo test 154 passed + 0. No security surface beyond the contributor guard, which is a strict subset of `update_task_meta_for_ctx` (creator check + `my_day: true` 403).
  - Gate: CHANGES r1 @202d4fa — security-brief
    - CRITICAL (HIGH, blocks): the hydrate-time sweep makes dirty writes from a stale cache, and those writes beat fresh server state. `hydrateFromDb` → `migrateStarsToTag` (tasks.ts:1011-1014) marks each starred cached copy `dirty` before any pull happens. The next pull then keeps the local copy because `mergeRemote` skips dirty tasks (tasks.ts:508 `if (existing?.dirty) continue`). The push after it (`+layout.svelte:72-76`, pull then push) sends the whole stale row. The server applies it with no `updated_ts` conflict check (`tasks.rs:446`: `emoji = ?11` overwrites outright; title, status, notes, due_date and my_day come from the stale copy through `coalesce`). Example: phone last synced while T was ★ and untagged. On desktop, T has since been tagged 🎯, its notes edited, and it was marked done. The phone upgrades: T comes back ⭐, pending, with the old notes, on every device. The 🎯 tag is overwritten (breaks R1) and real edits are lost silently. This hits every device on upgrade, when caches are at their stalest. Fix: do not sweep server-backed tasks at hydrate. Sweep only `task.local` tasks there, or tasks in an anonymous / never-synced scope. Sweep server tasks only inside `mergeRemote`, and only the rows that just arrived from `remote` (fresh), plus local-only rows. Add a test: a stale starred cache, then hydrate, then a pull bringing priority 0 and 🎯, must end with 🎯 and not dirty.
    - WARNING (LOW): a stale cached role (admin demoted to contributor) means the hydrate sweep dirties tasks the user can no longer edit. Push then returns 403, `applyRejections` runs `clearDirty`, and the user sees a "denied (403)" banner once. Until the server copy changes, this device shows ⭐ while the server keeps ★ (the incremental pull will not send it again). This is bounded: no loop, and the background `reconcileSession` corrects the role. The CRITICAL fix (no hydrate sweep of server rows) removes it too.
    - NOTE: the sweep adds a persist straight after `hydrateFromDb`. If auth/scope changes while `loadAll` is in flight, it could write scope A's tasks into scope B's IDB. That race already exists for any save; this is a suspicion only, I have no reproduced path. Clamping `priority` from IDB or the wire is fine: `mapApiTask` clamps to 0..3, a corrupt IDB value of 0 or less is skipped, and the sweep always writes 0. Collapsing priority 2/3 into ⭐ is irreversible but follows R1. The contributor guard matches `update_task_meta_for_ctx` (creator check, `my_day: true` returns 403). The `emoji || '⭐'` logic never overwrites a non-empty tag in the sweep itself.
  - Gate: CHANGES r1 @202d4fa — adversary
    - CRITICAL (independently reproduced; concurs with security-brief) — the plan is wrong here, and the code follows it faithfully. The sweep after `hydrateFromDb` (tasks.ts:1014) marks stale cached copies of server-backed rows `dirty` before any pull. On the next pull `mergeRemote` skips them (tasks.ts:508), and the push that follows sends the whole stale row. Scratch vitest through the real `syncFromServer` + `pushPendingToServer`: the IDB copy is {pending, no tag, notes "OLD", priority 1} and the server row is {done, 🎯, notes "NEW", priority 0}. The device pushed `{"status":"pending","priority":0,"emoji":"⭐","notes":"OLD notes",…}`. A completed task comes back to life, the 🎯 tag is overwritten (breaks R1) and the newer notes are lost. Acceptance 1(f) test "runs after hydrateFromDb" pins this behaviour. Fix: at hydrate, sweep only `local` (never-synced) or already-`dirty` rows. Sweep server-backed rows only inside `mergeRemote`, and only rows that arrived fresh in `remote` and were not skipped as dirty. Add the stale-cache regression test (stale ★ cache → hydrate → pull brings 🎯/done → expect 🎯, done, not dirty, nothing pushed).
    - WARNING (concurs with qa; reproduced) — an unruled behaviour loss. Measured: an undated starred task is in `myDaySuggestions` before the sweep and gone after it (`['x1']` → `[]`). Zeroing is irreversible for starred-and-tagged rows: no trace of the star is left that could restore Suggestions membership later. So the owner has to rule before merge, not afterwards through debt 055. Either accept the loss (record it here) or add undated `emoji === '⭐'` as a Suggestions source.
    - NOTE — the starred-first removal in the two route files is held only by grep. Re-adding a starred-first `.sort` in `+page.svelte` breaks no unit test, because no route test imports `sortTasks`, and no E2E fixture creates `priority > 0` any more. This is low risk because the UI can no longer create stars. Disclosed, not blocking.
    - NOTE — contributor guard: no 403 path found for pulled rows. The server checks are creator, `my_day: true`, unchanged assignee and list grant (tasks.rs:383-425), and the client mirrors creator and `my_day`. A 403 does not loop: `clearDirty` runs, and the incremental pull does not redeliver the row. Suspicion only: stale cached rows from a list whose grant was revoked are swept, which would give one 403 banner. The CRITICAL fix (hydrate sweeps only local/dirty rows) removes that path.
    - Measured at 202d4fa: vitest 33 files / 498 passed; lint clean; svelte-check 0/0; chromium `myday.spec.ts` + `smoke.spec.ts` 34 passed / 0 failed. Mutants, all killed: no hydrate sweep, no merge sweep, overwrite tag, guard always true, drop creator check, drop loading skip, no dirty, no ts bump, `>= 0`, persist on null, keep priority, always-changed, saveFromDetails writes priority, sort starred-first, drawer payload has priority, row ★ back. Survived: a route-level starred-first sort (NOTE above). My Day sort modes are `created`/`alpha` only (SortControls.svelte:24-25, +page.svelte:167), so the extraction behaves the same.
- PR:
