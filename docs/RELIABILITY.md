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
- When connectivity returns:
  - queued changes replay deterministically
  - duplicates are not created
  - conflict resolution follows documented rules

## Sync invariants (must be testable)

- Push is idempotent (re-sending the same payload does not create duplicates)
- Pull/apply is idempotent (re-applying the same snapshot does not change state)
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

## Failure policy

- Regressions are fixed by:
  - adding a failing test/benchmark
  - then implementing the fix
- If a budget must be temporarily violated:
  - record it as tech debt in `docs/exec-plans/tech-debt-tracker.md`
  - include a specific rollback/mitigation plan
