# Repo conventions

## Scripts are the interface
Prefer `/scripts/` for repeatable workflows and checks.

## Docs are source of truth
- `docs/` is the knowledge base.
- Keep `AGENTS.md` short and map-like.

## Logs
- Progress and roadmap are tracked in exec plans (see `docs/PLANS.md`).
- Legacy logs archived in `docs/exec-plans/completed/legacy-progress-and-roadmap.md`.

## CI
- CI must gate correctness and budgets.
- If a rule matters, encode it as a check (not a paragraph).
