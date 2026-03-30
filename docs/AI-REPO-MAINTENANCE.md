# How This Repo Is Maintained by AI

> **Audience:** Humans evaluating the agent harness, other AI agents being onboarded,
> or anyone curious about how tasksync uses Claude Code as a structured collaborator.
>
> **Snapshot date:** 2026-03-21

---

## 1. Philosophy

The tasksync repository treats AI as a **collaborator with guardrails**, not a free-form autocomplete. Every mechanism described below exists to enforce one core idea:

> Knowledge is written down. Plans come before code. Quality gates are mechanical. Session discipline is automatic.

The human doesn't have to remember to invoke any of this — the system bootstraps itself every time a conversation starts.

---

## 2. The Entry Point: `CLAUDE.md`

**Location:** project root (`/CLAUDE.md`)

This is the first file the AI reads every session. It is intentionally kept under ~125 lines and acts as **instructions, not documentation**. It tells the agent *what to do*, not *how the system works*.

### What it contains

| Section | Purpose |
|---------|---------|
| **Session protocol** | Mandatory startup → during-work → closing sequence (see §3) |
| **Reference docs** | Ordered reading list pointing into `docs/` |
| **Non-negotiables** | Hard stops the agent must never compromise: performance budgets, offline-first, server-side role enforcement, sync determinism |
| **Coding standards** | Concrete, checkable rules (no `@ts-nocheck`, no fire-and-forget IDB writes, reactive store bindings, etc.) |
| **Workflow** | Small change vs. complex change decision tree |
| **Quality gates** | What pre-commit, pre-push, and CI enforce — with an explicit "never use `--no-verify`" rule |
| **Exec plan ownership** | Living registry of active and completed execution plans |

### Key design choice

`CLAUDE.md` delegates everything substantive to `docs/`. This keeps the entry point scannable while the real depth lives in structured, purpose-specific documents.

---

## 3. Session Lifecycle

Every conversation follows a strict five-phase protocol. This is not optional — it's encoded in `CLAUDE.md` and reinforced by automation.

```
┌─────────────────────────────────────────────────────┐
│  Phase 1: SessionStart hook fires automatically     │
│  → branch, uncommitted file count, active plans,    │
│    and tech debt count injected as context           │
├─────────────────────────────────────────────────────┤
│  Phase 2: Agent reads CLAUDE.md                     │
│  → reads docs/index.md → docs/CONTRIBUTING.md       │
│  → checks for active exec plans                     │
│  → checks tech debt tracker                         │
├─────────────────────────────────────────────────────┤
│  Phase 3: Work intake                               │
│  → agent checks for overlap with active plans/debt  │
│  → uses /kickoff (simple) or /kickoff-complex       │
│  → no code written until brief or plan is confirmed │
├─────────────────────────────────────────────────────┤
│  Phase 4: Implementation                            │
│  → follows CONTRIBUTING.md design principles        │
│  → respects RELIABILITY.md budgets                  │
│  → updates plan progress log at milestones          │
├─────────────────────────────────────────────────────┤
│  Phase 5: Closing discipline                        │
│  → updates exactly one doc if behavior changed      │
│  → adds tech debt if debt was created               │
│  → moves completed plans to completed/              │
│  → runs quality gates, confirms they pass           │
│  → uses /commit-and-push or /commit-only            │
└─────────────────────────────────────────────────────┘
```

---

## 4. The SessionStart Hook

**Files:**
- `.claude/hooks/session-start.sh` — the shell script
- `.claude/settings.json` — registers the hook

### What it does

Runs automatically at the start of every Claude Code conversation (< 500ms, no network calls). It injects a structured context block that the agent sees before the human's first message:

```
## Session context (auto-injected)
- **Branch:** feat/my-feature
- **Uncommitted changes:** 2 file(s)
- **Active exec plans:** none
- **Active tech debt items:** 1
```

### How it works

1. Reads the current git branch and dirty file count via `git status --short`.
2. Scans `docs/exec-plans/active/` for `.md` files (active plans).
3. Parses `docs/exec-plans/tech-debt-tracker.md` to count active debt rows.
4. Prints the result as markdown — Claude sees this as a system reminder.

### Registration

