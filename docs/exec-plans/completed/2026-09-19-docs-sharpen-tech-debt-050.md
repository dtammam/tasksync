---
plan: docs-sharpen-tech-debt-050
harness: v2 · lean
anchor: docs-and-content (slim gate, adversary only)
status: Changes requested
gate: CHANGES r1 @6855878814a85105a7b3258407a296b489d33b53 — adversary
---

# docs: sharpen tech-debt #050 with real trace evidence, close the PTR half

## What this is

Docs-only tracker bookkeeping update to `docs/exec-plans/tech-debt-tracker.md`
on `docs/sharpen-tech-debt-050` (base `ef0e39c4708c94caff7f237bb2fb3d8305b4f49`,
HEAD `6855878814a85105a7b3258407a296b489d33b53`). No plan/acceptance doc exists
for this — per `docs-and-content` in the scrutiny table, this file is both the
record and the review. The diff does two things: (1) adds a new `051` row to
the "Closed" table closing the WebKit PTR wheel-gesture flake against PR #146,
and (2) rewrites the "Active" `050` row to reattribute the remaining flake to
a specific `offline.spec.ts` assertion (`task-row` count immediately after
`app-shell` reports `data-ready="true"`), citing a real trace artifact from
PR #146's firefox job as first-time hard evidence.

`git diff --name-only ef0e39c..6855878` confirms **only**
`docs/exec-plans/tech-debt-tracker.md` is touched. The pre-existing working-tree
modification to `.claude/agents/security-brief.md` (present in `git status` at
the start of this review, per the conversation's initial git-status snapshot)
is not part of this commit and was left untouched throughout this review.

## Review

### Firefox trace evidence (PR #146, run 35418732440, job 105832277078)
Downloaded the actual `playwright-report-firefox` artifact via the GitHub API
(artifact id `10577135634`, attempt 1 of the run — the job's own direct-fetch
`conclusion` is `failure`; the run's *current* summary shows attempt 2/success
because it was retried, which is why job listing without `/attempts/1` looked
clean at first — resolved by fetching the job by id directly).

Unzipped and read both `error-context.md` files directly: both show the same
genuine empty-state DOM — `"Nothing scheduled. Add a task to My Day."`,
`"No completed tasks yet."`, and every sidebar list link at count `"0"`. This
matches the row's claim exactly; it is not a stuck/loading state.

Parsed both `trace.zip`s' raw `0-trace.trace` JSONL event streams (not just
the summary) directly: for both failing tests the action sequence is
`goto → expect(app-shell, data-ready=true) [succeeds] → route.fulfill(...) →
expect(task-row count) [fails, "Expect failed"]`. No `setOffline`, no
`task-toggle` click, no reload, no visibilitychange dispatch appears anywhere
in either trace before the failure — confirming the row's claim that the
failure is at the test's *first* post-load assertion and has nothing to do
with the reconnect/resync logic later in the same tests. The `sync/pull`
`fulfill` body in both traces does contain the seeded task, confirming the
row's specific theory (data pulled, not yet rendered) rather than a server-side
gap.

Cross-checked `expect.params.selector` for both failing traces:
`internal:testid=[data-testid="task-row"] >> has-text="Offline title edit
nj38lu"` and `...has-text="Offline complete 9ldmzq"` — these map to the
`@smoke offline title edit...` test (line 604) and `offline complete
survives reload...` test (line 547) respectively in
`web/tests/e2e/offline.spec.ts`, exactly the lines named in the review brief,
and exactly the `getByTestId('task-row').filter(...).toHaveCount(1)` line
immediately following `page.goto('/')` and the `data-ready` check — not a
later, reload- or reconnect-adjacent assertion in either test. This part of
the row is accurate and independently verified against the primary artifact.

### CRITICAL — the row misattributes the historical chromium (PR #141) evidence to the same mechanism, and this is checkable and wrong

