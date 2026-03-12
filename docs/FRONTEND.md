# Frontend structure

Goal:
- Make changes easy without accidental coupling.
- Keep UI fast.
- Keep offline-first behavior deterministic.

## Current structure (what exists today)

SvelteKit app:
- `web/src/routes/` — pages/layout
- `web/src/lib/` — application logic + components

Within `web/src/lib/`:
- `api/` — HTTP client + headers
- `data/` — IndexedDB repo + persistence
- `stores/` — domain stores
- `sync/` — sync coordinator + worker
- `sound/` — audio runtime
- `components/` — UI components

## Settings surface standard

- The sidebar is navigation-first; settings controls are not expanded inline in the rail.
- Settings open in a dedicated modal surface (`web/src/lib/components/Sidebar.svelte`) with:
  - desktop split-pane navigation (sections left, detail right)
  - mobile section-list first, then section detail with back navigation
- Section visibility rules are centralized in `web/src/lib/components/settingsMenu.ts`.
- App theme labels in settings must stay aligned with product copy:
  - `default` = `To-Do Blue`
  - `light` = `Plain White Light`
  - `dark` = `Discernable Dark`
  - `demo-theme` is retired and must not appear in selectable theme options.

## In-app notifications

- `web/src/routes/+layout.svelte` is the single owner of ephemeral in-app toasts.
- Currently one toast type: remote task added — fires when an incremental sync pull surfaces tasks created by another user. Not shown on initial boot load.
- Toast behavior: auto-dismisses after 6 seconds; manually dismissable; state is ephemeral (not persisted to store or IDB).
- Do not add persistent or queued notification state without a corresponding store and IDB backing.

## Mobile quick-add positioning

- Route-level quick-add bars (`.mobile-add`) rely on `var(--mobile-keyboard-offset, 0px)` in their `bottom` offset.
- `web/src/routes/+layout.svelte` is the single owner of `--mobile-keyboard-offset`; it delegates to `web/src/lib/utils/keyboardOffset.ts`.
- `keyboardOffset.ts` installs the tracker via `installKeyboardOffsetTracker(el)` and returns a cleanup function. Do not duplicate keyboard-offset logic inside route components.
- Clipboard copy is handled by `web/src/lib/utils/shareText.ts` (`copyToClipboard` + `fallbackCopyText`); `+layout.svelte` imports it rather than inlining the logic.

## User-facing API errors

- `web/src/lib/api/client.ts` throws structured `ApiError` objects with HTTP status preserved.
- UI-facing stores/runtimes (`auth`, `sync`) must convert raw transport/server failures into plain-English messages.
- Preserve deterministic behavior:
  - status-code checks must use `apiErrorStatus(...)` instead of brittle string parsing
  - user copy can change, but retry/auth/offline branching must remain status-driven.

## List utilities (import + reset)

- List route utility actions are triggered from `web/src/routes/list/[id]/+page.svelte`.
  - `Import` — opens `web/src/lib/components/ImportTasksModal.svelte` (full import state machine lives there)
  - `Uncheck all` (resets completed tasks in the active list back to pending)
- Parsing contract lives in `web/src/lib/markdown/import.ts`; parser must remain deterministic line-by-line and skip non-task markdown noise.
- Bulk mutations must go through `web/src/lib/stores/tasks.ts` helpers (`importBatch`, `uncheckAllInList`) so offline behavior and sync queue semantics stay consistent.
- Duplicate imports are deterministic: existing completed duplicates are reopened (set back to pending) instead of creating another row.

## Task visual affordances

- `TaskRow` and `TaskDetailDrawer` must render punt state with a theme-aware shift glyph style:
  - inactive/actionable punt uses `▷`
  - active/punted state uses `▶`
- Task detail status controls (`Mark Done`, `My Day`, `Star`, `Punt`) should share consistent button sizing, text sizing, and centering.
- Task detail starred state should be conveyed by the star control itself (`☆ Star` / `★ Starred`), not by a separate starred pill above metadata.
- Punt actions in the details drawer are visibility-gated by the same rule as row quick actions:
  - pending status
  - due today
  - non-daily recurrence
- If a task is already punted for the current cycle, details shows a disabled `Punted` state control instead of an active punt button.

## Target layered model (directional dependencies)

Within a domain, dependencies should flow:
Types → Repo → Service → Runtime → UI

Rules:
- UI may depend on everything.
- Runtime may depend on types/repo/service.
- Service may depend on types/repo.
- Repo may depend on types.
- Types depend on nothing.

## Practical enforcement in this repo

Mapping for now:
- Types: `shared/types/*` and `web/src/lib/**/types.ts` (when local-only)
- Repo: `web/src/lib/data/*`
- Service: (create) `web/src/lib/service/*` (or per-domain)
- Runtime: `web/src/lib/sync/*`, `web/src/lib/sound/*` (workers count as runtime)
- UI: `web/src/lib/components/*`, `web/src/routes/*`

If you add new modules:
- Put orchestration logic in `service/`
- Keep UI components dumb (props in, events out)

## Extracted UI components

Components extracted from route-level files live under `web/src/lib/components/`:

| Component | Extracted from | Notes |
|---|---|---|
| `MissedTaskBanner.svelte` | `routes/+page.svelte` | Props in, events out. No store access. |
| `SuggestionPanel.svelte` | `routes/+page.svelte` | Props in, events out. Owns `showPanel` toggle state internally. |
| `SortControls.svelte` | `routes/+page.svelte` | Props in, events out. No store access. |
| `ImportTasksModal.svelte` | `routes/list/[id]/+page.svelte` | Intentional store access (`tasks`, `lists`, `auth`). Owns deduplication and import state machine. |
| `settings/SoundSettings.svelte` | `Sidebar.svelte` | Intentional store access (`soundSettings`). Owns all custom-sound upload/clear/preview logic. |
| `settings/MemberList.svelte` | `Sidebar.svelte` | Props in, events out (`reset`, `delete`, `grantChange`). Uses `ListPermissions` internally. |
| `settings/ListPermissions.svelte` | `Sidebar.svelte` | Props in, events out (`grantChange`). Renders grant grid for contributor members. |

Utilities extracted from route/layout files live under `web/src/lib/utils/`:

| Utility | Extracted from | Notes |
|---|---|---|
| `keyboardOffset.ts` | `routes/+layout.svelte` | `installKeyboardOffsetTracker(el)` — sets `--mobile-keyboard-offset` CSS var; returns cleanup. |
| `shareText.ts` | `routes/+layout.svelte` | `copyToClipboard(text)` with `execCommand` fallback. No DOM coupling beyond function params. |

## “No spaghetti” import rules (enforced by ESLint)

These boundaries are mechanically enforced via `no-restricted-imports` rules in `web/eslint.config.js`:

- `components/` must not import directly from `data/` (go through stores/service)
- `routes/` must not import from `data/` (go through stores/service)
- `data/` must not import from `components/` or `routes/`

If a rule needs an exception:
- add a `// eslint-disable-next-line no-restricted-imports` comment with an explanation, and document the exception here.
