---
plan: feat-bulk-check-uncheck-tasks
harness: v2 · lean
anchor: spec
status: Parked(revisit: owner paused to do plan-doc lifecycle housekeeping first, 2026-09-19)
next: Resume intake confirmation of anchor (spec) + decision register D1-D10 with the owner.
gate: pending
---

# Bulk check/uncheck-all, list-wide and per tag section

## Request

Owner-reported, right after a heavy-usage session bulk-tagging ~200 grocery
items into aisle categories (`emoji` field, via a one-off script hitting
`PATCH /tasks/:id` directly): "I think we should add an option to
check/uncheck all (we have uncheck). And maybe for tagged sections as well."

Restated: the list view (`web/src/routes/list/[id]/+page.svelte`) already has
an "Uncheck all" button that bulk-marks a list's *done* tasks back to
*pending* (`tasks.uncheckAllInList`, `web/src/lib/stores/tasks.ts:283-304`).
There is no symmetric "Check all" for bulk-marking *pending* tasks as *done*.
Additionally, tasks within a list are grouped into tag sections by emoji
(`groupTasksByTag`, `web/src/lib/tags/grouping.ts`) with a static, non-
interactive header per section (`tag-group-title` div) — the ask is for
check-all/uncheck-all to also work scoped to one tag section, not just the
whole list.

## Blind-spot pass

- **`uncheckAllInList` is pure client-side, no server endpoint** — it flips
  local `Task.status`/`completed_ts`, marks `dirty:true`, and lets the
  existing per-task sync push propagate the change (`tasks.ts:283-304`). This
  is the established pattern for this class of change (unlike bulk-*delete*,
  which needed server-side tombstones in the just-shipped
  `feat-bulk-clear-list-tasks`) — a new "check all" should follow the same
  shape, not invent a server endpoint.
- **Recurring tasks are NOT naturally symmetric with `uncheckAllInList`.**
  `uncheckAllInList` only ever touches `status === 'done'` tasks, and a
  recurring task's `status` never becomes `'done'` in the first place — a
  single `toggle()` on a recurring task advances `due_date` and stays
  `'pending'` (`tasks.ts:353-367`). So `uncheckAllInList` sidesteps recurring
  tasks for free. A "check all" has no such shortcut: it will hit pending
  recurring tasks directly and must decide how to treat them (see D2) rather
  than naively setting `status: 'done'` on everything pending.
- **`toggle()`'s side effects don't scale to a loop.** A single toggle can
  trigger a completion sound, a streak announcer, or a "day complete"
  celebration (`tasks.ts:388-407`). Reusing `toggle()` in a loop over dozens
  of tasks would fire that stack once per task — a real UX bug, not a
  hypothetical (see D3).
- **Tag sections are rendered twice, independently, already split by
  status.** `pendingGroups` and `completedGroups` are two separate
  `groupTasksByTag` calls over `pendingTasks`/`completedTasks`
  (`+page.svelte:85-86`) — there is no single "section" that contains both a
  list's pending and completed tasks for one tag. A per-section action is
  therefore inherently one-directional per rendered header: a group header in
  the Pending block only ever has pending tasks to check; one in the
  Completed block only ever has completed tasks to uncheck (see D4).
- **Untagged is just another group**, and a list with no tags in use
  collapses to one unlabeled group (`key: '__all__'`, `label: ''`) that the
  template doesn't render a header for at all (`{#if group.label}`,
  `grouping.ts:27-28`) — the existing list-level buttons already cover that
  case; no section-level control should try to duplicate it (see D6).
- **Contributor scoping precedent already exists and must be mirrored.**
  `uncheckAllInList(listId, { ownerUserId })` only touches tasks the calling
  contributor created (`tasks.ts:289`, wired from `+page.svelte:88-92,116`).
  A new `checkAllInList` (and any section-scoped variant) must apply the
  identical scoping rule, not a weaker or different one.
- No existing plan under `docs/exec-plans/active/` overlaps this area.
  `AGENTS.md` has no standing decision specific to bulk status changes; the
  closest precedent is the just-merged bulk-clear-list-tasks piece, which is
  a *delete* (forced full gate under `.harness/scrutiny.toml`'s
  `deletes-data` rule) — this piece is a *status* change, not a deletion, so
  it should NOT automatically inherit that same forced-full-gate treatment,
  but the seat table gets evaluated fresh at `/gate` time regardless.

## Anchor

Anchor — default: `outcome` · recommended: `spec`

This isn't a data-model or schema change, but it has several genuine
"correct behavior must be pinned before code" decision points surfaced above
(recurring-task semantics, side-effect batching, section-scope direction)
where a wrong read is real rework across both the store and two template
insertion points, not just a cosmetic miss an eyeball pass would catch.
Recommend `spec` — confirm, or override to `outcome` if you'd rather I use
judgment on D2/D3 and you just eyeball the result.

## Decision register

- **D1 — New store method.** Add `tasks.checkAllInList(listId, opts?:
  {ownerUserId?: string})` next to `uncheckAllInList` in
  `web/src/lib/stores/tasks.ts`, same shape (map over `tasksStore`, single
  `dirty:true` + one `repo.saveTasks()` call at the end, return count
  changed). This is the new interface everything else hangs off.
  **Recommend: build this.**

