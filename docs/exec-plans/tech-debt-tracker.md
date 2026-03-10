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
| 004 | Test | Low | Add offline boot timing measurement | Exec plan called for startup timing capture on offline launch path to catch latency regressions; never implemented | Add lightweight Playwright timing assertion to offline hard-reload test | unassigned | feat/offline-local-cache-ux |
| 005 | Store | Low | Remove dead `tasks.setMyDay()` method | All callers removed by My Day → due_date change; method compiles but has no call sites | Delete `setMyDay` from `tasks.ts` | unassigned | feat/my-day-due-today-and-recurrence-catchup |

## Closed

| ID | Area | Closed on | Summary | Link |
|---:|------|-----------|---------|------|
| - | - | - | - | - |
