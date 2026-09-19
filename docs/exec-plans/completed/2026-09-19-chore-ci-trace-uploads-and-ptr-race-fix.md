---
plan: chore-ci-trace-uploads-and-ptr-race-fix
harness: v2 · lean
anchor: outcome
status: Shipped PR#146
gate: APPROVED r1 @ccf77bc — adversary, qa
---

# CI pairing session: trace uploads + a real root cause found and fixed

## Request

Owner-directed live pairing session on the CI E2E flakiness pattern
(tech-debt #050) that had cost repeated manual re-triggers across PRs
#140-#145 this session, mostly `pull-to-refresh.spec.ts` on webkit and
`offline.spec.ts` on chromium.

## What we found

1. **No CI artifact upload, at all.** Playwright generates a `trace.zip` +
   `error-context.md` per failure (visible in the CI log's own "attachment"
   lines), but the workflow never runs `actions/upload-artifact` -- every one
   of the failures this session was genuinely unrecoverable after the job
   ended. We were re-running blind, reading only the terminal log text, never
   the trace.
2. **A real, mechanical race, not generic slowness**, in
   `pull-to-refresh.spec.ts`'s wheel-gesture test. Read directly from a
   failure's own logged Playwright "Call log" (not inferred): the observed
   opacity sequence was `0.495999 -> 0.000003 -> 0` -- a *completed* fade-out,
   not a stuck mid-transition. Traced the mechanism in
   `PullToRefresh.svelte`: `handleWheel` resets a real, hardcoded 150ms
   debounce timer on every wheel event; once it elapses with no new event, it
   starts the fade-out. The test fired 5 wheel events, then ran two
   `expect()` assertions (each a round-trip to the browser) *before* checking
   `opacity === '1'`. On a slower CI runner -- and WebKit's Playwright
   automation channel has measurably higher per-command latency than
   Chromium's/Firefox's -- that overhead alone was sometimes enough to let
   the 150ms debounce fire before the opacity assertion ever ran. This
   explains every symptom observed this session: browser-specific (WebKit
   loses the race, others usually don't), intermittent (depends on runner
   load at that moment), and the repeated "fails twice, passes on the third
   identical attempt" pattern (no code changed between attempts -- purely a
   timing coin-flip on a shared runner).
3. Retries-as-safety-net and switching the E2E `webServer` from `npm run dev`
   to a built `vite preview` were both raised and explicitly deferred by the
   owner for now -- not implemented in this piece.

## Fix

