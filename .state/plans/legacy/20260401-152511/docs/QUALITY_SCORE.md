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

**Last updated:** 2026-03-13

## Domains

### Auth & Session
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | Shared types exist; wire format validation added | — |
| Repo | B | IndexedDB scoping per user exists | Add migration + corruption recovery |
| Service | A- | Clean hydration/login/logout flows; handles 7 error scenarios; mutation version guard | — |
| Runtime | B+ | Background sync interacts w/ auth; mode switching works | Add deterministic tests for token expiry |
| UI | B | Basic flows exist; E2E auth specs added | Add E2E for admin vs contributor flow |
| Tests | B+ | 11 test blocks: login, error classification, 401/403/network, profile update | Add negative E2E for permission mismatch |

### Tasks & Lists
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | A- | Shared types well-defined; `TaskStatus` union enforced at sync boundary | Add explicit versioning strategy |
| Repo | B+ | Local repo with `updateAndPersist` helper; error-handled IDB writes | Add invariants & property tests |
| Service | A | 54 test blocks; My Day, recurrence (24 dedicated tests), import, undo, list CRUD | — |
| Runtime | A | Sync integration, undo/sound/streak callbacks | — |
| UI | B+ | Core flows exist; decomposed My Day (SortControls, MissedTaskBanner, SuggestionPanel) | Add accessibility pass |
| Tests | A | 47 task + 7 list + 24 recurrence tests; perf microbench (10k search, 500ms CI gate) | Property tests for recurrence edge cases |

### Sync
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | Sync types defined; `SyncUpdateTaskStatusChange.status` tightened to `TaskStatus`; `ApiList`/`ApiTask` deduplicated | — |
| Repo | B+ | Incremental pull/push queue, cursor tracking | — |
| Service | B+ | Coordinator well-separated; `pushPendingToServer` decomposed into `filterSyncableTasks` + `applyRejections`; partial-applied warning | Add explicit idempotency test |
| Runtime | B+ | Leader election via SharedWorker; single-tab fallback | — |
| UI | B | syncStatus published to UI | Improve failure UX |
| Tests | B+ | 35 tests across sync/coordinator/status; edge cases for partial applied, status validation | Property tests for conflict resolution |

### Sound / Feedback
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Runtime | A | WebAudio recovery, iOS PWA edge cases, HTML Audio fallback, perceptual gain curve | — |
| UI | A | Settings menu, theme selection, custom upload | — |
| Tests | A | 14 tests (sound + settings): AudioContext faking, volume clamping, theme switching | — |

### Streak
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | State types well-defined | — |
| Repo | A- | localStorage per-user-per-space; server sync; day-complete cross-device | — |
| Service | A | 593 lines, stateful counter, day-complete, combo-drop; `todayIso()` captured once per operation | — |
| Runtime | A | Sound + image on increment, debounced server sync, image preloading | — |
| UI | A- | StreakDisplay component, theme manifests, golden glow day-complete | — |
| Tests | A | 51 test blocks: all state transitions, dedup, break/reset, undo, modes, day-complete | — |

### Admin / Team
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Server rules | B+ | Role enforcement in ~24 locations; explicit `role !=` checks; routes split into domain modules | Add negative test matrix |
| UI | B | Controls exist, member management | Add "permissions mismatch" UX |
| Tests | B+ | 40 server tests: login, profile, backup, password, list CRUD | Add 5-10 explicit negative tests per admin op |

### Settings / Preferences
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B+ | Shared types with wire format validation; `UiFont` enforced | — |
| Repo | B+ | Persisted to IndexedDB + remote sync; shared `createHydrateGuard()` utility | — |
| Service | B+ | Settings (263 lines) + Preferences (391 lines); mutation version guards on both | — |
| Runtime | B+ | Debounced remote sync (300ms) | — |
| UI | B | Settings menu exists | — |
| Tests | B+ | 22 test blocks: hydration, volume clamping, theme persist, list sort, all preference fields | — |

## Summary

| Domain | Overall | Trend |
|--------|---------|-------|
| Auth & Session | B+ | improved (wire validation, mutation guards) |
| Tasks & Lists | A | improved (recurrence tests, perf bench, decomposed UI, error-handled IDB) |
| Sync | B+ | improved (type safety, decomposed push, partial-applied guard) |
| Sound / Feedback | A | stable |
| Streak | A | improved (day-complete sync, image preload, 51 tests) |
| Admin / Team | B+ | improved (routes split, list CRUD tests) |
| Settings / Preferences | B+ | improved (hydrate guards, wire validation, full test coverage) |

## Systemic gaps (cross-cutting)

1. **Property-based testing absent** — no commutativity/associativity tests for sync or recurrence

## Notes

This file is allowed to be uncomfortable.
If a grade is C/D/F, the next action must be concrete (a plan or a debt item).
