# AGENTS.md

This file is intentionally short. It is a map to the repo’s real sources of truth.

If you are an agent working in this repository:
- Start with `docs/index.md`
- Then read `docs/ARCHITECTURE.md`
- Then read the relevant domain docs (frontend/reliability/security/plans)

## Non-negotiables

### Performance
- Do not regress perceived UI latency.
- The budgets live in `docs/RELIABILITY.md` and must be enforced by tests/benchmarks.

### Local-first + Offline
- New features must continue to work offline.
- Server is a sync rendezvous; the client remains usable without it.

### Security
- Role enforcement happens server-side.
- Contributors must not be able to perform admin-only actions.

### Determinism
- Sync logic must be idempotent and testable.
- If behavior is “it depends”, encode the rule and test it.

## Where to look

- Repo entry point: `docs/index.md`
- Architecture & boundaries: `docs/ARCHITECTURE.md`
- Frontend structure & import rules: `docs/FRONTEND.md`
- Reliability + budgets + how we measure: `docs/RELIABILITY.md`
- Plans and execution artifacts: `docs/PLANS.md`
- Tech debt list: `docs/exec-plans/tech-debt-tracker.md`
- Security posture: `docs/SECURITY.md`

## How to run the repo

Prefer scripts over ad-hoc commands.

- Web + Server checks: `scripts/4-prepush.ps1`
- Bring Docker stack up/down: `scripts/8-docker-up.ps1` / `scripts/10-docker-down.ps1`
- Seed dev data: `scripts/1-seed.ps1` (or compose profile described in README)

If you must output commands:
- Put each command on its own line in a fenced code block.
- No bullets, no wrapped lines, no “helpful” spacing edits.
- See `docs/references/command-style.md`.

## Change hygiene

When you change behavior, update exactly one of:
- `docs/RELIABILITY.md` (if it affects budgets/reliability rules)
- `docs/FRONTEND.md` (if it affects structure/boundaries)
- `docs/ARCHITECTURE.md` (if it affects domains/layers)
- `docs/exec-plans/tech-debt-tracker.md` (if it creates debt)

Do not expand this file. Add detail to the docs it points to.
