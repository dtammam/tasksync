# Tech Debt Tracker

This is the canonical list of known technical debt.

Rules:
- Every item must have a clear next action (even if it’s “decide”).
- Every item must have an owner (human or “unassigned”).
- Close items by linking the PR and moving them to “Closed”.

## Active

| ID | Area | Severity | Summary | Why it matters | Next action | Owner | Link |
|---:|------|----------|---------|----------------|------------|-------|------|
| 002 | Perf | High | Make latency budgets mechanically enforced in CI | Prevent silent regressions | Add benchmarks + CI gates | unassigned | (add plan) |
| 003 | Arch | Med | Enforce frontend layer boundaries with lints | Prevent coupling & drift | Add ESLint boundary rules | unassigned | (add plan) |
| 004 | Test | Low | Add offline boot timing measurement | Exec plan called for startup timing capture on offline launch path to catch latency regressions; never implemented | Add lightweight Playwright timing assertion to offline hard-reload test | unassigned | feat/offline-local-cache-ux |
| 007 | Store | Low | Collapse `createLocal()` passthrough into `createLocalWithOptions()` | Thin wrapper adds indirection with no logic; 17 callers to update | Rename `createLocalWithOptions` → `createLocal`, update callers | unassigned | chore/code-quality-audit |
| 008 | Test | Med | Add preferences store test coverage | Only 2 of ~10 public methods tested; `hydrateFromServer` race guard untested | Add tests for setTheme, setFont, setPanel, hydrateFromLocal, hydrateFromServer | unassigned | chore/code-quality-audit |
| 009 | Test | Med | Add `recurrence.test.ts` for date logic | Functions tested indirectly via tasks.test.ts; no unit tests for month boundaries, leap years, weekday edge cases | Create dedicated test file | unassigned | chore/code-quality-audit |
| 010 | Arch | High | Split `server/src/routes.rs` (3,862 lines) into modules | Entire server in one file; all domains mixed; hard to navigate and review | Extract into `routes/{auth,tasks,sync,lists}.rs` + `types.rs` | unassigned | chore/code-quality-audit |
| 011 | UI | Med | Decompose `Sidebar.svelte` (2,382 lines) | Six distinct features in one component; violates SRP | Split into sub-components per panel | unassigned | chore/code-quality-audit |
| 012 | UI | Low | Remove `@ts-nocheck` from Svelte components | All 7 components suppress TypeScript; type errors only surface at runtime | Enable TS per component, fix errors | unassigned | chore/code-quality-audit |
| 014 | Store | Low | Extract `updateAndPersist` helper in tasks store | 15+ methods repeat `tasksStore.update(…); void repo.saveTasks(get(tasksStore))` | Extract shared helper to DRY the pattern | unassigned | chore/code-quality-audit |
| 015 | Test | Med | Add server list CRUD tests | 36 tests exist but none cover list endpoints directly | Add tests for get/create/update/delete list | unassigned | chore/code-quality-audit |
| 017 | UI | Med | Decompose `+layout.svelte` (985 lines) | Root layout owns sync coordination, mobile keyboard offsets, toast lifecycle — beyond structural role | Extract sync coordinator, keyboard offset utility, toast manager | unassigned | chore/code-quality-audit |
| 018 | UI | Med | Extract bulk import feature from list page | 835-line route component owns file parsing, duplicate detection, multi-step import state | Extract to `ImportTasks.svelte` component or service module | unassigned | chore/code-quality-audit |
| 019 | Types | Low | Tighten `SyncUpdateTaskStatusChange.status` from `string` to `TaskStatus` | Server validates but TypeScript doesn't catch invalid states at compile time | Change type in `shared/types/sync.ts` | unassigned | chore/code-quality-audit |
| 020 | Types | Low | Deduplicate `ApiList`/`ApiTask` vs `SyncList`/`SyncTask` | Two sources of truth for same wire format in `client.ts` and `shared/types/sync.ts` | Consolidate to single shared type | unassigned | chore/code-quality-audit |
| 021 | Store | Med | Add error handling to `void repo.saveTasks()` calls | 23 fire-and-forget IndexedDB writes; if write fails, data is in store but not persisted | Add catch handler or error callback to persist pattern | unassigned | chore/code-quality-audit |
| 022 | Store | Low | Add mutation version guard to `soundSettings.hydrateFromServer()` | Unlike `preferences.hydrateFromServer()`, settings blindly overwrites local mutations during fetch | Mirror the `prefsMutationVersion` pattern | unassigned | chore/code-quality-audit |
| 023 | Sync | Med | Refactor `pushPendingToServer()` — 92 lines, 6 responsibilities | Hard to test rejection paths in isolation; deeply nested conditionals | Extract `filterSyncableTasks()`, `applyRejections()` helpers | unassigned | chore/code-quality-audit |
| 024 | Sync | Med | Add runtime validation for `t.status` in `mapApiTask()` | Cast `as Task['status']` without validation; invalid server data accepted silently | Add status validation or discriminated union check | unassigned | chore/code-quality-audit |
| 025 | Sync | High | Add test + error handling for partial applied array in sync push | `appliedIndex` loop silently skips if server returns fewer applied tasks; data divergence risk | Add test case; log error on mismatch | unassigned | chore/code-quality-audit |
| 026 | Bug | Med | Fix markdown import code block parsing | `isSkippableLine()` skips ``` markers but not content inside code blocks; tasks created from code examples | Add state tracking for code block fences; fix test expectation | unassigned | chore/code-quality-audit |
| 027 | SW | Med | Add error logging to service worker catch blocks | Both fetch catch blocks swallow errors silently; impossible to debug offline failures in production | Add console.warn or metrics for failed fetches | unassigned | chore/code-quality-audit |
| 028 | Test | Med | Fix silent E2E test skips on SW registration failure | 6 offline tests silently return instead of being marked as skipped; misleading CI coverage | Use Playwright `test.skip()` API instead of early return | unassigned | chore/code-quality-audit |
| 029 | Test | Low | Extract shared IDB test fixture from E2E suites | `resolveScopedDbName()` pattern duplicated 5× across myday + offline specs | Create shared fixture in `tests/e2e/fixtures/` | unassigned | chore/code-quality-audit |
| 030 | Test | Low | Convert `resetClientState()` to `test.beforeEach()` hook | Called manually in 29 tests; error-prone if a test forgets | Centralize in describe-level hook | unassigned | chore/code-quality-audit |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| 005 | Store | 2026-03-11 | Remove dead `tasks.setMyDay()` method | chore/code-quality-audit |
| 006 | Store | 2026-03-11 | Remove dead exports: `pendingCount`, `getDbScope()` | chore/code-quality-audit |
| 013 | UI | 2026-03-11 | Clean duplicate CSS rules in `+page.svelte`, `TaskRow.svelte`, `TaskDetailDrawer.svelte` | chore/code-quality-audit |
| 001 | Docs | 2026-03-11 | Replace monolithic agent guidance with map + structured docs | chore/docs-cleanup-design-principles |
| 016 | UI | 2026-03-11 | Clean duplicate CSS in `+layout.svelte` | chore/code-quality-audit |
