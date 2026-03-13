# CLAUDE.BLUEPRINT.md

> **Audience: Claude, Codex, or any AI coding assistant.**
>
> You are reading the blueprint for an agent-first repository. Follow these instructions
> to scaffold a new project with this structure. The user will provide the project name,
> tech stack, and domain context. You supply the scaffolding.
>
> Nothing here is specific to any one project. Every file content is a template.
> Adapt it to whatever the user is building.

---

## Philosophy (read this first, internalize it)

This system treats you as a collaborator, not a tool. That means:

1. **You read docs, not just code.** Knowledge lives in structured markdown that you read at session start. If a convention isn't written down, it doesn't exist.
2. **Plans before code.** Every non-trivial change starts with a written plan. You check for existing plans before proposing new work.
3. **Quality gates are mechanical.** Git hooks enforce lint, type-check, and tests. You cannot bypass them with `--no-verify`. Neither can humans.
4. **Session discipline is automatic.** A startup hook injects context. CLAUDE.md defines the protocol. Skills structure intake. The human doesn't have to remember to invoke any of this.
5. **Debt is tracked, not hidden.** A single tracker file is the canonical list. Plans and sessions reference it. Items are closed with links.

---

## Step 1: Create the directory structure

Run this exactly:

```bash
mkdir -p docs/exec-plans/active docs/exec-plans/completed docs/references
mkdir -p hooks .claude/commands .claude/hooks
```

This produces:

```
project-root/
├── docs/
│   ├── exec-plans/
│   │   ├── active/           # Plans currently in progress
│   │   ├── completed/        # Finished plans (archive, never delete)
│   │   └── (tech-debt-tracker.md — created in step 3)
│   └── references/           # Supplementary reference material
├── hooks/                    # Git hooks (pre-commit, pre-push)
├── .claude/
│   ├── commands/             # Skills (slash commands)
│   └── hooks/                # Claude SessionStart hook
├── (CLAUDE.md — created in step 2)
└── (docs/*.md — created in step 3)
```

---

## Step 2: Write CLAUDE.md

Create `CLAUDE.md` at the project root. This is the first file you read every session. Keep it under 120 lines.

Use this template. Replace `{{placeholders}}` with project-specific values:

```markdown
# CLAUDE.md

This file is the Claude Code entry point for this repo. It is intentionally thin.
The real sources of truth live in `docs/`. Read them, not this file.

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
- Respect performance budgets (`docs/RELIABILITY.md`) and layer boundaries.
- Update the active plan's progress log after each meaningful milestone (append-only, dated).

### On finish (before the conversation ends)
- If behavior changed, update exactly one doc (see "Change hygiene" below).
- If debt was created, add it to `docs/exec-plans/tech-debt-tracker.md`.
- If a plan was completed, check all acceptance criteria, move to `completed/`, update this file's plan list.
- Run quality gates and confirm they pass.

## Reference docs

Read these before touching any code:

1. `docs/index.md` — knowledge map
2. `docs/ARCHITECTURE.md` — system design, data model, repo layout
3. `docs/RELIABILITY.md` — performance budgets and invariants (treat as non-negotiable)
4. `docs/CONTRIBUTING.md` — design principles and coding standards
5. `docs/PLANS.md` — when and how to write execution plans

For active work in progress: `docs/exec-plans/active/`
For tech debt: `docs/exec-plans/tech-debt-tracker.md`

## Non-negotiables (hard stops)

Do not compromise these regardless of what a task seems to require:

- **Performance budgets** — defined in `docs/RELIABILITY.md`. Flag regressions before proceeding.
- {{Add project-specific non-negotiables here: offline-first, security model, sync rules, etc.}}

## Coding standards

These apply to every change, no exceptions:

- {{List concrete, checkable rules here. Examples:}}
- {{No `@ts-nocheck` — fix type errors, don't suppress them.}}
- {{No silent catch blocks — every catch must at minimum log.}}
- {{No fire-and-forget async — all async writes must have error handling.}}

## Workflow

### Small changes
Make the change, update exactly one doc if behavior changed, write a test.

### Complex changes (multi-domain, data model, operational risk)
Write an execution plan first:
- Create `docs/exec-plans/active/<yyyy-mm-dd>-<short-title>.md`
- Use the template in `docs/PLANS.md`
- Do not write significant code until the plan is in place

### Change hygiene
When behavior changes, update exactly one of:
- `docs/RELIABILITY.md` — if it affects budgets or reliability rules
- `docs/ARCHITECTURE.md` — if it affects domains or system design
- `docs/exec-plans/tech-debt-tracker.md` — if it creates debt

## Quality gates (do not bypass)

- `pre-commit`: {{describe what pre-commit checks}}
- `pre-push`: {{describe what pre-push checks}}
- Never use `--no-verify`. If a hook fails, fix the root cause.

## Commands

Prefer repo scripts over ad-hoc commands.

\`\`\`
{{project install command}}
{{project test command}}
{{project lint command}}
\`\`\`

## Exec plan ownership

Active plans currently in progress:
(none)

Completed plans:
(none yet)

Append to the progress log (dated, append-only) when making meaningful advances on a plan.
Do not rewrite or summarize away prior log entries.
```

