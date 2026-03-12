# UI Component Decomposition

## Goal

Split four over-sized UI files into focused sub-components and utilities. Each
currently mixes multiple unrelated concerns in a single file, making changes
risky, tests fragile, and navigation slow.

Items in scope: #011 (Sidebar), #017 (+layout.svelte), #018 (list import),
#032 (My Day).

## Non-goals

- No behavior changes. Each decomposition is purely structural.
- No new features introduced as part of this work.
- No data model or sync protocol changes.
- No server changes.

## Constraints

- Offline-first invariant must hold: no new server dependencies introduced.
- Performance budgets from `docs/RELIABILITY.md` must not regress.
- All quality gates must pass after each batch.
- Prop contracts must be minimal — prefer events over callbacks, stores over
  prop-drilling.

## Current state

| Item | File | Lines | Mixed concerns |
|------|------|-------|----------------|
| #032 | `web/src/routes/+page.svelte` | ~835 | Sort logic, easter egg coordinator, suggestion engine, quick-add, missed-task flow |
| #017 | `web/src/routes/+layout.svelte` | ~985 | Sync coordination, mobile keyboard offsets, toast lifecycle, auth flow, share/copy |
| #018 | `web/src/routes/list/[id]/+page.svelte` | ~835 | Task list rendering, multi-step import state machine, file parsing, quick-add |
| #011 | `web/src/lib/components/Sidebar.svelte` | ~2,382 | Navigation, settings modal, list management, member management, space admin, sound settings |

## Proposed approach

Four independent batches ordered by risk (lowest first). Each batch ships on its
own, gates, and is committed before the next begins.

---

### Batch 1 — My Day page (#032)

**Target:** `web/src/routes/+page.svelte`

Extract three self-contained concerns:

| New file | What it holds |
|----------|---------------|
| `web/src/lib/components/MissedTaskBanner.svelte` | Missed-task list: renders overdue/missed tasks, emits `resolve`, `skip`, `delete` events. Receives `tasks: Task[]` as prop. No store access. |
| `web/src/lib/components/SuggestionPanel.svelte` | Suggestion engine UI: renders "Add to My Day" suggestions, emits `add` event. Receives `suggestions: Task[]` as prop. No store access. |
| `web/src/lib/components/SortControls.svelte` | Sort mode + direction selector: emits `change` event with `{ mode, direction }`. Receives `mode` and `direction` as props. No store access. |

The easter egg coordinator, quick-add bar, and task list remain in `+page.svelte`
— they are tightly coupled to page-level state and don't have a clean boundary yet.

**Gate:** `cd web && npm run lint && npm run check && npm run test && npm run test:e2e:smoke`

---

### Batch 2 — List import extraction (#018)

**Target:** `web/src/routes/list/[id]/+page.svelte`

Extract the bulk import feature:

| New file | What it holds |
|----------|---------------|
| `web/src/lib/components/ImportTasksModal.svelte` | Full import UI: text area, file picker, duplicate-detection message, import/clear controls. Emits `import` event with parsed task titles. Receives `listId: string` and `listName: string` as props. Internally calls `tasks.importBatch` after deduplication. |

The `normalizeImportKey` deduplication logic and `parseMarkdownTasks` call both
move into `ImportTasksModal.svelte`. The list page retains only `importOpen`
boolean to toggle the modal.

**Gate:** `cd web && npm run lint && npm run check && npm run test && npm run test:e2e:smoke`

---

### Batch 3 — Layout utilities (#017)

**Target:** `web/src/routes/+layout.svelte`

Extract two utilities with no UI:

| New file | What it holds |
|----------|---------------|
| `web/src/lib/utils/keyboardOffset.ts` | `installKeyboardOffsetTracker(el: HTMLElement): () => void` — sets `--mobile-keyboard-offset` on `el` from `visualViewport` + focus events; returns cleanup fn. Keeps `docs/FRONTEND.md` ownership rule: layout is the single caller. |
| `web/src/lib/utils/shareText.ts` | `copyToClipboard(text: string): Promise<boolean>` and `fallbackCopyText(text: string): boolean` — extracted from layout's share flow. No DOM coupling. |

The toast, auth flow, sync coordinator wiring, and route slot remain in
`+layout.svelte`. These have too much runtime coupling to extract safely without
a design discussion on coordinator lifecycle.

**Gate:** `cd web && npm run lint && npm run check && npm run test`

---

### Batch 4 — Sidebar panels (#011)

**Target:** `web/src/lib/components/Sidebar.svelte`

The sidebar has six distinct modal panels. Extract the three highest-value ones:

| New file | What it holds |
|----------|---------------|
| `web/src/lib/components/settings/SoundSettings.svelte` | Sound theme picker, volume slider, custom sound upload/clear. Reads `soundSettings` store; dispatches no events upward (store is source of truth). |
| `web/src/lib/components/settings/MemberList.svelte` | Member table: avatar, role label, reset password, delete member controls. Receives `members: SpaceMember[]` and `grants: ListGrant[]` as props; emits `reset`, `delete` events. |
| `web/src/lib/components/settings/ListPermissions.svelte` | Per-list grant toggle table. Receives `lists: List[]`, `members: SpaceMember[]`, `grants: ListGrant[]` as props; emits `grant-change` event. |

The navigation rail, settings section routing, and list management panel remain
in `Sidebar.svelte` until a follow-up plan is written for those.

**Gate:** `cd web && npm run lint && npm run check && npm run test && npm run test:e2e:smoke`

---

## Alternatives considered

- **Extract everything in one batch** — rejected; too many moving pieces at once;
  gate signal would be too coarse.
- **Start with Sidebar (largest file)** — rejected; its panel boundaries are less
  clean than the page-level extractions. Starting small builds confidence.
- **Extract sync coordinator from layout** — deferred; SyncCoordinator has tight
  lifecycle coupling with auth state changes and the `onMount`/`onDestroy`
  sequence. Needs its own design session.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Svelte event bubbling changes break existing E2E | Run `@smoke` gate after each batch; existing tests cover the primary flows |
| Prop-drilling creates more surface area than it removes | Keep props minimal — child components access stores directly when state is global |
| `ImportTasksModal` owns deduplication logic that references `$tasks` | Pass deduplication result up via event; let list page call `tasks.importBatch` to keep store ownership clear |
| `MissedTaskBanner` and `SuggestionPanel` need access to task actions | Emit events; parent page calls store methods — components stay dumb |

## Acceptance criteria

- [ ] All quality gates pass after each batch
- [ ] No component extracted holds more than one primary concern
- [ ] No new `@ts-nocheck` introduced
- [ ] No behavior changes observable in E2E smoke suite
- [ ] `docs/FRONTEND.md` updated to reflect new component locations
- [ ] Tech debt items #011, #017, #018, #032 closed in tracker

## Test plan

- Each batch: `npm run lint && npm run check && npm run test`
- Batches 1, 2, 4 (UI changes): also `npm run test:e2e:smoke`
- Batch 3 (utils only): unit test the extracted functions if they contain logic

## Progress log

- 2026-03-12: Plan written. Follows code health phase 2 (merged 2026-03-12).
  Waiting for new branch.
