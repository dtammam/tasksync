# Commit Only

Safely stage and commit the current working state without pushing. All quality gates enforced.

## Required input
- Commit message is provided as $ARGUMENTS.
- Reject generic messages: `update`, `fix`, `wip`, or anything that doesn't explain what changed and why.
- If no message is provided, ask for one before proceeding.

## Preconditions
- Confirm the working directory is a git repository.
- Hooks are authoritative — do not override them.

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

## Failure handling (mandatory)
If the commit fails — stop immediately. Do not retry blindly. Do not amend.

Identify the failure class:
- **pre-commit hook** — lint, format, type-check, or unit test failure

Enter fix loop:
1. Read error output carefully.
2. Determine if it's a test failure, lint/format issue, or violated invariant.
3. Fix the underlying issue in code or tests.
4. Do not weaken or disable checks to pass the commit.
5. Re-run from step 1 of this workflow.
6. Update the commit message if the scope of change materially changed.

If a test fails due to unclear expectations, stop and ask rather than guessing.

## Repo-specific gate (do not bypass)
- `pre-commit`: lint + type-check + vitest (web); fmt + clippy (server)
- Never use `--no-verify`.

## Success criteria
- `git commit` exits cleanly.
- All pre-commit hooks passed without skipping.

## Notes
- If the same failure repeats across attempts, add it to `docs/exec-plans/tech-debt-tracker.md` instead of fighting the gate.
- Never squash or rewrite history unless explicitly instructed.