**Key design choice:** CLAUDE.md is instructions, not documentation. It tells you *what to do*, not *how the system works*. For system knowledge, link to docs/.

---

## Step 3: Write the core docs

Create each file below. For each one, ask the user for project-specific details where marked. If the user hasn't provided details yet, write the structural skeleton with `{{placeholder}}` markers and tell the user what needs filling in.

### docs/index.md

```markdown
# docs/

This directory is the system of record for repository knowledge.

Start here, then follow links.

## Core docs

- Contributing & software design principles: `CONTRIBUTING.md`
- Architecture: `ARCHITECTURE.md`
- Reliability & performance budgets: `RELIABILITY.md`
- Plans & execution artifacts: `PLANS.md`
- Quality grading by domain: `QUALITY_SCORE.md`
- Security posture: `SECURITY.md`

## Execution plans

- Active plans: `exec-plans/active/`
- Completed plans: `exec-plans/completed/`
- Tech debt tracker: `exec-plans/tech-debt-tracker.md`
```

### docs/CONTRIBUTING.md

This is the most important doc. It defines how code gets written. Include these two sections:

**Section 1 — Software design principles.** Include all of these (adapt wording to the project):

- **Single responsibility** — every function, module, and file does one thing well.
- **Small, clean functions** — short, focused, readable top-to-bottom.
- **Modularity and cohesion** — composable pieces with clear inputs/outputs; related code lives together.
- **Explicit over implicit** — named parameters, clear return types, obvious control flow.
- **Minimal coupling** — depend on interfaces, not implementations; follow layer boundaries.
- **DRY — but not prematurely** — extract after three genuine repetitions, not two.
- **Fail fast and visibly** — validate at boundaries; surface errors early.
- **Naming is documentation** — if a name needs a comment, rename it.
- **Type safety** — strict mode; validate at system boundaries.
- **Defensive async** — guard against stale state; no fire-and-forget.
- **Test coverage** — every public method has explicit tests.
- **Keep state minimal and local** — prefer derived values over stored duplicates.
- **Delete freely** — dead code is a liability; version control remembers.

**Section 2 — Coding standards.** Project-specific rules (language config, lint rules, test requirements).

### docs/PLANS.md

```markdown
# Plans

Plans are first-class artifacts.

## Lightweight plan (default)

For small changes:
- Put the plan in the PR description.
- Include: scope, acceptance criteria, test plan.

## Execution plan (required for complex work)

Create a new file under `docs/exec-plans/active/` when:
- It spans multiple domains
- It changes the data model or critical paths
- It introduces operational or security risk
- It's likely to take more than one session
- It has non-obvious tradeoffs

### Template

Create: `docs/exec-plans/active/<yyyy-mm-dd>-<short-title>.md`

Skeleton:
- Goal
- Non-goals
- Constraints
- Current state
- Proposed approach
- Alternatives considered
- Risks and mitigations
- Acceptance criteria
- Test plan
- Rollout / migration plan
- Progress log (append-only, dated)
- Decision log (append-only, dated)

## Tech debt

If you discover debt:
- Add it to `docs/exec-plans/tech-debt-tracker.md`
- Link the PR or plan that introduced it
```

