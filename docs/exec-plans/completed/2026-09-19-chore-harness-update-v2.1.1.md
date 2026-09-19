---
plan: chore-harness-update-v2.1.1
harness: v2 · lean
anchor: outcome
status: Shipped v2.1.1
gate: APPROVED r1 @0def07763b9a92a92e7a77026d42d6bfe1fb95ea — adversary
---

# chore: update handoff-harness to v2.1.1

## What this is

Vendored-tool update. `chore/harness-update-v2.1.1` (PR #151) runs the
upstream `dtammam/handoff-harness` project's own official updater
(`curl ... install.sh -- --update`) to move the local harness tooling from
`v2.1.0@06cbf16` to `v2.1.1@1c1f4d6`. No plan/acceptance doc exists because
this is not a feature — this doc is both the record and the review, per the
slim gate for `harness-and-config` (`.harness/scrutiny.toml`: seats =
[adversary] only). This doc is created fresh (no separate intake doc existed
for this PR), mirroring the format of the prior update's record,
`docs/exec-plans/completed/2026-09-18-chore-harness-update-v2.1.0.md`.

Files touched (base `main` → HEAD `0def07763b9a92a92e7a77026d42d6bfe1fb95ea`):

```
.claude/agents/security-brief.md
.claude/hooks/session-start.sh
.harness/flow.md
.harness/harness.toml
.harness/lib/check-markers.sh
.harness/lib/harness-markers.md
```

Net change: `check-markers.sh` now scans a plan's SPINE explicitly (flat
`active/*.md` legacy files and `active/<slug>/plan.md` v2.1 directories,
never `research/*.md` / `design.md` siblings), reads terminal status from
YAML frontmatter only (never whole-file prose), adds a "merged but not
released" check (an `Approved` plan whose gate sha is already an ancestor of
the default branch but whose status isn't terminal), and extends
consistency checks into `completed/` (non-terminal status, or a
frontmatter `gate:` field contradicting the body's last verdict).
`session-start.sh`'s "Active plans" listing is upgraded from a flat glob to
a `find`-based walk so it also surfaces directory-shaped plans. `flow.md`
gets a short "passing the gate is not shipping" callout in Phase 5.
`harness-markers.md` documents all of the above. `security-brief.md` gains
`Edit` in its tool list, scoped in prose to writing the verdict line only.

## Review

### Scope — verified

`git diff --name-only main...HEAD` returns exactly the 6 files listed
above, no more, no less. `git diff main...HEAD --name-status` confirms all
6 are plain modifications. Nothing under `server/src/**` or `web/src/**`
appears anywhere in the diff.

### The update came from upstream, not hand-edited

`.harness/harness.toml` reads `version = "v2.1.1"` / `commit = "1c1f4d6"`
(confirmed by reading the file directly post-update, not the commit
message). `bash -n` on both changed shell scripts reports clean syntax.
Ran both live, verbatim:

```
$ bash .harness/lib/check-markers.sh docs/exec-plans
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @f8a429badb6f9ddd1a039f58d7fdba3d311c7578 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @54dfde5fbde9c510ece96e89033e12572c69d533 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @039a87fc283667e92820221e425e0c4258a5de6 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: approved work @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c is already in 'main' but plan not Shipped — run /release
check-markers: 5 issue(s) found
EXIT=1
```

```
$ bash .claude/hooks/session-start.sh
Branch: chore/harness-update-v2.1.1
Active plans (4):
  - 2026-09-16-roadmap-resilience-emoji-bulk.md: Draft
  - 2026-09-17-fix-add-task-details-reload.md: Parked(...)
  - 2026-09-19-feat-bulk-check-uncheck-tasks: Parked(...) — next: Resume intake confirmation of anchor (spec) + decision register D1-D10 with the owner.
  - README.md: no status
  [check-markers output as above, indented]
EXIT=0
```

Both ran to completion without crashing and produced output consistent
with the repo's real state (4 pre-existing genuine drift flags carried
over unchanged from before this update — the same 4 the prior v2.1.0
review already catalogued as pre-existing, unrelated housekeeping — plus
1 new correctly-firing "merged but not released" flag, addressed below).

### The four "gaps fixed" claims — each verified independently

**1. `completed/` now scanned.** Read `spines()`:
`spines <active|completed>` globs `$PLANS_DIR/$1` for flat `*.md` (maxdepth
1) plus nested `plan.md` (mindepth 2), and the script now runs this over
both `active` and `completed` in two separate loops, the second doing
frontmatter-terminal-status and `gate:`-vs-body-verdict consistency checks
only (no staleness, since completed plans are frozen). Confirmed by
reading the script directly (not the diff) — present in the committed
file, not just described.

**2. Frontmatter-only terminal-status check — constructed the exact
false-positive case.** Built a throwaway plan (outside the repo, under the
session scratchpad, never committed) with frontmatter `status: Draft` and
a body line `Shipped last week to prod, everyone loved it.`:

```
$ bash .harness/lib/check-markers.sh <scratch>/fm-test
check-markers: clean (<scratch>/fm-test)
EXIT=0
```

