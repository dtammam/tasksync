# Reliability & Performance

This doc defines non-negotiable reliability and performance rules and how we verify them.

## Performance budgets

Budgets (user-visible):
- Primary UI actions: under 16ms per interaction (no jank)
- Completion sound onset after check: under 20ms
- Search on 10k tasks: under 100ms

These budgets must be backed by:
- a repeatable benchmark harness
- CI checks that fail when budgets are exceeded

## Offline-first invariants

- If the server is down, the app still supports:
  - opening the app shell from local cache after a prior online load (including hard reload)
  - viewing cached tasks/lists
  - creating/editing tasks locally
  - queueing changes for later sync
- Task detail saves must persist as a single local mutation/write (not split across multiple writes) so first-save behavior remains deterministic for fields like due date, recurrence, and My Day.
- When connectivity returns:
  - queued changes replay deterministically
  - duplicates are not created
  - conflict resolution follows documented rules

## Pull-to-refresh (browser gesture interop)

- `<main>` in `+layout.svelte` sets `overscroll-behavior-y: none`. This is required to prevent the browser's native pull-to-refresh gesture from conflicting with the custom `PullToRefresh` component.
- The value is `none` (not `contain`): both `none` and `contain` suppress browser-native PTR, but `none` additionally prevents scroll chaining to parent elements — appropriate here because `<main>` is the outermost scroll container.
- Do not weaken this rule (e.g. by removing the property or changing it to `auto`) without a replacement mechanism that prevents the native gesture from racing with `PullToRefresh`'s touch handlers.

## Sync invariants (must be testable)

- Push is idempotent (re-sending the same payload does not create duplicates)
- Pull/apply is idempotent (re-applying the same snapshot does not change state)
- Deletes converge deterministically across devices via sync tombstones (a deleted task must not reappear after subsequent pulls)
- Cross-tab coordination:
  - only one tab performs periodic sync
  - other tabs observe status and do not fight for leadership

## What we measure

Minimum set:
- Web unit tests for stores + sync coordinator
- E2E smoke for core flows:
  - sign in → add task → complete → refresh → state stable
  - offline add/complete → back online → converges
- E2E offline continuity:
  - hard reload while offline still renders cached shell + local task data
- Perf checks:
  - task filter / text-search benchmark at 10k tasks: `npm run bench` (Vitest bench, `web/src/lib/stores/tasks.bench.ts`)
    - Product budget: < 100 ms; CI ceiling: < 500 ms (catastrophic-regression gate for slow runners)
    - Note: MiniSearch not yet integrated (V1); current benchmarks cover linear-scan equivalents
  - Task toggle interaction timing: `@smoke @perf` Playwright test (`web/tests/e2e/perf.spec.ts`)
    - E2E ceiling: < 200 ms (accounts for test-runner overhead; product budget is < 16 ms)

## Test framework and gate principles

Frameworks and ownership:
- Web unit/integration: Vitest (`web/src/**/*.test.ts`)
- Web E2E: Playwright (`web/tests/e2e/**/*.spec.ts`)
- Server/API + invariants: Rust `cargo test` (`server/src/**`)

Gate intent (do not remove gates):
- pre-commit: fastest correctness loop (lint, type/check, unit-level confidence)
- pre-push: deterministic smoke confidence before remote push
- pre-merge CI: full confidence matrix (cross-browser E2E + complete server checks)
- PR body gate: require a one-line human-authored `Summary` before merge (`pr-body` check)

Execution strategy:
- Keep local and CI responsibilities complementary, not duplicated.
- Pre-push E2E should prioritize deterministic smoke paths over full matrix breadth.
- Full cross-browser validation belongs in pre-merge CI where cost is acceptable.
- Current gate split:
  - local pre-push Playwright: Chromium-only `@smoke` subset (`npm run test:e2e:smoke`)
  - CI on branch push: lint/check/unit + Chromium smoke
  - CI on pull request (pre-merge): full Playwright suite across `chromium`, `firefox`, and `webkit`
- Branch protection baseline for `main`:
  - require status checks: `pr-body`, `web`, `server`, and `web-e2e-matrix` for each browser (`chromium`, `firefox`, `webkit`)
- Test selection must remain invariant-driven (offline-first, sync idempotency, role enforcement, deterministic task mutations).

Cost controls:
- Cache package and tool artifacts in CI (`npm`, Cargo, and Playwright browser cache).
- Pin and upgrade test tooling deliberately to avoid surprise dependency churn.
- Track gate runtime trends; if runtime grows, first remove duplication before reducing coverage.

Coverage controls:
- When a user-visible flow changes, add or adjust:
  - at least one low-cost test (unit or integration)
  - E2E coverage when behavior crosses modules or is regression-prone
- If an expensive test is retired, replace its confidence signal with cheaper deterministic coverage.

## Failure policy

- Regressions are fixed by:
  - adding a failing test/benchmark
  - then implementing the fix
- If a budget must be temporarily violated:
  - record it as tech debt in `docs/exec-plans/tech-debt-tracker.md`
  - include a specific rollback/mitigation plan
