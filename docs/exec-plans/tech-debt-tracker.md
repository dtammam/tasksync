# Tech Debt Tracker

This is the canonical list of known technical debt.

Rules:
- Every item must have a clear next action (even if it's "decide").
- Every item must have an owner (human or "unassigned").
- Close items by linking the PR and moving them to "Closed".

## Active

| ID | Area | Severity | Summary | Why it matters | Next action | Owner | Link |
|---:|------|----------|---------|----------------|------------|-------|------|
| 002 | Perf | High | Make latency budgets mechanically enforced in CI | Prevent silent regressions | Add benchmarks + CI gates | unassigned | (add plan) |
| 003 | Arch | Med | Enforce frontend layer boundaries with lints | Prevent coupling & drift | Add ESLint boundary rules | unassigned | (add plan) |
| 004 | Test | Low | Add offline boot timing measurement | Exec plan called for startup timing capture on offline launch path to catch latency regressions; never implemented | Add lightweight Playwright timing assertion to offline hard-reload test | unassigned | feat/offline-local-cache-ux |
| 010 | Arch | High | Split `server/src/routes.rs` (3,862 lines) into modules | Entire server in one file; all domains mixed; hard to navigate and review | Extract into `routes/{auth,tasks,sync,lists}.rs` + `types.rs` | unassigned | chore/code-quality-audit |
| 011 | UI | Med | Decompose `Sidebar.svelte` (2,382 lines) | Six distinct features in one component; violates SRP | Split into sub-components per panel | unassigned | chore/code-quality-audit |
| 012 | UI | Low | Remove `@ts-nocheck` from Svelte components | All 7 components suppress TypeScript; type errors only surface at runtime | Enable TS per component, fix errors | unassigned | chore/code-quality-audit |
| 014 | Store | Low | Extract `updateAndPersist` helper in tasks store | 15+ methods repeat `tasksStore.update(…); void repo.saveTasks(get(tasksStore))` | Extract shared helper to DRY the pattern | unassigned | chore/code-quality-audit |
| 015 | Test | Med | Add server list CRUD tests | 36 tests exist but none cover list endpoints directly | Add tests for get/create/update/delete list | unassigned | chore/code-quality-audit |
| 017 | UI | Med | Decompose `+layout.svelte` (985 lines) | Root layout owns sync coordination, mobile keyboard offsets, toast lifecycle — beyond structural role | Extract sync coordinator, keyboard offset utility, toast manager | unassigned | chore/code-quality-audit |
| 018 | UI | Med | Extract bulk import feature from list page | 835-line route component owns file parsing, duplicate detection, multi-step import state | Extract to `ImportTasks.svelte` component or service module | unassigned | chore/code-quality-audit |
| 021 | Store | Med | Add error handling to `void repo.saveTasks()` calls | 23 fire-and-forget IndexedDB writes; if write fails, data is in store but not persisted | Add catch handler or error callback to persist pattern | unassigned | chore/code-quality-audit |
| 023 | Sync | Med | Refactor `pushPendingToServer()` — 92 lines, 6 responsibilities | Hard to test rejection paths in isolation; deeply nested conditionals | Extract `filterSyncableTasks()`, `applyRejections()` helpers | unassigned | chore/code-quality-audit |
| 027 | SW | Med | Add error logging to service worker catch blocks | Both fetch catch blocks swallow errors silently; impossible to debug offline failures in production | Add console.warn or metrics for failed fetches | unassigned | chore/code-quality-audit |
| 032 | UI | Med | Decompose My Day page (`+page.svelte`, 835 lines) | Sort logic, easter eggs, suggestion engine, quick-add mixed in one route component; violates SRP | Extract sort panel, suggestion list, easter egg coordinator to sub-components | unassigned | chore/code-audit-cleanup-2026-03-12 |
| 033 | Test | Med | Add service worker unit tests | SW fetch/cache logic untested; only covered by Playwright E2E; hard to test edge cases in isolation | Design test harness (mock Cache API, mock fetch) then add unit tests | unassigned | chore/code-audit-cleanup-2026-03-12 |
| 034 | Store | Low | Redesign preferences hydration race guard | Current `prefsMutationVersion` pattern is an ad-hoc per-store solution; inconsistent with settings store | Design shared `HydrateGuard` abstraction usable across all stores | unassigned | chore/code-audit-cleanup-2026-03-12 |
| 035 | Types | Low | Add wire format validation for settings deserialization | `soundSettings` and `uiPreferences` JSON is read from localStorage and server with no schema validation; malformed data accepted silently | Add Zod or discriminated-union validation at read boundaries | unassigned | chore/code-audit-cleanup-2026-03-12 |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| 031 | Store | 2026-03-12 | Sync `day-complete-date` cross-device; collapse streak localStorage into prefs blob; re-hydrate prefs on tab resume | feat/streak-server-side-state |
| 030 | Test | 2026-03-12 | Convert `resetClientState()` to `test.beforeEach()` hook | chore/code-audit-cleanup-2026-03-12 |
| 029 | Test | 2026-03-12 | Extract shared IDB test fixture from E2E suites | chore/code-audit-cleanup-2026-03-12 |
| 028 | Test | 2026-03-12 | Fix silent E2E test skips on SW registration failure | chore/code-audit-cleanup-2026-03-12 |
| 026 | Bug  | 2026-03-12 | Fix markdown import code block parsing | chore/code-audit-cleanup-2026-03-12 |
| 025 | Sync | 2026-03-12 | Add test + warning for partial applied array in sync push | chore/code-audit-cleanup-2026-03-12 |
| 024 | Sync | 2026-03-12 | Add runtime validation for `t.status` in `mapApiTask()` | chore/code-audit-cleanup-2026-03-12 |
| 022 | Store | 2026-03-12 | Add mutation version guard to `soundSettings.hydrateFromServer()` | chore/code-audit-cleanup-2026-03-12 |
| 020 | Types | 2026-03-12 | Deduplicate `ApiList`/`ApiTask` vs `SyncList`/`SyncTask` | chore/code-audit-cleanup-2026-03-12 |
| 019 | Types | 2026-03-12 | Tighten `SyncUpdateTaskStatusChange.status` from `string` to `TaskStatus` | chore/code-audit-cleanup-2026-03-12 |
| 009 | Test | 2026-03-12 | Add `recurrence.test.ts` for date logic | chore/code-audit-cleanup-2026-03-12 |
| 008 | Test | 2026-03-12 | Add preferences store test coverage | chore/code-audit-cleanup-2026-03-12 |
| 007 | Store | 2026-03-12 | Collapse `createLocal()` passthrough into `createLocalWithOptions()` | chore/code-audit-cleanup-2026-03-12 |
| 005 | Store | 2026-03-11 | Remove dead `tasks.setMyDay()` method | chore/code-quality-audit |
| 006 | Store | 2026-03-11 | Remove dead exports: `pendingCount`, `getDbScope()` | chore/code-quality-audit |
| 013 | UI | 2026-03-11 | Clean duplicate CSS rules in `+page.svelte`, `TaskRow.svelte`, `TaskDetailDrawer.svelte` | chore/code-quality-audit |
| 001 | Docs | 2026-03-11 | Replace monolithic agent guidance with map + structured docs | chore/docs-cleanup-design-principles |
| 016 | UI | 2026-03-11 | Clean duplicate CSS in `+layout.svelte` | chore/code-quality-audit |
