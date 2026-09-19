---
plan: chore-plan-doc-lifecycle-cleanup
harness: v2 · lean
anchor: outcome
status: Shipped PR#149 (+ PR#150 follow-up)
gate: APPROVED r2 @1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a — adversary
---

# Plan-doc lifecycle cleanup — gate history (PR#149, PR#150)

Housekeeping chore, never given its own plan doc at intake time (it was a
same-session owner request: pause the bulk-check/uncheck-all intake, close
out four plan docs that had shipped and merged but never ran `/release`'s
Phase 5, and fix a stale frontmatter marker on an already-completed doc).
This doc exists retroactively, filed directly in `completed/`, to give the
work a proper record and to hold its gate history somewhere
`check-markers.sh` never scans — the sections below were originally appended
to `docs/exec-plans/active/2026-09-19-feat-bulk-check-uncheck-tasks/plan.md`
(an unrelated, still-Parked doc) and relocated here per the PR#150-review
finding immediately below: a verbatim `Gate: APPROVED r2 @<sha>` transcript
left under `active/` permanently self-trips `check-markers.sh`'s
stale-approval check on the next unrelated commit anywhere in the repo, with
no way to ever resolve it since the PR it describes is already closed and
merged.

## What PR #149 did
Ran the `/release` Phase 5 bookkeeping that got skipped after merging PR#143,
#145, #146, and #148: marked each plan doc `Shipped PR#<n>` and moved it from
`active/` to `completed/`; fixed
`completed/2026-09-19-docs-sharpen-tech-debt-050.md`'s frontmatter (said
"Changes requested r1" despite its own body recording a later "APPROVED r2");
updated the roadmap doc's status table/notes to reflect shipped pieces and
noted where bulk-clear-list-tasks overlaps Piece 4's remaining scope.

## What PR #150 did
Recorded the adversary's PR#149 review (r1 CHANGES, r2 APPROVED) into a plan
doc, since PR#149 had none of its own — the same gate history reproduced
verbatim below. Its own adversary review (r1, at the bottom of this doc)
found that doing so inside an `active/` doc created a live self-tripping
marker hazard; this doc is the fix.

---

## Gate — adversary (r1), reviewing PR#149 @a789d2a

Reviewed `chore/plan-doc-lifecycle-cleanup` (PR #149) against base `main`, at
`a789d2a29a4da226c6260bb79044fba504aeb2b7`. No plan/acceptance doc existed for
this housekeeping diff itself; judged against `.harness/lib/harness-markers.md`,
`.claude/commands/release.md` Phase 5, and factual accuracy of every claim the
moved/edited docs make, per the brief.

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
adversary seat, bound to commit 5466f7b587a33148c9d9690ab4453615f80be022)
genuinely exists at line 238 of that same file's body, as the terminal
verdict of a real r2 delta-review section (lines 175-238) that supersedes the
r1 `CHANGES` verdict at line 173. The sha resolves to a real commit and is an
ancestor of `main`. Not fabricated to make the frontmatter self-consistent.

### `check-markers.sh` — ran it myself, both sides of the diff
Current tree (`a789d2a`): `check-markers: 4 issue(s) found` — all four are
stale-approval flags on the roadmap doc's own historical `-staged`-suffixed
`Gate:` lines, none touched by this diff. Base tree (`main`, verified via
`git worktree add --detach <tmp> main`): `check-markers: 22 issue(s) found`.
22 → 4 confirmed independently — the commit message's arithmetic (18
resolved, 4 pre-existing and unworsened) is accurate, not restated without
checking.

**SUGGESTION (non-blocking):** `.claude/commands/release.md` Phase 5 step 4
states check-markers must be clean before push, "no exceptions" — and this
branch was already pushed with 4 issues outstanding. Not blocking: the 4 are
pre-existing on `main` before this branch existed, unchanged by this diff,
and honestly disclosed in the commit message with the exact count
independently reproduced. The actual root cause is that the roadmap doc's
body carries its own historical bound `Gate:`/`Approved` markers at all,
which `harness-markers.md`'s own convention says an umbrella doc should
never do. Fixing that is a bigger, separate structural change than this
housekeeping commit's scope — worth its own follow-up.

### Roadmap doc's "Piece 4 overlap" characterization — accurate
Re-read `docs/exec-plans/completed/2026-09-19-feat-bulk-clear-list-tasks.md`'s
own D1 decision and Scope line directly: `DELETE /lists/:id/tasks`,
admin-only, "clears both pending and completed tasks — the whole list," no
per-task selection mechanism anywhere in the doc. The roadmap's "list-scoped
… not the per-task multi-select described in Piece 4" framing matches the
source doc exactly.

### CRITICAL/WARNING finding: fabricated direct quote attributed to the owner

