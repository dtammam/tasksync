---
plan: feat-multi-select-bulk-delete
harness: v2 · lean
anchor: outcome
status: Built (pre-gate)
next: Run /gate (adversary + qa, escalate security-brief). Owner authorized intake+build; holds at gate.
gate: pending
---

# Multi-select + bulk delete (Piece 4, slice 3)

## Request (restated)

Add a **selection mode** on both the **per-list view** (`list/[id]/+page.svelte`)
and **My Day** (`+page.svelte`): tap/click to multi-select tasks, then
**bulk-delete** the selection in one gesture with a **single batched undo toast**
("N tasks deleted · Undo"). Reuse the soft-delete grace-window + undo pattern
from slice 1 (`feat-quick-task-delete-undo`) rather than inventing a new one.
Branch `feat/multi-select-bulk-delete`, off `main`.

## Blind-spot pass (2026-09-20)

Read: `web/src/lib/stores/tasks.ts` (soft-delete internals + `deleteRemote`),
`web/src/routes/+layout.svelte` (undo toast), `web/src/lib/components/TaskRow.svelte`
(delete trigger), both view routes, `server/src/routes/tasks.rs` (delete role),
`.harness/scrutiny.toml`, `AGENTS.md`.

1. **Slice-1 soft-delete is single-id — the core generalization.**
   `pendingDeleteId: writable<string|null>` (tasks.ts:26), one `pendingDeleteTimer`,
   `visibleTasks` filters exactly one id (30–32), and `commitPendingDelete` keeps
   that id filtered until `deleteRemote` resolves via an **id-guarded `.finally`**
   (48–60). Bulk needs a **set of pending-deleted ids** with **one shared grace
   window**. Design question for Phase 2: generalize `pendingDeleteId` →
   `pendingDeleteIds: Set<string>` (single source of truth, single timer) vs. add
   a parallel batch path. Leading approach: **generalize to a set** so `visibleTasks`
   and the six view stores filter `!ids.has(task.id)`, and single delete becomes
   "a batch of one" — one code path, no divergence. The id-guarded commit
   (don't un-hide until the server round-trip resolves) must be preserved
   **per id** so a synced task can't flash back mid-commit.

2. **Undo toast is single-title.** `+layout.svelte:446` renders one toast from
   `$pendingDelete` (a single task). Needs a batched variant: when >1 id is in the
   window, show "N tasks deleted · Undo"; Undo restores **all**. Keep the existing
   single-task copy for a batch of one (no visible regression to slice 1).

3. **Delete sync is per-task + idempotent.** `deleteRemote(id)` (tasks.ts:534)
   handles local vs server id: local/non-server-id → `tasks.remove` (no call);
   server id → `api.deleteTask` then remove. Bulk after the grace window is just
   N per-task `deleteRemote` calls (server tombstones each — `task_tombstone`).
   Undo before the window cancels with **no** server call. No new wire verb.

4. **Server enforces delete role — no bypass.** `delete_task` (tasks.rs:292)
   returns `FORBIDDEN` for a Contributor without permission (299–312). Bulk reuses
   the same endpoint per task, so enforcement is inherited server-side. **Client
   safety rule:** the selectable/deletable set must be scoped to tasks the user
   `canEdit` (mirror TaskRow's `canEditTask` + the Check-all `ownerUserId` /
   contributor scoping), so a contributor can't even *stage* a delete the server
   will reject — no half-applied batch, no confusing 403s.

5. **Recurring tasks:** bulk delete deletes the series/rule, identical to single
   delete today (no special recurring branch in `deleteRemote`). Confirmed same
   semantics — call it out in a test, no new behavior.

6. **Selection-mode UI placement.** Both views render `TaskRow`. Leading approach:
   a **small shared selection store** (`selection` — `mode: boolean`, `ids: Set<string>`,
   `toggle/enter/exit/clear`) so both routes and `TaskRow` share one source of
   truth and `TaskRow` stays presentational (it renders a checkbox + selected
   state when `mode` is on, emits toggle). Alternative (per-view local state)
   duplicates logic across two routes. Phase 2 decides; store is the recommendation.

7. **No gesture collision with shipped affordances.** Slice-1 single delete lives
   in the TaskRow action menu; Check-all/Uncheck-all are list-header pills. Selection
   mode is a distinct entry (e.g. a "Select" header affordance) — when **off**, all
   existing gestures behave exactly as today; when **on**, row tap = toggle-select
   (detail-open + star + action-menu suppressed). Assumption to hold: entering
   selection mode is explicit and reversible, and leaving it clears the set.

**Assumptions this rests on:** (a) reuse `deleteRemote`/`api.deleteTask` — no
server change; (b) generalize the existing grace-window rather than add a second
delete path; (c) selection is client-only ephemeral UI state (not persisted, not
synced); (d) contributor scoping is applied client-side to the selectable set,
server remains authoritative.

## Anchor

**Default `outcome` · recommended `outcome` — they match.** This is UI +
a store generalization whose result you can eyeball and E2E: no new schema, no
new interface, no new wire verb (reuses `deleteRemote`/`api.deleteTask`). The one
sharp edge — batched-undo grace semantics and role-scoped selection — is captured
as measurable acceptance below, not as a design register. You'll eyeball the
selection UX on both views; the gate measures the delete/undo/role invariants.

> Note: this is a **destructive / data-losing** change. Per `AGENTS.md` it takes
> the **full gate**, and at Phase 4 I will **escalate to add the `security-brief`
> seat** (adversary + qa + security-brief) — bulk delete + role scoping is exactly
> the surface that seat exists for. Escalation only; never dialed down.

## Acceptance (outcome — measurable against the tree)

1. **Selection mode + bulk delete on both views.** On the per-list view and My
   Day, a user can enter selection mode, multi-select ≥2 tasks, and delete them in
   one action; the selected tasks leave every visible list immediately and a
   **single** "N tasks deleted · Undo" toast appears. *Measured by:* an E2E `@smoke`
   on each view (add tasks → select 2 → bulk-delete → assert both gone from the
   list and exactly one batched toast), passing chromium/firefox/webkit.

2. **One batched grace window; undo restores all; commit deletes per-task.** A
   bulk delete stages all selected ids in **one** shared grace window: `visibleTasks`
   (and the six view stores) hide all of them; **Undo within the window restores
   every task with no server call**; on commit each id is deleted via the existing
   `deleteRemote` (server ids → `api.deleteTask`, local → removed), idempotently,
   and a `/sync/pull` landing mid-window cannot resurrect a staged task. *Measured
   by:* store unit tests over the generalized pending-delete set (stage N → all
   hidden → undo → all back, zero `deleteRemote` calls; stage N → commit → N
   `deleteRemote` calls; pull-during-window keeps them hidden), plus the slice-1
   single-delete tests still green (batch-of-one parity).

3. **Role-scoped, recurring-safe, no regression to shipped affordances.** The
   deletable selection is scoped to tasks the user `canEdit` (contributor scoping
   consistent with single delete + Check-all); recurring tasks delete the series
   exactly as single delete does; and with selection mode **off**, single delete,
   Check-all/Uncheck-all, star, and detail-open behave exactly as today (no gesture
   collision). *Measured by:* unit tests for the contributor-scoped selectable set
   and recurring delete; the existing `TaskRow`/`tasks`/Check-all suites unchanged
   and green; an E2E asserting single delete + Check-all still work.

## Build (2026-09-20)

Design chosen from the blind-spot leading approaches; owner authorized intake+build
(hold at gate).

- **`tasks.ts` — generalized the grace window to a set.** `pendingDeleteId:
  string|null` → `pendingDeleteIds: Set<string>` with one shared timer.
  `visibleTasks` filters `!ids.has(id)`; `pendingDelete` returns the single task
  only when exactly one is staged (slice-1's single toast unchanged);
  `pendingDeleteBatch` = `{count}` when ≥2. `commitPendingDelete` fires
  `deleteRemote` per id and un-stages each id **only after its own round-trip
  resolves** (`unstageCommitted`, guarded against a newer window). New public
  methods: `softDeleteMany(ids)`, `undoDeleteAll()`; `softDelete(id)` is now
  `softDeleteMany([id])` (a batch of one).
- **`selection.ts` (new)** — ephemeral, non-persisted, non-synced multi-select
  store shared by both views: `selectionMode`, `selectedIds`, `selectedCount`,
  and `selection.{enter,exit,toggle,setMany,clear,has,snapshot}`.
- **`SelectableTask.svelte` (new)** — wraps `TaskRow` untouched (zero regression
  risk to shipped gestures); in selection mode renders a checkbox (aria-label
  `Select "<title>"`) and greys/disables rows the user can't edit.
- **`BulkSelectToolbar.svelte` (new)** — "N selected", Select all / Clear /
  Delete / Cancel. Delete stages `softDeleteMany(selected ∩ eligibleIds)` then
  exits; select-all/delete are confined to the view's eligible (editable) ids.
- **`+layout.svelte`** — added the batched "Deleted N tasks · Undo" toast
  (`undo-delete-batch-toast` → `undoDeleteAll`) beside the single-task toast.
- **List view + My Day** — a "Select" pill enters selection mode; the toolbar
  renders while active; `TaskRow` → `SelectableTask` in the Planned/Completed
  (and list Pending/Completed) sections; eligibility mirrors edit permission
  (contributor scoping); `selection.exit()` on view unmount.

**Contributor safety:** the selectable set is scoped client-side to editable
tasks, and the server's `delete_task` still enforces role — no bypass, no server
change. **Recurring:** deletes the series exactly as single delete (no special
branch). **No new wire verb** — bulk commit is N idempotent `deleteRemote` calls.

## Verification (against acceptance)

- **Unit:** `selection.test.ts` (6) + `tasks.ts` bulk-delete block (6, incl.
  batched hide/undo, per-task commit, local+server mix, unknown-id drop, batch-of-
  one parity). Full suite **439 passed** (was 427).
- **E2E `@smoke`** `bulk-delete.spec.ts`: list view (select 2 of 3 → delete →
  single batched toast → Undo restores) and My Day (select-all → delete → grace
  window commits). **Green on chromium + firefox + webkit.**
- **No regression:** `task-delete-undo` + `list-check-all` E2E green; lint +
  `svelte-check` clean (0/0).

## Out of scope (deferred slices)

Bulk **move to list**, **clone**, and per-tag-section check/uncheck — each its own
later slice. This slice establishes the multi-select + batched-delete pattern the
bulk-move/clone slices will reuse.
