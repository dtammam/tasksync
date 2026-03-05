# Kickoff Complex

Enforce plan-first intake for complex work. Coding is blocked until an execution plan exists and is approved.

Use when the work:
- Spans multiple domains (web + server + shared)
- Changes sync behavior or the data model
- Introduces new operational or security risk
- Is likely to take more than one focused session
- Has non-obvious tradeoffs

Use `/kickoff` instead for small, single-domain changes.

## Workflow

1. Ask the user to fill this intake template:

```
Goal:
Scope:
Constraints:
Authoritative docs:
Deliverables:
Complexity signal: (why this is non-trivial — cross-domain risk, data migration, perf/security impact, or multi-session effort)
```

2. If any field is missing or vague, ask one concise follow-up listing only what's missing.

3. Produce a normalized `Execution Brief` using the same headings.

4. Produce a `Plan Gate` block:

```
Plan required: Yes
Execution plan path: docs/exec-plans/active/YYYY-MM-DD-short-title.md
Coding status: Blocked until plan is written and approved
```

5. Draft the execution plan skeleton using the template from `docs/PLANS.md`:
   - Goal / Non-goals / Constraints / Current state / Proposed approach /
     Alternatives considered / Risks and mitigations / Acceptance criteria /
     Test plan / Rollout plan / Progress log / Decision log

6. Write the plan file to `docs/exec-plans/active/` and confirm with the user before proceeding to implementation.

## Rules

- Do not write implementation code until the plan is approved.
- Constraints must always include: offline-first preserved, performance budgets not regressed, quality gates not bypassed, no new unreviewed security surface.
- Keep intake concise and referential — no long prose when a doc reference will do.
- Acceptance criteria must be specific and testable.
- Progress log and decision log entries are append-only and dated.
