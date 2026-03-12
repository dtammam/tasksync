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
| 010 | Arch | High | Split `server/src/routes.rs` (3,862 lines) into modules | Entire server in one file; all domains mixed; hard to navigate and review | Extract into `routes/{auth,tasks,sync,lists}.rs` + `types.rs` | unassigned | chore/code-quality-audit |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| 032 | UI | 2026-03-12 | Decompose My Day page — extracted `MissedTaskBanner`, `SuggestionPanel`, `SortControls` | feat/ui-decomposition-2026-03-12 |
| 018 | UI | 2026-03-12 | Extract `ImportTasksModal.svelte` from list route page | feat/ui-decomposition-2026-03-12 |
| 017 | UI | 2026-03-12 | Extract `keyboardOffset.ts` and `shareText.ts` from `+layout.svelte` | feat/ui-decomposition-2026-03-12 |
| 011 | UI | 2026-03-12 | Decompose `Sidebar.svelte` — extracted `SoundSettings`, `MemberList`, `ListPermissions` | feat/ui-decomposition-2026-03-12 |
| 035 | Types | 2026-03-12 | Add wire format validation for settings deserialization | chore/code-health-phase-2-2026-03-12 |
| 034 | Store | 2026-03-12 | Redesign preferences hydration race guard — shared `createHydrateGuard()` utility | chore/code-health-phase-2-2026-03-12 |
| 033 | Test | 2026-03-12 | Add service worker unit tests — extracted cacheStrategy.ts + 7 unit tests | chore/code-health-phase-2-2026-03-12 |
| 027 | SW | 2026-03-12 | Add error logging to service worker catch blocks | chore/code-health-phase-2-2026-03-12 |
| 023 | Sync | 2026-03-12 | Refactor `pushPendingToServer()` — extracted `filterSyncableTasks()` and `applyRejections()` | chore/code-health-phase-2-2026-03-12 |
| 021 | Store | 2026-03-12 | Add error handling to `void repo.saveTasks()` calls (23 sites) | chore/code-health-phase-2-2026-03-12 |
| 015 | Test | 2026-03-12 | Add server list CRUD tests (4 tests: create, get, update, delete) | chore/code-health-phase-2-2026-03-12 |
| 014 | Store | 2026-03-12 | Extract `updateAndPersist` helper in tasks store (21 call sites) | chore/code-health-phase-2-2026-03-12 |
| 012 | UI | 2026-03-12 | Remove `@ts-nocheck` from all 7 Svelte components | chore/code-health-phase-2-2026-03-12 |
| 004 | Test | 2026-03-12 | Add offline boot timing measurement (< 3 s assertion in @smoke test) | chore/code-health-phase-2-2026-03-12 |
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
