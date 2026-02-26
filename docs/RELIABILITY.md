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
  - viewing cached tasks/lists
  - creating/editing tasks locally
  - queueing changes for later sync
- Task detail saves must persist as a single local mutation/write (not split across multiple writes) so first-save behavior remains deterministic for fields like due date, recurrence, and My Day.
- When connectivity returns:
  - queued changes replay deterministically
  - duplicates are not created
  - conflict resolution follows documented rules

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
- Perf checks:
  - search benchmark at 10k
  - optional: key interaction timing in Playwright

## Test framework and gate principles

Frameworks and ownership:
- Web unit/integration: Vitest (`web/src/**/*.test.ts`)
- Web E2E: Playwright (`web/tests/e2e/**/*.spec.ts`)
- Server/API + invariants: Rust `cargo test` (`server/src/**`)

Gate intent (do not remove gates):
- pre-commit: fastest correctness loop (lint, type/check, unit-level confidence)
- pre-push: deterministic smoke confidence before remote push
- pre-merge CI: full confidence matrix (cross-browser E2E + complete server checks)

Execution strategy:
- Keep local and CI responsibilities complementary, not duplicated.
- Pre-push E2E should prioritize deterministic smoke paths over full matrix breadth.
- Full cross-browser validation belongs in pre-merge CI where cost is acceptable.
- Current gate split:
  - local pre-push Playwright: Chromium-only `@smoke` subset (`npm run test:e2e:smoke`)
  - CI on branch push: lint/check/unit + Chromium smoke
  - CI on pull request (pre-merge): full Playwright suite across `chromium`, `firefox`, and `webkit`
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