### docs/exec-plans/tech-debt-tracker.md

```markdown
# Tech Debt Tracker

This is the canonical list of known technical debt.

Rules:
- Every item must have a clear next action.
- Every item must have an owner (human or "unassigned").
- Close items by linking the PR and moving them to "Closed".

## Active

| ID | Area | Severity | Summary | Owner | Next action |
|---:|------|----------|---------|-------|-------------|
(none)

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
(none yet)
```

### docs/ARCHITECTURE.md

Ask the user for: tech stack, major components, data model, deployment model. Write:
- High-level design (1–2 paragraphs)
- Repo layout (tree diagram matching actual directories)
- Component relationships
- Data model (abridged)
- Key protocols or APIs

### docs/RELIABILITY.md

Ask the user for: performance targets, SLAs, offline requirements. Write:
- Concrete budgets with numbers (e.g., "primary UI actions: <16ms")
- Invariants that must never be violated
- What happens when a budget is at risk (flag before proceeding)

### docs/QUALITY_SCORE.md

```markdown
# Quality Score

Grades each major domain by architectural layer.

Scale: A (strong) → F (unacceptable)

Layers: Types, Repo, Service, Runtime, UI, Tests

**Last updated:** {{today's date}}

## Domains

{{Leave empty — fill in after the first audit}}

## Systemic gaps

{{Leave empty — identify during first audit}}

## Notes

This file is allowed to be uncomfortable.
If a grade is C/D/F, the next action must be concrete.
```

---

## Step 4: Create git hooks

Create `hooks/pre-commit` and `hooks/pre-push`. These must be executable.

Ask the user what their quality gates are (lint, type-check, tests, formatter). Then write hooks that enforce them.

Template for `hooks/pre-commit`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Load user tool paths (hooks run with a stripped environment)
[ -f "$HOME/.profile" ] && . "$HOME/.profile"

echo "=== pre-commit ==="

# {{Adapt these to the project's tech stack}}
# Example for a TypeScript project:
# cd web && npm run lint && npm run check && npm run test

# Example for a Rust project:
# cargo fmt -- --check && cargo clippy -- -D warnings
```

Then run:

```bash
git config core.hooksPath hooks
chmod +x hooks/pre-commit hooks/pre-push
```

---

## Step 5: Create the SessionStart hook

Write `.claude/hooks/session-start.sh`:

```bash
#!/usr/bin/env bash
# SessionStart hook — injects repo context at the start of every conversation.
# Keep this fast (<500ms). No network calls.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Branch and working tree state
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'detached')"
DIRTY="$(git status --short 2>/dev/null | wc -l | tr -d ' ')"

# Active execution plans
ACTIVE_DIR="$ROOT/docs/exec-plans/active"
PLANS=""
if [ -d "$ACTIVE_DIR" ]; then
  PLANS="$(find "$ACTIVE_DIR" -maxdepth 1 -name '*.md' -not -name 'README.md' -not -name '.*' -exec basename {} \; 2>/dev/null | sort)"
fi

# Tech debt active count
DEBT_FILE="$ROOT/docs/exec-plans/tech-debt-tracker.md"
DEBT_COUNT=0
if [ -f "$DEBT_FILE" ]; then
  DEBT_COUNT="$(awk '/^## Active/,/^## Closed/' "$DEBT_FILE" | grep -cE '^\| *[0-9]' || true)"
fi

# Output — you (the AI) see this as session context
echo "## Session context (auto-injected)"
echo "- **Branch:** $BRANCH"
echo "- **Uncommitted changes:** $DIRTY file(s)"

