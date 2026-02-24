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

## Mobile quick-add positioning

- Route-level quick-add bars (`.mobile-add`) rely on `var(--mobile-keyboard-offset, 0px)` in their `bottom` offset.
- `web/src/routes/+layout.svelte` is the single owner of `--mobile-keyboard-offset` and updates it from `visualViewport` + focus events.
- Do not duplicate keyboard-offset logic inside route components.

## User-facing API errors

- `web/src/lib/api/client.ts` throws structured `ApiError` objects with HTTP status preserved.
- UI-facing stores/runtimes (`auth`, `sync`) must convert raw transport/server failures into plain-English messages.
- Preserve deterministic behavior:
  - status-code checks must use `apiErrorStatus(...)` instead of brittle string parsing
  - user copy can change, but retry/auth/offline branching must remain status-driven.

## List utilities (import + reset)

- List route utility actions live in `web/src/routes/list/[id]/+page.svelte`:
  - `Import` (plain text + markdown/Joplin checkbox support)
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

## “No spaghetti” import rules (to enforce via lint)

- `components/` must not import directly from `data/` (go through stores/service)
- `routes/` must not import from `data/` (go through stores/service)
- `data/` must not import from `components/` or `routes/`

If a rule needs an exception:
- document it in `docs/RELIABILITY.md` or add a linter exception with a comment explaining why.
