# Kickoff

Create a concise execution brief before starting implementation on a simple, single-domain change.

Use for: small features, bug fixes, targeted refactors, doc updates.
Use `kickoff-complex` instead when the work spans multiple domains, touches sync behavior or the data model, or has non-obvious tradeoffs.

## Workflow

1. Ask the user to fill this template:

```
Goal:
Scope:
Constraints:
Authoritative docs:
Deliverables:
```

2. Keep the ask short and explicit. Do not add implementation details or suggest solutions.

3. Check for missing or vague fields. Ask one concise follow-up listing only what's missing.

4. Normalize the user input into an `Execution Brief` using the same five headings.

5. Start implementation only after the brief is complete and confirmed.

## Rules

- Prefer reference pointers over long prose (e.g. "see docs/RELIABILITY.md" not a copy of its contents).
- Preserve user wording where possible.
- Suggest defaults only when the user leaves a field blank.
- Do not propose solutions or design choices during kickoff.
- Constraints must always include: offline-first behavior preserved, performance budgets not regressed, no new security surface.
