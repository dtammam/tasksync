# Code Audit Cleanup

## Goal

Execute all actionable findings from the 2026-03-11 quality audit that do NOT require
their own separate exec plan. This covers quick wins, medium-effort items, and test
coverage gaps catalogued across dead code (D), naming (N), indirection (I), DRY (R),
type safety (Y), defensive async (A), test coverage (T), and one confirmed bug (B).

## Non-goals

The following audit items are explicitly out of scope here — each needs its own plan:

- **S4+M2** Sidebar decomposition (2,382-line component → sub-components)
- **S7+M1** Server module extraction (3,862-line `routes.rs` → domain modules)
- **S5+S8+M3** Layout decomposition (sync, keyboard offsets, toasts)
- **S6+M4** My Day page decomposition (sort, easter eggs, suggestions)
- **S9+M5** List page import feature extraction
- **S10** Refactor `pushPendingToServer()` into smaller functions
- **T7+Y1** Remove `@ts-nocheck` from all Svelte components (requires fixing type errors)
- **T11** Service worker unit tests (needs test harness design)
- **A1** Error handling for 23 `void repo.saveTasks()` calls (cross-cutting)
- **A4** Preferences hydration race guard redesign (needs design discussion)
- **A6–A7** Service worker error logging (coupled with T11)
- **Y8–Y9** Wire format validation for settings deserialization (needs server alignment)

## Constraints

- All existing tests must remain green after every batch
- No behavior changes except B1 (markdown code block bug fix, which has a test that
  encoded the wrong/buggy behavior — that test expectation is updated as part of B1)
- Offline-first invariant must hold: no new server dependencies introduced
- Performance budgets from `docs/RELIABILITY.md` must not regress

## Current state

Quick-win batches 1 and 2 already landed in `main` (D1–D11, D13–D19, D22, N7).
Remaining open items from the audit:

| Category | Open items |
|----------|-----------|
| Dead code | D23, D24 |
| Naming | N1–N6, N8–N10, N11, N12 |
| Indirection | I1 |
| DRY | R4, R5, R6 |
| Type safety | Y2, Y3, Y6 |
| Defensive async | A2, A3, A5, A8 |
| Test coverage | T1–T5, T8–T10, T13, T14 |
| Bug | B1 |

## Proposed approach

Seven sequential batches. Each batch ends with a full quality-gate pass before the
next begins. Order minimizes cross-batch dependencies (renames before tests that
reference those names; type changes before tests that cover them).

---

### Batch 1 — Remaining quick wins

| Item | File | Change |
|------|------|--------|
| D23 | `web/src/lib/stores/index.ts` | Delete unused barrel re-export file |
| D24 | `web/tests/e2e/offline.spec.ts` | Remove `escapeRegex()`, use Playwright `hasText` directly |
| Y5 | `web/src/app.d.ts` / `web/src/lib/api/client.ts` | Move `Window.__TASKSYNC_RUNTIME_CONFIG__` declaration to `app.d.ts`; remove inline `declare global` from `client.ts` |
| N11 | `web/src/lib/sync/sync.ts` | Rename `isIncrementalPull` → `hasPriorCursor` |
| N12 | `web/src/lib/sync/coordinator.ts` | Rename `runSyncLocally` → `dispatchSync` |
| B1 | `web/src/lib/markdown/import.ts` + `import.test.ts` | Fix code block parsing (track fence state); update test to expect correct behavior |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 2 — Naming pass

| Item | File | Change |
|------|------|--------|
| N1 | `web/src/lib/stores/tasks.ts` | Remove `canSeeTask()` no-op placeholder; inline `true` at the 4 call sites in derived stores |
| N2 | `web/src/lib/stores/auth.ts` | Rename `AuthSource` → `AuthOrigin` (type alias, local to file) |
| N3 | `web/src/lib/stores/settings.ts` | Rename `settingsMutationVersion` → `hydrateGuardVersion` |
| N4 | `web/src/lib/stores/lists.ts` | Rename `mapApiList()` → `normalizeListFromApi()` |
| N5 | `web/src/lib/stores/streak.ts` | Rename `pendingDailyBreak` → `deferredDailyReset` |
| N6 | `web/src/lib/stores/streak.ts` | Rename `checkMissedTasks()` → `checkMissedTasksAndApplyDailyReset()` (update all call sites) |
| N8 | `web/src/lib/components/Sidebar.svelte` | Rename `renameDraft`/`iconDraft`/`colorDraft` → `listNameDrafts`/`listIconDrafts`/`listColorDrafts` |
| N9 | `web/src/lib/sync/sync.ts` | Add comment documenting `recur_rule` ↔ `recurrence_id` field name mismatch at the mapping site |
| N10 | `web/src/lib/sync/sync.ts` | Add comment documenting `my_day: number` (0/1) wire format vs `boolean` domain at the mapping site |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 3 — Indirection + DRY

| Item | File | Change |
|------|------|--------|
| I1 | `web/src/lib/stores/tasks.ts` | Remove `createLocal()` wrapper; update its 17 call sites to call `createLocalWithOptions()` directly |
| R6 | `web/src/lib/sync/status.ts` | Extract `setPhase(field, state, err?)` helper; use in `setPull`, `setPush`, `setSnapshot` |
| R5 | `web/tests/e2e/myday.spec.ts` | Convert 29 manual `resetClientState(page)` calls to a `test.beforeEach()` hook |
| R4 | `web/tests/e2e/` | Extract `resolveScopedDbName()` into a shared test helper file (`e2e/helpers/idb.ts`); import from `myday.spec.ts` and `offline.spec.ts` |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 4 — Type safety

