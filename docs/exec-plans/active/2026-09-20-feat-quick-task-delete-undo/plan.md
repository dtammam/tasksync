---
plan: feat-quick-task-delete-undo
harness: v2 · lean
anchor: outcome
status: Building
next: Store softDelete/undoDelete + grace timer, undo toast in layout, rewire row delete; then tests + /gate.
gate: pending
---

# Quick single-task delete + undo (roadmap Piece 4, slice 1)

## Request (restated)

Make deleting a single task a one-gesture action from the task row (mobile +
desktop) with an **undo toast** instead of a blocking confirm dialog — fast but
not fatal. First slice of the bulk-task-ops umbrella (Piece 4); it should
establish the delete+undo pattern a later multi-select bulk-delete slice reuses.

## Blind-spot pass (read the code, cited)

- **Today's delete UX is a blocking `confirm()`.** `TaskRow.svelte:113`
  `deleteTask()` calls `confirm('Delete this task?')` then `await
  tasks.deleteRemote(task.id)`; there's also a "Delete" button in the row's
  action menu (`TaskRow.svelte:274`). Removing the `confirm()` and replacing it
  with an undo affordance is the core of this slice.
- **`deleteRemote` is an immediate HARD delete** (`tasks.ts:427-435`): a
  `local`/unsynced task is just `remove`d client-side; a synced task does
  `await api.deleteTask(id)` (a real server DELETE) then `remove`. There is **no
  client grace window / soft-delete state** today — so undo has to be built.
- **Sync delete model** (`sync.ts:201,217` → `tasks.applyRemoteDeletes`,
  `tasks.ts:331`): incoming deletes are server tombstones (`deleted_ts`)
  reconciled on pull. Outgoing deletes go through the immediate `api.deleteTask`
  call above, NOT the dirty-flag push pipeline. This slice does **not** change
  how a committed delete reaches the server — it only defers *when* that call
  fires and lets the user cancel it first.
- **Server enforces role on delete already** (`server/src/routes/tasks.rs:292`
  `delete_task`; contributor checks mirror `update_task`'s `created_by_user_id`
  gate at `:260-272`). Server-authoritative; unchanged by this client-only
  slice — no `server/**` change expected.
- **Toast infra to reuse, not invent:** `+layout.svelte` already renders a
  transient `remoteTaskToast` (`:168-186,434`) with a timer + dismiss. The undo
  toast can follow that shape (add an Undo action + a grace timer). There is a
  precedent for undo semantics in the store: `undoRecurringCompletion`.
- **Recurring tasks:** a recurring task is a single row with a `recur_rule`;
  deleting it removes the whole series (there's nothing per-occurrence to
  delete). Undo restores that one row. No special recurring handling needed
  (contrast the bulk check/uncheck plan, where recurring math mattered).
- **Views to keep consistent:** tasks render in My Day (`+page.svelte`) and list
  (`list/[id]/+page.svelte`) views off the same store; a pending-delete must
  disappear from BOTH immediately, so the "hidden while pending delete" state
  belongs in the store (one source of truth), not a page.
- No active plan overlaps; `feat-bulk-clear-list-tasks` (list-wide clear) and the
  parked `feat-bulk-check-uncheck-tasks` are adjacent but separate. `AGENTS.md`:
  destructive/data-losing changes force the full gate — a *delete* feature will
  be gated `full` (adversary + qa, and the `deletes-data` rule) regardless.

## Anchor

