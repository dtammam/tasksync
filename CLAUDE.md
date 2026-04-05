# CLAUDE.md

This file is the Claude Code entry point for this repo. It is intentionally thin.
The real sources of truth live in `docs/`. Read them, not this file.

## What YOU (the main session) do

You are NOT any of the agents listed below. You are the user's interface.
Your only job is to:

1. Receive the user's request
2. Invoke the engineering-manager agent via the Agent tool
3. Relay the engineering-manager's output — including its routing instructions — verbatim to the user

Do NOT roleplay as the engineering-manager. Do NOT directly invoke
product-manager, principal-engineer, software-developer, or any other
agent. Always go through engineering-manager.

If you catch yourself coordinating the pipeline, reading state files,
or delegating to specialist agents directly — STOP. Invoke the EM instead.

## Agent architecture

The engineering-manager is an **advisor and state manager**, not a delegator.
It writes the specialist prompt to `.state/inbox/<agent-name>.md` and tells the
user which VS Code task to run. The user launches each specialist via
**Terminal -> Run Task...** in VS Code, which spawns a fresh Claude Code session
that reads the inbox file automatically. This keeps every agent's output directly
visible to the user — no intermediary summaries, no copy-paste.

### Agents (`.claude/agents/`)

| Agent | What it does | How to run it |
|-------|-------------|---------------|
| `engineering-manager` | Tracks feature state, routes work to specialists, manages stage transitions | Invoked automatically by `/commands` |
| `product-manager` | Gathers requirements + acceptance criteria (Discovery), validates delivered work (Acceptance) | VS Code task **"Run Product Manager"** or `/run-pm` |
| `principal-engineer` | Reads requirements and codebase, produces technical design with approach, risks, alternatives | VS Code task **"Run Principal Engineer"** or `/run-pe` |
| `software-developer` | Implements ONE task at a time — writes code, tests, runs quality checks | VS Code task **"Run Software Developer"** or `/run-sde` |
| `build-specialist` | Runs build + test + lint + format checks, reports pass/fail (never fixes code) | VS Code task **"Run Build Specialist"** or `/run-build` |
| `quality-assurance` | Reviews code for correctness, security, performance, standards compliance (never fixes code) | VS Code task **"Run Quality Assurance"** or `/run-qa` |

### Commands (`.claude/commands/`)

Each command moves the feature one stage forward. Run them in order.

| Command | What it does | Then you do |
|---------|-------------|-------------|
| **`/kickoff`** | Initializes state, reads project context, summarizes starting point | Review summary -> **`/discover`** |
| **`/discover`** | Routes to PM to gather requirements and write exec plan | Run task **"Run Product Manager"** -> **`/design`** |
| **`/design`** | Routes to PE to produce technical design in exec plan | Run task **"Run Principal Engineer"** -> **`/tasks`** |
| **`/tasks`** | EM breaks design into small, testable tasks with definitions of done | Review tasks -> **`/implement`** |
| **`/implement`** | Routes ONE task to SDE for implementation | Run task **"Run Software Developer"** -> repeat or **`/verify`** |
| **`/verify`** | Routes to build specialist to run all quality gates | Run task **"Run Build Specialist"** -> **`/accept`** |
| **`/review`** | Routes to QA for code review (optional, recommended for non-trivial changes) | Run task **"Run Quality Assurance"** -> fix or proceed |
| **`/accept`** | Routes to PM to validate every acceptance criterion | Run task **"Run Product Manager"** -> **`/done`** |
| **`/done`** | Archives plan, commits, pushes, creates PR, offers release tagging | Merge PR -> **`/kickoff`** for next feature |
| **`/showme`** | Read-only status: shows last agent's work, files changed, next step | Review status -> proceed |
| **`/commit-only`** | Stages and commits (no push) | -- |
| **`/commit-and-push`** | Stages, commits, pushes | -- |

### VS Code tasks (`.vscode/tasks.json`)

