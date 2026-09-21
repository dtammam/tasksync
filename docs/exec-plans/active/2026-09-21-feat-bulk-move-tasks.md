---
plan: feat-bulk-move-tasks
harness: v2 · lean
branch: feat/bulk-move-tasks
anchor: outcome
status: Gate:APPROVED r2 @85c6500
next: Gate APPROVED by both seats @85c6500 — run /release (push, mark Shipped, doc → completed/)
gate: APPROVED r2 @85c6500 — adversary, qa
---

# Bulk move (reattribute) — Piece 4 remaining slice

**Restated request:** in the existing multi-select mode (list view + My Day),
add a **Move** action that reattributes every selected task to a different
list, chosen from a picker. This is the "reattribute" op from Piece 4's
original scope; the other remaining slice (clone) stays separate.

## Blind-spot pass (2026-09-21)

Read the move surface end to end. The move primitive **already exists** — this
slice is a bulk wrapper over a proven per-task path, not new plumbing.

- **Server move is done and role-safe.** `update_task_meta_for_ctx`
  (`server/src/routes/tasks.rs:354`) already accepts a `list_id` change via
  `PATCH /api/tasks/:id`. For a `Contributor` it verifies **both** that they may
  edit the task's current list **and** that they hold a `list_grant` on the
  **target** `list_id` (`tasks.rs:415-421`) before the update. The target-list
  authorization is **server-authoritative** — the client cannot bypass it.
- **Client single-move is done.** `tasks.moveToList(id, list_id)`
  (`web/src/lib/stores/tasks.ts:617`) sets `list_id` + `dirty` + `updated_ts`
  and lets the ordinary dirty-task sync push it as an `update_task_meta` PATCH.
  **No new wire verb is needed** for bulk move — it is N independent field
  patches.
- **Selection infra is done.** `BulkSelectToolbar.svelte` already renders in both
  views with an `eligibleIds` prop scoped to what the user may act on
  (`+page.svelte:351`, `list/[id]/+page.svelte:254`), plus a `selection` store
  with `snapshot()`/`setMany()`/`exit()`. Bulk move slots in beside the existing
  Delete/Tag buttons and reuses `eligibleSelection()`.
- **Target-list scoping (the one real design question).** The picker must offer
  only lists the user can move INTO. For a **contributor** the server returns
  only granted lists, so "known lists minus the current list" is already the
  writable set; for an **admin** every list is writable. So client scoping =
  known lists − source list, with the server grant-check as the authoritative
  backstop (a stale/forbidden target → 403, must degrade gracefully, not wedge
  the batch).
- **Landing order.** `moveToList` does **not** touch `order`; a moved task keeps
  its `order` string and sorts into the target list wherever that lands. Bulk
  move should match single-move exactly (no reordering side effect) — same
  behavior, N times. Noted so the gate can measure "nothing else changed".
- **Mixed-selection subtlety.** Selection can span tasks already in the target
  list (My Day view crosses lists). Moving a task to the list it's already in is
  a no-op patch — must be tolerated (idempotent), not counted as a move or
  errored.
- **Recurring tasks.** Recurring tasks reuse one id across occurrences; a move is
  a plain `list_id` patch and carries the rule with it — no special case
  expected, but the gate should confirm a recurring task survives a move intact.

**Assumptions this rests on:** (1) the client's known-lists set equals the
user's writable set (true given the server's grant-scoped `getLists`); (2) the
existing dirty→PATCH sync path handles a `list_id`-only change idempotently
(it already does for single move); (3) no per-list `order` renumber is expected
on arrival (matches current single-move behavior).

## Anchor — default: `outcome` · recommended: `outcome` (match)

Default and recommended both `outcome` — you'll eyeball the result. Unlike
Piece 3 (emoji), this slice adds **no** field, schema, migration, or wire verb:
the data model, the server endpoint, and the role check all already exist and
are read above. "Correct" here is observable directly (select → pick list →
tasks move, once, and sync stays idempotent), so a written decision register
would be ceremony over a proven path. Confirm, or override to `spec` if you want
the target-list-scoping contract pinned before code.

Gate sizing: touches `web/src/**` → `core-logic` row → **full gate (adversary +
qa)**. It is **not** destructive/data-losing (a move is reversible, no delete, no
migration), so no forced `security-brief` seat — expect adversary + qa.