The new `050` text reads: *"`tests/e2e/offline.spec.ts`'s task-visible-after-
load assertion (`getByTestId('task-row')...toHaveCount(1)`, run immediately
after `app-shell` reports `data-ready="true"`) fails intermittently under CI
load — **chromium originally (PR #141, 3/4 runs)**, now also confirmed on
firefox..."* — i.e. it claims the original chromium flakiness *was this same
assertion/mechanism*, just without a trace to prove it at the time.

I fetched PR #141's actual CI run history via the GitHub API (`branch=
feat/task-emoji`) and found the "3 failures in 4 runs" run: `35381133174`
(sha `54b145ec9e7a80173824195b0b007e698aed775f`, `run_attempt: 4`). Downloaded
the raw job logs for all three failed chromium attempts
(`105717287432`, `105718403678`, `105719852309`) via
`GET /repos/.../actions/jobs/{id}/logs`. All three show the **same** failure,
and it is **not** the task-row assertion:

```
Error: expect(locator).toHaveAttribute(expected) failed
Timeout: 10000ms
Error: element(s) not found
> 637 | 	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
  638 | 	await expect(page.getByTestId('task-row').filter({ hasText: editedTitle })).toHaveCount(1);
```
(third attempt: same pattern at line 706, in the sibling "offline list edit" test)

Read `web/tests/e2e/offline.spec.ts` at those exact lines: line 637/706 is the
`data-ready` check **after `page.reload()`** (mid-test, post-reload), not the
initial-load check. The failure is the `toHaveAttribute` call itself timing
out — `data-ready` **never reaches `"true"`** within 10s after reload — so
the test aborts there and the `task-row` line on 638/707 never even executes.
This is the exact same characterization the *previous* (now-deleted) row text
gave: *"always `getByTestId('app-shell')` missing `data-ready="true"`... after
an offline reload"*.

So the new row's framing — that chromium's PR #141 flakiness and firefox's
PR #146 flakiness are "the same assertion" failing under CI load, now finally
proven by a trace — is not supported by the primary evidence for the chromium
half. They are two different assertions (`toHaveAttribute` vs `toHaveCount`),
two different trigger points (post-`reload()` vs post-initial-`goto()`), and
plausibly two different bugs (a `data-ready` flag that never flips after
reload, vs one that flips before the task list finishes rendering on first
load). Conflating them under one theory and one `next action` (which only
directs the assignee to look at `data-ready`'s *initial*-load gating) risks:
the assignee "fixing" the firefox/first-load race, closing `050` as resolved,
and leaving the actual chromium/reload timeout — a plausibly more severe bug,
since `data-ready` never recovers at all rather than lagging briefly —
undiagnosed and unrepresented anywhere in the tracker.

This is a factual claim, stated with the tracker's normal declarative
confidence, that a from-scratch check of the cited primary source (GitHub's
own CI logs, still within retention) contradicts. Per the tracker's own stated
purpose (accurate technical-debt bookkeeping with "a clear next action"), this
blocks: the row needs to either (a) not claim the chromium and firefox
failures are the same assertion/mechanism — describe them as two distinct,
still-open flake signatures under `050`, each with its own next action, or
(b) present new evidence that the chromium `data-ready`-after-reload timeout
and the firefox `data-ready`-before-render race share a root cause (none is
offered in the diff or discoverable from the artifacts I could reach).

### WARNING — `051` closes against a PR that is not yet merged
`git log` shows `docs/sharpen-tech-debt-050` is **not** built on top of PR
#146's commits — `git merge-base --is-ancestor 873f970a... HEAD` returns
false; the branches share only `ef0e39c` (pre-`#146`). Checked PR #146 itself
via the API: `state: open`, `merged: false`, `merged_at: null` (its own gate
commit `873f970` — "full gate APPROVED r1" — exists, and its CI checks are
green, but it has not landed on `main`). The new `051` row states as fact,
dated `2026-09-19`: *"Root-caused and fixed... Reordered the assertions; also
added `actions/upload-artifact`..."* and links `[PR #146]` in the "Closed"
table, whose own column header is "Closed on" — i.e., asserting the fix has
landed. If this tracker commit reaches `main` before PR #146 actually merges,
the tracker will claim a fix is shipped when the corresponding code change
does not yet exist in `main`. I did independently verify PR #146's diff
content matches the `051` summary's technical claims (assertion reordering in
`pull-to-refresh.spec.ts`, the two `actions/upload-artifact` steps in
`ci.yml`), so the *content* of `051` is accurate to what's on that branch —
this is a sequencing/premature-closure risk, not a fabrication. Not blocking
if the intended merge order is "PR #146 merges first, this docs change lands
second" (plausible given its own gate is already approved), but the tracker
as currently worded doesn't hedge for that order at all. Flagging as WARNING;
safe to ship disclosed as long as PR #146 is merged before or atomically with
this change reaching `main` — the Architect should confirm that ordering
explicitly rather than let it be implicit.

### Internal consistency / formatting
- "Closed" table column order (`ID | Area | Closed on | Summary | Link`) is
  respected by the new `051` row.
- Link style is a pre-existing minor inconsistency, not introduced by this
  diff exclusively: `047` uses `[#136](...)`, the new `051` uses
  `[PR #146](...)` — cosmetic only (SUGGESTION, non-blocking).
