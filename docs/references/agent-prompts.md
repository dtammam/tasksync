# Agent prompts

These are templates. They are not the source of truth for constraints.
Constraints live in `docs/RELIABILITY.md`, `docs/ARCHITECTURE.md`, and `docs/SECURITY.md`.

## Feature

You are implementing: <feature>
- Read `docs/index.md` and relevant domain docs.
- Maintain offline-first behavior and budgets in `docs/RELIABILITY.md`.
- Deliver code + tests.
- If you change structure, update `docs/FRONTEND.md`.

Return:
- Summary of change
- Tests added/updated
- Any migrations (if server)
- Suggested commit message

## Bug

Investigate: <bug>
Return:
- Minimal repro steps
- Root cause
- Patch with a regression test
- Any perf impact and how verified

## API change

Design endpoint: <endpoint>
- Validate role rules server-side.
- Update shared types.
- Add integration tests for negative cases.
