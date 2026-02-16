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