if [ -n "$PLANS" ]; then
  echo "- **Active exec plans:**"
  echo "$PLANS" | while read -r p; do echo "  - \`$p\`"; done
else
  echo "- **Active exec plans:** none"
fi

echo "- **Active tech debt items:** $DEBT_COUNT"
```

Make it executable:

```bash
chmod +x .claude/hooks/session-start.sh
```

---

## Step 6: Register the hook

Write `.claude/settings.json`:

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

## Step 7: Create skills

Write each file below into `.claude/commands/`. These are slash commands the user (or you) invoke.

### .claude/commands/kickoff.md

```markdown
# Kickoff

Create a concise execution brief before starting implementation on a simple, single-domain change.

Use for: small features, bug fixes, targeted refactors, doc updates.
Use `kickoff-complex` instead when work spans multiple domains or has non-obvious tradeoffs.

## Workflow

1. **Check existing context first.** Before asking the user anything:
   - Read `docs/exec-plans/active/` — if an active plan relates to the request, surface it.
   - Read `docs/exec-plans/tech-debt-tracker.md` — if a debt item matches, reference it.
   - Read `docs/CONTRIBUTING.md` — confirm the design principles that apply.
   - If the request is already covered by an existing plan, say so and skip to step 5.

2. Ask the user to fill this template:

   Goal:
   Scope:
   Constraints:
   Authoritative docs:
   Deliverables:

3. Keep the ask short and explicit. Do not add implementation details or suggest solutions.

4. Check for missing or vague fields. Ask one concise follow-up listing only what's missing.

5. Normalize the user input into an Execution Brief using the same five headings.

6. Start implementation only after the brief is complete and confirmed.

## Rules

- Prefer reference pointers over long prose.
- Preserve user wording where possible.
- Suggest defaults only when the user leaves a field blank.
- Do not propose solutions or design choices during kickoff.
- When work is complete, follow the session protocol closing steps in CLAUDE.md.
```

### .claude/commands/kickoff-complex.md

```markdown
# Kickoff Complex

Enforce plan-first intake for complex work. Coding is blocked until an execution plan exists and is approved.

## Workflow

1. **Check existing context first.** Before asking the user anything:
   - Read `docs/exec-plans/active/` — surface related plans.
   - Read `docs/exec-plans/tech-debt-tracker.md` — reference relevant debt.
   - Read `docs/CONTRIBUTING.md` — confirm principles.
   - If already covered by an existing plan, resume it instead.

2. Ask the user to fill this intake template:

   Goal:
   Scope:
   Constraints:
   Authoritative docs:
   Deliverables:
   Complexity signal: (why this is non-trivial)

3. If any field is missing or vague, ask one concise follow-up.

4. Produce a normalized Execution Brief.

5. Produce a Plan Gate block:

   Plan required: Yes
   Execution plan path: docs/exec-plans/active/YYYY-MM-DD-short-title.md
   Coding status: Blocked until plan is written and approved

6. Draft the execution plan using the template from docs/PLANS.md.

7. Write the plan file and confirm with the user before coding.

## Rules

- Do not write implementation code until the plan is approved.
- Acceptance criteria must be specific and testable.
- Progress log and decision log entries are append-only and dated.
- When work is complete, follow the session protocol closing steps in CLAUDE.md.
```

### .claude/commands/commit-only.md

```markdown
# Commit Only

Safely stage and commit without pushing. All quality gates enforced.

## Required input
- Commit message provided as $ARGUMENTS.
- Reject generic messages (update, fix, wip).
- If no message provided, ask for one.

## Workflow
1. Run git status and git diff to understand what will be staged.
2. Stage changes by file (prefer explicit paths over git add .).
3. Commit using HEREDOC format with co-author trailer.

## Failure handling
If the commit fails — stop. Do not retry blindly. Do not amend.
Read the error. Fix the root cause. Re-run from step 1.
Never use --no-verify.

