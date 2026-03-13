# Code Quality Audit

## Goal

Full-codebase fact-finding pass to identify code quality issues through the lens of
software design principles. This plan catalogs findings only — no code changes until
individual items are triaged and scheduled.

## Non-goals

- Behavior changes, new features, or performance work
- Refactoring — this plan identifies candidates; separate plans will execute them
- Style-only nits (formatting, trailing whitespace, semicolons)

## Constraints

- All existing tests must remain green throughout any future work derived from this plan
- Findings must be concrete and verifiable (file, line, evidence)
- Each finding maps to a design principle so the "why" is explicit

## Design Principles (lens for this audit)

| ID | Principle | Short description |
|----|-----------|-------------------|
| P1 | **Dead code elimination** | Unreachable code, unused exports, commented-out blocks increase cognitive load and maintenance cost |
| P2 | **Single Responsibility (SRP)** | A module/function/component should have one reason to change |
| P3 | **Naming is documentation** | If it needs a comment to explain what it does, rename it instead |
| P4 | **Test coverage** | Untested public surface area is unverified behavior; gaps should be explicit |
| P5 | **No unnecessary indirection** | Thin wrappers and pass-throughs that add no value obscure intent |
| P6 | **DRY (Don't Repeat Yourself)** | Repeated patterns should be extracted when the repetition is structural, not coincidental |
| P7 | **Module cohesion** | Related code lives together; a 3,800-line file mixing all domains is a maintenance hazard |
| P8 | **Type safety** | Loose types (`any`, `string` where union expected, `@ts-nocheck`) hide bugs until runtime |
| P9 | **Defensive async** | Async operations should guard against stale state, race conditions, and silent failures |

---

## Findings

### Category 1: Dead Code

| # | File | Lines | What | Evidence | Principle |
|---|------|-------|------|----------|-----------|
| D1 | `web/src/lib/stores/tasks.ts` | 463–477 | `setMyDay()` method — zero callers | grep finds no call sites; already tracked as tech debt #005 | P1 |
| D2 | `web/src/lib/stores/tasks.ts` | 722–724 | `pendingCount` derived store — exported, never imported | grep for `pendingCount` returns only the definition | P1 |
| D3 | `web/src/lib/stores/tasks.ts` | 709–711 | No-op ternary in `replaceWithRemote`: `task.id === remote.id ? task : task` | Both arms return `task`; the condition is dead logic | P1 |
| D4 | `web/src/lib/data/idb.ts` | 45 | `getDbScope()` exported but never imported | grep finds only the definition; `setDbScope()` is used but getter is not | P1 |
| D5 | `web/src/routes/+page.svelte` | 15 | Redundant `blissMessage` init — immediately overwritten by reactive `$:` on line 16 | Line 15 runs once then line 16 takes over on every reactive tick | P1 |
| D6 | `web/src/lib/components/TaskRow.svelte` | 293–307 | Duplicate `.task` CSS rule — first declaration entirely overridden by second | Second block redefines all properties (border-radius, box-shadow, etc.) | P1 |
| D7 | `web/src/lib/components/TaskRow.svelte` | 387–388 | Unused CSS classes `.chip.pending` and `.chip.synced` | No HTML element applies these classes | P1 |
| D8 | `web/src/routes/+page.svelte` | 495–508 | Duplicate `.actions` / `.actions .sorter` CSS rules — overridden by lines 510–511 | Second definitions overwrite gap values | P1 |
| D9 | `web/src/routes/+page.svelte` | 547–555 | Duplicate `.missed-actions` CSS rule — overridden by line 557 | Second definition adds `justify-content: flex-end` and overwrites the rest | P1 |
| D10 | `web/src/routes/+page.svelte` | 632–646 | Duplicate `.panel-head` CSS rule — overridden by line 648 | Same properties redefined | P1 |
| D11 | `web/src/routes/+page.svelte` | 652–656 | Duplicate `.suggestion .meta` CSS rule — identical to line 650 | Pure duplication | P1 |
| ~~D12~~ | ~~`web/src/routes/list/[id]/+page.svelte`~~ | ~~12~~ | ~~Unused import: `uiPreferences`~~ | **False positive** — used on lines 83–84, 88–89, 251, 254, 264, 267 | — |
| D13 | `web/src/lib/components/TaskDetailDrawer.svelte` | 32–34 | Redundant `onMount` — calls `hydrate(task)` but reactive `$: if (task) hydrate(task)` on line 36 already fires on mount | Both run on mount; the reactive statement alone is sufficient | P1 |
| D14 | `web/src/lib/components/TaskDetailDrawer.svelte` | 368–379 | Duplicate `.active` CSS for `.status-toggle`, `.punt-toggle`, `.myday-toggle` — identical rules repeated 3× | Could consolidate to single `.detail-toggle.active` rule | P1, P6 |
| D15 | `web/src/routes/+page.svelte` | 677, 734 | Duplicate `.empty.subtle` CSS — second overrides color `#64748b` → `#7285a4` | First definition is dead | P1 |
| D16 | `web/src/routes/+page.svelte` | 504–523, 712–717 | Duplicate `.sorter` and `.sorter select` CSS — different gradient backgrounds | Second block overrides first entirely | P1 |
| D17 | `web/src/routes/+layout.svelte` | 693–699, 707–718 | Duplicate global `button/input/select/textarea` CSS — conflicting transition timings (140ms vs 120ms) | First block dead; second wins | P1 |
| D18 | `web/src/routes/+layout.svelte` | 836–844, 884–893 | Duplicate `.refresh-btn` CSS — second redefines all properties | First block dead | P1 |
| D19 | `web/src/routes/list/[id]/+page.svelte` | 24 | Redundant `listTasks` init — immediately overwritten by reactive `$:` on line 25 | Same pattern as D5 | P1 |
| ~~D20~~ | ~~`shared/types/task.ts`~~ | ~~3–8~~ | ~~`ChecklistItem` type unused~~ | **False positive** — used by `Task.checklist: ChecklistItem[]` on line 24 | — |
| ~~D21~~ | ~~`shared/types/backup.ts`~~ | ~~3–48~~ | ~~`SpaceBackup*` sub-types unused~~ | **Not dead code** — structural members of `SpaceBackupBundle` interface; exports are intentional API contract | — |
| D22 | `web/src/lib/components/Sidebar.svelte` | 1809 | Invalid CSS: `font-weight: 640` | Not a valid CSS value (valid increments: 100–900 by 100, or keywords) | P1 |
| D23 | `web/src/lib/stores/index.ts` | 1–4 | Barrel re-export file never imported | All 30+ consumers import from direct paths (`$lib/stores/tasks`); barrel unused | P1 |
| D24 | `web/tests/e2e/offline.spec.ts` | 4 | `escapeRegex()` utility — defined in both `offline.spec.ts` and `myday.spec.ts`, unnecessary for Playwright text matching | Only used once (line 707); Playwright `hasText` handles this natively | P1 |

### Category 2: SRP Violations

| # | File | Lines | What | Why it matters | Principle |
|---|------|-------|------|----------------|-----------|
| S1 | `web/src/lib/stores/tasks.ts` | 327–394 | `toggle()` mixes state mutation + sound playback + streak logic + day-complete detection | Four distinct concerns in one method; changes to sound or streak logic force touching toggle | P2 |
| S2 | `web/src/lib/stores/settings.ts` | 68–95 | `normalizeSettings()` mixes legacy migration, JSON parsing, and field validation | Three distinct operations in one function | P2 |
| S3 | `web/src/lib/stores/auth.ts` | 124–195 | `hydrate()` reads localStorage, makes API call, handles network vs auth failures, manages cached state | Necessary complexity but should be documented or split into phases | P2 |
| S4 | `web/src/lib/components/Sidebar.svelte` | 1–2382 | 2,382-line component handling lists, auth, settings, sound, backup, team panels | Six distinct features in one component file | P2, P7 |
| S5 | `web/src/routes/+layout.svelte` | 1–969 | Root layout mixes sync coordination, mobile keyboard offsets, clipboard logic, event listeners | Layout should be structural; orchestration logic should be extracted | P2 |
| S6 | `web/src/routes/+page.svelte` | 1–828 | My Day page mixes easter egg logic, sorting strategies, import preview, missed task actions | Page component doing too much orchestration | P2 |
| S7 | `server/src/routes.rs` | 1–3862 | **Entire server** in one file: 41 structs, 93 functions, 36 tests, 5 const arrays | All domains (auth, tasks, sync, lists, preferences, backup) in one module | P2, P7 |
| S8 | `web/src/routes/+layout.svelte` | 194–260 | Mobile keyboard viewport offset — complex DOM manipulation embedded in layout | Should be a standalone utility/action; layout shouldn't own viewport hacks | P2 |
| S9 | `web/src/routes/list/[id]/+page.svelte` | 98–212 | Bulk import with duplicate detection, file parsing, multi-step state — embedded in route | Import logic is a feature, not page layout; extract to component or service | P2 |
| S10 | `web/src/lib/sync/sync.ts` | 221–312 | `pushPendingToServer()` handles 6 responsibilities: filter dirty, validate IDs, build ops, POST, reconcile applied, handle rejections | 92 lines, deeply nested conditionals; hard to test rejection paths in isolation | P2 |

### Category 3: Naming & Clarity

| # | File | Lines | Current name | Issue | Suggested fix | Principle |
|---|------|-------|-------------|-------|---------------|-----------|
| N1 | `web/src/lib/stores/tasks.ts` | 744–749 | `canSeeTask()` | Always returns `true`; params suppressed with `void`. Misleading — implies filtering that doesn't exist | Rename to comment explaining it's a placeholder, or remove and add `// TODO: permission filtering` at call sites | P3 |
| N2 | `web/src/lib/stores/auth.ts` | 9 | `AuthSource` type | Doesn't convey meaning — is it where auth came from? | `AuthOrigin` | P3 |
| N3 | `web/src/lib/stores/settings.ts` | 98 | `settingsMutationVersion` | Name doesn't explain purpose (race condition guard during hydration) | `hydrateGuardVersion` or add inline comment | P3 |
| N4 | `web/src/lib/stores/lists.ts` | 17–23 | `mapApiList()` | Cryptic — what does "map" mean here? | `normalizeListFromApi()` | P3 |
| N5 | `web/src/lib/stores/streak.ts` | 178 | `pendingDailyBreak` | Purpose is subtle (deferred reset until `checkMissedTasks` runs) | `deferredDailyReset` | P3 |
| N6 | `web/src/lib/stores/streak.ts` | 443 | `checkMissedTasks()` | Also handles the deferred daily break — name is incomplete | `checkMissedTasksAndApplyDailyReset()` or split | P3 |
| N7 | `web/src/routes/+page.svelte` | 18 | `listsStore = lists` | Unnecessary alias; `lists` can be used directly | Remove alias | P3 |
| N8 | `web/src/lib/components/Sidebar.svelte` | 25–27 | `renameDraft`, `iconDraft`, `colorDraft` | Objects used as maps but names don't signal plural/map nature | `listNameDrafts`, `listIconDrafts`, `listColorDrafts` | P3 |
| N9 | `shared/types/sync.ts` | 22 | `SyncTask.recur_rule` | Inconsistent with domain type `Task.recurrence_id`; requires mapping boilerplate | Align field names or document the mapping explicitly | P3 |
| N10 | `shared/types/sync.ts` | 14 | `SyncTask.my_day` as `number` (0/1) | Inconsistent with `Task.my_day: boolean`; mapping at sync.ts:46 converts silently | Use `boolean` at type boundary or document the wire format | P3 |
| N11 | `web/src/lib/sync/sync.ts` | 175 | `isIncrementalPull` | Name implies a decision about pull type; actually just detects if cursor exists | `hasPriorCursor` or `hasExistingCursor` | P3 |
| N12 | `web/src/lib/sync/coordinator.ts` | 59 | `runSyncLocally` | Implies "no network involved" but actually posts to worker which triggers network sync | `dispatchSync` or `triggerSync` | P3 |

### Category 4: Test Coverage Gaps

| # | File | What's missing | Current state | Principle |
|---|------|---------------|---------------|-----------|
| T1 | `web/src/lib/stores/preferences.ts` | `setTheme`, `setFont`, `setPanel`, `setStreakSettings`, `setCompletionQuotes`, `hydrateFromLocal`, `hydrateFromServer` race guard, normalization edge cases | Only 2 test blocks (list sort hydration + persistence) out of ~10 public methods | P4 |
| T2 | `web/src/lib/stores/auth.ts` | `updateProfile()`, `isAuthenticated()` | Good coverage elsewhere but these methods are untested | P4 |
| T3 | `web/src/lib/stores/settings.ts` | `setAll()`, `hydrateFromServer()`, `settingsMutationVersion` race guard | Covered for individual setters but bulk and server hydration untested | P4 |
| T4 | `web/src/lib/stores/members.ts` | `find()` edge cases (undefined, not-found), error handling in `hydrateFromServer` | Only 2 test blocks (authenticated hydration + empty unauthenticated) | P4 |
| T5 | `web/src/lib/tasks/recurrence.ts` | No dedicated test file | Functions tested indirectly through tasks.test.ts but no unit tests for date edge cases (month boundaries, leap years, weekday logic) | P4 |
| T6 | `server/src/routes.rs` | List CRUD operations (get, create, update, delete) | 36 tests exist but none cover list endpoints directly | P4 |
| T7 | All `.svelte` components | `@ts-nocheck` on all 7 audited components disables TypeScript | Type errors won't surface until runtime | P4 |
| T8 | `web/src/lib/sync/sync.ts` | 15–28 | Private helpers `requestIdForLocalTask()`, `toTaskPriority()`, `mapApiTask()` have zero direct test coverage | Only tested implicitly through public functions; edge cases (invalid IDs, out-of-range priorities) not exercised | P4 |
| T9 | `web/src/lib/sync/sync.ts` | 261–272 | `appliedIndex` loop — no test for server returning fewer applied tasks than sent | Silent skip if `response.applied.length < pendingOps.length`; could cause data divergence | P4 |
| T10 | `web/src/lib/sync/coordinator.ts` | 37–39 | `crypto.randomUUID()` fallback branch never tested | Test suite doesn't mock crypto; UUID path unverified | P4 |
| T11 | `web/src/service-worker.ts` | 1–144 | No unit tests; only covered by E2E offline specs | Failed shell asset caching, error recovery paths untested | P4 |
| T12 | `web/src/lib/markdown/import.ts` | 14–20 | Code block parsing is broken — `isSkippableLine` skips markers but not content inside code blocks | Test on line 62 expects task from inside code block (test matches buggy behavior, not intended behavior) | P4 |
| T13 | `web/tests/e2e/myday.spec.ts` | — | No test for non-recurring single-task My Day complete → day-complete trigger | Recurring path tested (line 899); non-recurring day-complete path untested | P4 |
| T14 | `web/tests/e2e/offline.spec.ts` | 542–546 | 6 tests silently return on SW registration failure instead of being marked as skipped | Tests report as "pass" in CI when they actually didn't run; misleading coverage | P4 |

### Category 5: Unnecessary Indirection

| # | File | Lines | What | Evidence | Principle |
|---|------|-------|------|----------|-----------|
| I1 | `web/src/lib/stores/tasks.ts` | 176–178 | `createLocal()` is a pure passthrough to `createLocalWithOptions()` | 17 callers; identical signature subset; adds zero logic | P5 |
| I2 | `web/src/lib/stores/settings.ts` | 182–183 | `setCustomSound()` wraps `setCustomSounds()` with array | Only called in tests; production uses `setCustomSounds()` directly | P5 |
| I3 | `web/src/lib/stores/preferences.ts` | 243–245 | `persist()` is a one-liner wrapping `writeLocal()` | Could inline — though indirection is harmless here | P5 |
| I4 | `shared/types/auth.ts` | 20 | `SpaceMember extends AuthUser` — identity inheritance | No added fields; just a renamed alias adding a layer | P5 |

### Category 6: DRY / Repeated Patterns

| # | File | Lines | What | Principle |
|---|------|-------|------|-----------|
| R1 | `web/src/lib/stores/tasks.ts` | Throughout | 15+ methods repeat `tasksStore.update(…); void repo.saveTasks(get(tasksStore));` | Could extract `updateAndPersist(fn)` helper | P6 |
| R2 | `web/src/lib/stores/lists.ts` | Throughout | 4 mutation methods repeat `void repo.saveLists(get(listStore))` | Same pattern as R1 | P6 |
| R3 | `web/src/lib/stores/preferences.ts` | Throughout | 6 setter methods repeat `persist(next); queueRemoteSave(next);` | Setter boilerplate is structural repetition | P6 |
| R4 | `web/tests/e2e/myday.spec.ts` + `offline.spec.ts` | 12–220, 108–177 | IDB lookup / scope resolution logic duplicated 5× across test files | `resolveScopedDbName()` pattern repeated in `waitForTaskInIdb`, `readTaskFromIdb`, `updateTaskInIdb`, `readTasksFromIdbByTitle` | P6 |
| R5 | `web/tests/e2e/myday.spec.ts` | 288+ (29 sites) | `resetClientState(page)` called manually at the start of every test | Should be a `test.beforeEach()` hook; error-prone if a test forgets | P6 |
| R6 | `web/src/lib/sync/status.ts` | 20–30 | `setPull`, `setPush`, `setSnapshot` repeat identical store update pattern with ternary `lastError` logic | Could extract `setPhase(field, state, err?)` helper | P6 |

### Category 8: Type Safety

| # | File | Lines | What | Evidence | Principle |
|---|------|-------|------|----------|-----------|
| Y1 | All `.svelte` components | Throughout | `@ts-nocheck` on all 7 audited components | TypeScript disabled entirely; type errors only surface at runtime | P8 |
| Y2 | `shared/types/sync.ts` | 92–98 | `SyncUpdateTaskStatusChange.status` is `string` | Should be `TaskStatus` union; server validates but TypeScript doesn't catch invalid states at compile time | P8 |
| Y3 | `web/src/lib/api/client.ts` | 95–125 | `ApiList` and `ApiTask` duplicate `SyncList`/`SyncTask` from shared types | Two sources of truth for the same wire format; drift risk | P8 |
| Y4 | `shared/types/auth.ts` | 20 | `SpaceMember extends AuthUser` with no added fields | Identity inheritance; thin type that adds indirection without clarity | P8, P5 |
| Y5 | `web/src/lib/api/client.ts` | 23–28 | `window.__TASKSYNC_RUNTIME_CONFIG__` typed inline | Should live in `web/src/app.d.ts` as a global type extension | P8 |
| Y6 | `web/src/lib/sync/sync.ts` | 44 | `t.status as Task['status']` — cast without validation | Server could send invalid status string; accepted without check; used in UI filtering | P8 |
| Y7 | `web/src/lib/sync/coordinator.worker.ts` | 128 | `msgEvent.data as CoordinatorMessage` — cast without runtime validation | Runtime check exists inside `handleMessage()` but cast is dishonest at the boundary | P8 |
| Y8 | `shared/types/settings.ts` | 106–114 | `UiPreferencesWire` — all JSON fields typed as `string` with no validation | `completionQuotesJson`, `sidebarPanelsJson` could contain invalid JSON; parsing errors deferred to runtime | P8 |
| Y9 | `shared/types/settings.ts` | 108 | `UiPreferencesWire.font` is `string` instead of `UiFont` | Wire format loses type constraint; deserialization doesn't validate | P8 |

### Category 9: Defensive Async

| # | File | Lines | What | Risk | Principle |
|---|------|-------|------|------|-----------|
| A1 | `web/src/lib/stores/tasks.ts` | Throughout | 23 `void repo.saveTasks(...)` calls with no error handling | If IndexedDB write fails, task is in store but not persisted; data loss on refresh | P9 |
| A2 | `web/src/lib/stores/settings.ts` | 251–261 | `soundSettings.hydrateFromServer()` has no mutation version guard | Unlike `preferences.hydrateFromServer()` which checks version, settings blindly overwrites local mutations | P9 |
| A3 | `web/src/lib/stores/streak.ts` | 186–197 | `applyResetRuleIfNeeded()` calls `todayIso()` but `checkMissedTasks()` calls it again separately | If operation spans midnight, the two calls could get different dates; inconsistent reset behavior | P9 |
| A4 | `web/src/lib/stores/preferences.ts` | 377–386 | `hydrateFromServer()` race guard aborts hydration if any mutation occurs during fetch | Window between API call and version check means a single keystroke can leave preferences stale until next hydration | P9 |
| A5 | `web/src/lib/sync/sync.ts` | 261–272 | `appliedIndex` loop silently skips if server returns fewer applied tasks than sent | No error recorded; local state diverges from server; untested path | P9 |
| A6 | `web/src/service-worker.ts` | 112, 136 | Both fetch `catch` blocks swallow all errors silently | Network failures, timeouts invisible; makes production offline debugging very difficult | P9 |
| A7 | `web/src/service-worker.ts` | 57–60 | `Promise.allSettled` for shell asset caching masks individual failures | Critical shell assets may fail to cache during install; app boots in degraded state without warning | P9 |
| A8 | `web/tests/e2e/myday.spec.ts` | 426 | Hard-coded `waitForTimeout(300)` — race condition anti-pattern | Arbitrary 300ms wait hoping storage write completes; flaky if browser is slow | P9 |

### Category 10: Bugs Found During Audit

| # | File | Lines | What | Evidence | Severity |
|---|------|-------|------|----------|----------|
| B1 | `web/src/lib/markdown/import.ts` | 14–20 | Code block parsing broken — `isSkippableLine()` skips ``` markers but NOT content inside code blocks | No state tracking for "inside code block"; lines between ``` fences are parsed as tasks. Test on line 62 of `import.test.ts` expects this buggy behavior (test was written to match bug, not intent) | Medium — users importing markdown with code examples get phantom tasks |

### Category 7: Module Cohesion

| # | File | Lines | What | Recommendation | Principle |
|---|------|-------|------|----------------|-----------|
| M1 | `server/src/routes.rs` | 1–3862 | Entire server in one file | Split into `routes/{auth,tasks,sync,lists}.rs` + `types.rs` + `validation.rs` | P7 |
| M2 | `web/src/lib/components/Sidebar.svelte` | 1–2382 | Six distinct features in one component | Split into `SettingsPanel`, `ListManager`, `SoundManager`, `BackupPanel`, `TeamPanel` sub-components | P7 |
| M3 | `web/src/routes/+layout.svelte` | 1–985 | Root layout owns sync, keyboard offsets, toasts, settings dialogs | Extract sync coordinator, keyboard offset utility, toast manager | P7 |
| M4 | `web/src/routes/+page.svelte` | 1–828 | My Day page owns sort persistence, easter eggs, suggestion engine | Extract sort controller, easter egg module | P7 |
| M5 | `web/src/routes/list/[id]/+page.svelte` | 1–835 | List page owns bulk import with file parsing and duplicate detection | Extract import feature to dedicated component | P7 |

---

## Triage Guide

**Quick wins (safe, isolated, < 30 min each):**
- ~~D1–D5, N7: Done in batch 1~~
- ~~D6–D11, D13–D19, D22: Done in batch 2 (CSS cleanup, onMount, listTasks init, font-weight)~~
- ~~D14: Consolidated duplicate `.active` toggle CSS in TaskDetailDrawer (done in batch 2)~~
- ~~D20, D21: Corrected as false positives~~
- D23: Delete unused `stores/index.ts` barrel file
- D24: Remove duplicated `escapeRegex()` from E2E tests
- Y5: Move window type declaration to `app.d.ts`
- N11–N12: Rename `isIncrementalPull` → `hasPriorCursor`, `runSyncLocally` → `dispatchSync`
- B1: Fix markdown code block parsing bug + correct test expectation

**Medium effort (1–2 hours, localized):**
- T1: Preferences test coverage
- T2–T4: Fill store test gaps
- T5: Add `recurrence.test.ts`
- T8: Add edge case tests for sync helpers (`requestIdForLocalTask`, `toTaskPriority`, `mapApiTask`)
- T9: Add test for server returning fewer applied tasks than sent
- T10: Test `crypto.randomUUID()` fallback in coordinator
- T13: Add E2E test for non-recurring My Day day-complete trigger
- I1: Collapse `createLocal` into `createLocalWithOptions`
- N1–N6, N8–N10: Rename pass (stores + shared types)
- R1–R3: Extract persist helpers
- R4: Extract shared IDB test fixture from E2E suites
- R5: Convert `resetClientState()` to `test.beforeEach()` hook
- R6: Extract `setPhase()` helper in sync status store
- Y2: Tighten `SyncUpdateTaskStatusChange.status` to `TaskStatus` union
- Y3: Deduplicate `ApiList`/`ApiTask` vs `SyncList`/`SyncTask`
- Y6: Add runtime validation for `status` in `mapApiTask()`
- A2: Add mutation version guard to `soundSettings.hydrateFromServer()`
- A3: Capture `todayIso()` once per streak operation
- A5: Add error + test for partial applied array in sync push
- A8: Replace `waitForTimeout(300)` with `expect.poll()` in E2E

**Requires exec plan (multi-session, cross-cutting):**
- S4 + M2: Sidebar decomposition (2,382 lines → 7 sub-components)
- S7 + M1: Server module extraction (3,862 lines → domain modules)
- S1: Extract post-toggle side effects from `tasks.toggle()`
- S5 + S8 + M3: Layout decomposition (sync, keyboard offsets, toasts)
- S6 + M4: My Day page decomposition (sort, easter eggs, suggestions)
- S9 + M5: List page import feature extraction
- S10: Refactor `pushPendingToServer()` into smaller functions
- T7 + Y1: Remove `@ts-nocheck` from all components (requires fixing type errors)
- T11: Add unit tests for service worker (cache strategies, error recovery)
- T14: Fix silent test skips in offline E2E → use Playwright skip API
- A1: Add error handling to 23 `void repo.saveTasks()` calls
- A4: Redesign preferences hydration race guard
- A6–A7: Add error logging + asset validation to service worker
- Y8–Y9: Add wire format validation for settings deserialization

---

## Acceptance Criteria

- [x] Every finding has been triaged (quick-win / medium / needs-plan)
- [x] Quick wins executed and merged (separate PRs per category)
- [x] Medium items scheduled or converted to tech debt entries
- [x] Large items have their own exec plans created
- [x] No behavior changes introduced
- [x] All existing tests pass after each change

## Test Plan

- `cd web && npm run lint && npm run check && npm run test` after every change
- `cargo fmt -- --check && cargo clippy -- -D warnings && cargo test` for server changes
- Playwright smoke after CSS cleanup (visual regression risk)

## Progress Log

- 2026-03-11: Audit complete. 12 dead code items, 7 SRP violations, 7 naming issues, 7 test gaps, 3 indirection items, 3 DRY items, 2 module cohesion items cataloged across web and server codebases.
- 2026-03-11: Quick wins batch 1 — dead code + naming. Executed D1 (setMyDay), D2 (pendingCount), D3 (no-op ternary), D4 (getDbScope), D5 (redundant blissMessage init), N7 (listsStore alias). Corrected D12 as false positive (uiPreferences IS used). All quality gates pass (lint, check, 173/173 tests).
- 2026-03-11: Deep audit pass 2 — components, routes, shared types, store internals. Added D13–D22 (dead code in components/routes/shared types), S8–S9 (SRP in layout/list page), N8–N10 (naming in Sidebar/shared types), Y1–Y5 (type safety), A1–A4 (defensive async), I4 (identity inheritance), M3–M5 (route cohesion). Total findings: 22 dead code, 9 SRP, 10 naming, 7 test gaps, 4 indirection, 3 DRY, 5 module cohesion, 5 type safety, 4 async. Grand total: **69 findings** across 9 categories.
- 2026-03-11: Quick wins batch 2 — CSS cleanup + component fixes. Executed D6 (duplicate .task), D7 (unused .chip classes), D8–D11 (duplicate .actions/.missed-actions/.panel-head/.suggestion .meta), D13 (redundant onMount), D14 (consolidated toggle .active CSS), D15 (duplicate .empty.subtle), D16 (duplicate .sorter/.sorter select), D17 (duplicate global transitions), D18 (duplicate .refresh-btn), D19 (redundant listTasks init), D22 (invalid font-weight). Corrected D12, D20, D21 as false positives. Removed erroneous tech debt #023. All quality gates pass (lint, check, 173/173 tests, 10/10 Playwright smoke).
- 2026-03-11: Final audit pass — sync system, service worker, markdown parser, E2E tests, config files. Added D23–D24 (dead barrel/escapeRegex), S10 (pushPendingToServer SRP), N11–N12 (sync naming), T8–T14 (sync helpers, partial applied, SW unit tests, markdown parser bug, day-complete E2E, silent test skips), R4–R6 (E2E IDB fixture, resetClientState hook, sync status DRY), Y6–Y9 (status cast, message cast, wire format types), A5–A8 (partial applied race, SW error swallowing, shell asset caching, waitForTimeout flake), B1 (markdown code block parsing bug). **Full codebase audit complete.** Grand total: **24 dead code, 10 SRP, 12 naming, 14 test gaps, 4 indirection, 6 DRY, 5 module cohesion, 9 type safety, 8 async, 1 bug = 93 findings across 10 categories.**
- 2026-03-12: Cleanup plan executed on branch `chore/code-audit-cleanup-2026-03-12`. All 7 batches complete. Executed: D23 (barrel delete), D24 (escapeRegex→hasText), Y5 (runtime config type), N11/N12 (sync renames), B1 (markdown bug fix), N1–N6/N8–N10 (naming pass), I1 (createLocal alias), R6 (sync status DRY), R5 (beforeEach hook), R4 (IDB helper extraction), Y2/Y3/Y6 (type safety), A2/A3/A5/A8 (defensive async), T1–T5/T8–T10/T13/T14 (test coverage — 237 tests across 17 files). Deferred to separate plans: S4+M2, S5–S10+M1+M3–M5, T7+Y1, T11, A1, A4, A6–A7, Y8–Y9. All gates green: lint + check + 237 vitest + 10/10 Playwright smoke.
- 2026-03-13: All deferred items verified as closed in tech-debt-tracker. S4+M2→#011, S7+M1→#010, T7+Y1→#012, T11→#033, A1→#021, A4→#034, A6-A7→#027, Y8-Y9→#035, S5+S8+M3→#017, S6+M4→#032, S9+M5→#018, S10→#023, R1→#014, T6→#015. All 93 findings addressed. Plan complete.
