---
plan: feat-bulk-clear-list-tasks
harness: v2 · lean
anchor: spec
status: Gate:APPROVED r4 @a6cf836
gate: APPROVED r4 @a6cf836 — adversary, qa, security-brief
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
  (`bulk_clear_does_not_touch_other_lists_or_spaces` for the other-list case;
  `admin_cannot_bulk_clear_a_different_spaces_list_by_id` for the
  security-critical cross-space case, added in the r1 fix round after the
  adversary mutation-tested the original cross-space assertion and found it
  didn't actually exercise the `space_id` filter -- see Progress log)

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

**r1 fix round.** QA and the adversary independently found the same
`listMessage`-not-reset UI bug (fixed: `createList`/`renameList`/`moveList`/
`handleDrop` now clear it, matching the sibling `teamMessage` convention).
The adversary additionally mutation-tested `bulk_clear_does_not_touch_other_lists_or_spaces`
and found its cross-space assertion used a *different* `list_id` per space,
so it couldn't actually detect a dropped `and space_id = ?2` clause (that
mutant survived all 5 original tests) -- confirmed independently myself by
temporarily dropping the clause and re-running, then restoring it. `list.id`
being a global primary key makes a literal same-id collision across spaces
schema-impossible, so the real boundary worth testing is different: can an
s1 admin delete tasks in a list that genuinely belongs to space s2, by
supplying s2's real list id? Added
`admin_cannot_bulk_clear_a_different_spaces_list_by_id`, verified it fails
against the dropped-clause mutant and passes against the real code.

**r2 fix round.** QA re-verified the r1 fixes clean, then surfaced a NEW
finding while re-running instruments: `cargo test` failed once in 5
full-suite runs on the new `admin_cannot_bulk_clear_a_different_spaces_list_by_id`
test (0 failures in 5 isolated single-test runs — a pool-contention
signature, not a logic bug). Root cause, confirmed by reading `setup_pool()`
directly: it opened a plain `SqlitePool::connect("sqlite::memory:")` --
SQLite's in-memory mode is per-*connection*, not per-URI, so a default
multi-connection pool can hand a query to a connection that never saw the
migrations or that test's seed data, intermittently. This is pre-existing
test infrastructure shared by all 107 tests in this file, not something the
bulk-clear feature introduced -- but it was surfacing here first because
this is the one test whose safety property is sensitive enough to actually
notice a stale/empty connection's wrong answer. Fixed at the source:
`setup_pool()` now uses `SqlitePoolOptions::new().max_connections(1)`,
forcing every query within one test onto the same connection (the standard
fix for this well-known sqlx/SQLite interaction). Verified with 10
consecutive full-suite `cargo test` runs, 0 failures (1070 test executions
total); `cargo clippy -- -D warnings` and `cargo fmt -- --check` both clean.

**r3 fix round.** QA independently re-ran the fix 10x clean (0/1070) and
confirmed it correct, then found a SECOND helper in the same file,
`bare_pool()`, with the byte-identical unpinned pattern
(`SqlitePool::connect("sqlite::memory:")`, no `max_connections` pin) used
by 6 other tests. Applied the identical fix. Grepped the whole `server/src`
tree afterward to confirm these were the only two unpinned in-memory pool
helpers in the crate (the production pool in `main.rs` and `bin/seed.rs`
both connect to a real file path, immune to this class of bug entirely).
Verified with 8 more consecutive full-suite runs, 0 failures (18/18 clean
runs total across both fix commits, 1926 test executions).

## Gate

### security-brief — r1 @41c10cd

**Scope note:** read-only review — I have no Bash tool in this seat, so I
read the working tree directly (already checked out at HEAD `41c10cd`)
rather than running `git diff` myself. Files read in full:
`server/src/routes/lists.rs`, `server/src/routes/tasks.rs`,
`server/src/routes/types.rs` (auth/ctx resolution), `server/src/main.rs`
(route mounting), `server/migrations/0001_init.sql` and
`0013_task_delete_tombstones.sql` (FK/cascade surface),
`web/src/lib/api/client.ts`, `web/src/lib/stores/tasks.ts`,
`web/src/lib/components/Sidebar.svelte`, and the four new server tests in
`server/src/routes/mod.rs`. This covers the full diff described in the plan
doc; no gaps to flag.

**Named surface 1 — admin-only check placement.** VERIFIED. In
`clear_list_tasks` (`server/src/routes/lists.rs:169-177`), `ctx.role !=
Role::Admin -> FORBIDDEN` is the first thing after `ctx_from_headers`,
before any DB access — byte-for-byte the same ordering as `create_list`,
`update_list`, and `delete_list` in the same file. No info leak before the
check (e.g. no list-existence probe happens first).

