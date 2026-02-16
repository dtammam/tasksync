# Plans

Plans are first-class artifacts.

This repo uses two levels of planning:

## 1) Lightweight plan (default)

For small changes:
- Put the plan in the PR description (or top of the issue).
- Include: scope, acceptance criteria, test plan, rollout notes (if relevant).

If it’s not worth an execution plan, it’s still worth a 5–10 line plan.

## 2) Execution plan (required for complex work)

Create a new file under `docs/exec-plans/active/` when:
- It spans multiple domains (web + server + shared)
- It changes sync behavior / data model
- It introduces new operational or security risk
- It’s likely to take more than one focused session
- It has non-obvious tradeoffs

### Execution plan template

Create: `docs/exec-plans/active/<yyyy-mm-dd>-<short-title>.md`

Use this skeleton:

- Goal
- Non-goals
- Constraints (perf/offline/security)
- Current state (what exists today)
- Proposed approach
- Alternatives considered
- Risks and mitigations
- Acceptance criteria
- Test plan
- Rollout / migration plan (if any)
- Progress log (append-only, dated)
- Decision log (append-only, dated)

## Tech debt

If you discover debt:
- Add it to `docs/exec-plans/tech-debt-tracker.md`
- Link the PR or plan that introduced it (if known)