Each specialist agent has a corresponding VS Code task that spawns a fresh
Claude Code session reading from `.state/inbox/<agent-name>.md`. Run via
**Terminal -> Run Task...** in VS Code.

### Mobile workflow (Session 2)

For environments without VS Code (e.g. mobile CLI), specialist agents
can be invoked via shell scripts or slash commands instead of VS Code tasks.

**Two-session model:**

- **Session 1 (EM):** Uses existing slash commands (`/kickoff`, `/discover`, etc.) — unchanged.
- **Session 2 (Specialist workbench):** Runs specialist agents via `/run-*` commands.

| Slash command | Shell script | Equivalent VS Code task |
|---------------|-------------|------------------------|
| `/run-pm` | `scripts/run-product-manager.sh` | Run Product Manager |
| `/run-pe` | `scripts/run-principal-engineer.sh` | Run Principal Engineer |
| `/run-sde` | `scripts/run-software-developer.sh` | Run Software Developer |
| `/run-build` | `scripts/run-build-specialist.sh` | Run Build Specialist |
| `/run-qa` | `scripts/run-quality-assurance.sh` | Run Quality Assurance |

Each script verifies the inbox file exists and is non-empty before invoking
`claude --agent <name> @.state/inbox/<name>.md`. If the inbox is missing,
it means the EM hasn't routed work yet — run the appropriate command in Session 1 first.

### Shared state

`.state/feature-state.json` tracks the current feature lifecycle. The
engineering-manager reads and updates it at every stage transition.

`.state/inbox/` holds ephemeral prompt files written by the EM for specialist
agents. These are `.gitignore`d — only `.gitkeep` is tracked.

### Workflow

```
/kickoff -> /discover -> /design -> /tasks -> /implement -> /verify -> /accept -> /done
                                                ↑            |
                                                └── (next) ──┘

Optional at any point: /review (code review)
```

Every stage transition requires explicit user approval. No auto-progression.
The user runs each command manually. The engineering-manager runs ONE stage
per invocation and stops.

## Session protocol

Every conversation follows this sequence. No exceptions.

### On start (before writing any code)
1. Read the SessionStart hook output (branch, active plans, tech debt count).
2. Read `docs/index.md` → `docs/CONTRIBUTING.md` (design principles + coding standards).
3. If active exec plans exist, read them. Understand what's in progress before starting new work.
4. If the user's request overlaps with an active plan or tech debt item, say so.
5. For new work: use `/kickoff` (simple) or `/kickoff-complex` (multi-domain). Do not start coding without a brief or plan.

### During work
- Follow `docs/CONTRIBUTING.md` design principles on every change.
- Respect layer boundaries (`docs/FRONTEND.md`) and performance budgets (`docs/RELIABILITY.md`).
- Update the active plan's progress log after each meaningful milestone (append-only, dated).

### On finish (before the conversation ends)
- If behavior changed, update exactly one doc (see "Change hygiene" below).
- If debt was created, add it to `docs/exec-plans/tech-debt-tracker.md`.
- If a plan was completed, check all acceptance criteria, move to `completed/`, update this file's plan list.
- Run quality gates and confirm they pass.

## Reference docs

