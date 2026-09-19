---
plan: feat-bulk-clear-list-tasks
harness: v2 · lean
anchor: spec
status: Draft
gate: pending
---

# Bulk-clear all tasks in a list

## Request

Owner-reported: deleting a list with hundreds of tasks currently requires
hand-deleting every task first, since `delete_list` deliberately blocks
(`409 Conflict`) on a non-empty list. Add a way to clear a list's tasks in
one action, ahead of deleting the list itself.

Two decisions already confirmed live with the owner:
- **Two-action model**: a separate "clear all tasks in this list" bulk
  action; `delete_list` keeps blocking on non-empty lists exactly as today
  (its existing safety behavior is untouched).
- **Scope**: clears both pending and completed tasks — the whole list.

## Blind-spot pass

- **Single-task delete already has a tombstone pattern to replicate
  correctly.** `delete_task` (`server/src/routes/tasks.rs`) deletes the row
  and inserts into `task_tombstone` (for offline sync clients to learn about
  the deletion) inside one transaction. A bulk version must do this for
  every deleted task, still inside one transaction — partial application
  (some tasks deleted, no tombstones, or vice versa) would corrupt sync
  state for other clients.
- **This is a destructive, data-loss-capable change** — `.harness/scrutiny.toml`'s
  `data-loss` rule forces the full gate (adversary, qa, security-brief)
  regardless of how small the diff looks.
- **Permission model precedent**: `create_list`/`update_list`/`delete_list`
  are all admin-only (`ctx.role != Role::Admin` -> 403). Since this bulk
  action is explicitly in service of the same admin list-management
  workflow (clear, then delete), it should be admin-only too, not opened up
  to contributors clearing their own tasks — consistent with every other
  list-level mutation in this codebase.
- **Contributor task-delete precedent differs**: `delete_task` lets a
  contributor delete only their *own* task. That per-task ownership model
  doesn't map cleanly onto "clear this whole list" (which tasks would a
  contributor be allowed to bulk-clear — just their own, silently skipping
  others'? that's a confusing partial-clear UX for a "clear all" button) —
  admin-only sidesteps this ambiguity entirely.
- **No existing bulk-mutation endpoint precedent** in this codebase (sync
  push handles multiple *changes* but each change is still a discrete,
  individually-tombstoned task mutation, not a single "delete everything
  matching X" server-side operation) — this is genuinely new shape.

## Anchor

Anchor — default: `outcome` · recommended: **`spec`**

Destructive, data-loss-capable, and introduces a new bulk-mutation shape
this codebase hasn't had before. Recommend pinning the interface (endpoint
shape, permission, response body, confirm UX) before writing code.

## Decision register

**D1 — New endpoint: `DELETE /lists/:id/tasks`.** Space- and list-scoped
(mirrors `delete_task`'s `and space_id = ?` pattern). Deletes every task row
where `list_id = :id and space_id = ctx.space_id`, regardless of status
(pending or done) — matches the owner's confirmed "all tasks" scope.

**D2 — Admin-only.** Same `ctx.role != Role::Admin` check as
`create_list`/`update_list`/`delete_list`, per the blind-spot pass above.

**D3 — One transaction, one tombstone per deleted task.** Mirrors
`delete_task`'s exact tombstone-insert pattern (`task_tombstone` with
`on conflict(task_id, space_id) do update`), looped over every task id
returned by the bulk `delete ... returning id`. All in one `sqlx`
transaction — no partial application on failure.

**D4 — Response: `{ "deleted_count": N }`, 200 OK.** Lets the client show
"Cleared 42 tasks" feedback. `N = 0` (empty list) is a valid, non-error
response — not a 404 — since "clear an already-empty list" is a harmless
no-op, not a client error.

**D5 — Client confirm, no exact count in the dialog text.** Reuses the
native `confirm()` pattern already used for `deleteList`/`deleteMember`
(`Sidebar.svelte`), phrased generically ("Delete all tasks in "<list
name>"? This cannot be undone.") rather than trying to show a live count —
avoids a staleness/race between whatever count is displayed and what
actually gets deleted server-side by the time the confirm resolves.

**D6 — Placement: next to the existing per-list "Delete" button in the
Lists settings panel** (`Sidebar.svelte`'s admin list-management rows),
as a new "Clear tasks" action — same place the owner already goes to
manage/delete lists, so clearing-then-deleting is a natural two-click
sequence in one place.

## Acceptance

- [x] An admin can clear every task (pending and completed) in a list via
  one confirmed action, without hand-deleting each task first.
  (`admin_can_bulk_clear_all_tasks_in_a_list` server test; `Sidebar.svelte`
  "Clear tasks" button + confirm; `tasks.clearListRemote` store method)
- [x] After clearing, `delete_list` on that now-empty list succeeds (no
  longer 409s). (`delete_list_succeeds_after_bulk_clear` server test)
- [x] A contributor cannot call the bulk-clear endpoint (403).
  (`contributor_cannot_bulk_clear_list_tasks` server test)
- [x] Every cleared task gets a `task_tombstone` row, matching the existing
  single-delete behavior, so other clients' offline sync learns about the
  deletion correctly — verified for a multi-task clear (not just N=1).
  (`admin_can_bulk_clear_all_tasks_in_a_list`, via `sync_pull`)
- [x] Clearing an already-empty list succeeds with `deleted_count: 0`, not
  an error. (`bulk_clearing_an_already_empty_list_succeeds_with_zero`)
- [x] Tasks in *other* lists, or other spaces, are never touched by a
  clear on one list — verified directly, not assumed.
  (`bulk_clear_does_not_touch_other_lists_or_spaces`)

## Progress log

**E2E coverage attempted, then dropped as unreliable, not as skipped.**
Wrote a full E2E test (create list -> add tasks -> clear -> delete) and hit
a reproducible issue: list creation makes a real, non-optimistic
`POST /lists` network call (unlike task creation, which is local-first via
IndexedDB) with no live backend in this E2E environment, requiring
`page.route` mocking. After fixing that, task creation on the *newly
mocked* list intermittently failed to persist even to IndexedDB — and,
digging further, the *same* flakiness reproduced on a **pre-existing,
completely unmodified** list/task-creation flow when run back-to-back in
the same spec file (confirmed via a throwaway debug script, not shipped).
This points at an environment-level timing issue in this sandbox unrelated
to the bulk-clear feature itself — the same class of issue the CI pairing
session (tech-debt #050/#051) already spent real effort on. Given the
server (5 tests, including tombstone/cross-list/cross-space verification)
and the client store (2 tests, success and failure paths) already directly
verify every acceptance criterion above, shipping without E2E coverage
here rather than forcing in a test that doesn't reliably reflect the
feature itself.
