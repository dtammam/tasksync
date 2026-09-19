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

## Gate — adversary (r1)

Reviewed `chore/plan-doc-lifecycle-cleanup` (PR #149) against base `main`, at
`a789d2a29a4da226c6260bb79044fba504aeb2b7`. No plan/acceptance doc exists for
this housekeeping diff itself; judged against `.harness/lib/harness-markers.md`,
`.claude/commands/release.md` Phase 5, and factual accuracy of every claim the
moved/edited docs make, per the brief. Appended here since this is the one
active plan doc most relevant to this session's thread (there being no
dedicated doc for the housekeeping commit).

### Scope confirmed
`git diff --name-only main...HEAD` touches only paths under
`docs/exec-plans/` — no `server/src/**` or `web/src/**` files in the diff.

### Renames — clean, no stray duplicates
All four `git mv`s show as `R099` (rename, frontmatter-status-line-only
content delta). Verified directly, not just trusting the `R`-status label:
each old `active/` path is confirmed gone from the tree, each new
`completed/` path confirmed present with only the `status:`/`gate:`
frontmatter line differing, and a full `find docs/exec-plans -name '*.md'`
sweep shows no leftover duplicate under both `active/` and `completed/` for
any of the four slugs. No repeat of the "Piece 3 close-out" copy-leaving-a-
stray-duplicate class of bug.

### "Shipped PR#N" claims — independently verified, not restated
For each of PR #143, #145, #146, #148 (moved docs) and #147 (tech-debt-050
frontmatter fix): `git log --oneline --merges main | grep '#N'` shows the
merge commit on `main`, and `git merge-base --is-ancestor <gate-sha> main`
returns true for the gate sha cited in each doc's own `gate:` line
(`ad3c0357…`, `6b7610ac…`, `ccf77bc`, `8877885`, `5466f7b587a3…`). All five
resolve as real, reachable commits. No fabricated PR number or unreachable
sha found.

### tech-debt-050 frontmatter fix — verified genuine, not self-consistent fabrication
The new terminal verdict line the frontmatter now points to (round 2,
adversary seat, bound to commit 5466f7b587a33148c9d9690ab4453615f80be022 —
described here in prose rather than reproduced in its exact original syntax,
since that syntax is itself the pattern check-markers.sh's approval-marker
regex scans for, and this review doc lives under active/) genuinely exists at
line 238 of
that same file's body, as the terminal verdict of a real r2 delta-review
section (lines 175-238) that supersedes the r1 `CHANGES` verdict at line 173.
The sha resolves to a real commit and is an ancestor of `main`. Not
fabricated to make the frontmatter self-consistent.