Read these before touching any code:

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
cd web && npm run lint
cd web && npm run check
cd web && npm run test
cd web && npm run bench
cd web && npm run format
cd web && npm run test:e2e:smoke
cargo check
cargo fmt -- --check
cargo clippy -- -D warnings
cargo test
```

Scripts live in `scripts/`. Check there before constructing ad-hoc commands.

## Exec plan ownership

Active plans currently in progress:
(none)

Completed plans:
- `docs/exec-plans/completed/2026-04-05-ptr-trackpad-wheel.md` — Add trackpad/wheel gesture support to pull-to-refresh: wheel event handler with deltaY normalization, debounce end detection, 10+ unit tests, E2E smoke test, E2E flake fixes (complete 2026-04-05)
- `docs/exec-plans/completed/2026-04-04-ptr-desktop-viewport.md` — Add desktop mouse/pointer gesture support to pull-to-refresh with unit tests, E2E tests, and an exec plan (complete 2026-04-05)
- `docs/exec-plans/completed/2026-04-01-last-day-of-month-recurrence.md` — Add `lastDayOfMonth` recurrence rule: day-0 snap algorithm, forward/backward switch cases, 28 unit tests, E2E smoke test (complete 2026-04-01)
- `docs/exec-plans/completed/2026-03-30-shelf-close-all-actions.md` — Close mobile task shelf on ALL action button taps (star, punt, tomorrow, next-week), unit tests for all six handlers, E2E smoke for star (complete 2026-03-30)
- `docs/exec-plans/completed/2026-03-30-ptr-increase-max-drag.md` — PTR drag distance: exponential rubber-band curve, PULL_MAX=140 (~17.5% screen), PULL_DAMPING=0.9 for snappy pull feel (complete 2026-03-30)
- `docs/exec-plans/completed/2026-03-30-ptr-bugfixes.md` — PTR bug fixes: remove will-change:transform breaking position:fixed children, revert ptr-indicator to position:absolute, add regression tests (complete 2026-03-30)
- `docs/exec-plans/completed/2026-03-30-ptr-cleanup-polish.md` — PTR cleanup: remove scope-creep refresh button, expand emoji set to 15, fix E2E flakiness, update docs (complete 2026-03-29)
- `docs/exec-plans/completed/2026-03-29-ptr-ux-refinements.md` — Pull-to-refresh UX refinements: content translation + single emoji per pull (complete 2026-03-29)
- `docs/exec-plans/completed/2026-03-29-pull-to-refresh.md` — Pull-to-refresh gesture with animated emoji for mobile/PWA (complete 2026-03-29)
- `docs/exec-plans/completed/2026-03-17-hide-completed-tasks.md` — Add "Show completed tasks" appearance toggle to hide completed sections on My Day and list views (complete 2026-03-17)
- `docs/exec-plans/completed/2026-03-15-readme-e2e-node24.md` — README refresh, flaky E2E fix, Node 24 CI update (complete 2026-03-16)
- `docs/exec-plans/completed/2026-03-14-ios-pwa-stale-audio.md` — Fix stale audio on iOS/macOS PWA: replace singleton AudioContext with fresh-context-per-play (complete 2026-03-15)
- `docs/exec-plans/completed/2026-03-12-ui-polish-batch-1.md` — UI polish + fixes: list sort indicator (#036), color picker (#037), date chip (#038), review skill (#039), streak text position (#040) (complete 2026-03-13)
- `docs/exec-plans/completed/2026-03-12-tech-debt-batch-3.md` — close #003 (ESLint boundaries), #002 (latency CI gates), #010 (routes.rs split) (complete 2026-03-12)
- `docs/exec-plans/completed/2026-03-12-ui-decomposition.md` — UI component decomposition: Sidebar, layout utilities, list import modal, My Day sub-components (#011, #017, #018, #032) (complete 2026-03-12)
- `docs/exec-plans/completed/2026-03-12-code-health-phase-2.md` — medium-complexity cleanup: error handling, structural refactors, test coverage, @ts-nocheck removal, wire format validation (complete 2026-03-12)
- `docs/exec-plans/completed/2026-03-11-code-quality-audit.md` — full-codebase quality audit: 93 findings across 10 categories, all addressed (complete 2026-03-13)
- `docs/exec-plans/completed/2026-03-10-docs-cleanup-design-principles.md` — docs cleanup + design principles: CONTRIBUTING.md principles, QUALITY_SCORE.md refresh, AGENTS.md slim-down (complete 2026-03-13)

Append to the progress log (dated, append-only) when making meaningful advances on a plan.
Do not rewrite or summarize away prior log entries.
