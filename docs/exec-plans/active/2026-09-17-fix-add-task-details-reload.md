---
plan: fix-add-task-details-reload
harness: v2 · lean
anchor: outcome
status: Building (resumed 2026-09-20 on fix/add-task-details-reload, off main @3d94dfd)
gate: pending
---

# Fix — add-task details resilience

Roadmap: `docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md`
("Piece 2"). This doc is that piece's own plan, per the v2 flow (each piece
gets its own branch + plan doc).

## Request (restated)

Opening the details panel on a task immediately after adding it can cause the
panel to unmount/close on its own, mid-edit, while the task is still in its
optimistic (not-yet-server-acked) state. Fix it so the panel survives the
temp→saved transition, online or offline.

## Blind-spot pass — root cause (confirmed by code, not inferred)

Investigated the actual mechanism rather than assuming; findings below are
cited to source.

1. **Where the temp identity is minted.** A locally-created task gets id
   `` `local-${crypto.randomUUID()}` `` (`web/src/lib/stores/tasks.ts:49`,
   `makeLocalTask`), called from `createLocalWithOptions` — both the single
   add-task input (`tasks.ts:194`) and markdown bulk import (`tasks.ts:246`).

2. **The id is NOT stable through the lifecycle** — the string changes, even
   though the underlying UUID is preserved:
   - Push: `web/src/lib/sync/sync.ts:14-22` strips the `local-` prefix before
     sending the bare UUID as `create_task`'s `id` (`sync.ts:95`).
   - Server accepts the client-supplied id verbatim (idempotent — see
     `server/src/routes/mod.rs:1072` test) and stores the bare UUID
     (`server/src/routes/tasks.rs:165-171`).
   - Ack response is mapped back with `id: t.id` — the bare UUID
     (`sync.ts:48-72`).
   - `replaceWithRemote` (`tasks.ts:664-679`) overwrites the task's `id`
     field in place with the bare UUID, in both the "no local edits since
     create" and "edited since create" branches.

3. **Why this unmounts the drawer.** The details panel is opened by capturing
   the id string into local page state (`detailId`, e.g.
   `web/src/routes/+page.svelte:28`), and a reactive lookup re-derives the
   task from the store by that id (`+page.svelte:51`:
   `` $tasks.find((t) => t.id === detailId) ``). `detailId` is never updated
   when the store's task changes id. Once `replaceWithRemote` swaps
   `local-<uuid>` → `<uuid>`, the lookup fails, `detailTask` becomes `null`,
   `open={!!detailTask}` goes `false`, and `TaskDetailDrawer`'s top-level
   `{#if open && task}` (`TaskDetailDrawer.svelte:151`) unmounts the whole
   subtree — indistinguishable from the user closing it. Same pattern in
   `web/src/routes/list/[id]/+page.svelte`.
   - Secondary effect: the task-row list is keyed `{#each ... (task.id)}`
     (`+page.svelte:311,333`; `list/[id]/+page.svelte:203,219`), so the same
     id swap also destroys/recreates that row's `TaskRow` instance — not
     user-visible today the way the drawer unmount is, but the same root
     cause.
   - No `{#key}` block is involved anywhere in this path (confirmed by
     `grep -rn "{#key" web/src/` — the only hits are unrelated,
     `StreakDisplay.svelte`).

4. **Scope check — does this hit recurring or pull-ingested tasks?** No.
   `makeLocalTask` (and thus the `local-` → bare-UUID swap) is only reached
   from the add-task input and markdown import. Recurring-task advancement
   mutates an existing, already-server-confirmed task in place (stable id
   throughout) rather than minting a new local id, and tasks arriving via
   sync pull already carry their permanent server id from the moment the
   client learns about them. The bug is confined to tasks created locally by
   this client, between creation and their own create-ack.

5. **Assumption this plan rests on:** the `local-` prefix carries no other
   behavioral meaning anywhere else in the codebase — confirmed via
   `grep -rn "local-" web/src/lib/`: the only non-test reads are the two
   `sync.ts` sites that add/strip it. Nothing else branches on
   `id.startsWith('local-')`. This means the id does not have to encode
   "is this optimistic" — the existing `local: true` / `dirty: true` boolean
   fields on the task already carry that meaning independently.

## Anchor

Default (`.harness/harness.toml`): `outcome`. Recommended: `outcome` — same.
This is a targeted bug fix with a crisp, eyeballable observable (the panel
stays open); it does not change the task data model, wire format, or a public
interface. Matches the roadmap doc's own recommendation for this piece.

## Acceptance (outcome anchor)

- **Panel stability, online and offline.** Opening details on a just-created
  task, before its create-sync ack applies, never unmounts or resets the
  details view — the panel stays open, mounted, and editable through the
  temp→saved transition. Holds with the server reachable (ack applies during
  the open session) and fully offline (ack deferred until reconnect, or never
  sent). Bound by an E2E `@smoke` test: add a task, open its details
  immediately, wait through the sync round-trip (or simulate offline), assert
  the drawer is still visible and its fields are unchanged.
