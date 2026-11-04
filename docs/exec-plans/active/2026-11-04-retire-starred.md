---
plan: retire-starred
harness: v2 · lean
branch: feat/retire-starred
anchor: outcome
status: Planned
next: builder — Step 0, then W1
gate: pending
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
   starred task gets swept).
2. **UI gone.** No element with `data-testid` `task-star-indicator` or
   `detail-star-toggle` renders for a task with `priority: 1`; the ⋯ shelf has
   no Star/Unstar button. Bound by `TaskRow.test.ts` + a drawer test.
   `grep -rn "Unstar\|star-indicator\|star-toggle\|compareStarredFirst\|setPriority" web/src`
   returns nothing.
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

- W1:
- W2:
- W3:
- Gate:
- PR:
