# Tech Debt Tracker

This is the canonical list of known technical debt.

Rules:
- Every item must have a clear next action (even if it’s “decide”).
- Every item must have an owner (human or “unassigned”).
- Close items by linking the PR and moving them to “Closed”.

## Active

| ID | Area | Severity | Summary | Why it matters | Next action | Owner | Link |
|---:|------|----------|---------|----------------|------------|-------|------|
| 001 | Docs | Med | Replace monolithic agent guidance with map + structured docs | Reduces drift; improves agent reliability | Land new `AGENTS.md` + docs tree | unassigned | (add PR) |
| 002 | Perf | High | Make latency budgets mechanically enforced in CI | Prevent silent regressions | Add benchmarks + CI gates | unassigned | (add plan) |
| 003 | Arch | Med | Enforce frontend layer boundaries with lints | Prevent coupling & drift | Add ESLint boundary rules | unassigned | (add plan) |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| - | - | - | - | - |