- **D2 — Recurring-task handling in "check all".** A pending recurring task
  can't just get `status: 'done'` slapped on it (that's not what completing
  a recurring task means anywhere else in the app).
  **Recommend:** replicate `toggle()`'s recurring branch per task — advance
  `due_date` via `nextRecurringDueAfterCurrent`, bump
  `occurrences_completed`, set `completed_ts`/`updated_ts`, leave `status`
  as `'pending'` — so bulk-checking a recurring task advances it exactly one
  occurrence, same as tapping it once.
  **Alternative:** skip recurring tasks entirely (exclude them from the
  eligible count and the mutation) — simpler, zero risk of subtly wrong
  recurrence math, but "check all" would silently leave some visibly-pending
  tasks unchecked, which may surprise the owner.

- **D3 — Side effects during a bulk check.** Looping `toggle()` as-is would
  fire a completion sound / streak announcer / day-complete celebration once
  per task.
  **Recommend:** `checkAllInList` calls `streak.increment(id)` for each
  newly-completed task (so streak accounting stays accurate) but suppresses
  per-task audio/announcer playback; evaluate the "last My Day task" /
  day-complete condition exactly once after the whole batch is applied, and
  play at most one completion sound (or the day-complete celebration if
  triggered) for the entire bulk action, not per item.
  **Alternative:** suppress streak/sound/day-complete entirely for bulk
  actions — simplest, but under-counts the streak versus completing the same
  tasks one at a time.

- **D4 — Tag-section scope is direction-specific, not symmetric.** A group
  header rendered in the **Pending** block gets a "Check all" button (scoped
  to that group's task ids, calling `checkAllInList`'s per-id equivalent); a
  group header rendered in the **Completed** block gets an "Uncheck all"
  button. Neither block's header gets both buttons — there's nothing to
  uncheck in a pending-only group. **Recommend: build this** (matches the
  existing pending/completed split rendering exactly; no new "combined
  section" concept needed).
  This implies the store methods need a per-task-id-set variant, not just
  per-list — e.g. `checkAllInList(listId, opts)` for the list-wide button,
  plus the ability to scope to `group.tasks.map(t => t.id)` for a section
  button. **Recommend:** generalize to `checkTasks(ids: string[], opts?)`
  and `uncheckTasks(ids: string[], opts?)` as the actual primitives; the
  list-wide buttons call them with `pendingTasks.map(t => t.id)` /
  `completedTasks.map(t => t.id)` (still contributor-scoped identically),
  and section buttons call them with just that group's task ids. This also
  lets `uncheckAllInList` be re-expressed as a thin wrapper, so there's one
  code path instead of two near-duplicates.

- **D5 — Untagged group gets the same section button as any other tag
  group**, no special-casing — it's just another `group.key`/`group.tasks`
  bucket. **Recommend: build this.**

- **D6 — No section header (and no section button) when a list has no tags
  in use.** `groupTasksByTag` already collapses to one unlabeled
  `label: ''` group in that case, and the template already skips rendering
  a header for it (`{#if group.label}`) — the list-level buttons cover this
  case identically to how "Uncheck all" already does today.
  **Recommend: leave this behavior as-is; no new logic needed.**

- **D7 — "Check all" list-header button placement and eligibility.** Add a
  `Check all` ghost-pill in `.tools`, next to `Uncheck all` (recommend
  ordering: Import, **Check all**, Uncheck all — chronological logic of
  "add/complete/undo"). Disabled when a new `checkEligibleCount` (mirroring
  `uncheckEligibleCount`'s contributor-scoped-count pattern at
  `+page.svelte:90-92`, but over `pendingTasks`) is `0`.
  **Recommend: build this.**

- **D8 — No confirmation dialog for "Check all."** Matches the existing
  "Uncheck all" button's own precedent (single click, no `confirm()`) —
  completing tasks is non-destructive and individually reversible, unlike
  the delete confirmation added for bulk-clear-list-tasks.
  **Recommend: build this.**

- **D9 — Section-button styling.** Inline small text-buttons inside the
  (now-interactive) `tag-group-title` row — e.g. label text followed by a
  `tiny`-class ghost button — matching the existing `tiny` ghost-button
  precedent from the Sidebar's "Clear tasks" control shipped in
  bulk-clear-list-tasks, sized for an inline row rather than the page-header
  `ghost-pill` styling used at list level.
  **Recommend: build this.**

- **D10 — No new server endpoint.** `checkTasks`/`uncheckTasks` stay pure
  client-side store methods relying on the existing per-task dirty-flag +
  sync-push pipeline, exactly like `uncheckAllInList` today. Bulk-checking
  N tasks means N individual `PATCH /tasks/:id` calls go out on the next
  sync push, not one atomic server call — acceptable since that's the
  established pattern this whole feature area already uses, and sync pushes
  are already coalesced by the sync coordinator rather than fired
  synchronously per mutation.
  **Recommend: build this (i.e., explicitly do NOT add a server route).**

## Confirm

Anchor `spec`, and the decision register above (D1-D10) — confirm as
written, or override individual IDs (D2 and D3 are the two genuinely
judgment-call items; D6/D10 are closest to "no real alternative"). No
research pass proposed — the relevant behavior (`toggle()`, `groupTasksByTag`,
`uncheckAllInList`) is already fully read and cited above, nothing
unfamiliar to verify first.