`.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

---

## 5. Skills (Slash Commands)

Skills are markdown files in `.claude/commands/` that define structured workflows the agent (or human) can invoke via `/command-name`. They are the intake and output rituals of the harness.

### Inventory

| Skill | File | Purpose |
|-------|------|---------|
| `/kickoff` | `.claude/commands/kickoff.md` | Structured intake for simple, single-domain changes. Produces an **Execution Brief** (Goal, Scope, Constraints, Authoritative docs, Deliverables) before any code is written. |
| `/kickoff-complex` | `.claude/commands/kickoff-complex.md` | Plan-first intake for multi-domain or risky work. **Blocks coding** until an execution plan file is written and approved. Adds a "Complexity signal" field. |
| `/commit-only` | `.claude/commands/commit-only.md` | Safe stage + commit with quality gates. Rejects generic messages. Uses explicit file staging (not `git add .`). HEREDOC commit format with co-author trailer. |
| `/commit-and-push` | `.claude/commands/commit-and-push.md` | Same as commit-only, plus push to origin. Same safety rules, plus never force-push. |

### Skill design pattern

Every skill follows this structure:
1. **Description** — what it does and when to use it
2. **Workflow** — numbered steps the agent follows mechanically
3. **Rules** — constraints that cannot be violated
4. **Failure handling** — what to do when things go wrong (stop, diagnose, fix — never retry blindly or bypass)

### How skills interact with the session protocol

- **Intake skills** (`/kickoff`, `/kickoff-complex`) are invoked in Phase 3. The agent checks existing plans and tech debt *before* asking the human anything.
- **Output skills** (`/commit-only`, `/commit-and-push`) are invoked in Phase 5. They enforce quality gates and produce clean, traceable commits.

---

## 6. The Documentation System (`docs/`)

The `docs/` directory is the **system of record** for all repository knowledge. The agent is instructed to read docs, not just code.

### Knowledge map (`docs/index.md`)

A single-page progressive-disclosure index. Every doc in the system is linked here. This is the first doc read after `CLAUDE.md`.

### Core documents

| Document | Role |
|----------|------|
| `CONTRIBUTING.md` | **Most important doc.** 13 software design principles + coding standards. Every code change must follow these. |
| `ARCHITECTURE.md` | System design, repo layout, data model, sync protocol, conflict rules, recurrence, My Day logic, performance budgets. |
| `RELIABILITY.md` | Non-negotiable performance budgets with concrete numbers. Defines what gets measured, test framework ownership, gate intent, cost and coverage controls, failure policy. |
| `FRONTEND.md` | Layer boundaries, import rules, component extraction table, settings surface standard, notification rules, mobile positioning, ESLint enforcement. |
| `PLANS.md` | When to write a lightweight plan vs. a full execution plan. Includes the execution plan template skeleton. |
| `AGENTS.md` | Compact operating instructions for AI agents — guiding principles, tech stack, coding standards, communication style, Git/CI rules, file naming, performance budgets, required tests, definition of done. |
| `QUALITY_SCORE.md` | Grades every product domain (Auth, Tasks, Sync, Sound, Streak, Admin, Settings) by architectural layer (Types → Repo → Service → Runtime → UI → Tests). Scale: A–F. |
| `SECURITY.md` | Pointer to root `/SECURITY.md` disclosure policy. |
| `CLAUDE.BLUEPRINT.md` | **The meta-document.** A step-by-step runbook for scaffolding this entire agent-first structure in a new project. Includes templates for every file. |

### Reference docs (`docs/references/`)

| Document | Purpose |
|----------|---------|
| `command-style.md` | Formatting rules for runnable commands in agent output |
| `agent-prompts.md` | Prompt templates for feature, bug, and API-change tasks |
| `repo-conventions.md` | Scripts-as-interface, docs-as-truth, CI-gates-correctness principles |

---

## 7. Execution Plans

Plans are **first-class artifacts**, not ephemeral conversation context. They live in version-controlled markdown files.

### Two tiers

| Tier | When | Where |
|------|------|-------|
| **Lightweight** | Small, single-domain changes | PR description or issue body |
| **Full execution plan** | Multi-domain, data model changes, sync behavior, security risk, multi-session work | `docs/exec-plans/active/<yyyy-mm-dd>-<short-title>.md` |

### Execution plan skeleton

Every full plan includes: Goal, Non-goals, Constraints, Current state, Proposed approach, Alternatives considered, Risks and mitigations, Acceptance criteria, Test plan, Rollout/migration plan, **Progress log** (append-only, dated), **Decision log** (append-only, dated).

### Lifecycle

1. **Create** in `docs/exec-plans/active/` with a dated filename.
2. **Register** in `CLAUDE.md`'s exec plan ownership section.
3. **Update** the progress log at each milestone during work (append-only — never rewrite or summarize away prior entries).
4. **Complete**: verify all acceptance criteria, move to `docs/exec-plans/completed/`, update `CLAUDE.md`.

### Track record

As of 2026-03-21, **9 execution plans** have been completed, covering:
- UI features (hide completed tasks, UI polish, component decomposition)
- Platform bugs (iOS PWA stale audio)
- Code health (quality audit — 93 findings, code health phase 2, tech debt batches)
- Infrastructure (README refresh, E2E fixes, Node 24 CI)
- Documentation (docs cleanup, design principles)

---

## 8. Tech Debt Tracker

**Location:** `docs/exec-plans/tech-debt-tracker.md`

A single canonical file. Not scattered across issues or comments.

### Structure

- **Active table:** ID, Area, Severity, Summary, Owner, Next action
- **Closed table:** ID, Area, Closed date, Summary, Link to closing PR/branch

### Rules

- Every item has a clear next action (even if it's "decide").
- Every item has an owner (human or "unassigned").
- Items are closed by linking the PR and moving to the Closed table.
- The SessionStart hook counts active items and surfaces the count at session start.

### Current state

- **1 active item** (ID 041: `showCompleted` preference client-local only)
- **40+ closed items** spanning types, stores, UI, sync, testing, architecture, and tooling

---

## 9. Quality Gates (Git Hooks)

Git hooks live in `hooks/` and are activated via `git config core.hooksPath hooks`. They are **not bypassable** — `--no-verify` is explicitly banned.

### `hooks/pre-commit`

Runs on every commit:
1. **Web:** `npm run lint && npm run check && npm run test` (ESLint, SvelteKit type-check, Vitest)
2. **Server:** `cargo fmt -- --check && cargo clippy -- -D warnings`

### `hooks/pre-push`

Runs on every push:
1. **Web unit tests:** `npm run test`
2. **Playwright smoke:** `npm run test:e2e:smoke` (Chromium-only `@smoke` subset; skippable with `SKIP_PLAYWRIGHT=1`)
3. **Server tests:** `cargo test`

### CI (GitHub Actions)

- **Branch push:** lint + check + unit + Chromium smoke
- **Pull request (pre-merge):** full Playwright matrix (Chromium, Firefox, WebKit) + server checks
- **PR body gate:** requires a human-authored `Summary` line
- **Branch protection on `main`:** requires `pr-body`, `web`, `server`, and `web-e2e-matrix` (all three browsers)

### Failure policy

If a hook fails, the agent must:
1. Read the error carefully
2. Fix the root cause in code or tests
3. Never weaken or disable checks to pass
4. If the same failure repeats, add it to tech debt tracker

---

## 10. The Blueprint: `docs/CLAUDE.BLUEPRINT.md`

This is the **reproducible scaffolding runbook** — the meta-document that describes how to set up this entire system in a new project.

### What it covers (8 steps)

| Step | Action |
|------|--------|
| 1 | Create directory structure (`docs/`, `hooks/`, `.claude/commands/`, `.claude/hooks/`) |
| 2 | Write `CLAUDE.md` (template with placeholders) |
| 3 | Write core docs (`index.md`, `CONTRIBUTING.md`, `PLANS.md`, `tech-debt-tracker.md`, `ARCHITECTURE.md`, `RELIABILITY.md`, `QUALITY_SCORE.md`) |
| 4 | Create git hooks (`pre-commit`, `pre-push`) + set `core.hooksPath` |
| 5 | Create SessionStart hook (`.claude/hooks/session-start.sh`) |
| 6 | Register hook in `.claude/settings.json` |
| 7 | Create skills (`kickoff.md`, `kickoff-complex.md`, `commit-only.md`, `commit-and-push.md`) |
| 8 | Verify scaffolding (10-point checklist) |

### Design philosophy (from the Blueprint)

1. **You read docs, not just code.** Knowledge lives in structured markdown read at session start.
2. **Plans before code.** Every non-trivial change starts with a written plan.
3. **Quality gates are mechanical.** Git hooks enforce lint, type-check, and tests. Neither agent nor human can bypass them.
4. **Session discipline is automatic.** A startup hook injects context. Skills structure intake. The human doesn't have to remember to invoke any of this.
5. **Debt is tracked, not hidden.** A single tracker is the canonical list.

---

## 11. Full File Tree

```
/
├── CLAUDE.md                              # Agent entry point (instructions)
├── docs/
│   ├── index.md                           # Knowledge map
│   ├── CONTRIBUTING.md                    # Design principles + coding standards
│   ├── ARCHITECTURE.md                    # System design, data model, sync
│   ├── RELIABILITY.md                     # Performance budgets + invariants
│   ├── FRONTEND.md                        # Layer boundaries + import rules
│   ├── PLANS.md                           # Plan templates + escalation rules
│   ├── AGENTS.md                          # Agent operating instructions
│   ├── QUALITY_SCORE.md                   # Domain quality grades (A–F)
│   ├── SECURITY.md                        # Security policy pointer
│   ├── CLAUDE.BLUEPRINT.md               # Scaffolding runbook for new projects
│   ├── AI-REPO-MAINTENANCE.md            # This document
│   ├── exec-plans/
│   │   ├── active/                        # Plans currently in progress
│   │   ├── completed/                     # Archived plans (9 completed)
│   │   └── tech-debt-tracker.md           # Canonical debt registry
│   └── references/
│       ├── command-style.md               # Command formatting rules
│       ├── agent-prompts.md               # Prompt templates (feature/bug/API)
│       └── repo-conventions.md            # Scripts, docs, CI conventions
├── hooks/
│   ├── pre-commit                         # lint + type-check + unit tests
│   └── pre-push                           # unit + Playwright smoke + cargo test
└── .claude/
    ├── settings.json                      # Hook registration
    ├── hooks/
    │   └── session-start.sh               # SessionStart context injection
    └── commands/
        ├── kickoff.md                     # Simple work intake
        ├── kickoff-complex.md             # Plan-first complex intake
        ├── commit-only.md                 # Safe commit (no push)
        └── commit-and-push.md             # Safe commit + push
