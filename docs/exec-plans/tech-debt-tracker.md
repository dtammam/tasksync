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
| 048 | Security/Auth | Medium | The gated-login-wall feature (`feat/gated-login-wall-and-task-api`) makes `POST /auth/login` a public, always-reachable surface, widening the brute-force / credential-stuffing exposure. No login-attempt throttling exists beyond bcrypt cost. Flagged as an explicit `/done` follow-up in the exec plan's out-of-scope note (2026-07-18-gated-login-wall-and-task-api.md, Risks/Out-of-scope) | unassigned | Decide on and add login-attempt rate limiting / lockout (e.g. per-IP + per-account throttle on `/auth/login`, and consider `/auth/setup`); validate it does not regress `docs/RELIABILITY.md` budgets and stays server-authoritative |
| 049 | UI/Tags | Low | Two independent "priority" concepts now coexist and visually overlap: the existing `Task.priority`/Starred toggle (pins a task to the top of sort, shows a ★ indicator) and the new task-emoji tag system's "Time / priority" palette section (⭐ starred, ⏰ time-sensitive, 🎯 goal-focused — a category label with no effect on sort order beyond its own group). A task can be both Starred *and* tagged ⭐, showing two visually-similar star glyphs side by side (`TaskRow.svelte`'s `.star-indicator` and `.emoji-indicator`) for different reasons, which reads as duplicated/confusing. Owner-flagged during Piece 3 (`feat/task-emoji`, 2026-09-18); explicitly deferred, not resolved | unassigned | Decide: rename/drop the ⭐ palette entry to avoid the glyph collision, merge the two concepts (e.g. Starred becomes just the top palette entry), or keep them deliberately separate with distinct glyphs and document the distinction in-app |
| 050 | Test/CI | Medium | `tests/e2e/offline.spec.ts`'s task-visible-after-load assertion (`getByTestId('task-row')...toHaveCount(1)`, run immediately after `app-shell` reports `data-ready="true"`) fails intermittently under CI load — chromium originally (PR #141, 3/4 runs), now also confirmed on **firefox** (PR #146, 2/2 failing tests) with real trace evidence for the first time (see PR #146's `playwright-report-firefox` CI artifact, captured by the new `actions/upload-artifact` step added in that same PR). The trace's page snapshot at failure time shows the app genuinely rendering its **empty state** ("Nothing scheduled. Add a task to My Day.", every sidebar list at count 0) — not a stuck/slow DOM update. Both firefox failures are at the test's very *first* post-load assertion (right after `page.goto('/')`), not anything related to the reconnect/resync steps later in the same tests — despite the test names ("...syncs once after reconnect"), the failure has nothing to do with reconnect logic. This points at `app-shell`'s `data-ready="true"` marker being set before the initially-pulled/seeded task list has actually finished rendering, at least under `mockAuthenticatedSyncServer`'s seeded-data path plus CI-runner latency. | unassigned | Read `app-shell`'s `data-ready` marker logic (`+layout.svelte`) and confirm exactly what it waits on before flipping to `true` — likely needs to also gate on the task store's first render/hydration completing, not just auth+shell mount. Reproduce locally with artificial latency injected into the mocked `/sync/pull` route before concluding it's CI-only. |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| 051 | Test/CI | 2026-09-19 | Root-caused and fixed: `tests/e2e/pull-to-refresh.spec.ts`'s wheel-gesture test raced `PullToRefresh.svelte`'s real, hardcoded 150ms gesture-end debounce against its own two intervening `expect()` round-trips before checking `opacity === '1'` — WebKit's Playwright automation channel has measurably higher per-command latency, so it lost that race under CI load. Traced from a real failure's Call-log (`0.495999 -> 0.000003 -> 0`, a *completed* fade-out). Reordered the assertions; also added `actions/upload-artifact` for Playwright traces on failure (previously nothing was ever recoverable after a CI failure) | [PR #146](https://github.com/dtammam/tasksync/pull/146) |
| 045 | Tooling | 2026-09-16 | (moot) Wrong `--agent` arg shape in `scripts/run-*.sh` specialist launchers | chore/harness-v2-migration — scripts removed with the v1 EM/PM/PE/SDE pipeline |
| 046 | Tooling | 2026-09-16 | (moot) Missing non-interactive permission mode in `scripts/run-*.sh` launchers | chore/harness-v2-migration — scripts removed with the v1 EM/PM/PE/SDE pipeline |
| 047 | Security/Auth | 2026-07-18 | Removed the `DEV_LOGIN_PASSWORD` shared-fallback login for hash-less accounts (auth is now hash-only; a missing hash fails authentication). `POST /auth/setup` first-run admin provisioning replaces it as the sole owner-provisioning path; the boot preflight no longer mandates `DEV_LOGIN_PASSWORD` but still fails closed on an unset `JWT_SECRET` | [#136](https://github.com/dtammam/tasksync/pull/136) |
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
