# Commit And Push

Safely finalize repository state by committing and pushing to origin with all quality gates enforced.

## Required input
- Commit message is provided as $ARGUMENTS.
- Reject generic messages: `update`, `fix`, `wip`, or anything that doesn't explain what changed and why.
- If no message is provided, ask for one before proceeding.

## Preconditions
- Confirm the working directory is a git repository.
- Hooks and CI are authoritative — do not override them.

## Workflow
1. Inspect state: run `git status` and `git diff` to understand what will be staged.
2. Stage changes by file (prefer explicit paths over `git add .` to avoid accidentally staging secrets or large binaries).
3. Commit using the provided message in HEREDOC format with co-author trailer:
   ```
   git commit -m "$(cat <<'EOF'
   <message>

   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```
4. Push to origin: `git push`.

## Failure handling (mandatory)
If any step fails — stop immediately. Do not retry blindly. Do not amend or force-push.

Identify the failure class:
- **pre-commit hook** — lint, format, type-check, or unit test failure
- **pre-push hook** — Playwright smoke or integration test failure
- **CI rejection** — push succeeded but remote checks failed

Enter fix loop:
1. Read error output carefully.
2. Determine if it's a test failure, lint/format issue, or violated invariant (performance budget, sync determinism, security).
3. Fix the underlying issue in code or tests.
4. Do not weaken or disable checks to pass the commit.
5. Re-run from step 1 of this workflow.
6. Update the commit message if the scope of change materially changed.

If a test fails due to unclear expectations, stop and ask rather than guessing.

## Repo-specific gates (do not bypass)
- `pre-commit`: lint + type-check + vitest (web); fmt + clippy (server)
- `pre-push`: web unit + Playwright `@smoke` Chromium-only + `cargo test`
- Never use `--no-verify`. Never force-push.

## Success criteria
- `git push` exits cleanly.
- All local hooks passed without skipping.
- CI is expected to be green based on the same checks run locally.

## Notes
- If the same failure repeats across attempts, add it to `docs/exec-plans/tech-debt-tracker.md` instead of fighting the gate.
- Never squash or rewrite history unless explicitly instructed.
