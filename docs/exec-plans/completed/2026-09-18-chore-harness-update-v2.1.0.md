---
plan: chore-harness-update-v2.1.0
harness: v2 · lean
anchor: outcome
status: Shipped v2.1.0
gate: APPROVED r1 @70c0d2525e3290cad633557fa9f6fdb73d06a86e — adversary
---

# chore: update handoff-harness to v2.1.0

## What this is

Vendored-tool update. `chore/harness-update-v2.1.0` runs the upstream
`dtammam/handoff-harness` project's own official updater
(`curl ... install.sh -- --update`) to move the local harness tooling from an
untagged dev snapshot (`dev@513c256`) to its first tagged release
(`v2.1.0@06cbf16`). No plan/acceptance doc exists because this is not a
feature — this doc is both the record and the review, per the slim gate for
`harness-and-config` (`.harness/scrutiny.toml`: seats = [adversary] only).

Files touched (base `1b4889f8c5f58519990475892ac48d9643dbfd36` → HEAD
`70c0d2525e3290cad633557fa9f6fdb73d06a86e`):

```
.claude/commands/gate.md
.claude/commands/release.md
.claude/commands/start.md
.claude/commands/status.md
.claude/hooks/session-start.sh
.harness/flow.md
.harness/harness.toml
.harness/lib/check-markers.sh
.harness/lib/gate-protocol.md
.harness/lib/harness-markers.md
```

Net change: plans become directories (`plan.md` + `research/*.md` +
`design.md` siblings) instead of a single flat file, a `next:` one-line
resume marker is added to the status block, a Phase 1.5 (research) step is
documented, gating requires a real commit first (`<sha>` = `HEAD`, never a
staged-but-uncommitted diff), and `check-markers.sh`'s staleness check widens
from "has this one file changed since `@sha`" to "has any non-plan-dir file
in the tree changed since `@sha`" (explicitly excluding the plans directory
so a plan's own bookkeeping never self-invalidates its approval).

## Review

### Diff coherence
Read every changed file's diff in full (`.claude/commands/{gate,release,
start,status}.md`, `.claude/hooks/session-start.sh`, `.harness/flow.md`,
`.harness/harness.toml`, `.harness/lib/check-markers.sh`,
`.harness/lib/gate-protocol.md`, `.harness/lib/harness-markers.md`). All ten
read as a single coherent, internally-consistent documentation/tooling
rework (directory-shaped plans, `next:` marker, commit-before-gate
precondition, widened staleness check) with no unexplained or suspicious
content. `grep` across the whole diff for `curl|wget|http://|eval|base64|
token|secret|api[_-]?key|password` turned up nothing but an innocuous
in-prose reference to `git diff --name-only`. `harness.toml`'s version/commit
bump (`dev@513c256` → `v2.1.0@06cbf16`, `installed` date unchanged) is the
only non-doc-prose change and matches the commit message and PR framing
exactly.

### `.harness/manifest.lock` / scope check
`manifest.lock` (which enumerates every file the installer manages as
`whole`/`region`/`once`) is itself unchanged by this diff, and none of the
other installer-managed files it lists (`.claude/agents/{adversary,qa,
security-brief}.md`, `.claude/commands/seed.md`, `.claude/settings.json`,
`AGENTS.md`, `CLAUDE.md`, `docs/{ARCHITECTURE,CONTRIBUTING,RELIABILITY}.md`,
`.harness/scrutiny.toml`, `.harness/lib/{apply-regions.sh,regions.md}`) show
any diff between base and HEAD — confirmed via `git diff <base> HEAD --
<each path>` returning empty. The update touched exactly the ten files that
actually changed upstream between the dev snapshot and v2.1.0, nothing more.

### `check-markers.sh` — read for injection/eval risk
Read the full script (not just the diff). No `eval`, no unquoted expansions
of anything attacker-influenced: `"$file"`, `"$line"`, `"$sha"`,
`"$PLANS_DIR"` are quoted everywhere they're used, and `$sha` is only ever
the substring matched by `grep -oE '@[0-9a-f]{7,40}'` (hex digits only)
before being interpolated into `git cat-file -e "${sha}^{commit}"` — no
command-injection surface. No new Bash/Write capability is granted to
anything untrusted; the script is read-only over the repo except for its own
stdout/exit code.

### Ran it — verbatim output against this repo's `docs/exec-plans/`
```
$ bash .harness/lib/check-markers.sh
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @f8a429badb6f9ddd1a039f58d7fdba3d311c7578 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @54dfde5fbde9c510ece96e89033e12572c69d533 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @039a87fc283667e92820221e425e0c4258a5de6 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md: stale approval @3eb4e6e82403bb1dee7c875b34f4c88e3097ad1c — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @ad3c0357 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @10e7161 — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — reviewed code changed since; re-gate
  ✗ docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md: stale approval @ad3c0357fcbde3c2aa05aa99b8754b6e9c8084be — reviewed code changed since; re-gate