- The rewritten `050` no longer mentions the WebKit PTR flake at all (correctly
  moved to `051`), and `051`'s content does not duplicate or contradict `050`'s
  remaining chromium/firefox claims other than the CRITICAL finding above.
- No other row in the tracker references `050`/`051` or is affected.

### Tree hygiene
All downloaded artifacts, extracted zips, and job logs were written under the
session scratchpad (`/tmp/claude-.../scratchpad/`), outside the repo. No
repo file was modified during this review except the creation of this record
itself. `git status`/`git diff` inside `/home/coder/projects/tasksync` show
only the single pre-existing, out-of-scope `M .claude/agents/security-brief.md`
line noted above (present before this review began) plus this new untracked
file — nothing else differs.

## Verdict

Gate: CHANGES r1 @6855878814a85105a7b3258407a296b489d33b53 — adversary

## r2 delta review — @5466f7b

Re-verified after the coordinator's fix (`0f7e53e`, "fix: un-conflate
tech-debt #050's two distinct app-shell flake signatures") and rebase
(`docs/sharpen-tech-debt-050` now at `5466f7b587a33148c9d9690ab4453615f80be022`,
onto `main` post-PR-#146-merge).

### CRITICAL (conflated chromium/firefox mechanism) — fixed as prescribed
Read `0f7e53e`'s diff to `docs/exec-plans/tech-debt-tracker.md` directly. The
`050` row now states two explicit, separately-labeled signatures instead of
one: **(a) chromium/PR #141** — `toHaveAttribute('data-ready','true')` itself
times out on the check immediately after `page.reload()`, lines ~637/706, 3/4
runs; **(b) firefox/PR #146** — `data-ready` flips promptly on a fresh
`page.goto('/')`, but the `task-row` count assertion fails right after because
the list hasn't rendered — with an explicit line: *"(a) and (b) may share a
root cause... but that is NOT established — treat as two open questions, not
one, until proven otherwise."* Also splits the `next action` column into
separate reload-path vs fresh-boot investigation instructions.

Re-checked this against the same primary sources from r1, not just trusting
the new prose:
- `web/tests/e2e/offline.spec.ts` is untouched by PR #146/the rebase (`git log
  -- web/tests/e2e/offline.spec.ts` shows no commit past `f709d10`, well
  before this work) — line numbers are stable. `awk 'NR==547||NR==604||
  NR==637||NR==706'` confirms 547/604 are still the initial `task-row` count
  checks and 637/706 are still the post-`reload()` `data-ready`
  `toHaveAttribute` checks, exactly as the rewritten row now describes.
- Re-read the three chromium job logs from r1 (`105717287432`,
  `105718403678`, `105719852309`) — still show `toHaveAttribute` timing out
  at 637/706, matching (a) verbatim.
- Re-read the firefox trace JSONL and `error-context.md` from r1
  (`playwright-report-firefox`, run `35418732440`) — still show `data-ready`
  succeeding then `task-row` `toHaveCount(1)` failing on a fresh `goto`,
  matching (b) verbatim, with the empty-state snapshot correctly retained in
  the prose.
- The new row no longer asserts a unified mechanism anywhere, and the
  disclaimer is unambiguous. **Fixed as prescribed — no surviving instance of
  the conflation.**

### WARNING (051 closing against an unmerged PR) — fixed as prescribed
`git merge-base --is-ancestor 8d6d566 HEAD` (PR #146's actual merge commit)
now returns true, and `git merge-base HEAD main` **is** `8d6d566` — the branch
is rebased cleanly onto `main` post-merge, not just claiming it. Re-confirmed
PR #146 itself via the GitHub API: `merged: true`. The `051` row's content
(link, summary) is unchanged from r1 and was already verified accurate to
PR #146's actual diff. **Fixed as prescribed.**

### Scope re-check
`git diff --name-only main HEAD` (new base): only
`docs/exec-plans/tech-debt-tracker.md` and this record file
(`docs/exec-plans/completed/2026-09-19-docs-sharpen-tech-debt-050.md`, added
by the coordinator's own r1-recording commit `5466f7b`, byte-identical to
what I wrote — diffed and confirmed). Nothing else changed. No new issue
introduced by the fix commit itself (single-purpose `050`-row edit only).

### Tree hygiene
No repo file modified during this delta review except this appendix. `git
status` shows only the pre-existing, out-of-scope `M .claude/agents/
security-brief.md` (unchanged since r1, still not part of any commit under
review) plus this file's own edit.

## Verdict

Gate: APPROVED r2 @5466f7b587a33148c9d9690ab4453615f80be022 — adversary
