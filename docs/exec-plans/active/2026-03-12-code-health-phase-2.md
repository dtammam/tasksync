# Code Health Phase 2

## Goal

Execute the remaining actionable items from the 2026-03-11 quality audit that were
deferred from the cleanup plan — specifically the medium-complexity items and structural
decompositions that were too risky or involved to batch with the quick wins.

Phase 1 (`chore/code-audit-cleanup-2026-03-12`, merged 2026-03-12) handled dead code,
renames, indirection, type safety tightening, and test coverage gaps. This phase picks
up where that left off.

## Active tech debt items in scope

| ID | Sev | Area | Summary |
|----|-----|------|---------|
| 021 | Med | Store | Add error handling to `void repo.saveTasks()` calls (23 sites) |
| 027 | Med | SW | Add error logging to service worker catch blocks |
| 023 | Med | Sync | Refactor `pushPendingToServer()` — extract helpers |
| 014 | Low | Store | Extract `updateAndPersist` helper in tasks store |
| 034 | Low | Store | Redesign preferences hydration race guard |
| 035 | Low | Types | Add wire format validation for settings deserialization |
| 015 | Med | Test | Add server list CRUD tests |
| 033 | Med | Test | Add service worker unit tests |
| 004 | Low | Test | Add offline boot timing measurement |
| 012 | Low | UI | Remove `@ts-nocheck` from Svelte components |
| 010 | High | Arch | Split `server/src/routes.rs` into domain modules |
| 011 | Med | UI | Decompose `Sidebar.svelte` (2,382 lines) |
| 017 | Med | UI | Decompose `+layout.svelte` (985 lines) |
| 018 | Med | UI | Extract bulk import feature from list page |
| 032 | Med | UI | Decompose My Day page (835 lines) |
| 002 | High | Perf | Make latency budgets mechanically enforced in CI |
| 003 | Med | Arch | Enforce frontend layer boundaries with ESLint |

## Non-goals

The following are explicitly out of scope here — each needs its own focused plan
with design discussion before execution:

- **#010** — `routes.rs` module split: 3,862-line server file; domain boundary design
  needed before moving code
- **#011** — Sidebar decomposition: 2,382 lines; need to agree on sub-component
  boundaries and prop contracts before splitting
- **#017** — Layout decomposition: sync coordinator extraction has runtime coupling
  implications; toast + keyboard offsets need design
- **#018** — List import extraction: multi-step state machine; needs component API design
- **#032** — My Day page decomposition: easter egg coordinator has unusual lifecycle;
  sort + suggestion panels need design
- **#002** — CI latency budget enforcement: needs benchmark tooling decision (Lighthouse,
  custom Playwright timing, or server-side) before implementation
- **#003** — ESLint layer boundaries: needs `eslint-plugin-boundaries` config design
  aligned with `docs/FRONTEND.md` layer map

## Constraints

- All existing tests green after every batch
- No behavior changes (all batches are structural/observability improvements)
- Offline-first invariant holds: no new server dependencies introduced
- Performance budgets from `docs/RELIABILITY.md` must not regress

## Proposed approach

Five sequential batches ordered by risk and dependency. Error handling first (most
safety-critical), then structural refactors, then testing additions, then @ts-nocheck
(requires type error fixes), then validation.

---

### Batch 1 — Error handling + observability

Address the silent failure paths that make production debugging hard.

| Item | File | Change |
|------|------|--------|
| #021 | `web/src/lib/stores/tasks.ts` + callers | Add `.catch(err => console.error('[repo] saveTasks failed', err))` to all 23 `void repo.saveTasks()` call sites. Do not throw — store state is correct; IDB write failure is non-fatal but must be visible. |
| #027 | `web/static/sw.js` | Add `console.warn('[sw] fetch failed', err)` to both catch blocks so offline failures appear in DevTools |
| #004 | `web/tests/e2e/offline.spec.ts` | Add timing assertion to the `@smoke hard reload offline` test: measure time from navigation start to `data-ready=true`; fail if > 3 s (RELIABILITY.md offline boot budget) |

**Gate:** `cd web && npm run lint && npm run check && npm run test && npm run test:e2e:smoke`

---

### Batch 2 — Structural refactors

DRY patterns and refactors that reduce duplication without changing behavior.

| Item | File | Change |
|------|------|--------|
| #014 | `web/src/lib/stores/tasks.ts` | Extract `updateAndPersist(fn)` helper: `tasksStore.update(fn); void repo.saveTasks(get(tasksStore))`. Update the 15+ methods that repeat this pattern. |
| #023 | `web/src/lib/sync/sync.ts` | Extract `filterSyncableTasks()` (tasks eligible for push) and `applyRejections()` (handle rejected op_ids) out of `pushPendingToServer()`. Function stays; only helpers extracted. |
| #034 | `web/src/lib/stores/` | Design and extract a shared `createHydrateGuard()` utility (returns `bump()` + `isCurrent(snap)`) used in `preferences.ts`, `settings.ts`, and any future stores. Replace the ad-hoc `prefsMutationVersion` / `hydrateGuardVersion` counters. |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 3 — Test coverage additions

Fill the remaining test gaps that need a harness design first.

