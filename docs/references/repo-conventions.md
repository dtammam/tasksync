# Repo conventions

## Scripts are the interface
Prefer `/scripts/*.ps1` for repeatable workflows and checks.

## Docs are source of truth
- `docs/` is the knowledge base.
- Keep `AGENTS.md` short and map-like.

## Logs
- `PROGRESS.md` is outcome-first and append-only.
- `ROADMAP.md` is future work only.

## CI
- CI must gate correctness and budgets.
- If a rule matters, encode it as a check (not a paragraph).
