# 2026-03-15 — README refresh, flaky E2E fix, Node 24 CI update

## Goal

Three independent improvements in a single branch:

1. **Fix flaky E2E test** — `@smoke offline title edit survives reload and syncs once after reconnect` fails consistently in CI due to a service worker registration race after `page.reload()`.
2. **Update GitHub Actions to Node.js 24** — CI warns that `actions/checkout@v4`, `actions/cache@v4`, and `actions/setup-node@v4` run on Node 20 (deprecated; Node 24 forced default June 2, 2026).
3. **README refresh** — Simplify language and structure so non-technical users can understand what TaskSync is and how to self-host it.

## Non-goals

- Rewriting the service worker itself (only fixing the test harness race).
- Changing any application behavior.
- Adding new CI jobs or changing test coverage scope.

## Constraints

- Pre-commit and pre-push hooks must pass.
- No `--no-verify`.
- Offline-first and sync determinism are untouched.

## Current state

### E2E flaky test
- `ensureServiceWorkerControlsPage` (offline.spec.ts:55–106) polls for `navigator.serviceWorker.controller` with a 20s timeout.
- After `page.reload()`, the SW's `activate` event (which calls `clients.claim()`) may not have fired yet, so `controller` is null.
- The test at line 594 calls `ensureServiceWorkerControlsPage` with `allowUnregistered: true`, meaning if the SW never registers it skips the reload portion. But in CI the SW *does* register — it just hasn't claimed the page yet when the poll checks.
- Root cause: the poll on lines 90–102 checks `!!registration?.active && !!navigator.serviceWorker?.controller` but doesn't wait for the `controllerchange` event, so it can timeout in slow CI environments.

### GitHub Actions
- `ci.yml` uses `actions/checkout@v4`, `actions/cache@v4`, `actions/setup-node@v4` — all running Node 20.
- `pr-body-check.yml` uses `actions/checkout@v4` (implicitly, via `actions/github-script@v7`).
- Need to check if `@v5` releases exist; if not, use the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var approach.

### README
- Current README is functional but assumes comfort with Docker, Rust, and SvelteKit.
- Images exist in `assets/images/` (icon, desktop screenshot, iPhone screenshot).
- Language could be simpler; setup steps could have more context for first-timers.

## Proposed approach

### 1. Fix flaky E2E test

In `ensureServiceWorkerControlsPage`, replace the second poll (lines 90–102) with a `controllerchange` event listener pattern:

- If `navigator.serviceWorker.controller` is already set, return immediately.
- Otherwise, wait for the `controllerchange` event with a timeout, rather than polling `controller` in a loop.
- This is deterministic because `clients.claim()` in the SW's activate handler fires `controllerchange` on the page.

### 2. Update GitHub Actions to Node 24

- Check for `@v5` releases of `actions/checkout`, `actions/cache`, `actions/setup-node`.
- If available, bump to `@v5`. If not, add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` as a top-level `env` in `ci.yml` and `pr-body-check.yml`.
- Also check `docker/setup-buildx-action`, `docker/login-action`, `docker/build-push-action`, `dtolnay/rust-toolchain`.

### 3. README refresh

- Rewrite intro section with plainer language (what it is, who it's for, what it looks like).
- Simplify self-hosting steps: number them clearly, add context about what each command does.
- Add a "What you'll need" prerequisites box before setup.
- Keep Local Dev section but soften language for newcomers.
- Preserve all existing information; just restructure for clarity.

## Alternatives considered

- **E2E**: Skip the test entirely with `test.fixme()` — rejected because it's a `@smoke` gate and covers a real offline flow.
- **E2E**: Increase timeout to 60s — rejected because it masks the race rather than fixing it.
- **Node 24**: Pin action SHAs — rejected because it's harder to maintain than version tags.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| `controllerchange` event never fires in some browser | Keep the timeout; fall back to `test.skip()` via existing `allowUnregistered` pattern |
| `@v5` actions have breaking changes | Review changelogs before bumping; test in this branch's CI run |
| README changes lose technical accuracy | Keep all existing info; only restructure and simplify language |

## Acceptance criteria

1. `@smoke offline title edit survives reload and syncs once after reconnect` passes reliably in CI (no timeout on SW controller).
2. CI workflow runs without Node 20 deprecation warnings.
3. README is understandable by someone unfamiliar with Rust/SvelteKit — clearer structure, simpler language, same information.
4. All quality gates pass (pre-commit, pre-push).

## Test plan

- Run `npm run test:e2e:smoke` locally to verify the E2E fix.
- Push the branch and verify CI passes without Node 20 warnings.
- Read the README as a non-technical user — does it make sense without prior context?

## Rollout / migration plan

Single PR to `main`. No data model or sync changes. No migration needed.

## Progress log

- 2026-03-15: Plan created. Branch `chore/readme-e2e-node24` created from `main`.
- 2026-03-15: All three goals implemented. E2E fix: replaced poll loop with `controllerchange` event listener. CI: bumped checkout v4→v5, cache v4→v5, setup-node v4→v5, github-script v7→v8. README: full rewrite for accessibility. All quality gates pass (lint, check, 246 unit tests, fmt, clippy).

## Decision log

- 2026-03-15: Chose `controllerchange` event listener over increased timeout for E2E fix — deterministic vs. hoping the timeout is long enough.
