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
| 1 | Install handoff-harness v2 (`--migrate`, lean) | `chore/harness-v2-migration` | gated (`APPROVED r2`), ready to commit + PR |
| 2 | Add-task resilience (no reload on details open) | `fix/add-task-details-reload` | not started |
| 3 | Optional per-task emoji, sort/group, in exports | `feat/task-emoji` | not started |
| 4 | Bulk task ops: delete, select, bulk delete, clone, bulk move | `feat/bulk-task-ops` | not started |

Order: **2 → 4 → 3**, confirmed by the owner 2026-09-16. 2 is the daily-friction
bug and is smallest. 4 is UI + store work on an unchanged data model. 3 changes
the data model, the wire format, IDB, SQLite, and exports — highest blast
radius, do it last with the most context.

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

### Gate — adversary (r1)

CHANGES — findings below; the migration is incomplete against its own acceptance
bullet 2 ("no dangling reference to a removed file survives").

- `.harness/manifest.json:5-193` (tracked, unmodified by this diff, installed
  2026-04-03 by the prior v1 harness install) — a full checksum manifest that
  still lists every one of the deleted v1 files as installed/present:
  `.claude/agents/{build-specialist,engineering-manager,principal-engineer,
  product-manager,quality-assurance,software-developer}.md`, all 16 retired
  commands, all 5 `scripts/run-*.sh`, and `.state/inbox/.gitkeep`. This is a
  direct, literal violation of acceptance bullet 2 (dangling reference to
  removed files in a tracked `.harness/**` file) and sits inches from the new,
  correct `.harness/manifest.lock` this diff adds — two competing manifests in
  the same directory, one stale and false. `git ls-files .harness/manifest.json`
  confirms it is tracked at HEAD (predates this diff, base sha already has it);
  this diff had to touch `.harness/**` anyway and did not remove or update it.
  CRITICAL — `git rm .harness/manifest.json` (or fold its residual value into
  `manifest.lock` and remove it) before commit.

- `CLAUDE.md.template:11,14-16,24-40,71-93` (tracked at repo root, orphaned —
  `git grep` confirms nothing references it, including the rewritten
  `.claude/commands/seed.md`) — a verbatim copy of the old v1 `CLAUDE.md`,
  fully describing the retired EM/PM/PE/SDE pipeline: "Invoke the
  engineering-manager agent", `.state/inbox/<agent-name>.md`, all 5
  `scripts/run-*.sh`, `.state/feature-state.json`. Matches the exact grep
  terms named in attack surface #6 and is a v1 leftover HANDOFF.md's removal
  list missed entirely (it only lists agents/commands/scripts/.state, not this
  file). CRITICAL — delete it, or if it is meant to seed *other* repos via
  some future harness feature, that intent is not documented anywhere and the
  file contradicts the current (v2) scaffolding shape; as-is it is dead,
  actively misleading v1 documentation.