- **Sync stays idempotent.** No duplicate task exists after reconnect
  regardless of whether details were open during the ack, and regardless of
  whether the id-stability fix changes what gets sent on the wire. Bound by
  the existing `create_task_is_idempotent_when_client_retries_same_id`
  server test continuing to pass, plus a client-side assertion that exactly
  one task with the created title exists post-sync.
- **Regression bound at the store layer, no perf regression.** A unit test on
  the sync-ack apply path (`replaceWithRemote` / `pushPendingToServer`)
  asserts that whatever key the UI depends on to resolve "the same task"
  (id, or a separate stable key if the fix introduces one) does not change
  across the ack — and that applying one task's ack does not force a full
  task-list re-render (single-row update only), per the performance budgets
  in `docs/RELIABILITY.md`.

## Approach (outcome anchor — short note, per flow.md Phase 2)

Confirmed before locking this in: `sync.ts:88-89` gates create-vs-update on
the `task.local` boolean, not on id shape — `` const op_id = `${task.local ?
'create' : 'update'}-${index}` ``. `requestIdForLocalTask` (`sync.ts:12-22`)
already handles a bare UUID id correctly via its `isServerId(id)` branch
(returns it unchanged), independent of the `local-` prefix path. Nothing else
in `web/src/lib/` branches on `id.startsWith('local-')` (only `sync.ts` itself
and test fixtures). So:

- `makeLocalTask` (`tasks.ts:49`) stops prefixing the id — mint a bare
  `crypto.randomUUID()` directly. Optimistic/unsynced state stays exactly
  where it already lives: `local: true, dirty: true` on the task record.
  `order`'s own `local-` prefix (`tasks.ts:50`) is untouched — it's a sort
  key, not the Svelte keyed-block identity, and out of scope for this bug.
- `requestIdForLocalTask` needs no change — it already passes a bare UUID
  through as-is, and still correctly strips a `local-` prefix for the
  transitional case of a task created by a pre-fix client version that
  hasn't synced yet (self-healing on its first sync; not worth engineering
  further for).
- Net effect: the id the client mints, stores in IDB, keys Svelte's
  `{#each (task.id)}` and `detailId` lookup on, and sends to the server are
  now all the *same string* from creation onward — `replaceWithRemote`'s
  `id: remote.id` overwrite becomes a same-value no-op, so neither the row
  nor the drawer loses its key.

## Progress log

- 2026-09-17 — Intake complete: root cause identified and confirmed by
  reading the actual code path (not assumed). Anchor (`outcome`) and
  acceptance confirmed by the owner. Approach confirmed safe against the
  create/update sync decision and against other id-format dependencies.
- 2026-09-17 — **Parked** before Build: owner chose to reprioritize the
  roadmap, taking Piece 3 (task emoji) next instead. Nothing here is stale —
  the root cause, acceptance, and approach above are ready to resume as-is
  whenever this piece comes back up. No code has been written yet.
- 2026-09-20 — **Resumed and built** on `fix/add-task-details-reload` (off main
  @3d94dfd). Implemented exactly the approach above.

## Build (2026-09-20)

**Change (one line + comment):** `makeLocalTask` (`tasks.ts:51`) now mints a
bare `crypto.randomUUID()` instead of `local-${uuid}`; the non-crypto fallback
keeps its `local-` id (a degenerate path that never syncs). `requestIdForLocalTask`
unchanged — a bare UUID passes `isServerId` and is sent as-is; a legacy
`local-<uuid>` (pre-fix task) is still stripped (self-heals on first push).
Net: the id the client mints = stores in IDB = keys `{#each (task.id)}` and the
drawer `detailId` lookup = sends to the server = the server echoes back, so
`replaceWithRemote`'s `id: remote.id` is a same-value no-op and the drawer/rows
keep their identity across the create-ack.

## Verification (local, pre-gate)

- `npm run lint` / `npm run check`: clean. `npx vitest run`: **417 passed** (28
  files; +2 store tests for bare-UUID mint & id-stability-across-ack, +1 net
  sync test — updated the old "strips local- prefix" test to the new bare-UUID
  behavior and added a legacy-strip self-heal test).
- **New E2E `@smoke`** `tests/e2e/add-task-details-resilience.spec.ts`: add a
  task, open its details while still optimistic, then let the create push→ack
  land (mock echoes the client id, as the real server does) — the drawer stays
  mounted and editable. **Passes chromium+firefox+webkit.** Mutation-tested:
  reverting the fix (restore the `local-` prefix) makes it FAIL at
  `expect(drawer).toBeVisible()` ("element(s) not found" — the drawer unmounts),
  proving it guards the exact regression.
- **Full e2e suite on the preview build (chromium+firefox+webkit): 179 passed,
  16 skipped, 0 failed** — no regression from the id change.

Gate: pending.
