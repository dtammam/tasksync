# CLAUDE.md

This file is the Claude Code entry point for this repo. It is intentionally thin.
The real sources of truth live in `docs/`. Read them, not this file.

## Start here

1. `docs/index.md` — knowledge map
2. `docs/ARCHITECTURE.md` — system design, data model, sync protocol
3. `docs/RELIABILITY.md` — performance budgets and invariants (treat as non-negotiable)
4. `docs/FRONTEND.md` — layer boundaries and import rules
5. `docs/PLANS.md` — when and how to write execution plans

For active work in progress: `docs/exec-plans/active/`
For tech debt: `docs/exec-plans/tech-debt-tracker.md`

## Non-negotiables (hard stops)

Do not compromise these regardless of what a task seems to require:

- **Performance budgets** — defined in `docs/RELIABILITY.md`. If a change risks a regression, flag it before proceeding.
- **Offline-first** — new behavior must work without a server. Server is a sync rendezvous, not a runtime dependency.
- **Server-side role enforcement** — auth and role checks stay server-authoritative. Contributors must not be able to perform admin-only actions.
- **Sync determinism** — push and pull must remain idempotent. Conflict resolution follows documented rules. Do not introduce branching behavior that isn't encoded and tested.

## Workflow

### Small changes
Make the change, update exactly one doc if behavior changed, write a test.

### Complex changes (multi-domain, sync behavior, data model, operational risk)
Write an execution plan first:
- Create `docs/exec-plans/active/<yyyy-mm-dd>-<short-title>.md`
- Use the template in `docs/PLANS.md`
- Do not write significant code until the plan is in place

### Change hygiene
When behavior changes, update exactly one of:
- `docs/RELIABILITY.md` — if it affects budgets or reliability rules
- `docs/FRONTEND.md` — if it affects structure or layer boundaries
- `docs/ARCHITECTURE.md` — if it affects domains or system design
- `docs/exec-plans/tech-debt-tracker.md` — if it creates debt

### Tests required per change
- Web: lint + check + vitest; E2E smoke for flows that cross modules or are regression-prone
- Server: `cargo fmt -- --check`, `cargo clippy -D warnings`, `cargo test`
- If you retire an expensive test, replace its signal with cheaper deterministic coverage

## Quality gates (do not bypass)

- `pre-commit`: lint + type-check + unit tests (web) + fmt + clippy (server)
- `pre-push`: web unit + Playwright `@smoke` Chromium-only + `cargo test`
- CI on PR: full Playwright matrix (chromium, firefox, webkit) + server checks
- PR body gate: requires a human-authored `Summary` line before merge

Never use `--no-verify`. If a hook fails, fix the root cause.

## Commands

Prefer repo scripts over ad-hoc commands. Each command on its own line in a fenced block.

```
cd web && npm install
cargo check
npm run test:e2e:smoke
```

Scripts live in `scripts/`. Check there before constructing ad-hoc commands.

## Exec plan ownership

Active plans currently in progress:
- `docs/exec-plans/active/2026-02-26-offline-first-shell-and-sync-continuity.md` (branch: `feat/offline-local-cache-ux`)
- `docs/exec-plans/active/2026-02-24-test-posture-and-pipeline-cost.md`

Append to the progress log (dated, append-only) when making meaningful advances on a plan.
Do not rewrite or summarize away prior log entries.
