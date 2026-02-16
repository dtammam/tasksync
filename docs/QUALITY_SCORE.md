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

## Domains

### Auth & Session
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Shared types exist | Add boundary validation on server |
| Repo | B | IndexedDB scoping per user exists | Add migration + corruption recovery |
| Service | C | Some orchestration in stores | Separate orchestration from UI |
| Runtime | C | Background sync interacts w/ auth | Add deterministic tests |
| UI | B | Basic flows exist | Add more e2e coverage |
| Tests | C | Some tests exist | Add negative auth cases |

### Tasks & Lists
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Shared types exist | Add explicit versioning strategy |
| Repo | B | Local repo exists | Add invariants & property tests |
| Service | C | Logic spread across stores | Create “service” modules |
| Runtime | C | Sync/indexing workers exist | Add runtime telemetry & perf checks |
| UI | B | Core flows exist | Add accessibility pass |
| Tests | C | Unit + e2e exist | Add perf microbench for 10k |

### Sync
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Types | B | Sync types exist | Validate at boundaries |
| Repo | C | Local queueing exists | Add formal invariants doc |
| Service | C | Coordinator exists | Add idempotency tests |
| Runtime | C | Worker exists | Add backoff + retry tests |
| UI | C | Status surfaces exist | Improve failure UX |
| Tests | D | Missing deep property tests | Add commutativity/associativity tests |

### Sound / Feedback
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Runtime | B | WebAudio recovery exists | Add perf budget checks |
| UI | B | Sound settings exists | Add cross-browser e2e |
| Tests | C | Some unit tests exist | Add e2e “plays once” assertion |

### Admin / Team
| Layer | Grade | Notes | Next |
|------|-------|------|------|
| Server rules | C | Role enforcement exists | Add integration tests for negative cases |
| UI | B | Controls exist | Add “permissions mismatch” UX |
| Tests | D | Not enough coverage | Add server test suite |

## Notes

This file is allowed to be uncomfortable.
If a grade is C/D/F, the next action must be concrete (a plan or a debt item).