```

---

## 12. How the Parts Reinforce Each Other

```
SessionStart hook
  │  injects branch, plans, debt count
  ▼
CLAUDE.md (session protocol)
  │  mandates reading docs + checking plans before coding
  ▼
/kickoff or /kickoff-complex (skills)
  │  structures intake, blocks code until brief/plan exists
  ▼
docs/ (CONTRIBUTING, RELIABILITY, FRONTEND, ARCHITECTURE)
  │  provides the rules the agent must follow during implementation
  ▼
hooks/pre-commit + hooks/pre-push (quality gates)
  │  mechanically enforce lint, types, tests — no bypass possible
  ▼
/commit-and-push (skill)
  │  safe output with co-author trailer + explicit file staging
  ▼
exec-plans/ + tech-debt-tracker.md (plan artifacts)
  │  durable record of what was done, what's pending, what debt exists
  ▼
QUALITY_SCORE.md
  │  periodic health assessment by domain and layer
  ▼
CLAUDE.BLUEPRINT.md
    reproducible: scaffold this entire system in a new repo
```

Each layer removes a category of failure:
- **SessionStart** prevents the agent from starting without context.
- **Skills** prevent the agent from coding without a plan.
- **Docs** prevent the agent from violating design principles or budgets.
- **Git hooks** prevent broken code from being committed or pushed.
- **Tech debt tracker** prevents debt from being forgotten.
- **Blueprint** prevents the system itself from being unreproducible.

---

## 13. What Makes This Different from a Plain `CLAUDE.md`

| Dimension | Plain CLAUDE.md | This harness |
|-----------|----------------|--------------|
| Context at session start | None (agent starts cold) | SessionStart hook injects branch, plans, debt |
| Work intake | Freeform conversation | Structured skills with templates and gates |
| Planning | Ad hoc | Two-tier system with durable plan files |
| Quality enforcement | Trust-based | Mechanical git hooks (no bypass) |
| Knowledge management | Single flat file | Progressive-disclosure doc tree with index |
| Debt tracking | None | Single canonical tracker, counted at startup |
| Reproducibility | Copy-paste instructions | Blueprint runbook with templates and verification |
| Session discipline | Hope the agent remembers | Protocol encoded in entry point + automation |

---

## 14. Evolving the Harness

When iterating on this system:

1. **Add new skills** → create `.claude/commands/<name>.md` with description, workflow, rules, failure handling.
2. **Add new docs** → create in `docs/`, add to `docs/index.md`, optionally add to `CLAUDE.md` reference list.
3. **Change quality gates** → edit `hooks/pre-commit` or `hooks/pre-push`; update `RELIABILITY.md` and `CLAUDE.md` gate descriptions.
4. **Extend the SessionStart hook** → edit `.claude/hooks/session-start.sh` (keep it under 500ms, no network calls).
5. **Port to another project** → follow `docs/CLAUDE.BLUEPRINT.md` step by step, replacing placeholders with project-specific values.
6. **Port to another agent** → this document + the Blueprint provide the full specification. The key interfaces are: (a) a way to run a shell script at session start, (b) a way to define slash-command skills as markdown, (c) git hooks for quality gates.
