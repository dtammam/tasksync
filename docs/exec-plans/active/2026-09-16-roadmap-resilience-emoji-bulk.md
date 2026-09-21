---
plan: roadmap-resilience-emoji-bulk
harness: v2 · lean
anchor: outcome
status: Draft
gate: pending
---

# Roadmap — add-task resilience, task emoji, bulk task ops

**Kind:** roadmap / umbrella. This doc sequences three pieces of work; each piece
ships as its **own branch + own plan doc** (slug = branch name) under the v2
flow. This doc's own status tracks the roadmap, not any single piece. It moves
to `completed/` when all three child plans are `Shipped`.

Authored 2026-09-16 by the Architect session on the closing budget of a
higher-cost model; execution of pieces 2–4 is intended for Opus sessions.

## Status of the four pieces

| # | Piece | Branch / plan slug | State |
|---|-------|--------------------|-------|
| 1 | Install handoff-harness v2 (`--migrate`, lean) | `chore/harness-v2-migration` | **Shipped** — PR #138 (+ #139 cleanup), merged 2026-09-17 |
| 2 | Add-task resilience (no reload on details open) | `fix/add-task-details-reload` | **Shipped** — PR #156, merged 2026-09-20 (bare-UUID task id keeps the drawer mounted across the create-sync ack; gate APPROVED, CI green all browsers) |
| 3 | Optional per-task emoji, sort/group, in exports | `feat/task-emoji` | **Shipped** — PR #141, merged 2026-09-18; validated by owner in beta on a real device |
| 4 | Bulk task ops: delete, select, bulk delete, clone, bulk move | (sliced) | **In progress — sliced.** Slice 1 (quick single-task delete + undo) **Shipped** — PR #158, merged 2026-09-20 (`feat/quick-task-delete-undo`; see completed/2026-09-20-feat-quick-task-delete-undo). Slice 3 (multi-select + bulk delete + bulk **tag** + tap-to-select, list view + My Day) **Shipped** — PR #162, merged 2026-09-20, owner-validated in beta (`feat/multi-select-bulk-delete`; see completed/2026-09-20-feat-multi-select-bulk-delete). **Slice — bulk move (reattribute): Shipped** — PR #165, merged 2026-09-21, owner-validated in beta on a real device (`feat/bulk-move-tasks`; see completed/2026-09-21-feat-bulk-move-tasks). gate approved at r3 by adversary + qa (bound markers in the completed plan doc); a bulk wrapper over the existing `tasks.moveToList` + server-authoritative `update_task_meta` target-list grant-check — no new route/wire verb; 403 degrades gracefully via existing sync. Shipped with two owner-requested toolbar tweaks (drop the Clear pill, sticky toolbar). Remaining Piece 4 slice: **clone** (single + bulk) — its own branch/plan. (List-level bulk-clear already shipped out of band, PR #148; list-level Check all shipped PR #160.) |

Order: **3 → 2 → 4**, reprioritized by the owner 2026-09-17 (originally
2 → 4 → 3, confirmed 2026-09-16). Piece 2's intake is complete and parked,
not abandoned — cheap to resume later. Rationale for the original order (2
smallest/highest-friction, 4 unchanged data model, 3 highest blast radius)
still holds as *relative* difficulty; the owner chose to take the highest-value
piece first regardless of blast radius.

**Piece 3 follow-up, inserted 2026-09-18** (owner direction, after validating
Piece 3 in beta): an in-app Settings UI to manage the tag palette itself
(add/edit/remove/reorder entries) — see
`docs/exec-plans/completed/2026-09-18-feat-task-emoji.md`'s closing note.
**Shipped** — PR #143, merged 2026-09-19; see
`docs/exec-plans/completed/2026-09-18-feat-tag-palette-settings.md`.

