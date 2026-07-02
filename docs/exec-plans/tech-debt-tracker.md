# Tech Debt Tracker

This is the canonical list of known technical debt.

Rules:
- Every item must have a clear next action (even if it's "decide").
- Every item must have an owner (human or "unassigned").
- Close items by linking the PR and moving them to "Closed".

## Active

| ID | Area | Severity | Summary | Owner | Next action |
|---:|------|----------|---------|-------|-------------|
| 041 | Store | Low | `showCompleted` preference is client-local only (localStorage); add server-side DB column + Rust handler so it syncs cross-device | unassigned | Add `show_completed` column to `user` table, wire through `auth_update_preferences` / `load_ui_preferences_for_user`, remove client-side preservation workaround in `pushRemote` / `hydrateFromServer` |
| 042 | UI | Low | `TaskRow.svelte` action-menu close inconsistency: `deleteTask` and `openDetailFromMenu` use inline `showActions = false` while newer handlers (`toggleStar`, `punt`, `addTomorrow`, `addNextWeek`) use `closeActions()` | unassigned | Replace inline `showActions = false` with `closeActions()` in `deleteTask` and `openDetailFromMenu` for consistency |
| 043 | Store | Low | `handleDrop` in `Sidebar.svelte` is async but its Promise is silently discarded by the Svelte event handler wrapper. Internal try/catch handles errors so no correctness bug, but violates "No fire-and-forget" coding standard | unassigned | Wrap the async body in a `.catch(console.error)` self-invoking pattern, or extract the async logic into a non-event-handler function called with explicit `.catch()` |
| 044 | UI/Fonts | Low | Font flicker (font-display: swap layout shift) is still perceptible on cold launch for non-system fonts (e.g. Sora) but not for SF Pro. The self-hosted fonts + hydration gating eliminated the empty-state flash, but the fallback→web-font metric swap is still visible. Fix would be inlining @font-face CSS in the head `<style>` tag and/or switching to `font-display: block` once SW caching is verified | unassigned | Investigate inlining @font-face declarations + font-display: block for locally-hosted woff2 files |
| 045 | Tooling | Medium | All five `scripts/run-*.sh` specialist launchers pass the **inbox file path** to `claude --agent` (e.g. `claude --agent .state/inbox/<name>.md`), but the CLI's `--agent` flag expects the agent **name**, not a prompt file path. Surfaced during the 2026-07-01 auth-hardening PM run. Out of scope for auth-hardening (agent-harness tooling, not product code) | unassigned | Fix the five `scripts/run-*.sh` invocations to pass the agent name to `--agent` and supply the inbox file via the prompt/`@file` argument (mirror the working VS Code task invocation); verify each script end-to-end |
| 046 | Tooling | Medium | The `scripts/run-*.sh` launchers lack a permission mode for non-interactive file writes: the first 2026-07-01 PM run could not write the exec plan; re-running with `--permission-mode acceptEdits` succeeded. Without it, specialist agents that must produce artifacts (exec plans, code) stall on write permission prompts. Out of scope for auth-hardening | unassigned | Add an explicit `--permission-mode acceptEdits` (or equivalent scoped write permission) to the five `scripts/run-*.sh` invocations so specialist artifact writes succeed non-interactively; confirm it does not over-broaden permissions beyond the workspace |
| 047 | Security/Auth | High | `DEV_LOGIN_PASSWORD` is a **shared fallback login credential** for any account with a null/empty `password_hash` (flagged as a branch-2 candidate by the 2026-07-02 auth-hardening QA review — deliberately NOT fixed on that branch). In `server/src/routes/auth.rs` `password_matches_for_user` (~262-281), a hash-less user's login candidate is compared against `state.login_password`; consumed by `login` (~309) and `auth_change_password` (~913). Impact: anyone knowing the value can authenticate as ANY hash-less user including admin via `/auth/login`; the auto-upgrade path (~314-324) then bcrypts the shared value as that user's PERMANENT personal password, so rotating the env var does not revoke access; a restored backup with null hashes (`BackupUserRow.password_hash` is `Option`) re-arms the fallback; and the var is boot-mandatory (T2 preflight) even for deployments where it gates nothing. NOT a master key for hashed accounts; the T2 denylist blocks the known default value | unassigned | Branch-2: make `DEV_LOGIN_PASSWORD` optional (absent → fallback login disabled) or remove the fallback entirely in favor of the existing admin `auth_set_member_password` flow |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| 040 | UI | 2026-03-13 | Fix streak text positioning on first render — flexbox centering + image preload | feat/ui-polish-batch-1 |
| 039 | Tooling | 2026-03-12 | Create `/review` skill with coding standards checklist | feat/ui-polish-batch-1 |
| 038 | UI | 2026-03-12 | Show scheduled date chip for non-recurring tasks in task rows | feat/ui-polish-batch-1 |
| 037 | UI | 2026-03-12 | Replace native color picker with swatch grid in Sidebar | feat/ui-polish-batch-1 |
| 036 | UI | 2026-03-12 | Redesign list sort indicator with full-row highlight in Sidebar | feat/ui-polish-batch-1 |
| 010 | Arch | 2026-03-12 | Split `server/src/routes.rs` into `routes/{types,auth,lists,tasks,sync}.rs` + `mod.rs` | chore/tech-debt-batch-3 |
| 003 | Arch | 2026-03-12 | Enforce frontend layer boundaries with ESLint `no-restricted-imports` rules | chore/tech-debt-batch-3 |
| 002 | Perf | 2026-03-12 | Vitest bench harness (10k tasks) + CI gate (500ms ceiling) + Playwright perf test (200ms ceiling) | chore/tech-debt-batch-3 |
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