Then ran the pre-update script (`git show main:.harness/lib/check-markers.sh`,
extracted to a throwaway file, never committed) against the identical
fixture:

```
$ bash <scratch>/old-check-markers.sh <scratch>/fm-test
  ✗ <scratch>/fm-test/active/fake-plan.md: terminal status (Shipped/Abandoned) still under active/ — move to completed/
check-markers: 1 issue(s) found
EXIT=1
```

This directly reproduces the regression the commit message describes and
confirms the fix: old version false-positives on prose; new version
(`fm_field()` parses only between the first two `---` lines;
`is_shipped()` matches only that extracted field) does not.

**3. Directory-shaped plans found by `session-start.sh`.** Read the new
loop: it now runs `find docs/exec-plans/active -maxdepth 1 -type f -name
'*.md'` plus `find docs/exec-plans/active -mindepth 2 -type f -name
'plan.md'`, merged and sorted. Ran it live against this repo (output
above) — `2026-09-19-feat-bulk-check-uncheck-tasks` (a real
`active/<slug>/plan.md` directory in this repo) appears in the "Active
plans" listing, correctly de-suffixed to the slug name (not literally
`plan.md`), with its `status:`/`next:` fields read correctly.

**4. "Merged but not released" check.** Read the new logic in
`check-markers.sh`: for any active plan whose frontmatter status isn't
terminal/`Parked`, it extracts the sha from the **last** `Gate: APPROVED
... @<sha>` line in the body, and flags if that sha both resolves
(`git cat-file -e`) and is an ancestor of the default branch
(`git merge-base --is-ancestor`). Verified against this repo's own
`docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md`:

- `grep -n "Gate:" ...` shows its last `Gate: APPROVED` line is
  `Gate: APPROVED r2 @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c-staged —
  adversary` (line 667) — the regex's `[0-9a-f]{7,40}` correctly stops at
  the `-` in `-staged`, extracting the bare 40-char sha.
- `git merge-base --is-ancestor 3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c
  main` exits 0 — confirmed ancestor of `main`.
- The live run above shows the check firing exactly as predicted:
  `approved work @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c is already in
  'main' but plan not Shipped — run /release`.

This is the disclosed, non-blocking false positive the commit message
describes: this plan is a multi-piece umbrella doc where one piece's
gate-and-merge (piece 4, `3eb4e6e8`) landed while the umbrella document
itself is intentionally still `Draft` pending the remaining pieces — not
a case where `/release` was actually skipped for the whole plan. Confirmed
non-blocking: `session-start.sh` reports this via `check-markers.sh` for
visibility only (its own exit code is always 0 per the hook's `|| true`
wrapping), and nothing in the diff makes this check gate anything.

### `security-brief.md` — read in full, not just the diff

Frontmatter: `tools: Read, Grep, Glob, Edit` — matches. Body (line 38-40):
"you have no Bash and no Write, and your only use of Edit is to append the
verdict line below into the plan doc; nothing else in the tree changes."
No contradiction found anywhere else in the file — the "What you review"
and "Verdict and the fix loop" sections describe read-only analysis and a
single verdict-line write, consistent throughout. (The stash-redundancy
claim in the commit message is, as flagged in the brief, unverifiable
after the fact since the stash is gone — not independently confirmed here,
but the resulting file content is internally sound on its own terms.)

### Supply-chain sanity sweep

Read all 6 changed files in full (not just diff hunks). Grepped each for
`curl|wget|http://|https://|eval|base64|token|secret|api[_-]?key|password|
nc |ncat|/dev/tcp|ssh|exec\(`: the only hits are in `security-brief.md`'s
own prose describing threat classes to look for (e.g. "`curl | bash`
trust", "Secrets. Committed credentials...") — expected content for a
security brief, not live code. No `eval`, no unexpected network calls, no
obfuscation, no credentials, nothing unrelated to marker-checking /
session hooks / agent briefs in any of the 6 files.

### Tree hygiene

`git status --porcelain -uall` was clean (no output) both before and after
this review. All scratch work (a throwaway `fm-test` fixture directory and
a throwaway copy of the pre-update `check-markers.sh`) was created under
the session scratchpad outside the repo and deleted after use — confirmed
via a final `git status --porcelain -uall` showing zero lines, i.e.
byte-identical to the starting tree apart from this doc itself.

### Findings

None. All four claimed fixes verified by direct construction/execution,
not by trusting the commit message. Scope is exactly the 6 files claimed.
No supply-chain concerns found in a full read of all 6 files. The one new
check-markers.sh flag this update introduces on this repo's tree (the
`roadmap-resilience-emoji-bulk.md` "merged but not released" flag) is
correctly disclosed in the commit message as expected and non-blocking,
and independently confirmed here to be a true structural side-effect of
the umbrella doc's multi-piece gating history, not a bug.

## Verdict

Gate: APPROVED r1 @0def07763b9a92a92e7a77026d42d6bfe1fb95ea — adversary