## Acceptance (outcome anchor — three measurable bullets)

1. **The action works and is scoped.** In selection mode on both the list view
   and My Day, a **Move** control opens a picker of target lists (= known lists
   minus the current/source list); choosing one moves every *eligible* selected
   task to it and exits selection mode.
   *Measured:* a store unit test that `moveToListMany(ids, target)` sets
   `list_id`+`dirty`+`updated_ts` on exactly the eligible ids and no others; a
   component/E2E `@smoke` that selects ≥2 tasks, moves them, and asserts they
   appear in the target list and are gone from the source.

2. **No new plumbing; idempotent + offline.** Bulk move reuses the existing
   `update_task_meta` PATCH path — **no new route** in `tasks.rs` and **no new
   wire verb**. Applied offline then synced, each moved task lands in the target
   list exactly once; re-applying a move (or moving a task already in the target)
   is a no-op.
   *Measured:* `git diff` adds no route/handler to `server/src/routes/tasks.rs`;
   a unit test asserts a repeated move is a no-op and that a task already in the
   target is unchanged.

3. **Nothing else changes.** A bulk move alters only `list_id` (+ `dirty` /
   `updated_ts`); `order`, `title`, `emoji`, `status`, `my_day`, recurrence, and
   due state are untouched — bulk move is observably N single moves, no more.
   *Measured:* a unit test snapshots a moved task and asserts every field but
   `list_id`/`dirty`/`updated_ts` is byte-identical before and after.

## Design (approach — outcome anchor, no formal gate)

Bulk move is a thin wrapper over the proven single-move path; no schema, no
route, no wire verb. Server (`update_task_meta` target-list grant-check) and
403 degrade (sync `applyRejections` clears dirty → re-pull restores source) are
already in place and untouched.

- **Store** — `tasks.moveToListMany(ids, list_id): number` mirrors
  `setEmojiMany`: sets `list_id`+`dirty`+`updated_ts` on eligible ids, **skips**
  ids that are unknown or already in the target (no-op, uncounted), returns the
  count actually moved. `order` and all other fields untouched.
- **Toolbar** (`BulkSelectToolbar.svelte`) — a **Move** pill beside Tag opens a
  target-list panel (`bulk-move-panel`) listing `$lists` minus `my-day` (a
  derived view, never a move target) minus `excludeListId`. Picking a list calls
  `moveToListMany(eligibleSelection(), id)` then exits selection (same "apply +
  exit" flow as Tag). One picker open at a time. Move disabled when nothing is
  selected or no target exists.
- **List view** passes `excludeListId={listId}` + an `onBulkMoved` toast
  (`"Moved N tasks to <list>"`, or a "already there" note when N=0).
- **My Day** renders the toolbar with defaults: `excludeListId` undefined
  (selection spans lists), no toast — consistent with its existing silent
  delete/tag.

**Build (files touched):**
- `web/src/lib/stores/tasks.ts` — `moveToListMany`
- `web/src/lib/components/BulkSelectToolbar.svelte` — Move pill + picker
- `web/src/routes/list/[id]/+page.svelte` — wire `excludeListId` + `onBulkMoved`
- `web/src/lib/stores/tasks.test.ts` — 3 unit tests (moves eligible / only
  list_id changes / unknown+empty+repeat are no-ops)
- `web/tests/e2e/bulk-move.spec.ts` — `@smoke` select two → move → assert gone
  from source, present in target, source list excluded from picker

**Instruments (pre-commit):** `npm run check` 0 errors/warnings · `npm run lint`
clean · `npx vitest run` 448/448 pass. No server (Rust) change — cargo untouched.

## Decisions (resolved at intake)

- **Move-target authorization failure UX — degrade gracefully.** Owner-approved
  2026-09-21. If the server rejects a target (403 — grant revoked between load
  and move), the failed tasks **stay in their source list** and the user gets a
  single toast; the rest of the batch still moves. No partial-limbo state, no
  wedged batch. Exact toast copy to be settled in design.

## Gate

Gate: APPROVED r1 @e74a6d6 — qa
Gate: APPROVED r1 @e74a6d6 — adversary
Gate: APPROVED r2 @85c6500 — adversary
Gate: APPROVED r2 @85c6500 — qa