**Named surface 2 — scoping / cross-space isolation.** VERIFIED by tracing,
not assumed. `ctx.space_id` originates only from `ctx_from_headers`
(`types.rs:216-244`), which decodes and signature-verifies the `Authorization:
Bearer` JWT and takes `space_id` from `decoded.claims.space_id` — never from
a client-supplied header, body field, or the path param. The delete
(`lists.rs:183`) binds `?1` to the path's `:id` (client-controlled) and `?2`
to `ctx.space_id` (server-derived) — same two-bind pattern as `delete_list`'s
task-count guard and `delete_task`. Because both predicates are ANDed, an
admin of space A passing a `list_id` that actually belongs to space B cannot
match any row (that list's tasks carry `space_id = B`, not A) — it's a safe
0-row no-op, not a cross-space match. Confirmed against
`bulk_clear_does_not_touch_other_lists_or_spaces`, which seeds a genuine
second space/list/task and asserts it survives.

**Named surface 3 — confused deputy.** VERIFIED (negative finding). Only one
router entry calls `clear_list_tasks`: `list_routes`'s
`.route("/:id/tasks", delete(clear_list_tasks))`. No other route, client
code path, or sync mechanism references the handler. More importantly the
role check lives *inside* the handler body (not on a shared middleware
layer that something could route around), so even a hypothetical second
caller would still hit the same check. `Role` is resolved fresh from a
`membership` DB join on every request (`resolve_identity`), not trusted from
JWT claims, so a stale/forged role claim in an old token can't grant admin.

**Named surface 4 — resource exhaustion / DoS.** Real but non-blocking for
this deployment context. The delete has no batch-size cap, and the
tombstone insert is one query per deleted row inside a single transaction
(`lists.rs:190-201`) — O(n) round-trips, held in one open transaction for
the duration. For a solo-dev self-hosted instance the only party who can
trigger this is an admin acting on their own space's own data — the same
trust boundary as `delete_list`, `update_list`, and every other admin-gated
mutation already in this codebase. This is self-inflicted at worst (an
admin clearing a list with an extreme task count blocks their own request
briefly), not an attacker-reachable DoS. INFO, not a finding: if list sizes
ever grow to the tens of thousands, the N+1 tombstone-insert loop is worth
batching for latency, not security.

**Named surface 5 — data loss without recourse.** VERIFIED as matching, not
exceeding, existing irreversibility. No backup/undo path — identical to
`delete_task`/`delete_list`, which also have none; this isn't a new class of
unrecoverable action, just the same one at bulk scale, which is exactly
what the plan and D2/D3 claim. Checked the schema directly
(`0001_init.sql`, `0013_task_delete_tombstones.sql`) for any FK referencing
`task(id)`: none exists. `list_grant` references `list`, not `task`. So
bulk-clearing a list's tasks touches only `task` (deleted) and
`task_tombstone` (upserted) — the identical blast radius as N sequential
single-task deletes, with no cascading effect on grants, sync cursors, or
anything else.

**Other checks.** Client (`Sidebar.svelte`'s `clearListTasks`,
`tasks.ts`'s `clearListRemote`) gates on `adminMode` and a native
`confirm()` before calling the API — cosmetic only, since the server is the
real enforcement point and does not trust the client. `clearListRemote`
only mutates local IndexedDB state after the server call resolves
(`await api.clearListTasks(listId)` before the local filter), so a failed
request leaves local state untouched, matching the plan's stated
failure-path test. `deleted_count: 0` on an empty list returns 200, not 404
or an error, matching D4. Response body carries no internal error detail
(`INTERNAL_SERVER_ERROR` is a bare status code, no message leakage).

**Findings:** none at CRITICAL/HIGH/MEDIUM/LOW. One INFO (N+1 tombstone-insert
loop, batching worth considering only if list sizes grow far beyond current
scale — not a security finding).

**Tree state:** this verdict line is the only edit I made to the plan doc;
no other file touched. (Note: `.claude/agents/security-brief.md` shows
modified in `git status` from before this review started — not something I
touched, and outside the scope of this branch's feature diff.)

Gate: APPROVED r1 @41c10cd — security-brief

### security-brief — r2 @209d969

Re-engaged per the coordinator's note that the tree moved (three commits,
`41c10cd` -> `209d969`) after r1. Re-verified independently rather than
taking the summary on faith — read the current state of every file the
summary named, plus re-confirmed `clear_list_tasks` itself.

1. **`server/src/routes/lists.rs`** — read in full again: byte-for-byte
   identical to what I reviewed at r1. `clear_list_tasks`'s admin check,
   the `list_id = ?1 and space_id = ?2` bind order, and the
   transaction/tombstone-loop structure are unchanged. Named surfaces 1, 2,
   3, 4, 5 from r1 all still hold as verified.
2. **`web/src/lib/components/Sidebar.svelte`** — confirmed the only change
   is `listMessage = ''` added to `createList`, `renameList`, `moveList`,
   and `handleDrop` (grepped all six call sites), matching the existing
   convention already present in `deleteList`/`clearListTasks`. No new
   network call, no new data flow, no security surface.
3. **New test `admin_cannot_bulk_clear_a_different_spaces_list_by_id`**
   (`server/src/routes/mod.rs:2044`) — read in full. This is a genuine
   strengthening of exactly the gap I noted at r1 (I'd verified the
   cross-space no-op by code tracing since the prior test only covered a
   *different* list_id in a different space, not an admin explicitly
   supplying an*other* space's real list_id). This new test does that
   directly: s1-admin calls `clear_list_tasks` with s2's real `list_id`,
   asserts `deleted_count == 0` and that s2's task survives. Confirms my r1
   reasoning was correct; no logic changed to produce this result.
4. **`setup_pool()` single-connection fix** (`server/src/routes/mod.rs:55`,
   inside `mod tests` at line 18) — confirmed this is confined to the test
   module and not part of any production code path (production pool
   construction is separate, in `main.rs`/`types.rs::app_state`, untouched
   by this commit). Fixes a documented test-flake mechanism (SQLite
   in-memory mode being per-connection, not per-URI, under a multi-
   connection pool). No security relevance.

No new findings. All prior findings stand as previously banded (zero
CRITICAL/HIGH/MEDIUM/LOW; one non-blocking INFO on tombstone-insert
batching, unchanged and still not a security concern at this scale).

Gate: APPROVED r2 @209d969 — security-brief

### security-brief — r3 @a6cf836

Re-engaged per the coordinator's note (tree moved `209d969` -> `a6cf836`).
Independently verified rather than accepting the summary: read
`bare_pool()` (`server/src/routes/mod.rs:126-138`) directly. It sits inside
the same `mod tests` block as `setup_pool()` (opened at line 18, still in
scope), applies the identical `SqlitePoolOptions::new().max_connections(1)`
fix for the same documented reason (SQLite in-memory mode being
per-connection, not per-URI). `test_state()` immediately below it
(line 140) just wraps whatever pool it's handed — no production code path
touches `bare_pool()`. `clear_list_tasks` and the rest of
`server/src/routes/lists.rs` are unaffected (not re-touched by this
commit). No new security surface; findings from r1/r2 stand unchanged.

Gate: APPROVED r3 @a6cf836 — security-brief

### qa — r1 @41c10cd

**Instruments run, verbatim results:**
- `cargo fmt -- --check` (server/): clean, no output, exit 0.
- `cargo clippy -- -D warnings` (server/): clean, no warnings/errors.
- `cargo test` (server/): `test result: ok. 106 passed; 0 failed; 0 ignored;
  0 measured; 0 filtered out`. Includes all 5 new bulk-clear tests
  (`admin_can_bulk_clear_all_tasks_in_a_list`,
  `contributor_cannot_bulk_clear_list_tasks`,
  `bulk_clearing_an_already_empty_list_succeeds_with_zero`,
  `bulk_clear_does_not_touch_other_lists_or_spaces`,
  `delete_list_succeeds_after_bulk_clear`) — all `ok`.
- `npm run lint` (web/): clean, no output beyond the script header.
- `npm run check` (web/): `svelte-check found 0 errors and 0 warnings`.
- `npx vitest run` (web/): `Test Files 28 passed (28)` / `Tests 411 passed
  (411)`, including the 2 new `clearListRemote` tests in
  `web/src/lib/stores/tasks.test.ts` (57 tests in that file, up from 55).
  Two stderr lines are expected console.error output from pre-existing
  error-path tests in `sync.test.ts`, not failures.

**Field-name spot check — VERIFIED, no mismatch.** Server
(`server/src/routes/lists.rs`): `ClearListTasksResponse { deleted_count:
i64 }`, serialized via `#[derive(Serialize)]` → JSON key `deleted_count`.
Client (`web/src/lib/api/client.ts:171-174`): `clearListTasks` types the
response as `{ deleted_count: number }`. Store
(`web/src/lib/stores/tasks.ts:430`): destructures `const { deleted_count }
= await api.clearListTasks(listId)`. All three spellings match exactly.
Also checked `fetchJson` (`client.ts:95-116`): the handler returns `200
OK` with a JSON body (not `204`), so `fetchJson` parses and returns it
rather than short-circuiting to `undefined` — the response actually
reaches the store, this isn't a case where a 204-vs-200 mismatch would
silently swallow the field.

**Route collision — none.** `list_routes()`
(`server/src/routes/lists.rs`) registers `/`, `/:id`, and the new
`/:id/tasks`. axum's router matches by path-segment count/shape, so
`/:id` (one segment) and `/:id/tasks` (two segments) are disjoint
patterns — no shadowing either direction. Confirmed empirically too: all
pre-existing `update_list`/`delete_list` tests still pass unchanged, and
the new `delete_list_succeeds_after_bulk_clear` test exercises
`delete_list` and `clear_list_tasks` back-to-back against the same list
id with no interference.

**Progress log honesty — checked against the acceptance checklist,
accurate.** Mapped all 6 acceptance items to the cited tests:
1. admin bulk-clear → `admin_can_bulk_clear_all_tasks_in_a_list`
2. `delete_list` succeeds after → `delete_list_succeeds_after_bulk_clear`
3. contributor 403 → `contributor_cannot_bulk_clear_list_tasks`
4. tombstone per task, multi-task → `admin_can_bulk_clear_all_tasks_in_a_list`
   via `sync_pull` (asserts all 3 seeded ids appear in `deleted_tasks`)
5. empty-list `deleted_count: 0` → `bulk_clearing_an_already_empty_list_succeeds_with_zero`
6. other lists/spaces untouched → `bulk_clear_does_not_touch_other_lists_or_spaces`
   (seeds a genuine second space + list + task and asserts survival)

All 6 are genuinely, directly covered — the log's claim is not oversold.
The E2E-dropped account is also honest: it names the specific repro
(list creation is non-optimistic and needs route mocking in this E2E
sandbox; a throwaway debug script confirmed the same flakiness on an
untouched, pre-existing flow run back-to-back), rather than hand-waving
"skipped for time."

One tension worth naming, not blocking: `docs/CONTRIBUTING.md` says
"E2E when behavior is user-visible or cross-module," and this is both
(server route + store + Sidebar button). The plan's justification is a
real, investigated environment flake rather than an excuse, and I
confirmed by grepping the existing Playwright specs that none of this
same Sidebar panel's sibling actions (`deleteList`, `renameList`,
`createList`) have E2E coverage either — so this isn't a new gap unique
to this diff, it's consistent with (undocumented) existing practice for
this panel. Noting as SUGGESTION, not blocking.

**WARNING — stale `listMessage` leaks across sibling list actions.**
`web/src/lib/components/Sidebar.svelte`. `listMessage` is new state
introduced by this diff (verified: absent entirely at base sha
`8d6d566`). It is correctly reset (`listMessage = ''`) at the top of
`clearListTasks` (line 484) and `deleteList` (line 464), but **not** at
the top of `createList` (line 316, only `listError = ''`), `renameList`
(line 348, same), `moveList` (line 390, same), or `handleDrop` (line
443, same) — all four render into the exact same shared `{#if
listMessage}<p class="ok">{listMessage}</p>{/if}` block
(Sidebar.svelte:997-999) as `clearListTasks`.

Concrete scenario: admin clicks "Clear tasks" on list A → succeeds →
`listMessage = 'Cleared 3 tasks from "A".'`. Admin then renames list B
(or reorders any list, or creates a new list) → that action succeeds,
`listError` is cleared but `listMessage` is never touched → the stale
"Cleared 3 tasks..." message keeps displaying under the *now-unrelated*
rename/reorder/create action, falsely implying a clear just happened (or
masking that the rename actually succeeded, since there's no distinct
success feedback for rename). It persists until the admin happens to
trigger `clearListTasks` or `deleteList` again, or reloads.

This is a real regression against the file's own established pattern:
the sibling `teamMessage` state (added earlier, same panel style) is
reset at the top of *every* team-mutating action
(`grep -n "teamMessage = ''"` → 6 hits, one per action:
invite/reset-password/remove/etc.), so the convention in this exact file
is "every action in the panel that shares a message slot clears it
first." This diff only followed that convention for 2 of the 6 list
actions that share `listMessage`'s render slot.

Given the project's own memory notes this app has "a daily active user,
deeply invested in polish/UX," and the fix is a one-line addition to 4
existing `try` blocks (or hoisting the reset into a shared helper), I'm
treating this as blocking rather than shipping disclosed.

**Local-filter risk (`clearListRemote`'s `list.filter((t) => t.list_id
!== listId)`) — no path found.** The filter only runs after
`api.clearListTasks(listId)` resolves successfully (verified: `await`
before the `updateAndPersist` call, and the failure-path test
`clearListRemote does not remove any local tasks when the server call
fails` confirms local state is untouched on rejection). A task's local
`list_id` could only diverge from server truth via a bug elsewhere (e.g.
a stale optimistic move not yet synced), which is out of scope for this
diff and not introduced by it. No finding, matching the task's own
hedge.

**Tree state:** only edit is this appended section plus the verdict
line below. `.claude/agents/security-brief.md` remains modified from
before this review started (pre-existing, not touched by me, already
noted by the security-brief seat above).

Gate: CHANGES r1 @41c10cd — qa

### adversary — r1 @41c10cd

**Instruments run, verbatim results (all against the committed tree at
`41c10cd`, restored after each mutation):**
- `cargo test` (server/): `test result: ok. 106 passed; 0 failed; 0
  ignored; 0 measured; 0 filtered out` — includes all 5 new tests
  (`admin_can_bulk_clear_all_tasks_in_a_list`,
  `contributor_cannot_bulk_clear_list_tasks`,
  `bulk_clearing_an_already_empty_list_succeeds_with_zero`,
  `bulk_clear_does_not_touch_other_lists_or_spaces`,
  `delete_list_succeeds_after_bulk_clear`), each also re-run individually.
- `cargo fmt -- --check` (server/): exit 0, no output.
- `cargo clippy --all-targets -- -D warnings` (server/): exit 0, no
  warnings.
- `npx vitest run src/lib/stores/tasks.test.ts` (web/): `57 tests` passed,
  including both new `clearListRemote` tests.
- `npm run test` (web/, full suite): `Test Files 28 passed (28)` /
  `Tests 411 passed (411)`.
- `npm run lint` (web/): clean, no output.
- `npm run check` (web/): `svelte-check found 0 errors and 0 warnings`.

**Mutation testing — server (`server/src/routes/lists.rs`,
`clear_list_tasks`), each applied individually then reverted via the saved
original, tree confirmed clean after each cycle:**
- Dropped the `ctx.role != Role::Admin` check entirely →
  `contributor_cannot_bulk_clear_list_tasks` goes red (`left: None, right:
  Some(403)`). Killed.
- Removed the tombstone-insert loop body (no-op'd it) →
  `admin_can_bulk_clear_all_tasks_in_a_list` goes red on the `sync_pull`
  tombstone assertion. Killed.
- Removed `tx.commit()` (implicit rollback on drop) →
  `admin_can_bulk_clear_all_tasks_in_a_list` (remaining count still 3, not
  0) and `delete_list_succeeds_after_bulk_clear` (409 persists) both go
  red. Killed. Confirms D3's one-transaction/no-partial-application claim
  actually binds, not just reads correctly.
- **Removed `and space_id = ?2` from the delete query** (mutated to
  `delete from task where list_id = ?1 returning id`, leaving `ctx.space_id`
  bound as an unused parameter) → **all 5 new tests still pass, including
  `bulk_clear_does_not_touch_other_lists_or_spaces`.** Surviving mutant.

**WARNING — the cross-space isolation test does not exercise the
predicate it claims to verify.** The acceptance checklist states this
property is "verified directly, not assumed," but the mutant above shows
the reviewer-facing test would not catch a regression that drops the
`space_id` filter entirely. Why: `bulk_clear_does_not_touch_other_lists_or_spaces`
proves isolation via a *different* `list_id` per space (`list_to_clear.id`
vs `l-other`), so removing the `space_id` predicate has no observable
effect in that test — nothing ties the "other space" task to the *same*
`list_id` string as the target list, which is the one scenario where a
missing `space_id` filter would actually leak across spaces.

To be precise about severity: I traced `ctx.space_id`'s origin
(`ctx_from_headers`, `server/src/routes/types.rs:216-244`) and confirmed
it is decoded from a signature-verified JWT and never client-suppliable,
and list ids are `Uuid::new_v4()` (`create_list`, `lists.rs:85`) — so in
the **shipped code as committed**, cross-space leakage via `list_id`
collision is not practically reachable today (both because the SQL
predicate is present *and* because IDs are cryptographically random).
This is not a live vulnerability in `41c10cd`. It is a **test-suite
integrity gap**: the specific security-critical clause the brief asked to
attack (`and space_id = ?2`) has a surviving mutant, so a future refactor
that silently drops it (e.g. someone "simplifying" the query, or copying
this handler as a template for a new endpoint with less scrutiny) would
ship with no test catching the regression, while the acceptance checklist
would still read as satisfied. Recommend: add a test that seeds the
*same* `list_id` string under two different `space_id`s (not two
different lists) and asserts clearing one space's list never touches the
other's rows under that shared id — that is the one shape of input that
actually discriminates a present-vs-missing `space_id` predicate.

**WARNING — concur with qa's stale-`listMessage` finding, verified
independently against the committed sha (not the current dirty working
tree).** `git show 41c10cd:web/src/lib/components/Sidebar.svelte | grep
"listMessage = ''"` shows exactly two hits — `deleteList` (line 464) and
`clearListTasks` (line 484) — while `createList` (311), `renameList`
(332), `moveList` (368), and `handleDrop` (422) all render into the same
shared `{#if listMessage}` slot without resetting it. This independently
confirms qa's repro at the sha under review. (Note: mid-review the
working tree — not the commit — picked up an uncommitted 4-line diff to
`Sidebar.svelte` adding `listMessage = ''` to those four handlers,
apparently an in-progress fix; since it is uncommitted it is not credited
against `41c10cd` and does not change this verdict. Re-verify at whatever
sha actually lands it.)

**Other surfaces checked, no findings:**
- Admin-gating is layered correctly: `settingsActiveSection === 'lists' &&
  adminMode` gates the entire panel (`Sidebar.svelte:938`) containing the
  `{#each managedListsManual as list, index}` loop the new button lives
  in, *and* `clearListTasks` has its own `if (!adminMode) return;` —
  removing either layer alone still leaves the other. Button is wired to
  the correctly-scoped loop variable (`list.id`, `list.name`), not a
  stale/outer closure.
- `fetchJson` throws on any non-2xx before `clearListRemote`'s
  `updateAndPersist` runs, and reordering the await-then-filter sequence
  in `clearListRemote` (filter before await) turns the "does not remove
  local tasks on failure" test red — ordering claim is real, not
  incidental.
- Field-name (`deleted_count`) and route-shape (`/:id` vs `/:id/tasks`)
  checks from security-brief/qa spot-checked and confirmed by independent
  reading, not re-litigated in full here.
- E2E-drop rationale: independently sanity-checked the acceptance-to-test
  mapping (6/6 items map to a named, passing test) without needing to
  reproduce the flake myself, per the brief. No hand-waving found in the
  Progress log's account.

**Tree state:** restored `server/src/routes/lists.rs` and
`web/src/lib/stores/tasks.ts` after every mutation cycle (diffed against
the saved pre-mutation copy each time; `git diff` on both is empty).
Working-tree-only, pre-existing-at-session-start: `.claude/agents/security-brief.md`
(not touched by me). Working-tree-only, appeared mid-review, not touched
by me: the 4-line `Sidebar.svelte` diff noted above. My only edit is this
appended section plus the verdict line below.

Gate: CHANGES r1 @41c10cd — adversary

### adversary — r2 @b66ab6c

Delta re-review of both r1 findings. Both fixed as prescribed; no new
findings introduced.

**Finding 1 (mine) — cross-space test-quality gap: FIXED AS PRESCRIBED,
verified by re-running the exact mutant.** Re-applied my r1 mutant
(dropping `and space_id = ?2` from the `DELETE` in `clear_list_tasks`,
`server/src/routes/lists.rs`) against the `b66ab6c` tree and ran the full
`bulk_clear` test group: the new
`admin_cannot_bulk_clear_a_different_spaces_list_by_id`
(`server/src/routes/mod.rs`) now goes red —
`left: 1, right: 0, "an s1 admin must not be able to delete s2's tasks by
supplying s2's real list id"` — while it passes against the real,
restored code. File restored after the mutation cycle (`git diff` on
`lists.rs` empty).

The fix deviates from my literal suggestion (I asked for "the same
`list_id` string under two different `space_id`s") but the deviation is
correct and better: I verified the schema myself
(`server/migrations/0001_init.sql:21-22`, `id text primary key` on
`list`, not composite with `space_id`) — a literal same-id collision
across spaces is enforced schema-impossible by the primary key, so my
originally-suggested repro shape could never occur. The shipped test
instead targets the actual reachable boundary: an s1-authenticated admin
supplying s2's real (distinct, valid) list id. This is the correct
mutation-discriminating shape for this schema and a better test than the
one I proposed. Full server suite: `cargo test` → **107 passed, 0
failed** (106 + 1 new). `cargo fmt -- --check` clean, `cargo clippy
--all-targets -- -D warnings` clean.

**Finding 2 (qa's, concurred in r1) — stale `listMessage`: FIXED AS
PRESCRIBED.** `web/src/lib/components/Sidebar.svelte` now has 6
`listMessage = ''` resets, one at the top of each of the 6 actions that
render into the shared `{#if listMessage}` block: `createList` (317),
`renameList` (350), `moveList` (393), `handleDrop` (447), `deleteList`
(468), `clearListTasks` (488) — verified by grep + cross-referencing each
line number against its enclosing `const <name> = async` declaration.
Matches the sibling `teamMessage` convention qa cited (every action
resets its own shared-slot message state before running). `npm run
check` → 0 errors/warnings; `npm run test` → 411 passed (28 files); `npm
run lint` → clean.

**No new findings.** Diffed `41c10cd..b66ab6c`: two commits, exactly the
scope described (`98ad493` touches only the 4 missing `listMessage`
resets in `Sidebar.svelte`; `b66ab6c` adds only the one new server test
in `mod.rs` plus the plan-doc Progress-log entry). No production logic in
`clear_list_tasks`/`clearListRemote` itself changed between r1 and r2.

**Tree state:** restored `server/src/routes/lists.rs` after the r2
mutation cycle (`git diff` on it is empty). Only edit is this appended
section plus the verdict line below.
`.claude/agents/security-brief.md` remains modified from before this
review started (pre-existing, not touched by me or this fix round).

Gate: APPROVED r2 @b66ab6c — adversary

### qa — r2 @b66ab6c

**Delta re-verify of my r1 finding: FIXED AS PRESCRIBED.** Diffed
`web/src/lib/components/Sidebar.svelte` between `41c10cd` and `98ad493`
(the fix commit) directly: `listMessage = '';` was added at the top of
`createList` (line 317), `renameList` (350), `moveList` (393), and
`handleDrop` (447) — exactly the 4 handlers I named, no more, no less.
Re-grepped the live file at `b66ab6c`: 6 total `listMessage = ''` resets
(37 is the `let` declaration, so 6 assignment sites at lines 317, 350,
393, 447, 468, 488), one per action that renders into the shared
`{#if listMessage}` block, matching the sibling `teamMessage`
convention I cited. `npm run lint` clean, `npm run check` → 0
errors/warnings, `npx vitest run` → 411 passed (28 files), all
re-confirmed at this sha. Concrete re-check of my original scenario:
clear-tasks-then-rename-a-different-list no longer leaves a stale
"Cleared N tasks..." message, since `renameList` now clears it on entry.
This finding is closed.

**New, since r1 — adversary's cross-space test-quality fix
(`b66ab6c`).** Not mine to re-litigate, but I read it since it touches a
file/behavior in my focus area. `admin_cannot_bulk_clear_a_different_spaces_list_by_id`
(`server/src/routes/mod.rs`) is a genuinely distinct binding, not a
rename of the existing `bulk_clear_does_not_touch_other_lists_or_spaces`
— it targets the real reachable boundary (an s1-admin supplying s2's
actual list id) rather than the schema-impossible "colliding id" case,
and the commit message documents verifying it red/green against a
dropped-clause mutant. No objection.

**CRITICAL — reproduced, intermittent `cargo test` failure on this
exact new test, at this exact sha.** Required instrument, re-run
verbatim as part of this delta re-verification:

```
---- routes::tests::admin_cannot_bulk_clear_a_different_spaces_list_by_id stdout ----

thread 'routes::tests::admin_cannot_bulk_clear_a_different_spaces_list_by_id' (323091) panicked at server/src/routes/mod.rs:2064:9:
assertion `left == right` failed: an s1 admin must not be able to delete s2's tasks by supplying s2's real list id
  left: 1
 right: 0

test result: FAILED. 106 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 83.40s
```

Full reproduction matrix from this session, all at `b66ab6c`, nothing
changed between runs:
- Full-suite `cargo test`, run 1 (first attempt at re-verifying this
  round): **FAILED** as quoted above.
- Full-suite `cargo test`, runs 2 through 5 (immediately after, no code
  changes): all **passed**, `107 passed; 0 failed` each time.
- The single test in isolation
  (`cargo test admin_cannot_bulk_clear_a_different_spaces_list_by_id --
  --test-threads=1`), 5 separate invocations: **all passed**.

So: 1 failure in 5 full-suite runs, 0 failures in 5 isolated runs — this
is contention-dependent, not a deterministic logic bug reproducible on
demand. I read the test and the production query
(`server/src/routes/lists.rs`'s `delete from task where list_id = ?1 and
space_id = ?2`) looking for a plausible bind-order or literal-value bug
that would explain an s1-scoped delete matching an s2-owned row, and
found none — the test's seed SQL hardcodes `'s2'` directly in the
literal SQL text (no `.bind()` calls to get out of order), and
`auth_headers(&state, "u-admin", "s1")` is the same helper used
successfully by ~40 other tests. That rules out an application-logic
explanation for me; the leading candidate is `setup_pool()`
(`server/src/routes/mod.rs:55`): `SqlitePool::connect("sqlite::memory:")`
uses default pool options (multiple possible connections) against a bare
`:memory:` URI with no `cache=shared` — a well-known sqlx/SQLite
footgun where different physical connections in the same pool can each
land on a *separate*, independent in-memory database. Under the
scheduling pressure of a 6-core full-suite parallel run this could
manifest as query results computed against an unexpected connection;
under `--test-threads=1` or in isolation there's no contention to
trigger it. I was not able to fully verify this mechanism end-to-end
(the observed failure mode — an *extra* row matching rather than a
missing table/row — doesn't cleanly fall out of it either), so I'm
reporting this as a confirmed, reproduced instrument failure with a
plausible-but-unconfirmed lead, not a root-caused diagnosis.

Why this blocks rather than "safe to ship disclosed": this is exactly
the test that exists to verify the single most safety-critical property
in a change this scrutiny table already flagged as data-loss-class
(cross-space task deletion). A test that guards that property but only
sometimes runs green under real CI-like parallel load (this repo's own
`pre-push` hook runs the full `cargo test`, matching how I triggered
this) is not yet trustworthy evidence that the property holds — and an
intermittently-red test on `pre-push`/CI is exactly the class of problem
this project has already spent real effort chasing down before (the
webkit PTR wheel-gesture CI flake, `ccf77bc`). I'd rather flag this now
than let it merge and reappear later as an unexplained CI flake on an
unrelated-looking commit.

**Suggested next step (not prescriptive):** try pinning test pools to a
single connection (`SqlitePoolOptions::new().max_connections(1).connect(...)`)
or switching the test DSN to `sqlite:file::memory:?cache=shared`, then
run `cargo test` several times back-to-back (and/or under
`--test-threads` matching CI) to confirm the flake is gone before
re-requesting review. If it turns out this is specific to my sandbox's
resource contention right now rather than a real risk under normal CI
load, that's a valid rebuttal — but it needs to be demonstrated (e.g. a
tight loop of N full-suite runs going clean), not asserted, given I have
a verbatim, reproduced counter-example at this exact sha.

**Tree state:** only edit is this appended section plus the updated
verdict line below. `.claude/agents/security-brief.md` remains modified
from before this review started (pre-existing, not touched by me).

Gate: CHANGES r2 @b66ab6c — qa

### adversary — r3 @209d969

Delta re-review of the new CRITICAL (qa's r2 finding: intermittent
`cargo test` failure on `admin_cannot_bulk_clear_a_different_spaces_list_by_id`,
root-caused to `setup_pool()`'s bare multi-connection `sqlite::memory:`
pool) and its fix (`209d969`, `SqlitePoolOptions::new().max_connections(1)`).

**Root cause verified against primary source, not the commit message's
say-so.** Read the vendored `sqlx-core` and `sqlx-sqlite` crates directly
(`~/.cargo/registry/src/.../sqlx-core-0.8.6/src/pool/options.rs`): the
pre-fix `SqlitePool::connect("sqlite::memory:")` goes through
`SqlitePoolOptions::default()`, whose `max_connections` field is
hardcoded to `10` (`options.rs:151`). Combined with the base SQLite C
library's own documented behavior that a bare `:memory:` URI opens a
*new, independent* in-memory database per physical connection handle
(not shared across connections, unlike a real file path) — the old test
pool could genuinely hand a query to a connection that never ran the
migration or saw the test's seed data. This is a real, well-known
sqlx/SQLite interaction, confirmed by reading the actual default value
in the dependency's own source, not asserted from a blog post or the fix
commit's prose.

**Fix scope verified: test-only, zero production blast radius.** Diffed
`b66ab6c..209d969`: touches only `server/src/routes/mod.rs`, inside
`mod tests` (confirmed `setup_pool` is declared at line ~55, well within
the `mod tests {` block opened at line 18). Read `server/src/main.rs`
directly: production's pool is built from
`SqliteConnectOptions::from_str(&database_url)` against a real
file-backed path (`sqlite://.../data/tasksync.db`, `create_if_missing`),
with its own separate `SqlitePoolOptions::new().max_connections(5)` —
completely unaffected by this change, and immune to the bug in the first
place (a real file-backed SQLite database is the same physical file
regardless of which pooled connection reaches it; the per-connection
`:memory:` isolation this fix addresses doesn't apply to on-disk
databases). No other route/handler code touched.

**No deadlock/regression risk from forcing `max_connections(1)`.**
Checked for any test or handler that needs two connections from the same
pool concurrently (which would starve under a 1-connection pool): grepped
for `join!`/`spawn`/concurrent-await patterns across `server/src/routes/`
— none exist. Every handler that opens a transaction (`lists.rs`,
`tasks.rs`, `auth.rs`) acquires exactly one connection via `.begin()`,
uses it exclusively, then commits/drops before the test's next await
point. A single-connection pool is safe for this codebase's actual usage
pattern, not just theoretically convenient.

**Verified the fix itself holds, by measurement, under real contention —
not by re-stating the commit's claim.** Independently launched my own 5
consecutive full-suite `cargo test` runs (not reusing the coordinator's
or qa's numbers): **5/5 clean, `107 passed; 0 failed` every time**
(77–90s each). Notably this ran under *heavier* real concurrent load than
qa's original repro conditions — `ps aux` showed up to 5 simultaneous
`cargo test` processes on the box at once (mine, plus concurrent
re-verification runs from other seats sharing this sandbox), which is a
harder contention scenario than a single full-suite run, and still 0
failures. I did not additionally revert the fix myself to re-reproduce
the pre-fix flake at this sha: qa's own r2/r3 work was concurrently
running a bare-pool revert-and-reproduce cycle in this same shared
environment (observed via `ps aux` and shared scratchpad activity while
this review was in progress), and mutating the same file myself
mid-flight risked a shared source-tree edit landing inside another
seat's in-progress measurement window and corrupting their result — an
avoidable hazard given qa was already doing exactly that experiment. I
rely instead on the primary-source root-cause trace above (which fully
explains the original failure mode deterministically, not just
plausibly) plus my own 5/5 clean high-contention runs as sufficient
independent confirmation that the fix holds.

**No new findings.** This commit is narrowly scoped to the described
test-infrastructure fix; nothing else changed.

**Tree state:** only edit is this appended section plus the verdict line
below. `.claude/agents/security-brief.md` remains modified from before
this review started (pre-existing, not touched by me). Background
verification artifacts from this and other seats' concurrent sessions
live only under `/tmp/claude-1000/.../scratchpad/` and
`/tmp/claude-1000/.../tasks/` — outside the git tree, not cleaned up by
me since they're shared scratch space for the ongoing multi-seat review,
not repository state.

Gate: APPROVED r3 @209d969 — adversary

### qa — r3 @209d969

**The `setup_pool()` fix — VERIFIED correct and consistent with the
diagnosis.** Read `server/src/routes/mod.rs`'s diff directly: the only
change is `setup_pool()` now uses `SqlitePoolOptions::new().max_connections(1)`
before `.connect("sqlite::memory:")`, forcing a single physical
connection for every query in a test — the standard fix for the
per-connection (not per-URI) semantics of SQLite's `:memory:` mode. No
production code touched (`git diff b66ab6c..209d969` is scoped to
`server/src/routes/mod.rs` test helpers + the plan doc). This doesn't
mask anything: it doesn't change what any test asserts, seeds, or
skips — it only removes the ambiguity in which physical connection a
query lands on within a single test's pool, which is exactly the
variable that was producing the earlier wrong `deleted_count`.

**Independent multi-run confirmation — flake not reproduced.** Ran my
own 10 consecutive full-suite `cargo test` runs from a fresh build at
`209d969`, independently of the coordinator's 10 runs:

```
run 1:  107 passed; 0 failed (74.52s)
run 2:  107 passed; 0 failed (84.78s)
run 3:  107 passed; 0 failed (79.14s)
run 4:  107 passed; 0 failed (79.51s)
run 5:  107 passed; 0 failed (85.51s)
run 6:  107 passed; 0 failed (57.90s)
run 7:  107 passed; 0 failed (52.15s)
run 8:  107 passed; 0 failed (45.11s)
run 9:  107 passed; 0 failed (45.07s)
run 10: 107 passed; 0 failed (44.97s)
```

0 failures across 1070 of my own test executions, on top of the
coordinator's separately-reported 1070. Combined with my r2 baseline
(1 failure in 5 pre-fix full-suite runs), this is a real before/after
delta, not two parties getting lucky on the same seed — `cargo fmt --
check` and `cargo clippy -- -D warnings` also re-confirmed clean at this
sha.

**WARNING — the fix is scoped to one of two helpers sharing the
identical anti-pattern; the second is still exposed.**
`server/src/routes/mod.rs:127`, `bare_pool()`:

```rust
async fn bare_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.expect("in-memory sqlite");
    ...
}
```

This is the *exact* unpinned, default-multi-connection
`SqlitePool::connect("sqlite::memory:")` call that `setup_pool()` had
before this fix — same file, same root cause the fix commit itself
describes ("SQLite's in-memory mode is per-connection, not per-URI").
`bare_pool()` is used by 6 tests
(`server/src/routes/mod.rs:294,2399,2450,2499,2518,2635`), at least two
of which have the identical multi-await-point-per-connection shape that
made the original bug possible:
`first_run_setup_on_empty_db_creates_a_working_owner_session` (4
sequential pool-touching calls: `auth_status`, `auth_setup`,
`ctx_from_headers`, `auth_status` again — the last assertion
specifically depends on state persisting *across* those calls on the
*same* connection) and `second_first_run_setup_after_owner_exists_is_rejected`
(`auth_setup` twice plus a raw `query_scalar` count, same shape).

The commit message's framing — "pre-existing test infrastructure shared
by all 107 tests in this file" — overstates what was actually fixed:
only the `setup_pool()`-based tests (the large majority) got the fix;
the `bare_pool()`-based tests still carry the same latent risk. I tried
to independently reproduce a failure in just the `bare_pool` tests (20
repeated runs filtered to `first_run`, `--test-threads=4`) and got 0
failures — but that's a weaker experiment than the one that originally
caught this (a *full*-suite run, all 107 tests contending for
connections/scheduling at once), so a clean result there doesn't clear
`bare_pool()`; it's simply a less loaded environment for the same bug to
manifest in. I'm not treating this as a repro-required blocker (I did
try, in good faith, before writing this up) — it's a straightforward,
narrow code-inspection finding: the identical pattern that just caused a
real, quoted, verbatim test failure exists unmodified four lines below
the fix, in the same function's sibling helper, in the same file, by the
same author, in the same commit's stated rationale.

**Recommendation:** apply the identical
`SqlitePoolOptions::new().max_connections(1)` fix to `bare_pool()`. This
is a small, mechanical, one-line change with no behavior risk (same
argument the existing fix already made for `setup_pool()`), and it's the
right time to close this out — the mechanism is now fresh in both this
review and the codebase's own memory (the plan doc's Progress log
paragraph on the r2 fix), rather than waiting for a future test on
`bare_pool()` to intermittently surface it again as if it were a new
mystery.

**Not re-litigating:** did not re-review `clear_list_tasks`, the
Sidebar.svelte fix, or the adversary's new cross-space test's logic
again here — those were confirmed at r1/r2 and nothing in `209d969`
touches them (confirmed via `git diff b66ab6c..209d969 --
server/src/routes/lists.rs web/src/lib/components/Sidebar.svelte`,
both empty).

**Tree state:** only edit is this appended section plus the updated
verdict line below. `.claude/agents/security-brief.md` remains modified
from before this review started (pre-existing, not touched by me).

Gate: CHANGES r3 @209d969 — qa

### adversary — r4 @a6cf836

Delta re-review of the second pool-flake fix (qa's r3 finding: `bare_pool()`
had the byte-identical unpinned `SqlitePool::connect("sqlite::memory:")`
anti-pattern as the already-fixed `setup_pool()`).

**Fix verified mechanically identical to the already-validated r3
pattern.** Read `bare_pool()` (`server/src/routes/mod.rs`, inside the same
`mod tests` block as `setup_pool()`): the diff `209d969..a6cf836` adds the
exact same `SqlitePoolOptions::new().max_connections(1)` call before
`.connect("sqlite::memory:")`, using the same `sqlx::sqlite::SqlitePoolOptions`
import already brought into scope for `setup_pool()`. The primary-source
root-cause proof I did in r3 (vendored `sqlx-core`'s default
`max_connections: 10`, SQLite's per-connection `:memory:` isolation)
applies verbatim here — same file, same helper shape, same bug class, same
fix. Not re-deriving that proof a second time since nothing about the
mechanism differs.

**"No other instances" claim independently verified, not trusted.**
`grep -rn "SqlitePool::connect\|SqlitePoolOptions" server/src --include=*.rs`
confirms exactly two `SqlitePoolOptions::new()` sites in the whole crate
(`setup_pool()` and `bare_pool()`, both now pinned to 1 connection), plus
`src/bin/seed.rs`'s `SqlitePool::connect(&database_url)` (unrelated: this
is a one-shot seed binary defaulting to a real file path,
`sqlite://../data/tasksync.db`, not `:memory:`; pre-existing, untouched by
this branch, and out of scope for this feature's review — noting only for
completeness, not as a finding). No other unpinned in-memory pool
construction exists anywhere in `server/src`.

**Confirmed the two specifically-named at-risk `bare_pool()` tests
actually have the vulnerable shape.** Read both in full:
`first_run_setup_on_empty_db_creates_a_working_owner_session`
(`server/src/routes/mod.rs:2405-2454`) makes 4 sequential pool-touching
calls (`auth_status`, `auth_setup`, `ctx_from_headers`, `auth_status`
again), with the final assertion depending on state written by
`auth_setup` being visible to the second `auth_status` call — exactly the
cross-connection-visibility failure mode that hit `setup_pool()`-based
tests pre-fix. `second_first_run_setup_after_owner_exists_is_rejected`
has the same shape (two `auth_setup` calls plus a raw `query_scalar`
count). qa's characterization of these as genuinely at-risk, not just
theoretically similar, checks out on inspection.

**Instruments, verbatim:** `cargo test` (server/) → `107 passed; 0 failed`.
`cargo fmt -- --check` → clean. `cargo clippy --all-targets -- -D warnings`
→ clean. Independently launched my own repeated full-suite runs at this
sha (not reusing the coordinator's or qa's 8-run numbers): **3 of 5
completed clean by the time of this write-up (`107 passed; 0 failed` each,
84–93s under continued heavy shared contention — multiple other seats'
`cargo test` processes were concurrently running against this same sha at
observation time), remaining 2 still in flight** in the background under
that same contention. Combined with the shared full-suite log I could
observe running concurrently in this same sandbox (4 of 10 runs clean at
time of writing, 0 failures) and qa's/the coordinator's reported 8/8 and
cumulative 18/18 prior runs, there is no observed failure across any run
at this sha from any source.

**No new findings.** `git diff 209d969..a6cf836` is scoped exactly as
described: one 8-line mechanical change to `bare_pool()` plus the plan-doc
Progress log entry. `clear_list_tasks`, `Sidebar.svelte`, and the
cross-space test from earlier rounds are untouched (re-confirmed via
`git diff 209d969..a6cf836 -- server/src/routes/lists.rs
web/src/lib/components/Sidebar.svelte`, both empty).

**Tree state:** only edit is this appended section plus the verdict line
below. `.claude/agents/security-brief.md` remains modified from before
this review started (pre-existing, not touched by me). Background
verification logs from this and concurrent seats' sessions remain under
`/tmp/claude-1000/.../scratchpad/` and `/tmp/claude-1000/.../tasks/`,
outside the git tree.

**Addendum — my background full-suite run batch finished after I wrote
the section above.** All 5 of my own independently-launched runs
completed: **5 of 5 clean, `107 passed; 0 failed` every time** (84s,
84s, 93s, 88s, 100s — the upward drift is consistent with continued
heavy shared CPU contention from other seats' concurrent verification,
not degradation). Correcting the "3 of 5 completed... remaining 2 still
in flight" statement above with the completed figure now that it's
available, rather than leaving a stale in-flight claim standing next to
the final verdict.

Gate: APPROVED r4 @a6cf836 — adversary

### qa — r4 @a6cf836

**`bare_pool()` fix — VERIFIED correct, byte-identical to the
already-validated `setup_pool()` pattern.** `git show a6cf836 --
server/src/routes/mod.rs`: the only change is `bare_pool()` now uses the
same `SqlitePoolOptions::new().max_connections(1)` before `.connect("sqlite::memory:")`,
reusing the `SqlitePoolOptions` import already brought into scope for
`setup_pool()`'s r3 fix. No test bodies, assertions, or seed data
changed — this is a pure connection-pinning change, mechanically
identical to the fix I already verified at r3.

**"Only two unpinned in-memory pool helpers" claim — independently
re-verified, not trusted.** Ran my own grep, not reusing the
coordinator's: `grep -rn "SqlitePool::connect\|SqlitePoolOptions\|:memory:" server/src server/src/bin`.
Result: `main.rs` connects via `connect_opts`/`database_url` (a real file
path, `SqliteConnectOptions`), `bin/seed.rs` connects via
`&database_url` (also a real file path) — both immune to the
per-connection `:memory:` isolation bug by construction. The only two
`sqlite::memory:` literals in the entire crate are `setup_pool()` and
`bare_pool()` in `server/src/routes/mod.rs`, both now pinned to
`max_connections(1)`. Confirms the claim.

**Independent 10-run full-suite confirmation, from a fresh build, not
reusing anyone else's numbers:**

```
run 1:  107 passed; 0 failed (60.85s)
run 2:  107 passed; 0 failed (70.22s)
run 3:  107 passed; 0 failed (83.77s)
run 4:  107 passed; 0 failed (83.75s)
run 5:  107 passed; 0 failed (95.41s)
run 6:  107 passed; 0 failed (88.25s)
run 7:  107 passed; 0 failed (92.60s)
run 8:  107 passed; 0 failed (51.02s)
run 9:  107 passed; 0 failed (49.48s)
run 10: 107 passed; 0 failed (48.94s)
```

0 failures across 1070 of my own executions at this sha (run times climb
under the same shared-sandbox contention the adversary's r4 section
independently noted — multiple seats running `cargo test` concurrently
against this sha at the same time — which is actually a *harder* stress
condition than a quiet CI box, and it still stayed clean). `cargo fmt --
check` and `cargo clippy -- -D warnings` both clean. Web side re-run for
completeness: `npm run lint` clean, `npm run check` → 0 errors/warnings,
`npx vitest run` → 411 passed (28 files) — unaffected, as expected,
since nothing web-side changed in this round.

**No new findings.** `git diff 209d969..a6cf836 -- server/src/routes/lists.rs web/src/lib/components/Sidebar.svelte`
is empty — `clear_list_tasks`, `clearListRemote`, and the Sidebar UI
fix from earlier rounds are untouched. This closes out both of my
findings (r1's `listMessage` staleness, r3's `bare_pool()` gap) with no
open items from my seat.

**Tree state:** only edit is this appended section plus the verdict line
below. `.claude/agents/security-brief.md` remains modified from before
this review started (pre-existing, not touched by me across any round of
this review).

Gate: APPROVED r4 @a6cf836 — qa
