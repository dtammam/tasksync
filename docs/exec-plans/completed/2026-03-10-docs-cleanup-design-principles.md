# Docs Cleanup & Software Design Principles

**Created:** 2026-03-10
**Branch:** `chore/docs-cleanup-design-principles`

## Goal

Clean up high-level docs to reflect what the codebase actually is today, remove stale Cursor/Codex/Windows-centric content, and add explicit software design principles to the contributing standards.

## Non-goals

- Rewriting code (this is docs-only)
- Adding new lint rules or CI checks (that's tech debt 002/003)
- Changing any runtime behavior

## Constraints

- Docs must stay consistent with CLAUDE.md as the agent entry point
- No information loss — consolidate, don't delete knowledge

## Current state

- **AGENTS.md** — written for Cursor/Codex with Windows `.ps1` scripts. Duplicates CLAUDE.md, CONTRIBUTING.md, and RELIABILITY.md heavily. Tech debt item 001.
- **CONTRIBUTING.md** — thin, defers to AGENTS.md. Missing software design principles.
- **ARCHITECTURE.md** — repo layout section stale (wrong nesting for components, shared types, missing recent dirs like `markdown/`, `assets/`, `tasks/`).
- **QUALITY_SCORE.md** — grades likely stale after streak, sound recovery, offline, punt, recurrence work.
- **repo-conventions.md** — references `.ps1` scripts as primary interface.
- **index.md** — links to bloated AGENTS.md.

## Proposed approach

1. **CONTRIBUTING.md** — expand with software design principles section (modularity, single responsibility, clean functions, DRY, explicit over implicit, minimal coupling). Make this the canonical coding standards doc.
2. **AGENTS.md** — slim down to agent-specific operating instructions only. Remove Windows scripts, remove duplicated performance budgets/test requirements (link to RELIABILITY.md and CONTRIBUTING.md instead). Keep: guiding principles, tech stack summary, file naming conventions, definition of done.
3. **ARCHITECTURE.md** — fix repo layout to match reality. Minor accuracy pass on descriptions.
4. **QUALITY_SCORE.md** — update grades based on current state.
5. **repo-conventions.md** — update to be platform-neutral.
6. **index.md** — adjust descriptions to match updated docs.

## Risks and mitigations

- **Risk:** Losing useful information from AGENTS.md. **Mitigation:** Move content to the right home, don't delete outright.
- **Risk:** CLAUDE.md references become stale. **Mitigation:** CLAUDE.md already points to docs/; just verify links.

## Acceptance criteria

- [x] CONTRIBUTING.md has explicit software design principles
- [x] AGENTS.md is slim, non-duplicative, platform-neutral
- [x] ARCHITECTURE.md repo layout matches actual directory tree
- [x] QUALITY_SCORE.md grades reflect recent work
- [x] All doc cross-references are consistent
- [x] Quality gates pass (lint + check + vitest)

## Progress log

- 2026-03-10: Plan created. Branch created from main with tech debt 005 cleanup (dead setMyDay removal) carried forward.
- 2026-03-13: Review pass. CONTRIBUTING.md already had design principles (added across prior sessions); consolidated duplicate "Software design principles" and "Design principles" sections into single unified section. AGENTS.md already slim and platform-neutral. ARCHITECTURE.md repo layout already accurate. repo-conventions.md already clean (no .ps1 references). Updated QUALITY_SCORE.md: refreshed all domain grades to reflect code health work (244 vitest, 40 server, 45 Playwright tests; @ts-nocheck removed; routes.rs split; ESLint boundaries enforced; perf bench + offline boot tests added); closed 3 of 4 systemic gaps (perf gates, boundary lint, offline timing all resolved). Plan complete.