| Item | File | Change |
|------|------|--------|
| Y2 | `shared/types/sync.ts` | Change `SyncUpdateTaskStatusChange.status: string` → `status: TaskStatus` (import `TaskStatus` from `task.ts`) |
| Y3 | `web/src/lib/api/client.ts` | Remove `ApiList` and `ApiTask` interface definitions; re-export `SyncList as ApiList` and `SyncTask as ApiTask` from `shared/types/sync` |
| Y6 | `web/src/lib/sync/sync.ts` | In `mapApiTask()`, validate `t.status` against `TaskStatus` union before casting; fall back to `'pending'` and `console.warn` for invalid values |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 5 — Defensive async

| Item | File | Change |
|------|------|--------|
| A2 | `web/src/lib/stores/settings.ts` | Add `hydrateGuardVersion` check to `hydrateFromServer()` (matching the pattern already used in `preferences.ts`) |
| A3 | `web/src/lib/stores/streak.ts` | Capture `todayIso()` once at the start of `applyResetRuleIfNeeded()` and `checkMissedTasksAndApplyDailyReset()` instead of calling it twice per operation |
| A5 | `web/src/lib/sync/sync.ts` | When `appliedIndex` loop finds `!remoteTask`, log a warning with the `op_id` and `appliedIndex` so partial responses are visible in production |
| A8 | `web/tests/e2e/myday.spec.ts` | Replace `waitForTimeout(300)` on line 426 with `expect.poll()` waiting for the specific condition |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 6 — Test coverage

| Item | What to add |
|------|-------------|
| T1 | `preferences.test.ts`: tests for `setTheme`, `setFont`, `setPanel`, `setStreakSettings`, `setCompletionQuotes`, `hydrateFromLocal`, `hydrateFromServer` race guard, and `setAll` normalization edge cases |
| T2 | `auth.test.ts`: tests for `updateProfile()` success/error paths and `isAuthenticated()` |
| T3 | `settings.test.ts`: tests for `setAll()`, `hydrateFromServer()`, and `hydrateGuardVersion` race guard |
| T4 | `members.test.ts`: tests for `find()` with undefined/not-found, and `hydrateFromServer()` error path |
| T5 | New `web/src/lib/tasks/recurrence.test.ts`: unit tests for `nextDueForRecurrence` and `prevDueForRecurrence` covering month boundaries, leap years, and weekday logic |
| T8 | `sync.test.ts`: edge case tests for `requestIdForLocalTask()` (invalid IDs), `toTaskPriority()` (out-of-range values), `mapApiTask()` (invalid status) |
| T9 | `sync.test.ts`: test that `pushPendingToServer()` logs a warning when server returns fewer `applied` tasks than sent |
| T10 | `coordinator.test.ts`: test for `crypto.randomUUID()` fallback branch (mock `crypto` to be undefined) |
| T13 | `web/tests/e2e/myday.spec.ts`: E2E test for non-recurring single-task My Day complete → day-complete trigger |
| T14 | `web/tests/e2e/offline.spec.ts`: Replace 6 silent `return` on SW registration failure with `test.skip()` calls |

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 7 — Final validation + doc updates

- Full Playwright smoke suite: `npm run test:e2e:smoke`
- Update progress log in `2026-03-11-code-quality-audit.md`
- Update `docs/exec-plans/tech-debt-tracker.md` for deferred items
- Close this plan (move to `done/`)

**Gate:** All above + smoke passes

---

## Alternatives considered

- **One commit per finding** — rejected; 30+ micro-commits adds noise without benefit
- **One batch per file** — rejected; batches organized by concern are easier to review
- **Handle decomposition items here** — rejected; they each need design discussion; mixing them here would make this plan unmanageable

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| N1 (remove `canSeeTask`) breaks derived store filtering | Function always returns `true`; removal is purely dead code. Confirm with grep before removing. |
| Y3 (dedup `ApiList`/`ApiTask`) breaks sync type consumers | `SyncList`/`SyncTask` are structurally identical; verify all import sites compile after change |
| B1 changes import behavior for users | Intentional fix; test is updated to match correct behavior. Manual verify with sample markdown. |
| R5 `beforeEach` changes test isolation | Only wraps existing `resetClientState` call; no behavioral difference |
| N6 rename has many call sites | Grep all call sites first; rename is mechanical |

## Acceptance criteria

- [ ] All quality gates pass after each batch (lint, check, vitest)
- [ ] Playwright smoke passes after final batch
- [ ] No regressions in existing test count
- [ ] New tests added for T1–T5, T8–T10, T13, T14
- [ ] Audit plan progress log updated
- [ ] Tech debt tracker updated for deferred items
- [ ] This plan moved to `done/`

## Test plan

After each batch:
```
cd web && npm run lint && npm run check && npm run test
```

After all batches:
```
npm run test:e2e:smoke
```

Server checks (only if `shared/types/sync.ts` changes touch server-used types):
```
cargo fmt -- --check && cargo clippy -- -D warnings && cargo test
```

## Progress log

- 2026-03-12: Plan written. Branch `chore/code-audit-cleanup-2026-03-12` created.
- 2026-03-12: Batches 1–7 complete. All quality gates green: lint + check + 237 vitest (17 files) + 10/10 Playwright smoke. Closed 12 tech debt items (#007–009, #019–020, #022, #024–026, #028–030). Added 4 deferred items (#032–035). Audit plan progress log updated. Plan moved to `done/`.