If the same failure repeats, add it to docs/exec-plans/tech-debt-tracker.md.
```

### .claude/commands/commit-and-push.md

```markdown
# Commit And Push

Safely commit and push to origin with all quality gates enforced.

## Required input
- Commit message provided as $ARGUMENTS.
- Reject generic messages (update, fix, wip).
- If no message provided, ask for one.

## Workflow
1. Run git status and git diff.
2. Stage changes by file (explicit paths, not git add .).
3. Commit using HEREDOC format with co-author trailer.
4. Push to origin: git push.

## Failure handling
If any step fails — stop. Do not retry blindly. Do not amend or force-push.
Read the error. Fix the root cause. Re-run from step 1.
Never use --no-verify. Never force-push.

If the same failure repeats, add it to docs/exec-plans/tech-debt-tracker.md.
```

---

## Step 8: Verify the scaffolding

After creating all files, run this checklist:

1. `ls CLAUDE.md` — exists at project root
2. `ls docs/index.md docs/CONTRIBUTING.md docs/PLANS.md docs/ARCHITECTURE.md docs/RELIABILITY.md` — all exist
3. `ls docs/exec-plans/tech-debt-tracker.md` — exists
4. `ls docs/exec-plans/active/ docs/exec-plans/completed/` — directories exist
5. `ls hooks/pre-commit hooks/pre-push` — exist and are executable
6. `ls .claude/hooks/session-start.sh` — exists and is executable
7. `ls .claude/settings.json` — exists with SessionStart hook
8. `ls .claude/commands/kickoff.md .claude/commands/kickoff-complex.md .claude/commands/commit-only.md .claude/commands/commit-and-push.md` — all exist
9. `.claude/hooks/session-start.sh` — runs and prints session context
10. `git config core.hooksPath` — returns `hooks`

Tell the user which checks passed and which need attention.

---

## Session lifecycle (reference diagram)

Once scaffolding is complete, every conversation follows this flow:

```
┌─────────────────────────────────────────────────┐
│  1. SessionStart hook fires                     │
│     → branch, plans, debt injected as context   │
├─────────────────────────────────────────────────┤
│  2. You read CLAUDE.md (session protocol)       │
│     → read index.md → CONTRIBUTING.md           │
│     → check active plans                        │
│     → check tech debt                           │
├─────────────────────────────────────────────────┤
│  3. User describes work                         │
│     → you check for plan overlap                │
│     → use /kickoff or /kickoff-complex          │
├─────────────────────────────────────────────────┤
│  4. Implementation                              │
│     → follow CONTRIBUTING.md principles         │
│     → respect RELIABILITY.md budgets            │
│     → update plan progress log at milestones    │
├─────────────────────────────────────────────────┤
│  5. Closing discipline                          │
│     → update docs if behavior changed           │
│     → add tech debt if debt created             │
│     → move completed plans to completed/        │
│     → run quality gates                         │
│     → use /commit-and-push                      │
└─────────────────────────────────────────────────┘
```

---

## Maintenance operations (for ongoing sessions)

### Adding a new doc
1. Create the file in `docs/`.
2. Add it to `docs/index.md`.
3. If CLAUDE.md should reference it, add to the reference docs list.

### Adding a new skill
1. Create `.claude/commands/<name>.md`.
2. Include: description, workflow steps, rules, failure handling.
3. Reference the session protocol closing steps.

### Plan lifecycle
1. Create in `active/` with dated filename.
2. Update CLAUDE.md plan list.
3. Append to progress log during work (dated, append-only).
4. When done: check acceptance criteria, move to `completed/`, update CLAUDE.md.

### Tech debt lifecycle
1. Add to Active table with ID, area, severity, summary, owner, next action.
2. When resolved: move to Closed table with date and PR link.
3. If all active items are closed, write `(none — all items closed)` in the Active table.

### Quality score updates
1. Gather current test counts and coverage data.
2. Update `docs/QUALITY_SCORE.md` domain tables.
3. Update summary table and trends.
4. Close resolved systemic gaps.
