---
plan: chore-ci-trace-uploads-and-ptr-race-fix
harness: v2 · lean
anchor: outcome
status: Draft
gate: pending
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