Anchor — default: `outcome` · recommended: `outcome` (match). The result is
directly eyeball-able (delete a task → it's gone + an undo toast → Undo brings it
back; or let it expire → it's committed). The one real design fork is the undo
*mechanism* (below) — surfaced here for confirmation rather than pinned as a full
`spec` register, since it's a single decision with a clear recommendation.
Override to `spec` if you'd rather formally pin the mechanism first.

## Approach & the one key decision — the undo mechanism

**Recommended: a store-owned deferred delete (grace window).** On delete, the
store marks the task **pending-delete** (kept in the store but filtered out of
every derived view, so it vanishes from My Day + list instantly), starts a
grace timer (~5s), and shows an undo toast.
- **Undo** within the window clears the pending-delete flag → the task
  reappears, byte-identical, with **no server call at all**.
- **Commit** (timer expires, or the user deletes another task, or navigates
  away / unloads) calls the existing `tasks.deleteRemote(id)` — the actual
  server delete path, unchanged. So exactly one commit path, reusing today's
  code; the server/sync contract is untouched.
- Works offline for the reversible part (hide + undo are pure client state); a
  committed synced-task delete still needs the network exactly as it does today
  (pre-existing; not regressed, not fixed here).

**Alternative (not recommended): immediate hard delete + recreate-on-undo** —
delete now, and Undo re-creates the task. Simpler state, but it does two server
round-trips, can't undo offline, and risks id/sync churn on recreate. Rejected
unless you prefer it.

Sub-decisions (recommendations, confirm/override): grace window **5s**; the
toast lives in the **layout toast slot** (reuse `remoteTaskToast`'s shape) so it
shows regardless of view; committing a pending delete when a second delete
starts (one toast at a time, or a small stack — recommend **one at a time**,
newest commits the previous); **remove the `confirm()`** dialog entirely.

## Acceptance (outcome — measurable)

1. **One gesture, undo toast, no confirm dialog.** Deleting a task from the row
   (mobile + desktop) removes it from the visible list immediately with **no
   `confirm()`** and shows an undo toast for a bounded window. Bound by an E2E
   `@smoke`: delete → row gone + undo toast visible → click **Undo** → the same
   task row is back with identical title; AND delete → let the toast expire →
   row stays gone (task absent from IDB / committed). `grep` confirms no
   `confirm(` remains in the task-row delete path.
2. **Deferred delete: no server delete if undone; exactly one if committed.** A
   store unit test (fake timers): after `softDelete(id)` the task is excluded
   from the visible/derived lists but `api.deleteTask` has NOT been called;
   `undoDelete(id)` before commit calls no delete and restores the task; letting
   the grace window commit calls `deleteRemote` exactly once. Reversible part
   works offline (no network for hide/undo).
3. **No regression, server untouched, recurring intact.** `git diff --name-only
   main...HEAD -- server/` is empty; the sync tombstone path
   (`applyRemoteDeletes`) and contributor role enforcement are unchanged;
   deleting a recurring task removes the series and Undo restores it; `npx
   vitest run` and the full e2e suite (chromium/firefox/webkit, preview build)
   stay green.

## Build (2026-09-20)

- **Store** (`tasks.ts`): `pendingDeleteId` + `visibleTasks` derived (tasks minus
  the one in its grace window); the public `subscribe` and all six view stores
  (`myDayPending/Missed/Completed/Suggestions`, `tasksByList`, `listCounts`) now
  read `visibleTasks`, so a soft-deleted task vanishes from every view but stays
  in `tasksStore` (a sync pull during the window can't resurrect it). New
  methods `softDelete(id)` (hide + 5s grace timer, commits any prior — one at a
  time), `undoDelete(id)` (cancel, no server call), `commitDelete()` (commit
  now). Exposed `pendingDelete` readable for the toast. Commit reuses the
  existing `deleteRemote`.
- **TaskRow.svelte**: `deleteTask` → `tasks.softDelete` (removed the `confirm()`,
  the async try/catch, and the now-dead `deleting`/`actionError`/`.error`).
- **+layout.svelte**: an undo toast driven by `$pendingDelete` (reuses the
  remote-task-toast shape; `data-testid="undo-delete-toast"` + `undo-delete`
  button) and `afterNavigate` commits any in-flight delete.
- **Commit ordering (r2, addressing qa r1 suggestion):** `commitPendingDelete`
  keeps the task filtered (`pendingDeleteId` still set) until `deleteRemote` has
  actually removed it, clearing the flag in `.finally` (id-guarded so a newer
  soft-delete still wins). Without this, a *synced* task — whose delete awaits a
  network round-trip — flashed back into view mid-commit. The reversible
  hide/undo path is unchanged; all four store unit tests stay green.

## Verification (local, pre-gate)

- `npm run lint` / `npm run check`: clean. `npx vitest run`: **421 passed** —
  incl. 4 new store tests (hidden-not-deleted-until-commit; commit-once-on-
  elapse; undo-cancels; second-delete-commits-previous, all with fake timers)
  and the updated TaskRow delete test (asserts `softDelete` + no `confirm`).
- **New E2E `@smoke`** `tests/e2e/task-delete-undo.spec.ts`: delete → row gone +
  undo toast (no confirm) → Undo restores → delete again → grace window commits
  (toast auto-hides, row stays gone). **Passes chromium + firefox + webkit.**
- Full e2e suite on preview: **181 passed / 16 skipped**; the lone webkit
  `myday.spec.ts:1020` "failure" was a browser-closed crash under concurrent
  3-engine memory pressure on this shared box (passes 33/33 on webkit run alone;
  a completion test, unrelated to delete) — not a regression. CI is the arbiter.
- `git diff --name-only main...HEAD -- server/`: empty — no server change.

## Notes
- Branch `feat/quick-task-delete-undo` off `main @68b7939`.
- This slice deliberately keeps the *committed* delete on the existing immediate
  `deleteRemote` path — moving deletes to a queued/offline-durable model is a
  separate concern, out of scope here.

## Gate

Gate: APPROVED r1 @a6e615f30f392d5493e63991d9664e76c44f91c1 — adversary
Gate: APPROVED r1 @a6e615f30f392d5493e63991d9664e76c44f91c1 — qa