- `.github/workflows/ci.yml`: `actions/upload-artifact` (`if: failure()`,
  7-day retention) added after both Playwright run steps (`web`'s push-only
  smoke gate, and `web-e2e-matrix`'s per-browser full suite), uploading
  `web/test-results` (traces, screenshots, error-context) so the next real
  failure is inspectable instead of blind.
- `web/tests/e2e/pull-to-refresh.spec.ts`: reordered the wheel-gesture test
  so the debounce-sensitive `opacity === '1'` assertion runs immediately
  after the wheel-event loop, before the two `.ptr-content` translateY
  checks -- minimizing the real wall-clock overhead competing against the
  app's own 150ms timer. No production code changed; this is a test-timing
  fix, not a UX behavior change.

## Acceptance

- [x] CI workflow uploads `test-results/` as a named, retained artifact on
  failure for both the push smoke gate and the PR browser matrix.
- [x] `pull-to-refresh.spec.ts`'s wheel-gesture test passes locally
  (chromium) with the reordered assertions; no other test in the file
  regressed.
- [x] Root cause is traced directly from the CI log's own Call-log opacity
  sequence, not inferred from "CI is generally slow."

## Gate

**Adversary review (r1 @ccf77bc)**

Verified by measurement:
- `PullToRefresh.svelte` debounce claim confirmed at source: `handleWheel`
  clears and resets `wheelEndTimer` on every call while tracking
  (`clearTimeout` + `setTimeout(..., 150)`, lines 426-443) — 150ms figure and
  "resets on every wheel event" are accurate, not just trusted from the plan.
- Diff in `pull-to-refresh.spec.ts` confirmed as a pure reorder: same three
  `expect()` calls, no assertion added/dropped/changed, only comments added
  and the opacity check moved earlier.
- Ran the full spec file 5x on chromium (15/15 tests green) and, after
  installing missing WebKit system deps (`sudo playwright install-deps
  webkit`) to get a real WebKit binary in this sandbox, 5x on webkit
  (10/10 non-skipped tests green; the touch-gesture test's 1 `skipped` per
  run is pre-existing, guarded by `browserName !== 'chromium'`, unrelated to
  this diff). No regression from the reorder.
- Mutation test: reverted `pull-to-refresh.spec.ts` to the pre-fix (old)
  assertion order via `git show <base>:... > file` (not `git checkout`, to
  avoid an irreversible-destruction block) and ran the wheel-gesture test
  8x on webkit — it passed all 8 times. This mutant does not go red locally,
  which is *consistent* with the plan's own claim that the race "never
  reproduces locally when explicitly checked," but it also means I could not
  empirically prove the fix changes CI outcome from this sandbox — only that
  it introduces no regression. Restored the file byte-identical afterward
  (diffed against backup before restoring).
- CI YAML: valid (`yaml.safe_load` parses cleanly; `actionlint` unavailable,
  no network access to fetch it, so relied on manual trace + PyYAML parse).
  Traced the conditional logic directly:
  - `web` job's upload step: `if: failure() && github.event_name == 'push'`
    — correctly conjoined, so it will NOT fire if e.g. `npm run lint` fails
    on a PR-triggered run of this same job (the concern named in the brief).
    This is a real, correct fix of exactly that scoping hazard, not an
    oversight.
  - `web-e2e-matrix` job is already gated at the job level to
    `pull_request`-only, so its step's bare `if: failure()` needs no
    additional scoping — no bug there.
  - Artifact names: `playwright-report-smoke`,
    `playwright-report-${{ matrix.browser }}` → 4 distinct names
    (smoke/chromium/firefox/webkit), confirmed no collision.
  - `path: web/test-results` confirmed correct two ways: `playwright.config.ts`
    sets no explicit `outputDir` (default is `<config-dir>/test-results` =
    `web/test-results`), and empirically — running Playwright locally
    populated exactly `web/test-results/` (cleaned up after, gitignored).
  - `retention-days: 7`: no issue found.
- Root-cause narrative: the debounce mechanism is real and mechanically
  sufficient to explain a completed-fade-out failure. One caveat/suspicion
  (not blocking): the plan's smoking-gun evidence — the quoted Call-log
  opacity sequence `0.495999 -> 0.000003 -> 0` from a past failure — is not
  independently verifiable from this repo; no CI run URL or archived
  trace/log is linked, and by the plan's own admission no trace upload
  existed before this fix, so that historical evidence is gone. This doesn't
  undermine the change itself: the reorder is a strict improvement (real
  race window narrowed, zero downside, verified non-regressive across 30+
  local runs spanning chromium/webkit x old/new order), so even if that one
  quote is imprecise, the fix is sound on its own mechanical merits.

No CRITICAL or WARNING findings. Diff is test-timing + CI-metadata only, no
production code touched, matches the plan's (appropriately modest) acceptance
criteria.

Gate: APPROVED r1 @ccf77bc — adversary

**QA review (r1 @ccf77bc)**

Independently re-derived, not taken on trust from the plan or the Adversary section above:

- **Diff scope**: `git diff ef0e39c..ccf77bc --stat` touches exactly
  `.github/workflows/ci.yml`, `web/tests/e2e/pull-to-refresh.spec.ts`, and
  this plan doc. `server/` has a zero-line diff (confirmed via `git diff
  --name-only -- server/`) — `cargo test`/`clippy`/`fmt` correctly not run.
- **Reorder fidelity**: read the commit-object diff line by line. All three
  original `expect()` assertions (`opacity === '1'`, `translateY(...)`
  present, `translateY(0px)` absent) survive, only reordered; the final
  `opacity === '0'` settle-check is untouched. Nothing dropped, weakened,
  or duplicated.
- **Mechanism claim vs. source**: read `PullToRefresh.svelte` directly.
  `handleWheel`'s end-detection timer (lines 425-443) really is a
  `clearTimeout`+`setTimeout(..., 150)` that resets on every wheel event,
  and both `indicatorOpacity` (line 108, `$: indicatorOpacity = isRefreshing
  ? 1 : Math.min(pullDistance / threshold, 1)`) and `contentTranslateY`
  (lines 98-102) are Svelte reactive statements driven directly off
  `pullDistance`, which the debounce callback zeroes on fire. `.ptr-indicator`
  also carries `transition: opacity 0.3s ease` (line 615), so a
  `toHaveCSS('opacity', ...)` read that lands mid-fade genuinely can observe
  an intermediate value like the plan's quoted `0.495999` before settling at
  `0` — the new comment's description of the mechanism matches the code, not
  just plausible-sounding prose.
- **Instruments, verbatim**: `npm run lint` (web/) — clean, no output.
  `npm run check` (web/) — `svelte-check found 0 errors and 0 warnings`.
  `npx vitest run` (web/) — `Test Files 28 passed (28)`, `Tests 409 passed
  (409)`.
- **Playwright, chromium, bracketed by checksum**: partway through this
  review, `git status` unexpectedly showed
  `web/tests/e2e/pull-to-refresh.spec.ts` as modified, reverted in the
  working tree to the exact pre-fix assertion order, unstaged. `ps aux`
  traced this to a concurrent, live process running the Adversary seat's own
  webkit mutation-testing pass (`git show <base>:... > file`-style revert,
  documented in the Adversary section above) against the same shared
  checkout — not a defect in this diff, and it self-restored byte-identical
  (confirmed via `md5sum` vs. `git show HEAD:...`) once that pass finished.
  Flagging plainly rather than smoothing over: this harness's shared,
  persistent-tmux working tree means two review seats running concurrently
  against the same path can transiently observe each other's mutation-test
  state. I re-ran all Playwright verification only after bracketing each run
  with a checksum-vs-`git show HEAD:...` check (before and after) to
  guarantee a clean, HEAD-matching tree for every reported result below.
  - `pull-to-refresh --project=chromium --workers=1 --retries=0`, 5 runs:
    3/3 tests green every time (15/15 total), checksum matched HEAD before
    and after every run.
  - `--project=chromium --grep @smoke` (the actual push smoke-gate command),
    run 3 times: 24/24, 23/24 (one failure in `offline.spec.ts:588`, a file
    untouched by this diff and explicitly named in the plan's own "What we
    found" as one of the two flaky specs from this session, separate from
    the PTR fix and out of scope here), 24/24. The PTR file's 3 tests passed
    in all 3 runs (9/9); re-running the offline test alone confirmed it as a
    pre-existing, independent flake, not a regression from this diff.
- **CI YAML**: `actions/upload-artifact@v4` is a real, currently-functioning
  tag (confirmed via the GitHub API — `v4` resolves to `v4.6.2`; note the
  action's overall latest major is now `v7`, so `v4` is real but a few majors
  behind — a SUGGESTION to bump opportunistically, not a defect: v4 is fully
  supported and not the deprecated `v3`). `path: web/test-results` is
  correct and consistent with this file's own convention: `uses:` steps'
  `with.path`/`with.cache-dependency-path` inputs resolve relative to
  `GITHUB_WORKSPACE` (repo root), not affected by
  `defaults.run.working-directory: web` (which only applies to `run:` shell
  steps) — exactly why the existing `actions/cache` steps in this same file
  already write `web/node_modules` / `web/package-lock.json` rather than
  bare `node_modules`. `playwright.config.ts` sets no `outputDir` override,
  so Playwright's default (`<config-dir>/test-results`) resolves to
  `web/test-results` from repo root, matching. No `permissions:` gap:
  `actions/upload-artifact@v4` needs no `GITHUB_TOKEN` scope beyond this
  workflow's existing `contents: read`. One point the Adversary section
  didn't cover: this repo is public
  (confirmed via the GitHub API, `"private": false`), so the uploaded
  artifacts are downloadable by any GitHub-authenticated user for the
  7-day retention window — checked `tests/e2e/helpers/auth.ts` and confirmed
  the only credential-shaped value the E2E suite ever seeds is a synthetic,
  hardcoded `'test-token'` with a fake `admin@example.com` user, so there is
  no real-secret exposure risk here; noting for awareness, not blocking.
- **Standards**: no `docs/CONTRIBUTING.md` violation found. Commit message
  follows the repo's `fix:`/topic-branch convention; the new test comments
  explain *why* (the race mechanism), consistent with "reserve comments for
  why."

No CRITICAL or WARNING findings from this pass. Concur with the Adversary's
verdict.

Gate: APPROVED r1 @ccf77bc — qa