`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md` line 54
(new in this diff) read:

> the owner separately asked, out of band, for a way to bulk-clear a list's
> tasks before deleting the list itself (manually deleting hundreds of items
> first was "a real slog").

The phrase "a real slog," in quotation marks, attributed to the owner, did
not exist anywhere findable as a primary source: not in the bulk-clear-list-
tasks plan doc's own Request section, not in PR #148's actual GitHub body,
not in any commit message, not in project memory files.

**Severity: WARNING, blocking.** A future session reading this roadmap as
ground truth would reasonably believe the owner used those exact words, with
no way to verify it. Fixed by dropping the quotation marks and rephrasing as
an unattributed paraphrase.

Gate: CHANGES r1 @a789d2a29a4da226c6260bb79044fba504aeb2b7 — adversary

## Gate — adversary (r2), reviewing PR#149 @1cf9d83

Re-reviewed the fix commit `1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a`, one
commit ahead of the `a789d2a` reviewed at r1.

### r1 finding (fabricated owner quote) — fixed as prescribed
`git diff a789d2a29a4da226c6260bb79044fba504aeb2b7 1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a`
showed exactly one file changed, 2 insertions / 1 deletion: the roadmap
doc's line 54 now reads "(manually deleting hundreds of items first was
tedious and error-prone)" — no quotation marks, no attributed direct speech.
Rest of the paragraph confirmed byte-identical to what was verified at r1.
**Fixed as prescribed.**

### New, introduced by this fix commit — non-blocking, flagged for the record
The paraphrase reflowed the paragraph so a line started with the literal
word "Shipped" — `.harness/lib/check-markers.sh`'s terminal-status regex
matches a line's start, not just a `status:` field, so this tripped a new
"terminal status still under active/" false positive on the roadmap doc that
did not exist at `a789d2a`. Confirmed via direct measurement: `check-
markers.sh` went from 4 to 5 issues. Not blocking: the doc's real `status:`
frontmatter is still `Draft`; recommended folding the fix into whatever
follow-up addresses the roadmap doc's other pre-existing flags rather than a
third gate round for this alone. (See the harness bug report filed
upstream — this exact false-positive class is item 4 there.)

Gate: APPROVED r2 @1cf9d838ac72cf8d58ea1c144c6ff9a7ee243d0a — adversary

## Gate — adversary, PR#150 review (r1)

Reviewed `chore/record-pr149-gate-history` (PR #150) against base `main`, at
the branch's HEAD commit `74dcb42206e3a3e996de9a784f975ceea0261eaa`. This
section reviews the *act of adding* the gate-history sections above (a
verbatim historical transcript of the PR#149 review) into
`docs/exec-plans/active/2026-09-19-feat-bulk-check-uncheck-tasks/plan.md` —
not a re-review of PR#149's content, already merged and out of scope here.

### Scope — confirmed single-file, purely additive
`git diff --name-only main...HEAD` touched exactly one path, purely additive
(a single hunk appended after the pre-existing Parked content — nothing
above the insertion point rewritten). No source file touched.

### Verdict-line provenance — verified, not restated
Both cited shas exist and are ancestors of `main`. PR #149 confirmed real
and merged (`272ea51`).

### check-markers.sh — ran on both trees
Current tree and `main` (via a detached worktree): identical 5 issues, same
file (the roadmap doc), same lines. This commit introduced zero
*currently-visible* new check-markers issues — but see the finding below for
a latent one.

### WARNING (blocking): the transcribed r2 verdict line plants a permanent, self-tripping false positive in check-markers.sh
The transcript's own closing r2 verdict line reproduced `check-markers.sh`'s
live-tracking `Gate: APPROVED ... @<sha>` syntax verbatim, inside a file
under `active/`. `check-markers.sh`'s approval-marker check has no way to
know that line is a historical transcript about a different, already-merged
PR — it only sees an "APPROVED ... @<sha>" pattern in a doc under `active/`
and checks whether non-docs code has drifted since that sha.

Demonstrated, not inferred: in a throwaway detached worktree, appending one
unrelated line to `README.md` flipped `check-markers.sh` from 5 issues to 6,
adding a stale-approval flag against the *bulk-check-uncheck-tasks* plan
doc — unrelated, Parked, `gate: pending` — with no way to ever resolve it,
since PR #149 is finished and merged and there is nothing to "re-gate."

**Fix:** relocate this historical transcript to a `completed/` location,
which `check-markers.sh` does not scan at all — the more correct home for a
closed-and-merged PR's gate history than an unrelated, still-Parked, active
plan doc. (This is exactly what this doc you're reading now is.)

Gate: CHANGES r1 @74dcb42206e3a3e996de9a784f975ceea0261eaa — adversary
