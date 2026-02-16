# Command formatting

When outputting runnable commands:

- Put each command on its own line in a fenced code block.
- Do not wrap commands across lines.
- Do not prefix commands with bullets/numbers.
- Prefer repo scripts under `/scripts/` over ad-hoc commands.

PowerShell:
- If you need environment variables for one command, set them inline with `$env:NAME="value"; ...`
- Do not include machine-specific absolute paths.
