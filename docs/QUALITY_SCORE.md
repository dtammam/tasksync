# Quality Score

This doc grades each major product domain by architectural layer.

Scale:
- A: strong, tested, enforced, easy to change
- B: good, minor gaps
- C: works, drift risk, missing enforcement
- D: fragile, unclear, under-tested
- F: unacceptable / unknown

Layers (target model):
- Types: domain types and validation at boundaries
- Repo: persistence + caching + DB access
- Service: orchestration + business rules
- Runtime: workers/scheduling/background tasks
- UI: components, routes, user journeys
- Tests: unit + integration + e2e + perf gates

**Last updated:** 2026-03-10

## Domains

### Auth & Session
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Shared types exist | Add boundary validation on server |
| Repo | B | IndexedDB scoping per user exists | Add migration + corruption recovery |
| Service | B+ | Clean hydration/login/logout flows; handles 7 error scenarios | — |
| Runtime | B | Background sync interacts w/ auth; mode switching works | Add deterministic tests for token expiry |
| UI | B | Basic flows exist | Add E2E for admin vs contributor flow |
| Tests | B | 10 test blocks: login, error classification, 401/403/network | Add negative E2E for permission mismatch |

### Tasks & Lists
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | Shared types well-defined | Add explicit versioning strategy |
| Repo | B | Local repo exists | Add invariants & property tests |
| Service | A- | 49 test blocks; My Day, recurrence, import, undo | — |
| Runtime | A | Sync integration, undo/sound/streak callbacks | — |
| UI | B | Core flows exist | Add accessibility pass |
| Tests | A- | Covers My Day auto-include, overdue, recurrence shifting, import dedup | Add perf microbench for 10k search |

### Sync
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Sync types defined in shared | Validate at boundaries |
| Repo | B+ | Incremental pull/push queue, cursor tracking | — |
| Service | B | Coordinator well-separated (312 + 146 lines) | Add explicit idempotency test |
| Runtime | B+ | Leader election via SharedWorker; single-tab fallback | — |
| UI | B | syncStatus published to UI | Improve failure UX |
| Tests | B | 45 tests across sync/coordinator/status | Add "same push twice = no dupes" test; property tests for conflict resolution |

### Sound / Feedback
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Runtime | A | WebAudio recovery, iOS PWA edge cases, HTML Audio fallback, perceptual gain curve | — |
| UI | A | Settings menu, theme selection, custom upload | — |
| Tests | A | 20 tests (sound + settings): AudioContext faking, volume clamping, theme switching | Add perf budget gate for <20ms onset |

### Streak
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | State types well-defined | — |
| Repo | B+ | localStorage per-user-per-space; server sync | — |
| Service | A | 593 lines, stateful counter, day-complete, combo-drop | — |
| Runtime | A | Sound + image on increment, debounced server sync | — |
| UI | B+ | StreakDisplay component, theme manifests | — |
| Tests | A | 48 test blocks: all state transitions, dedup, break/reset, undo, modes | Add day-complete boundary test (once per day) |

### Admin / Team
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Server rules | B | Role enforcement in ~24 locations; explicit `role !=` checks | Add negative test matrix |
| UI | B | Controls exist, member management | Add "permissions mismatch" UX |
| Tests | B | 34 server tests: login, profile, backup, password | Add 5-10 explicit negative tests per admin op |

### Settings / Preferences
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Shared types exist | — |
| Repo | B | Persisted to IndexedDB + remote sync | — |
| Service | B | Settings (263 lines) + Preferences (391 lines), well-separated | — |
| Runtime | B | Debounced remote sync (300ms) | Add remote sync failure recovery test |
| UI | B | Settings menu exists | — |
| Tests | B | 12 test blocks: hydration, volume clamping, theme persist, list sort | Expand to cover all preference fields |

## Summary

| Domain | Overall | Trend |
|--------|---------|-------|
| Auth & Session | B+ | stable |
| Tasks & Lists | A- | improved (My Day, recurrence, punt) |
| Sync | B+ | improved (coordinator tests) |
| Sound / Feedback | A | improved (recovery, custom sounds) |
| Streak | A- | new domain, well-tested from start |
| Admin / Team | B | stable |
| Settings / Preferences | B | stable |

## Systemic gaps (cross-cutting)

1. **Perf gates not enforced in CI** — budgets exist but no mechanical enforcement (tech debt 002)
2. **Layer boundary lint rules missing** — import rules documented but not enforced (tech debt 003)
3. **Property-based testing absent** — no commutativity/associativity tests for sync or recurrence
4. **Offline boot timing not measured** — spec exists, no Playwright assertion (tech debt 004)

## Notes

This file is allowed to be uncomfortable.
If a grade is C/D/F, the next action must be concrete (a plan or a debt item).
