---
plan: roadmap-resilience-emoji-bulk-gate-history
harness: v2 · lean
anchor: outcome
status: Shipped (relocation)
gate: APPROVED r2 @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c — adversary
---

# Roadmap doc's own edit-history gate record

`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md` is an
umbrella/tracking doc, not a single shippable piece — per its own stated
design, it "sequences pieces of work; each piece ships as its own branch +
own plan doc... this doc's own status tracks the roadmap, not any single
piece." Over the life of the roadmap, several edits *to the roadmap document
itself* (removing v1 harness leftovers, deleting a stale handoff file, a
status-table update, closing out Piece 3) were gated and merged the normal
way — each producing a `### Gate — adversary (rN)` section with a bound
`Gate: <verdict> @<sha>` line, appended directly into the roadmap doc's own
body.

That was a mistake in hindsight: `harness-markers.md`'s own convention says
an umbrella doc should hold status *pointers*, never its own bound `Gate:` /
`Approved` markers. The `handoff-harness` v2.1.1 update's new "merged but not
released" check (`check-markers.sh`) surfaced the consequence directly — it
found the roadmap doc's last bound `Gate: APPROVED` line
(`@3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c`, from the Piece 3 close-out
below) already merged into `main`, and flagged the whole roadmap doc as
"approved work already in main but plan not Shipped — run /release." That
flag was a real, correctly-firing symptom, but the roadmap doc is
intentionally not done (Piece 2 and Piece 4 are still open) — the fix isn't
to ship the umbrella early, it's to stop the umbrella from carrying gate
markers that don't describe its own completion at all.

This document is the fix: the six gate rounds below (verbatim, unedited,
moved as-is — nothing reworded, condensed, or summarized) are relocated out
of the still-active roadmap doc into their own record here in `completed/`,
which `check-markers.sh` does not scan for staleness. The roadmap doc itself
keeps its acceptance/planning content and its Progress log, with a pointer
to this file where its own edit history used to be. No verdict, severity, or
finding was changed in the move — only the location.

---

## Piece 1 — Harness v2 migration, gate history

(Acceptance criteria for this piece remain in the roadmap doc itself; only
the gate rounds below are relocated here.)

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

## Piece: park-add-task-resilience-intake

### Gate — adversary (r1)