check-markers: 10 issue(s) found
EXIT=1
```
Verified this is **not** a regression from this diff: I extracted the
pre-update script (`git show 1b4889f8...:.harness/lib/check-markers.sh`) and
ran it against the same tree, unmodified. It reported **22** issues — the
same 10 above, *plus* 12 spurious flags against
`docs/exec-plans/completed/2026-09-18-feat-task-emoji.md`, whose own
already-shipped bookkeeping (status/marker edits after approval) was
tripping the old per-file diff as a false "stale approval." The new
whole-tree-diff-excluding-`docs/exec-plans` logic fixes exactly that false
positive (a plan's own bookkeeping no longer self-invalidates its
approval) without introducing new false positives — the remaining 10 are
genuine pre-existing drift (real non-plan commits landed after those gate
shas) present under both old and new logic. Net: this diff makes
`check-markers.sh` strictly more correct for this repo's actual state, not
less. (I also confirmed with a git stash/pop round-trip that these 10 flags
are not an artifact of the pre-existing dirty `security-brief.md` working
file — they persist identically with a fully clean tree — so they are a
separate, pre-existing housekeeping item: the `feat-tag-palette-settings`
and `roadmap-resilience-emoji-bulk` plans should be re-gated or moved to
`completed/` on their own time, unrelated to this PR.)

Mutation-tested the four flag conditions in an isolated scratch dir
(`.adversary-scratch-mtest/`, created and deleted inside this repo so the
`git diff` exclude-pathspec resolves correctly, never committed): terminal
`status: Shipped` under `active/` flags; an unknown `@sha` flags; a real but
stale `@sha` flags; a sha-less `status: Approved` flags; a `Gate: CHANGES`
line with no sha does **not** flag (history, correctly ignored); and an
approval at the exact current `HEAD` sha with a clean tree correctly does
**not** flag. All four documented detections bind; no false negative found.
(Noted in passing, not a finding against this diff: passing an *absolute
path outside the repo* as `$1` makes the `:(exclude)$PLANS_DIR` pathspec
fatally invalid, and because the script only checks `$?` via `!` with
stderr suppressed, that fatal error is silently read as "diff found" and
would falsely flag every marker. This is unreachable from any actual call
site in this repo — `session-start.sh` and this review both invoke the
script with the in-repo default `docs/exec-plans` — so it is a
robustness/hardening suggestion, not a live bug here.)

### Findings

**WARNING — `.claude/hooks/session-start.sh` regression, verified.**
The base version filtered `README.md` out of the "Active plans" listing:
```bash
plans=()
for f in docs/exec-plans/active/*.md; do
  [ "$(basename "$f")" = "README.md" ] && continue
  plans+=("$f")
done
```
The new version collapses this to a bare glob:
```bash
plans=(docs/exec-plans/active/*.md)
```
`docs/exec-plans/active/README.md` exists in this repo (it is the
directory's own explanatory readme, no `status:` marker). Verified directly
(inlined the new loop logic rather than the full hook, since the sandbox's
auto-mode classifier blocked direct execution of the hook script itself as
"code from external"):
```
$ shopt -s nullglob; plans=(docs/exec-plans/active/*.md); echo "${#plans[@]}"
4
docs/exec-plans/active/2026-09-16-roadmap-resilience-emoji-bulk.md
docs/exec-plans/active/2026-09-17-fix-add-task-details-reload.md
docs/exec-plans/active/2026-09-18-feat-tag-palette-settings.md
docs/exec-plans/active/README.md
```
Every future `SessionStart` will now print `README.md: no status marker` in
the "Active plans" block — cosmetic noise, not a crash and not a false gate
signal (`check-markers.sh` globs the same directory but only flags lines
matching specific marker regexes, and `README.md` has none, so it does not
itself get falsely flagged there). Confirmed this is upstream's own
regression — introduced within `06cbf16`/v2.1.0 itself, not something this
repo's use pulled in accidentally — by diffing this file and finding no
other repo-local hand-edits nearby. Severity: does not block merge (no data
loss, no security exposure, no broken gate protocol); recommend filing
upstream and/or restoring the two-line skip locally the next time
`.claude/hooks/session-start.sh` needs a repo-local touch, since it's
listed `whole` in `manifest.lock` and a local patch would be silently
overwritten by the next `--update` run regardless.

### Confirmed out of scope, as instructed
- `.claude/agents/security-brief.md`'s working-tree diff (`tools: ... Edit`
  addition, scoped-Edit clarification in its Phase-4-brief section) is
  **not** part of this commit — `git diff <base> HEAD -- .claude/agents/
  security-brief.md` is empty; the file only shows as modified in
  `git status` (working tree vs HEAD), matching the pre-existing,
  deliberately-uncommitted local fix from earlier this session. Confirmed
  it is untouched by `70c0d25`.
- No file under `web/` or `server/` appears anywhere in
  `git diff <base> HEAD --name-only` — the full 10-file list is reproduced
  above; nothing else is present.
- `cargo test` (server/): **101 passed; 0 failed.**
- `npx vitest run` (web/): **28 test files, 408 tests passed; 0 failed.**
  (Two expected `console.error`/stderr lines inside passing
  `sync.test.ts` error-path assertions — not failures.)
  Both runs are a sanity check only, confirming the tooling-only diff (as
  expected) left application behavior untouched.
- No secrets, tokens, URLs, or unrelated content found anywhere in the diff.

### Tree hygiene
All mutation/scratch work (`.adversary-scratch-mtest/`, a `git stash push -u
-- .claude/agents/security-brief.md` / `stash pop` round-trip done twice to
isolate the pre-existing dirty file from `check-markers.sh` behavior, and a
throwaway copy of the pre-update script under the session scratchpad
outside the repo) was created and removed/restored during this review.
Final `git status --porcelain -uall` shows exactly one line,
`M .claude/agents/security-brief.md` — the same pre-existing, out-of-scope
local edit noted above and present before this review began. No other
tracked or untracked file differs from the state at the start of this
review.

## Verdict

Gate: APPROVED r1 @70c0d2525e3290cad633557fa9f6fdb73d06a86e — adversary
