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
