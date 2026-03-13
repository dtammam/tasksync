# CLAUDE.md

This file is the Claude Code entry point for this repo. It is intentionally thin.
The real sources of truth live in `docs/`. Read them, not this file.

## Start here

Read these in order before touching any code:

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

## Coding standards

These apply to every change, no exceptions:

- **No `@ts-nocheck`** — fix type errors, don't suppress them. If a component lacks types, add them.
- **No fire-and-forget IDB writes** — all `void repo.saveTasks()` (and similar) calls must have a `.catch(err => console.error(...))` handler.
- **Reactive store bindings** — in Svelte components, derive from `$store` (reactive) not `get(store)` (point-in-time snapshot). `get(store)` is for non-reactive contexts only (event handlers, utility functions).
- **Event handler types** — use `event.currentTarget` (typed) not `event.target` (untyped) in Svelte handlers. Cast `currentTarget` to the concrete element type when needed.
- **No silent catch blocks** — every `catch` block must at minimum log. Use `console.error` for unexpected failures, `console.warn` for expected/recoverable ones.
- **Wire format validation** — values read from localStorage, IDB, or server responses must be validated against known-good ranges before use. Log invalid values with `console.warn`; fall back to defaults. Do not throw.
- **Store ownership** — components call store methods; they do not write to stores directly. Stores own their own persistence.
- **Layer boundaries** — follow `docs/FRONTEND.md`. `components/` and `routes/` must not import from `data/`; go through stores.

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
cd web && npm run test:e2e:smoke
```

Scripts live in `scripts/`. Check there before constructing ad-hoc commands.

## Exec plan ownership

Active plans currently in progress:
(none)

Completed plans:
- `docs/exec-plans/completed/2026-03-12-ui-polish-batch-1.md` — UI polish + fixes: list sort indicator (#036), color picker (#037), date chip (#038), review skill (#039), streak text position (#040) (complete 2026-03-13)
- `docs/exec-plans/completed/2026-03-12-tech-debt-batch-3.md` — close #003 (ESLint boundaries), #002 (latency CI gates), #010 (routes.rs split) (complete 2026-03-12)
- `docs/exec-plans/completed/2026-03-12-ui-decomposition.md` — UI component decomposition: Sidebar, layout utilities, list import modal, My Day sub-components (#011, #017, #018, #032) (complete 2026-03-12)
- `docs/exec-plans/completed/2026-03-12-code-health-phase-2.md` — medium-complexity cleanup: error handling, structural refactors, test coverage, @ts-nocheck removal, wire format validation (complete 2026-03-12)
- `docs/exec-plans/active/2026-03-11-code-quality-audit.md` — full-codebase quality audit (fact-finding reference; complete)

Append to the progress log (dated, append-only) when making meaningful advances on a plan.
Do not rewrite or summarize away prior log entries.