**After the palette-settings piece shipped, the owner-directed CI-flakiness
pairing session ran** (tech-debt #050 — chromium/`offline.spec.ts` and
webkit/`pull-to-refresh.spec.ts`, both marginal-timeout-under-CI-load, not
logic bugs). **Shipped** — PR #146 (CI trace-upload capability + a genuine
root-caused PTR wheel-gesture race fix found live during the session), merged
2026-09-19; see
`docs/exec-plans/completed/2026-09-19-chore-ci-trace-uploads-and-ptr-race-fix.md`
and the sharpened tech-debt-tracker entries (PR #147). Roadmap work below
(Piece 2 / Piece 4) resumes from here.

**Piece 4 overlap, noted 2026-09-19:** the owner separately asked, out of
band, for a way to bulk-clear a list's tasks before deleting the list itself
(manually deleting hundreds of items first was tedious and error-prone).
Shipped as
`feat/bulk-clear-list-tasks`, PR #148, merged 2026-09-19 — see
`docs/exec-plans/completed/2026-09-19-feat-bulk-clear-list-tasks.md`. This is
list-scoped ("clear every task in list X"), not the per-task multi-select
described in Piece 4 below, so Piece 4's remaining scope is unchanged: quick
single-task delete/undo, multi-select, bulk **move**, and **clone** still need
their own intake.

**Check all — Shipped 2026-09-20** (PR #160, `feat/bulk-check-uncheck-tasks`): a
list-level "Check all" complementing the existing "Uncheck all" list-header
action (list-level only; a pending recurring task advances one occurrence; side
effects batched). See `docs/exec-plans/completed/2026-09-19-feat-bulk-check-uncheck-tasks/`.
**Deferred to a follow-up slice:** per-tag-section check/uncheck.

## Anchor recommendations (project default: `outcome`)

Per `.harness/flow.md` Phase 1, state the default next to the recommendation
and argue any difference:

- **Piece 2 → `outcome`.** Matches default. Bug fix with a crisp observable.
- **Piece 4 → `outcome`.** Matches default. UI/store work; bulk *delete* is a
  destructive change, so `scrutiny.toml` will force the **full gate**
  (`deletes-data`) regardless of anchor — expect adversary + qa + security-brief.
- **Piece 3 → `spec` (differs from default).** It adds a field to the task
  model, which touches client store, IDB schema, sync wire format, server
  schema/migration, and export formats at once. The project attack-surface note
  in `AGENTS.md` says a partial change corrupts sync. That is exactly the case
  where "correct" must be a written contract before code exists: a decision
  register (field name, nullability, wire encoding, sort semantics, export
  column) approved at a sha. `scrutiny.toml` will also force full gate via
  `alters-schema` / migration paths.

---

## Piece 2 — Add-task resilience

**Problem (owner's words):** after adding a task, opening its details sometimes
triggers a reload/remount. Cause as understood: the task exists client-side in
a temp/optimistic state until the server save round-trips; the swap from
temp → persisted identity re-keys the view and the details panel is torn down.
Correct behavior, disruptive result.

**Inferred acceptance (outcome anchor — confirm at intake):**
- Opening details on a just-added task, before the server ack arrives, never
  unmounts or resets the details view; the panel stays open and editable and
  simply becomes "saved" in place.
- Works fully offline: with the server unreachable the same task can be added,
  opened, and edited with no visible state jump; the eventual sync is
  idempotent (no duplicate task after reconnect).
- A regression test binds it: a unit test on the store path that swaps a temp
  task for its persisted form without changing the identity the UI keys on,
  plus an E2E `@smoke` that adds a task, opens details immediately, and asserts
  the panel survives the save.

**Blind-spot pass to run at intake (cheap now, expensive later):**
- Where is the temp identity minted — client UUID reused by the server, or a
  server-assigned id that replaces a client placeholder? If the latter, the fix
  is "stable client id, server accepts it"; if the former, the remount is
  coming from somewhere else (e.g. list re-sort, `{#key}` block, store replace
  vs. patch). Find the actual remount trigger before designing.
- Does the same remount hit *recurring* tasks or tasks created via
  `POST /api/tasks` (the ingest route) when they arrive by pull?
- Performance budgets in `docs/RELIABILITY.md`: an in-place patch must not turn
  one save into a full-list re-render.

---

## Piece 3 — Optional task emoji (category dimension)

**Problem (owner's words):** on shared lists like groceries the owner manually
types an emoji at the front of each title to group items (🥦 produce, 🧀 dairy…).
It works but is manual and un-maintainable. Wanted: a first-class optional
emoji field per task, chosen from a dropdown, usable for sorting/grouping
within one list, and carried through exports.

**Open decisions for the register (spec anchor):**
1. **Field shape** — single emoji string, nullable/absent by default. Name
   (`emoji`? `tag`?), max length (grapheme cluster, not bytes), validation on
   the wire (reject non-emoji? or accept any short string?).
2. **Sort semantics** — **confirmed by the owner 2026-09-16: (a) group-by.**
   The list view clusters into emoji-headed sections (🥦 produce, 🧀 dairy…),
   matching the grocery use-case the owner described. Not a flat sort key.
3. **Picker** — a fixed curated set (fast, consistent, offline, no font
   dependency) vs. a free emoji picker (heavy, larger surface). Recommend a
   curated set with a small "recently used" strip, and per-list defaults
   later if wanted.
4. **Exports** — which export formats exist today, and where the emoji goes
   (own column vs. prefixed into the title to preserve today's visual). Read
   the export code before deciding.
5. **Migration & sync** — additive nullable column server-side; IDB schema
   version bump with an upgrade path; wire format tolerant of the field being
   absent (old clients) — sync must remain idempotent in both directions with
   a mixed client population.
6. **Existing data** — should tasks whose title already *starts* with an emoji
   be auto-migrated into the new field? Recommend **no** automatic rewrite
   (data-losing if wrong); optionally a one-shot, explicit, per-list "extract
   leading emoji" action later.

**Inferred acceptance (to be replaced by the approved register):**
- A task can be given, changed, or cleared an emoji from a dropdown in the task
  details; the field is absent by default and round-trips through IDB and sync
  unchanged; old clients ignore it without error.
- A list can be viewed grouped/sorted by emoji (per decision 2), offline, within
  the existing performance budgets for list render.
- Every export format carries the emoji (per decision 4), and tests cover the
  presence and the absence of the field.

---

## Piece 4 — Bulk task operations

**Problem (owner's words):** deleting a task is not easy enough; wanted: quick
delete, multi-select, bulk delete, clone a task, and bulk move ("reattribute")
tasks to a different list.

**Inferred acceptance (outcome anchor — confirm at intake):**
- Single-task delete is reachable in one gesture from the task row/shelf on
  mobile and desktop, with an undo affordance (toast) rather than a confirm
  dialog, so it stays fast but not fatal.
- A selection mode exists on list and My Day views: tap/click to multi-select,
  then bulk **delete**, bulk **move to list**, and (single or multi) **clone**.
  All work offline and sync as ordinary per-task mutations (idempotent; no new
  wire verbs unless unavoidable).
- Tests: store unit tests for each operation, including clone semantics
  (which fields copy — recurrence? completion state? emoji?) and E2E `@smoke`
  for select → bulk delete → undo.

**Blind-spot pass at intake:**
- Soft-delete vs. hard-delete today? If hard, "undo" needs a tombstone or a
  client-side grace window. Check the sync protocol's delete handling first.
- Does the server enforce role on delete/move? Contributors must not be able to
  bulk-move into lists they can't write to — server-authoritative check.
- Clone of a *recurring* task: clone the rule or a one-off instance? Decide
  and test explicitly.
- Bulk move across lists with different sort orders — where does the task land?

---

## Piece 1 — Harness v2 migration (record)

**Acceptance (outcome anchor — this is the gate's contract for this diff):**
- No v1 pipeline artifact remains: the six retired agents, sixteen
  `kickoff/prep-*/run-*/show-me` commands, five `scripts/run-*.sh`,
  `.state/feature-state.json`, `.state/inbox/` are gone from the tracked tree
  (history preserved via `.state/plans/legacy/20260916-232013/` + git log).
- No dangling reference to a removed file survives in tracked docs/config
  (e.g. `docs/index.md` must not link deleted `AI-REPO-MAINTENANCE.md` /
  `CLAUDE.BLUEPRINT.md`; `.claude/settings.json` must not name a removed hook
  or command).
- `AGENTS.md` is the accurate entry point for v2: operating model, the five
  non-negotiables, and the project `keep` region are present and match
  `.harness/flow.md` / `scrutiny.toml` semantics (anchor dial, gate seats).
- `.claude/hooks/session-start.sh` still runs cleanly (`bash -n` at minimum)
  and no longer depends on `.state/feature-state.json` or the inbox dir it
  just lost.
- The unrelated `spinnerVerbs` tweak in `.claude/settings.json` survives
  untouched (owner asked to leave it alone).

Done 2026-09-16 on this machine, not yet committed:
- Installer ran via the inner `harnesses/install.sh` (`--migrate --preset=lean`)
  because the public bootstrap passes `--source <path>` while the installer
  parses only `--source=<path>` → `unknown flag: --source`. **Upstream bug in
  `dtammam/handoff-harness` `install.sh` lines 22–25** — fix there.
- v1 files archived to `.state/plans/legacy/20260916-232013/`.
- `AGENTS.md` project region re-grafted from the old `CLAUDE.md` (rules,
  attack surfaces, commands, lessons).
- Still to do before commit: remove the v1 pipeline leftovers (six agents,
  sixteen `kickoff/prep-*/run-*/show-me` commands, five `scripts/run-*.sh`,
  `.state/feature-state.json`, `.state/inbox/`). `docs/AI-REPO-MAINTENANCE.md`
  and `docs/CLAUDE.BLUEPRINT.md` still describe v1 — retire or rewrite.
- This change touches `.claude/**` and `.harness/**` → `harness-and-config`
  row → slim gate (adversary). Run `/gate` before merging.

**This umbrella doc's own edit-history gate rounds** (Piece 1's two rounds,
post-migration-cleanup, park-add-task-resilience-intake, and the Piece 3
close-out's two rounds — six `Gate:` verdicts in all) have moved to
`docs/exec-plans/completed/2026-09-19-roadmap-doc-gate-history.md`, verbatim
and unedited. This doc is an umbrella that tracks the roadmap, not a single
shippable piece, and per `harness-markers.md`'s own convention it should
hold status pointers, never its own bound `Gate:`/`Approved` markers — that
history sat here for a while regardless, which meant `check-markers.sh`'s
"merged but not released" check (added in handoff-harness v2.1.1) correctly
found the last of those bound markers already merged into `main` and flagged
this whole doc as an un-released plan, even though Piece 2 and Piece 4 below
are genuinely still open. Moving the history out is the fix.

## Progress log
- 2026-09-16 — roadmap drafted; piece 1 installed locally; pieces 2–4 scoped
  with inferred acceptance and blind-spot lists. Order and emoji sort semantics
  still need owner confirmation.
- 2026-09-21 — status re-review: Pieces 1–3 all confirmed **Shipped** and
  owner-validated in beta (emoji live on a real device). Piece 4 is the only
  open piece. Owner chose **bulk move (reattribute)** as the next slice; intake
  opened on `feat/bulk-move-tasks` (`outcome` anchor). Blind-spot pass found the
  move primitive already exists server- and client-side, so the slice is a bulk
  wrapper. **Clone** remains the last Piece-4 slice after this; once both land,
  Piece 4 (and this umbrella) can move to `completed/`.
- 2026-09-21 — bulk move **Shipped**: PR #165 squash-merged to `main` (@8b322e2),
  gate approved at r3 (adversary + qa), CI green across all three e2e
  browsers, owner-validated in beta. Shipped with two owner-requested toolbar
  tweaks (drop Clear, sticky toolbar). **Clone** is now the sole remaining Piece 4
  slice; when it lands, Piece 4 and this umbrella move to `completed/`.