Reviewed the staged diff (`docs/exec-plans/active/2026-09-17-fix-add-task-details-reload.md`
new, this doc's own table/order-note edit) against the current tree at
`HEAD` (no staged code changes ride along).

**Attack surface 2 — no code changed.** `git diff --cached --name-only`
returns exactly the two doc paths named in the brief. `git diff --cached
--stat` shows 157 insertions / 7 deletions across those two files only.
The new plan doc's own "Progress log — No code has been written yet" is
true as stated; nothing under `web/` or `server/` is touched.

**Attack surface 1 — root-cause claims, verified against source, not
prose.** Read every cited file:line directly:
- `makeLocalTask` mints `` `local-${crypto.randomUUID()}` `` at
  `web/src/lib/stores/tasks.ts:49` exactly as claimed; called from
  `createLocalWithOptions` (`tasks.ts:194`) and `importBatch` (`tasks.ts:246`,
  confirmed markdown-sourced via `ImportTasksModal.svelte:6,25`
  `parseMarkdownTasks`).
- `requestIdForLocalTask` (`sync.ts:14-22`) strips the `local-` prefix
  before it's used as `create_task`'s `id` (`sync.ts:95`); confirmed the
  server accepts a client-supplied id verbatim
  (`server/src/routes/tasks.rs:165-171`, idempotency test at
  `server/src/routes/mod.rs:1072`).
- Ack path traced end to end: `sync.ts:310` calls
  `tasks.replaceWithRemote(entry.op.localTaskId, mapApiTask(remoteTask), ...)`;
  `mapApiTask` (`sync.ts:48-72`) sets `id: t.id` (the bare server UUID).
  `replaceWithRemote` (`tasks.ts:664-679`) overwrites `id` with `remote.id`
  in *both* branches (the spread-`remote` no-edits branch and the explicit
  `id: remote.id` edited-since-create branch) — confirmed by reading both
  branches, not just one.
- Create-vs-update gating confirmed at `sync.ts:88-89`
  (`` `${task.local ? 'create' : 'update'}-${index}` ``) — gated on the
  `task.local` boolean, not id shape, as claimed.
- Drawer-unmount mechanism confirmed exactly: `detailId`
  (`+page.svelte:28`), reactive lookup (`+page.svelte:51`), set only by
  `openDetail`/`closeDetail` (`+page.svelte:204,208`) — never resynced when
  a task's `id` changes — feeding `open={!!detailTask}`
  (`+page.svelte:352`) into `TaskDetailDrawer`'s `{#if open && task}`
  (`TaskDetailDrawer.svelte:151`). Identical pattern independently confirmed
  in `web/src/routes/list/[id]/+page.svelte:15,22,102,103`.
  `{#each ... (task.id)}` keying confirmed at `+page.svelte:311,333` and
  `list/[id]/+page.svelte:203,219`.
- `grep -rn "{#key" web/src/` reproduces exactly the doc's claim: the only
  hits are `StreakDisplay.svelte:31,46`, unrelated to this path.

- WARNING (doc accuracy, not code-affecting since no code exists yet):
  claim 5's own grep summary is imprecise. It states "confirmed via
  `grep -rn "local-" web/src/lib/`: the only non-test reads are the two
  `sync.ts` sites that add/strip it." Running that exact grep shows
  **one** non-test hit in `sync.ts` (line 16, inside
  `requestIdForLocalTask`, which strips the prefix) plus a coincidental,
  unrelated match in `Sidebar.svelte:463` ("local-only signOut", a comment,
  not the prefix). The site that *adds* the prefix is `tasks.ts:49-50`
  (`makeLocalTask`'s `id` and `order`), not `sync.ts` — which the doc's own
  claim 1, three paragraphs earlier, correctly attributes to `tasks.ts:49`.
  So claim 5 contradicts claim 1 on which file mints the prefix. The
  downstream conclusion ("nothing else branches on
  `id.startsWith('local-')`") is still true — verified independently by
  the same grep, which shows no third-party branch on the literal — so
  this doesn't change the Approach's safety argument, but it's exactly the
  kind of "confirmed by code" claim that wasn't, and should be corrected
  before Build resumes so a future implementer isn't sent looking for a
  second `sync.ts` site that doesn't exist. Safe to ship disclosed: the
  plan is Parked with no code written, and the error doesn't survive
  independent re-verification of the thing it's actually used to argue.

**Attack surface 3 — consistency between the two doc edits.** The
roadmap table's Piece 2 row ("Parked — intake done (root cause confirmed,
approach ready), no code yet; see its own plan doc") and branch column
(`fix/add-task-details-reload`) match the new plan doc's frontmatter
(`status: Parked(revisit: owner reprioritized emoji piece first,
2026-09-17)`) and its own progress log verbatim — same branch, same
parked reason, same "no code yet." The reordered note ("3 → 2 → 4 …
originally 2 → 4 → 3, confirmed 2026-09-16") is self-consistent with the
original text it replaces (diffed via `git diff --cached`). No
contradiction found.

**Attack surface 4 — marker hygiene.** `.harness/lib/check-markers.sh
docs/exec-plans` output, verbatim:
```
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval: 'f8a429badb6f9ddd1a039f58d7fdba3d311c7578' predates changes to this file — re-confirm
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval: 'f8a429badb6f9ddd1a039f58d7fdba3d311c7578' predates changes to this file — re-confirm
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval: '54dfde5fbde9c510ece96e89033e12572c69d533' predates changes to this file — re-confirm
check-markers: 3 issue(s) found
```
All three are the previously-reported `-staged`-suffix limitation
(documented in this same doc's Piece 1 r2 section and Piece
post-migration-cleanup r1 section): the tool's bound-sha regex can't
resolve the `-staged` suffix, and any further edit to this file re-trips
the same three already-bound `Gate:` lines (Piece 1 r1, r2, and
post-migration-cleanup r1). Not new, not re-litigated. The new plan doc
(`2026-09-17-fix-add-task-details-reload.md`) has no bound `Gate:` line
yet (`gate: pending`) and produced zero findings of its own.

No CRITICAL findings. One WARNING (doc-accuracy, claim 5 vs. claim 1),
argued safe to ship disclosed above. Tree confirmed left byte-identical
to the pre-review staged state apart from this appended section
(`git status --porcelain` / `git diff --cached` show only the two
originally-staged files, this section included).

Gate: APPROVED r1 @039a87fc283667e92820221e425e0c4258a5de6-staged — adversary

## Piece 3 close-out gate

Findings (adversary, r1):

1. **CRITICAL — the plan doc was copied to `completed/`, not moved; the
   stale `active/` copy is still tracked and unchanged.** `git ls-files
   docs/exec-plans/active/2026-09-18-feat-task-emoji.md` shows it is still
   in the index, and its content on disk is byte-identical to the last
   commit on `main` (`54b145e`) — frontmatter still reads `status:
   Building`, no `## Closed` section. The staged diff never `git rm`s
   this file; it only adds a second copy at
   `docs/exec-plans/completed/2026-09-18-feat-task-emoji.md` with
   `status: Shipped PR#141` and the closing note. `diff` between the two
   copies shows only the intended frontmatter + appended-section change —
   confirming the `completed/` copy's *content* is correct and complete
   (all D1–D11 decisions and all three r1/r2/r3 gate rounds for
   adversary/qa/security-brief are present verbatim), but the repo now
   has two contradictory records of the same plan's status at once:
   `active/` says "Building" (and `docs/exec-plans/active/README.md`
   defines that folder as "work that is currently in progress" and
   explicitly instructs "move it to `../completed/`" on completion — this
   diff violates that contract), while the same commit's roadmap edit
   says "**Shipped**". `.harness/lib/check-markers.sh` independently
   flags this file: `terminal status (Shipped/Abandoned) still under
   active/ — move to completed/` — though I traced that specific trigger
   to a coincidental lowercase "shipped" at the start of a prose line
   inside the file's own adversary r1 gate section (line 658: "shipped
   this is a real, reachable data-shape bug..."), not to the frontmatter
   (which still says "Building" and would not itself trip the regex).
   The tool's *trigger* is accidental; the *diagnosis* is correct and
   independently confirmed by my own `git ls-files` check. Fix: stage a
   deletion of `docs/exec-plans/active/2026-09-18-feat-task-emoji.md`
   alongside the new `completed/` file (`git rm` it, do not just leave it
   behind).
   Repro:
   ```
   git ls-files docs/exec-plans/active/2026-09-18-feat-task-emoji.md
   diff docs/exec-plans/active/2026-09-18-feat-task-emoji.md \
        docs/exec-plans/completed/2026-09-18-feat-task-emoji.md
   ```

Verified clean (no findings):

- **Surface 1 (Shipped claims).** No `gh` CLI installed, but the sandbox
  has outbound network access, so I hit the GitHub REST API directly
  (primary source) for PRs #138–#141:
  `curl -s https://api.github.com/repos/dtammam/tasksync/pulls/{138,139,140,141}`
  — all four report `"merged": true`, and each `merge_commit_sha` matches
  the corresponding merge commit in `git log --oneline main` exactly
  (#141 → `6fa81f77…`, #140 → `3eb4e6e8…` = current `HEAD`). Also
  confirmed on-disk: `web/src/lib/tags/palette.ts` and
  `server/migrations/0018_task_and_list_emoji.sql` both exist on the
  current tree.
- **Surface 2 (moved-doc completeness).** Full 1053-line read of
  `completed/2026-09-18-feat-task-emoji.md`: all eleven decisions (D1–D11)
  present, all three gate rounds present verbatim
  (`security-brief` r1/r2/r3, `qa` r1/r2/r3, `adversary` r1/r2/r3), in
  order, nothing truncated. (The content is fine — see finding 1 for why
  the *location* isn't.)
- **Surface 3 (stray references).** Repo-wide content grep for
  `2026-09-18-feat-task-emoji` outside the two file copies themselves
  turns up exactly one hit: the roadmap doc's new follow-up note, which
  correctly points at the new `completed/` path. No stale index/README/
  code references. (Again, the residual problem is finding 1's stray
  *file*, not a stray *reference*.)
- **Surface 4 (tech-debt #050).** Broadened text is internally
  consistent and attributes each flakiness pattern to the correct PR
  (chromium/`offline.spec.ts` → PR #141; webkit/`pull-to-refresh.spec.ts`
  → PR #140), matching the brief. Historical CI counts are unverifiable
  from here, per the brief's own scoping — not re-litigated.
- **Surface 5 (marker hygiene).** `.harness/lib/check-markers.sh`
  verbatim: 25 issues found against the staged tree. I isolated which of
  these predate this diff by `git stash -u` (removing the staged docs
  changes) and re-running: 15 of the 25 reproduce identically against
  `main`'s current tip with no staged changes at all — i.e. they are
  pre-existing on `main`, not introduced by this diff (all the
  `active/2026-09-16-roadmap...` stale-approval flags, and all the
  `active/2026-09-18-feat-task-emoji.md` flags including the
  terminal-status one from finding 1). The remaining 10 are the same
  class of finding landing fresh on the *new*
  `completed/2026-09-18-feat-task-emoji.md` file, because its own
  historical r1/r2/r3 `Gate:` lines necessarily predate the
  frontmatter/Closed-section edit that just added them to that path —
  the same known whole-file-diff limitation the brief pre-authorizes as
  non-blocking. (Restored staging exactly after the stash round-trip;
  see tree-hygiene note below.)

Tree hygiene: mutation-tested nothing destructive; the only non-read
operation was a `git stash -u` / `git stash pop` round-trip to isolate
pre-existing vs. new `check-markers.sh` findings, which unstaged the two
already-staged docs files as a side effect — caught immediately via
`git status --short` and re-staged by name
(`git add docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md
docs/exec-plans/tech-debt-tracker.md`) to restore the exact original
staged stat (1063 insertions / 2 deletions across the three files).
Final `git status --short` before writing this verdict: the three
originally-staged files plus the pre-existing unstaged
`.claude/agents/security-brief.md` (untouched, out of this diff's scope,
not my mess) — tree otherwise byte-identical to the pre-review snapshot.

CRITICAL finding 1 blocks. Requesting a fix: stage the deletion of the
stale `active/2026-09-18-feat-task-emoji.md` copy before this closes.

Gate: CHANGES r1 @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c-staged — adversary

## Piece 3 close-out gate — r2 delta re-review

Finding 1 (CRITICAL, r1): **fixed as prescribed.** `git status` now shows
a proper rename:
`renamed: docs/exec-plans/active/2026-09-18-feat-task-emoji.md ->
docs/exec-plans/completed/2026-09-18-feat-task-emoji.md`. Verified directly:
`ls docs/exec-plans/active/2026-09-18-feat-task-emoji.md` → no such file;
`git ls-files docs/exec-plans/active/2026-09-18-feat-task-emoji.md` →
empty (untracked, gone from the index too). No duplicate, no stray file.
`git diff --cached --stat` shows exactly three paths touched (the rename
target + the two already-reviewed doc edits), nothing else.

Re-ran `.harness/lib/check-markers.sh`: 15 issues (down from 25 in r1 —
the 10 tied to the stray `active/` copy, including the terminal-status
flag, are gone along with the file). Of the remaining 15:
- 10 are the same `completed/2026-09-18-feat-task-emoji.md` stale-approval
  flags already categorized in r1 (its own historical r1/r2/r3 `Gate:`
  lines necessarily predate the frontmatter/Closed-section edit that just
  landed — known whole-file-diff limitation, unchanged from r1).
- 4 are the same pre-existing roadmap-doc stale-approval flags from r1
  (shas `f8a429b`, `f8a429b`, `54dfde5`, `039a87f` — present on `main`
  before this diff, confirmed in r1 via the stash isolation).
- 1 is **new but expected**: a stale-approval flag against
  `3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c` in the roadmap doc — that's
  my own r1 `Gate:` line, which necessarily goes stale the instant any
  further edit lands in the same file (the owner's two r2 additions,
  in this case). This is the identical mechanism already documented
  earlier in this same doc's Piece 1 r2 section ("any further edit to
  this file re-trips the same three already-bound `Gate:` lines") —
  not a new class of problem, and it will recur again against my own r2
  line the moment anyone edits this file again. Not blocking.

The two new content additions (owner-direction note in the roadmap, and
the matching note appended to tech-debt #050 about pausing roadmap work
for a live pairing session on the CI flakiness after the next piece
ships) are consistent with each other, correctly cross-reference tech-debt
#050, and don't touch or contradict anything from the r1-reviewed diff
(#050's PR attribution for the two flakiness patterns is unchanged and
still correct per r1).

No new findings. Tree needed no mutation this round beyond the read-only
checks above; `git status --short` before writing this verdict shows
only the four originally-in-play paths (three staged, one pre-existing
unstaged `.claude/agents/security-brief.md`, still out of scope).

Gate: APPROVED r2 @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c-staged — adversary
