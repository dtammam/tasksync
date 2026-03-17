# Hide Completed Tasks Option

## Goal

Add a new appearance setting — "Show completed tasks" — that lets users hide the completed-tasks section on My Day and all list views. Default: **on** (current behavior preserved). When toggled off, completed tasks are hidden from view but remain untouched in storage and sync.

## Non-goals

- Deleting, archiving, or modifying completed tasks in any way.
- Hiding completed tasks from server sync or IndexedDB.
- Adding per-list or per-view granularity (this is a single global toggle).
- Changing the "Uncheck all" list utility behavior.

## Constraints

- **Offline-first**: preference persists to localStorage immediately; server sync is best-effort (existing pattern).
- **Performance**: no new derived stores or re-renders. The toggle conditionally renders an existing `{#if}` block — zero cost when hidden.
- **Wire format**: the new field travels inside the existing `UiPreferencesWire` JSON blob. Old clients that don't know the field will ignore it; new clients that read an old blob will default to `true`.

## Current state

- `UiPreferences` in `shared/types/settings.ts` has: theme, font, completionQuotes, sidebarPanels, listSort, streakSettings.
- Preferences store (`web/src/lib/stores/preferences.ts`) handles normalization, localStorage, and server sync.
- Appearance panel in `Sidebar.svelte` currently shows theme and font dropdowns.
- My Day (`web/src/routes/+page.svelte`) renders a "Completed" section unconditionally (lines ~323-336).
- List pages (`web/src/routes/list/[id]/+page.svelte`) render a "Completed" section unconditionally (lines ~213-226).

## Proposed approach

### 1. Type layer (`shared/types/settings.ts`)

Add `showCompleted: boolean` to `UiPreferences` interface.

### 2. Preferences store (`web/src/lib/stores/preferences.ts`)

- Add `showCompleted: true` to `defaultPreferences()`.
- Add normalization: `typeof candidate?.showCompleted === 'boolean' ? candidate.showCompleted : true`.
- Include in `toWire` / `fromWire` / `readLocal` / `setAll` / `writeLocal`.
- Add `setShowCompleted(show: boolean)` method following the existing pattern (bump guard, update, persist, queue remote).

### 3. Appearance UI (`web/src/lib/components/Sidebar.svelte`)

Add a checkbox/toggle below the font selector in the appearance card:

```
Show completed tasks  [toggle]
```

Wired to `$uiPreferences.showCompleted` via `uiPreferences.setShowCompleted(...)`.

### 4. My Day page (`web/src/routes/+page.svelte`)

Wrap the "Completed" `<section>` in `{#if $uiPreferences.showCompleted}`.

### 5. List page (`web/src/routes/list/[id]/+page.svelte`)

Wrap the "Completed" `<section>` in `{#if $uiPreferences.showCompleted}`.

### 6. Tests

- **Unit test** (`web/src/lib/stores/__tests__/preferences.test.ts` or new file): verify `showCompleted` defaults to `true`, round-trips through `toWire`/`fromWire`, and normalizes missing/invalid values.
- **Component test**: verify My Day and List pages hide completed section when `showCompleted` is `false`.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Per-list toggle | Over-engineering for a focus feature; global toggle is simpler and matches user request. |
| Collapsible section (accordion) | Different UX — user wants tasks fully hidden, not collapsed with a header. |
| Store in a separate localStorage key | Inconsistent with existing pattern; all UI prefs live in one blob. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Old clients ignore new field | Default is `true` (show), so behavior is identical on old clients. |
| User forgets they hid completed tasks | Toggle is clearly labeled in Appearance settings. Could add a subtle indicator in the future if needed. |

## Acceptance criteria

1. Default behavior unchanged — completed tasks visible out of the box.
2. Toggling "Show completed tasks" off in Appearance hides the completed section on My Day and all list views.
3. Toggling it back on restores visibility immediately.
4. Preference persists across page reloads (localStorage) and syncs to server.
5. No completed tasks are modified, deleted, or excluded from sync.
6. Wire format is backward-compatible (old clients ignore the field).
7. Unit tests pass for normalization and round-trip.
8. Lint, type-check, and existing tests pass.

## Test plan

- Unit: preferences store normalization (default, true, false, missing, invalid).
- Component/integration: My Day and List pages conditional rendering.
- Manual: toggle in Appearance, verify sections hide/show, reload page, verify persistence.

## Rollout / migration plan

No migration needed. The field is additive with a safe default.

## Progress log

- 2026-03-17: Plan created.
- 2026-03-17: Implementation complete. All 6 files changed, 8 new tests added, all quality gates pass (lint, type-check, 254 unit tests).

## Decision log

- 2026-03-17: Chose global toggle over per-list toggle for simplicity.