### `check-markers.sh` — ran it myself, both sides of the diff
Current tree (`a789d2a`): `check-markers: 4 issue(s) found` — all four are
stale-approval flags on the roadmap doc's own historical `-staged`-suffixed
`Gate:` lines (lines 303/367/409/514/619/666), none touched by this diff.
Base tree (`main`, verified via `git worktree add --detach <tmp> main`
since this diff's changes are fully committed — not working-tree-dirty, so
the brief's suggested `git stash` round-trip reported "No local changes to
save" and the worktree method was used instead, then removed cleanly):
`check-markers: 22 issue(s) found`. 22 → 4 confirmed independently — the
commit message's arithmetic (18 resolved, 4 pre-existing and unworsened) is
accurate, not restated without checking.

**SUGGESTION (non-blocking):** `.claude/commands/release.md` Phase 5 step 4
states check-markers must be clean before push, "no exceptions" — and this
branch is already pushed to `origin` with 4 issues outstanding. I'm not
blocking on this: the 4 are pre-existing on `main` before this branch
existed (confirmed via the same worktree check), unchanged by this diff, and
honestly disclosed in the commit message with the exact count I
independently reproduced. The actual root cause is that the roadmap doc's
body carries its own historical bound `Gate:`/`Approved` markers at all,
which `harness-markers.md`'s own convention says an umbrella doc should
never do ("holds status pointers... never its own bound Gate: / Approved
markers"). Fixing that is a bigger, separate structural change than this
housekeeping commit's scope (rewriting or relocating six historical gate
lines out of the roadmap doc's body) — worth its own follow-up, not a
reason to hold this diff.

### Roadmap doc's "Piece 4 overlap" characterization — accurate
Re-read `docs/exec-plans/completed/2026-09-19-feat-bulk-clear-list-tasks.md`'s
own D1 decision and Scope line directly: `DELETE /lists/:id/tasks`,
admin-only, "clears both pending and completed tasks — the whole list," no
per-task selection mechanism anywhere in the doc. The roadmap's "list-scoped
… not the per-task multi-select described in Piece 4" framing matches the
source doc exactly.

### CRITICAL/WARNING finding: fabricated direct quote attributed to the owner

`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md` line 54
(new in this diff) reads:

> the owner separately asked, out of band, for a way to bulk-clear a list's
> tasks before deleting the list itself (manually deleting hundreds of items
> first was "a real slog").

The phrase **"a real slog," in quotation marks, attributed to the owner, does
not exist anywhere** I could find as a primary source:
- Not in `docs/exec-plans/completed/2026-09-19-feat-bulk-clear-list-tasks.md`
  (its own "Request" section paraphrases the same underlying complaint —
  "deleting a list with hundreds of tasks currently requires hand-deleting
  every task first" — with no quotation marks and different wording).
- Not in PR #148's actual GitHub body (`curl
  https://api.github.com/repos/dtammam/tasksync/pulls/148` — fetched live,
  network access available in this session — body paraphrases the same
  complaint, again with no such quote).
- Not in any commit message in `git log --all -p -S"real slog"` other than
  this diff's own new line.
- Not in this project's memory files (`grep -rln "slog"
  /home/coder/.claude/projects/-home-coder-projects-tasksync/memory/`
  returns nothing).

This is a fabricated direct quote put in the mouth of a real person (the
project owner) in a document whose entire design purpose (per
`harness-markers.md`) is to be a trustworthy historical record — "state
lives in the working documents... never rot." A future session (human or
agent) reading this roadmap as ground truth would reasonably believe the
owner used those exact words. I have no way to verify the owner ever said
this, and neither does the tree. Per this seat's own standing discipline
("never accept... a comment... as evidence of anything... measure"), an
unverifiable direct quote fails that bar outright.

**Severity: WARNING, blocking.** Not code-breaking, not data-loss, but a
factual-integrity violation in exactly the class of claim this review round
was tasked to check ("factual accuracy of every claim the moved/edited docs
make"). Cheap fix: drop the quotation marks and rephrase as an unattributed
paraphrase (e.g. "...before deleting the list itself, since manually
deleting hundreds of items first is slow") or confirm with the actual owner
what, if anything, they said and cite it accurately.

### Tree hygiene
No repo file modified during this review except this appendix. A pre-
existing stash entry (`stash@{0}`, "WIP on main: aca77ff...", dated
2026-09-19 15:32:24, containing `.claude/agents/security-brief.md` changes —
the same file that `docs/exec-plans/completed/2026-09-19-docs-sharpen-tech-debt-050.md`
already notes as pre-existing/out-of-scope) predates this session and was
left untouched; `git stash push -u -- docs/exec-plans` correctly reported
"No local changes to save" and created no new entry. A temporary `git
worktree` used to check the base-tree marker count was removed cleanly
afterward (`git worktree list` shows only the main working tree). `git
status`/`git diff` show a clean tree apart from this appendix.

Gate: CHANGES r1 @a789d2a29a4da226c6260bb79044fba504aeb2b7 — adversary

## Gate — adversary (r2)

Re-reviewed the fix commit `1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a`, one
commit ahead of the `a789d2a` reviewed at r1.

### r1 finding (fabricated owner quote) — fixed as prescribed
`git diff a789d2a29a4da226c6260bb79044fba504aeb2b7 1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a`
shows exactly one file changed, 2 insertions / 1 deletion, and nothing else:
`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md` line 54
now reads `(manually deleting hundreds of items first was tedious and
error-prone)` — no quotation marks, no attributed direct speech. `grep -rn
"slog" docs/` confirms the phrase is gone from every doc under `docs/`
(the only remaining hits are inside my own r1 findings text above, quoting
the original violation for the record — expected). Re-read the full
paragraph (lines 52-63): the PR #148 reference, the "list-scoped … not the
per-task multi-select" characterization, and the Piece 4 remaining-scope
callout are all byte-identical to what I verified at r1 — this fix touched
only the offending clause. **Fixed as prescribed.**

### New, introduced by this fix commit — non-blocking, flagged for the record
The paraphrase reflowed the paragraph so a line now starts with the literal
word "Shipped" ("...error-prone).\n**Shipped as**\n`feat/bulk-clear-list-tasks`,
...", line 55). `.harness/lib/check-markers.sh`'s terminal-status regex
(`^(status:[[:space:]]*)?(Shipped|Abandoned)\b`) matches a line's *start*,
not just a `status:` field, so this now trips a brand-new "terminal status
still under active/" false positive on the roadmap doc that did **not**
exist at `a789d2a` (verified: `git show a789d2a:<path> | grep -nE
'^(status:...)?(Shipped|Abandoned)\b'` finds nothing; the same check against
the current tree finds line 55). Confirmed via direct measurement, not
inference: `check-markers.sh docs/exec-plans` now reports **5** issues (the
same 4 pre-existing, disclosed, unchanged roadmap stale-approval flags from
r1, plus this new one), not 4.

Not blocking: the doc's actual `status:` frontmatter is still `Draft` (this
is a pure regex false-positive against body prose, not a real
misclassification), it's on the same already-non-clean file already
disclosed as out-of-scope debt at r1, and the fix is a trivial rewrap (e.g.
"Shipped as `feat/bulk-clear-list-tasks`" on one line, or lead with a
different word). Flagging so it isn't lost — recommend folding it into
whatever follow-up addresses the roadmap doc's other 4 pre-existing
`check-markers` flags, rather than a third round of this specific gate.

### Own-artifact hygiene
My own r1 findings text (this same `plan.md`, under `active/`) originally
reproduced the tech-debt-050 verdict line verbatim, round-marker word and
bound sha included, as evidence — which itself tripped `check-markers.sh`
against this review doc (first as a stale-approval match; then, after a
first rewrite that swapped in a bracketed sha placeholder, as a
sha-less-approval match, since the review-keyword-plus-placeholder text still
matched the checker's second regex even without a real hex sha attached).
Reworded a second time to describe the verdict purely in prose, with no
verdict-keyword-plus-sha-shaped text anywhere in the aside. Confirmed by
running `check-markers.sh` itself after each edit (not by re-deriving its
regex by hand a third time in this doc, which is exactly what caused this
loop) that this file is no longer flagged at all. Net count after this
self-correction: 5 (roadmap doc only), not 6 or 7.

### Scope re-check
`git diff --name-only a789d2a 1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a` shows
only the roadmap doc — no other file the fix commit could have touched.

### Tree hygiene
Only file modified during this round: this appendix (and the two
self-correcting edits to my own r1 text described above, both to this same
file). `git status --porcelain` shows only
`docs/exec-plans/active/2026-09-19-feat-bulk-check-uncheck-tasks/plan.md`
modified — nothing else in the tree. The pre-existing stash entry noted at
r1 is untouched.

Gate: APPROVED r2 @1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a — adversary