- `docs/exec-plans/tech-debt-tracker.md:18-19` (Active section, items #045 and
  #046, both `unassigned`) — both describe bugs in "the five
  `scripts/run-*.sh` specialist launchers" and `.state/inbox/<name>.md`, all
  of which this diff deletes. These are now-moot open tickets pointing at
  files that no longer exist in the tree; a future session will waste time
  investigating them. WARNING — close both as moot (superseded by the v1
  removal) with a one-line note, or move to Closed; safe to ship disclosed
  since nothing breaks, but it is an enumeration gap in this migration.

- `.claude/hooks/session-start.sh:12-13` (new version) — glob
  `docs/exec-plans/active/*.md` no longer excludes `README.md` the way the old
  script's `find ... -not -name 'README.md'` did. Verified by executing the
  hook: it now prints `README.md: no status marker` as a fake "active plan"
  every session. Confirmed `docs/exec-plans/active/README.md` exists and is
  not a plan. The hook still runs cleanly (exit 0, per acceptance bullet 4 —
  not blocking), but this is a real regression the diff introduces. WARNING —
  safe to ship disclosed; fix by excluding `README.md` from the glob (or any
  file lacking a `status:` line) in a follow-up.

- Process note: the brief's `@f8a429b...-staged` sha-label convention is
  itself a gap — `check-markers.sh`'s bound-marker validation
  (`git cat-file -e "${sha}^{commit}"`) cannot resolve a `-staged` suffixed
  sha, so this verdict line will show as a marker `check-markers.sh` cannot
  bind/validate once written (it doesn't match the `@[0-9a-f]{7,40}` pattern
  it greps for, so today it's silently skipped rather than flagged wrong —
  but it also means it is not verifiable via that tool either). Flagging per
  the brief's own request; not a blocker for this round.

Verified clean (measured, not asserted):
- 6 agents / 16 commands / 5 scripts / `.state/feature-state.json` /
  `.state/inbox/` all confirmed absent from `git diff --cached --name-only`,
  archived under `.state/plans/legacy/20260916-232013/`.
- `docs/index.md` no longer links `AI-REPO-MAINTENANCE.md` / `CLAUDE.BLUEPRINT.md`
  (both files confirmed deleted; `git grep` finds zero remaining references).
- `AGENTS.md`'s operating-model/non-negotiables/index regions read consistent
  with `.harness/flow.md` (5 phases, anchor dial, fix-loop) and
  `.harness/scrutiny.toml` (floor=adversary, seats escalate, gate sizes).
- `.claude/hooks/session-start.sh` executed directly: exit 0, no reference to
  `.state/feature-state.json` or `.state/inbox` remains (`bash -n` also clean).
- `.claude/settings.json`: `spinnerVerbs: {mode: replace, verbs: ["Processing"]}`
  present, byte-identical to HANDOFF.md's description; no hook/command entry
  references a deleted path.

Gate: CHANGES r1 @f8a429badb6f9ddd1a039f58d7fdba3d311c7578-staged — adversary

### Gate — adversary (r2, delta re-review)

Re-verified each r1 finding against the new staged state (`git status`,
`git diff --cached`), not the Architect's summary:

- `.harness/manifest.json` — **fixed, better than prescribed.** Confirmed via
  `git ls-files .harness/` (only `flow.md`, `harness.toml`, `lib/`,
  `manifest.lock`, `scrutiny.toml` remain) and `git status --porcelain`, which
  shows it staged as `renamed: .harness/manifest.json ->
  .state/plans/legacy/20260916-232013/manifest.json` — not a plain `git rm`,
  but moved into the same legacy archive as the rest of the v1 footprint,
  consistent with this migration's own "history preserved via
  `.state/plans/legacy/`" convention. `git grep` confirms zero live references
  to `.harness/manifest.json` remain anywhere in the tree.
- `CLAUDE.md.template` — **fixed as prescribed.** `git status --porcelain`
  shows `deleted: CLAUDE.md.template`; `ls CLAUDE.md.template` confirms it is
  gone from the working tree. `git grep` for `CLAUDE.md.template` and
  `.harness/manifest.json` across the tree returns hits only inside this plan
  doc's own r1 findings text (expected, historical) — no live dangling
  reference to either remains.
- `docs/exec-plans/tech-debt-tracker.md` #045/#046 — **fixed as prescribed.**
  Re-read the file: both rows moved from `## Active` to `## Closed`, dated
  2026-09-16, marked `(moot)`, linked to `chore/harness-v2-migration` with a
  one-line reason ("scripts removed with the v1 EM/PM/PE/SDE pipeline"). `##
  Active` no longer contains them; `## Closed` does.
- `.claude/hooks/session-start.sh` — **fixed as prescribed.** Re-read the
  script: the glob loop now explicitly skips `basename == README.md`. Ran it
  directly: `Active plans (1): - 2026-09-16-roadmap-resilience-emoji-bulk.md:
  Draft` — `README.md` no longer appears. Exit code 0, confirmed.

New-fix sweep (mutating nothing, re-running the same instruments as r1):
- Broad grep for all six agent names / sixteen command stems / `run-{pe,pm,
  qa,sde,build}` across the tracked tree, excluding the legacy archive,
  `docs/exec-plans/completed/**` (historical progress logs), the
  tech-debt-tracker (already re-checked above), and this plan doc's own r1
  text: only hits left are in `HANDOFF.md` (prose telling the reader *not* to
  invoke the retired agents, and its one-shot `git rm` command listing them
  for archaeology — not a live path reference; the file is explicitly labeled
  "delete this file once the migration is merged"). No new leftover found.
- `.claude/settings.json`: `spinnerVerbs: {mode: replace, verbs:
  ["Processing"]}` still present, diff against HEAD shows only the intended
  9-insertion hunk (unchanged since r1).
- `bash -n .claude/hooks/session-start.sh`: clean.
- No new file appeared in `git status` beyond the four fixes plus the
  already-known set from r1; tree matches expectations.

Process note re-confirmed empirically (not blocking, informational): running
`.harness/lib/check-markers.sh docs/exec-plans` right now flags this very
plan doc's r1 `Gate:` line as `stale approval: 'f8a429b...' predates changes
to this file — re-confirm`, because the regex extracts only the hex run and
stops at the literal `-` in `-staged`, then diffs the doc against `f8a429b`
where the doc did not exist at all — so *any* `Gate:` line using this
base-sha-labeled-`-staged` convention on a new plan doc is permanently
unverifiable by the harness's own tooling. `session-start.sh` still exits 0
(check-markers reports, never blocks), so this does not block Piece 1's
acceptance bullet 4. Flagging again for whoever owns the sha-labeling
convention going forward — not a defect in this diff.

All four r1 findings verified fixed; no new issue found. Piece 1's acceptance
contract (all 5 bullets) is now met, measured directly against the staged
tree.

Gate: APPROVED r2 @f8a429badb6f9ddd1a039f58d7fdba3d311c7578-staged — adversary

## Progress log
- 2026-09-16 — roadmap drafted; piece 1 installed locally; pieces 2–4 scoped
  with inferred acceptance and blind-spot lists. Order and emoji sort semantics
  still need owner confirmation.

## Piece: post-migration-cleanup

### Gate — adversary (r1)

Attack surface per brief: confirm no tracked file has a *live* dependency on
`HANDOFF.md` existing.

- `git diff --cached --stat` / `git status --porcelain`: staged change is
  exactly `D  HANDOFF.md` — a single-file deletion, nothing else riding along.
- `git grep -ln "HANDOFF" -- . ':!HANDOFF.md'` plus a whole-tree
  case-insensitive `grep -rn "HANDOFF"` (including untracked files, `.git`
  excluded): only hits are three lines in this same roadmap doc
  (`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md:218,
  265, 305`), all inside the prior migration piece's r1/r2 gate-verdict prose
  — describing what `HANDOFF.md`'s text said/omitted at review time. No
  `[text](HANDOFF.md)` markdown link anywhere (`git grep -n "](HANDOFF"`
  empty), no `.yml`/`.yaml` CI workflow references it, no hook/script under
  `.claude/`, `.harness/`, or `scripts/` reads or mentions it. These are
  genuinely historical/descriptive references, not something that breaks.
- Read `HANDOFF.md` at `HEAD` directly (not the brief's summary): its own
  first-section text reads "Delete this file once the migration is merged —
  it is a one-shot handoff, not a doc," matching the brief's characterization
  verbatim.
- Confirmed the stated precondition is actually true, not just asserted: `git
  log --oneline -5` shows `54dfde5 Merge pull request #138 from
  dtammam/chore/harness-v2-migration` at the tip of the base — the migration
  this handoff was written for is merged.
- No dead-code guard, no script, no other tracked file's present-tense prose
  (`AGENTS.md`, `docs/index.md`, `.claude/settings.json`,
  `.claude/hooks/session-start.sh`) names or requires `HANDOFF.md`.

No findings. Tree left byte-identical to the pre-review staged state apart
from this appended section (verified via `git status --porcelain` /
`git diff --cached` showing only the pre-existing `D  HANDOFF.md`).

Gate: APPROVED r1 @54dfde5fbde9c510ece96e89033e12572c69d533-staged — adversary