| Item | What to add |
|------|-------------|
| #015 | `server/src/routes.rs` (test module): add 4 tests covering list CRUD — create list, get lists, update list name/icon/color, delete list. Follow existing test pattern (`TestApp::new()`). |
| #033 | `web/static/sw.test.js` (new file): design a minimal test harness using a mock `caches` / `fetch` global (no framework; plain node test or vitest with `jsdom`). Cover: cache-first hit, cache miss → network, network failure → cache fallback, network failure with no cache → error. |
| #004 | (already in Batch 1) | — |

**Gate:** `cd web && npm run lint && npm run check && npm run test` + `cargo test`

---

### Batch 4 — TypeScript strict mode (@ts-nocheck removal)

Remove `@ts-nocheck` from the 7 Svelte components one at a time. Each component may
require fixing type errors before the suppress can be removed. Order from least to most
complex based on component size and store coupling.

Estimated order: `StreakDisplay.svelte` → `TaskDetailDrawer.svelte` → `TaskRow.svelte`
→ `Sidebar.svelte` → `+page.svelte` → `list/[id]/+page.svelte` → `+layout.svelte`

Work one component per sub-commit. Run `npm run check` after each.

| Item | Change |
|------|--------|
| #012 | Remove `// @ts-nocheck` from each of the 7 components; fix resulting type errors in each. Do not ignore errors — fix them. If a component's errors reveal a genuine design problem, stop and document it rather than papering over it. |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 5 — Wire format validation

Add schema validation at the two deserialization boundaries where unvalidated external
data enters the store layer.

| Item | File | Change |
|------|------|--------|
| #035 | `web/src/lib/stores/preferences.ts` + `settings.ts` | Add discriminated-union or Zod parse at: (a) `localStorage.getItem` read in `hydrateFromLocal()`, (b) server response parse in `hydrateFromServer()`. Invalid fields should log a warning and fall back to defaults — not throw. Decide on Zod vs. manual parse before starting (Zod adds a dependency; manual parse keeps bundle clean). |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

## Alternatives considered

- **Tackle decompositions first** — rejected; they each need design discussion and will
  take much longer. The medium-complexity items above can ship quickly and improve
  production observability immediately.
- **Bundle all batches into one PR** — rejected; too risky to review; gates after each
  batch catch regressions early.
- **Skip @ts-nocheck batch** — rejected; suppressing TypeScript in 7 components is
  a known reliability gap. But it's sequenced after the safer batches.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| #021 `.catch` handlers add noise to test output | Use `console.error` not `console.warn`; spy in tests that intentionally trigger write failures |
| #034 `createHydrateGuard` refactor changes store timing | Extracted helper is purely functional (counter bump + compare); existing race guard tests will catch regressions |
| #012 @ts-nocheck removal surfaces many errors in large components | Work one component at a time; gate after each; document genuine design problems rather than suppressing |
| #035 adding Zod increases bundle size | Evaluate bundle impact before committing; if > 5 KB gzipped, use manual parse instead |

## Acceptance criteria

- [ ] All quality gates pass after each batch
- [ ] All 17 tech debt items listed above are closed or explicitly re-deferred with a note
- [ ] No new `@ts-nocheck` introduced
- [ ] Tech debt tracker updated when items are closed
- [ ] This plan moved to `done/` when complete

## Progress log

- 2026-03-12: Plan written. Follows `chore/code-audit-cleanup-2026-03-12` (merged 2026-03-12). Waiting for new branch.
- 2026-03-12: Batch 3 complete. Added 4 list CRUD tests to `server/src/routes.rs` (`admin_can_create_list`, `admin_can_get_all_lists`, `admin_can_update_list_name_icon_color`, `admin_can_delete_empty_list`). Extracted SW caching strategies into `src/lib/sw/cacheStrategy.ts` (`networkFirstNavigate`, `cacheFirstAsset`) and updated `service-worker.ts` to call them; added 7 unit tests in `src/lib/sw/cacheStrategy.test.ts` covering cache-first hit, cache miss → network, network failure → cache fallback, network failure with no cache → error. All gates green (web: 244 unit tests; server: 40 tests).
- 2026-03-12: Batch 2 complete. Extracted `updateAndPersist(fn)` helper in `tasks.ts` (21 call sites converted; `uncheckAllInList` and `setAll` left intentionally unchanged — conditional save and `set` vs `update` semantics). Extracted `filterSyncableTasks()` and `applyRejections()` from `pushPendingToServer()` in `sync.ts`. Created `createHydrateGuard()` utility in `hydrateGuard.ts`; replaced ad-hoc `prefsMutationVersion` counter in `preferences.ts` and `hydrateGuardVersion` in `settings.ts`. All gates green (lint, check, 237 unit tests).
- 2026-03-12: Batch 1 complete. Added `.catch(err => console.error('[repo] saveTasks failed', err))` to all 23 `void repo.saveTasks()` call sites in `tasks.ts`. Added `console.warn('[sw] fetch failed', err)` to both catch blocks in `service-worker.ts`. Added offline boot timing assertion (< 3 s) to `@smoke hard reload offline` test in `offline.spec.ts`. All gates green (lint, check, 237 unit tests, 10 smoke tests).
