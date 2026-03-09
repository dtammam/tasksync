# Test Posture And Pipeline Cost

Date: 2026-02-24
Status: In Progress
Owner: Codex + project maintainer

## Goal

Assess and improve project-wide testing posture so confidence stays high while local and CI execution cost is reduced where possible.

## Non-goals

- No weakening of role/security, offline-first, sync determinism, or performance-budget coverage.
- No bypassing or removing pre-commit, pre-push, or pre-merge quality gates.
- No product behavior changes unrelated to test strategy and pipeline execution.

## Constraints (perf/offline/security)

- Maintain reliability contracts in `docs/RELIABILITY.md`:
  - UI latency, audio onset, search budgets.
  - offline-first local mutation guarantees.
  - sync idempotency and deterministic convergence.
- Keep hook enforcement in place:
  - `hooks/pre-commit`
  - `hooks/pre-push`
- Keep PR/merge CI enforcement in place via `.github/workflows/ci.yml`.
- Any optimization must preserve or improve measurable confidence for critical flows.

## Current state (what exists today)

- Web pre-commit gate runs `npm run lint`, `npm run check`, and `npm run test`.
- Pre-push gate runs web unit tests, Playwright smoke, and server tests.
- CI web job currently runs lint/check/unit plus full Playwright run (`chromium`, `firefox`, `webkit`) after `npx playwright install --with-deps`.
- CI server job runs `cargo fmt -- --check`, `cargo clippy -- -D warnings`, and `cargo test`.
- Recent observed bottlenecks:
  - Playwright browser dependency setup (`install --with-deps`) is expensive and can appear stalled while apt installs system packages.
  - Full multi-browser E2E execution dominates end-to-end pre-push/CI wall time.

## Proposed approach

1. Baseline and classify
- Build a test inventory matrix by layer (unit/integration/e2e) and by invariant (offline, sync determinism, role security, UX critical flows, perf budgets).
- Capture baseline runtime for:
  - local pre-commit
  - local pre-push (with and without Playwright)
  - CI web and server jobs
- Record flaky/failure-prone tests and failure causes (true regressions vs environment setup delays).

2. Decide posture rating
- Produce explicit rating: `underdone`, `adequate`, or `overdone`.
- Use objective criteria:
  - Coverage of required invariants from `docs/RELIABILITY.md`.
  - Signal-to-cost ratio of each test group.
  - Duplication level (same behavior checked expensively in multiple layers).

3. Optimize without reducing confidence
- Define a two-tier E2E strategy:
  - fast deterministic smoke gate for local pre-push.
  - broader matrix validation in pre-merge CI.
- Keep hook presence intact while right-sizing what each hook executes.
- Add/adjust tags or project selection so high-cost browsers/scenarios run where they add unique signal.
- Improve browser/dependency caching in CI for Playwright to reduce repeated download/install cost.

4. Backfill coverage if gaps are found
- If expensive E2E checks are reduced, replace lost signal with targeted unit/integration tests where appropriate.
- Preserve deterministic assertions for previously flaky areas (first-save behavior, recurrence/punt/my-day interactions, sync idempotency).

5. Land changes with explicit measurement
- Include before/after timing and confidence summary in PR notes.
- Update exactly one authoritative doc only if behavioral/testing policy changes require it.

## Alternatives considered

- Keep all current tests and accept cost growth.
  - Rejected: cost and contributor feedback indicate rising friction.
- Aggressively cut E2E scope.
  - Rejected: high risk of confidence regression and misses user priority.
- Move all expensive checks to nightly only.
  - Rejected: weakens pre-merge signal for critical regressions.

## Risks and mitigations

- Risk: accidental test coverage regression while reducing runtime.
  - Mitigation: require invariant-to-test mapping and no unowned coverage gaps.
- Risk: hidden flakiness masked by retries.
  - Mitigation: track flaky tests separately and fix root causes; limit retries to transient environment failures.
- Risk: CI environment variance (browser install/deps) dominates runtime.
  - Mitigation: explicit Playwright and dependency caching strategy, and pinned versions.
- Risk: local developer workflows diverge from CI confidence.
  - Mitigation: document gate intent and ensure local smoke plus CI matrix are complementary, not conflicting.

## Acceptance criteria

- Produce a written assessment with posture rating (`underdone`, `adequate`, or `overdone`) and rationale.
- Define approved target test split across pre-commit, pre-push, and pre-merge CI.
- Maintain or improve coverage for reliability/security/offline/determinism invariants.
- Demonstrate measurable improvement in median pipeline cost (local and/or CI) without increased escape defects.
- Keep all required hooks and CI quality gates active.

## Assessment snapshot (2026-02-26)

- Posture rating: `adequate` overall, with `overdone` local/branch-push E2E breadth.
- Invariant coverage (current owners):
  - offline-first + sync idempotency: `web/src/lib/sync/*.test.ts`, `web/src/lib/sync/coordinator.test.ts`, `server/src/routes.rs` sync/idempotency tests.
  - deterministic task mutation and recurrence/punt/my-day: `web/src/lib/stores/tasks.test.ts`, `web/tests/e2e/myday.spec.ts` smoke-tagged determinism checks.
  - role/security enforcement: `server/src/routes.rs` contributor/admin authorization tests, `web/tests/e2e/auth.spec.ts` smoke-tagged sign-in flow.
- Baseline execution shape before change:
  - local pre-push Playwright command executed all projects (`chromium`, `firefox`, `webkit`) with retries.
  - local run in this environment took `~4m06s` before failing due missing Linux browser runtime libs (so wall-time baseline reflects gate breadth, not pass latency).
- Updated target split implemented:
  - local pre-push Playwright now runs Chromium-only `@smoke` subset (`6` tests currently selected).
  - CI branch push runs lint/check/unit + Chromium smoke.
  - CI pull request runs full Playwright suite in a browser matrix (`chromium`, `firefox`, `webkit`) with per-browser caching/install.
- Measured local smoke gate command in this environment: `~18s` wall time before failing at browser launch due missing libs.

## Test plan

- Validation of the test-strategy change itself:
  - run baseline and post-change timings for local pre-push and CI web workflow.
  - run representative regression set for:
    - first detail save determinism
    - recurrence + punt + my day interactions
    - role enforcement paths
    - offline queue and sync convergence
- Confirm no required invariant from `docs/RELIABILITY.md` is left without an owning automated test.

## Rollout / migration plan (if any)

- Phase 1: assessment-only deliverable and plan approval.
- Phase 2: implement agreed test/pipeline adjustments on a dedicated branch.
- Phase 3: monitor first 3-5 PRs post-change for runtime and failure quality.
- Phase 4: document final posture decision and any residual tech debt.

## Progress log (append-only, dated)

- 2026-02-24: Intake completed and plan created. Implementation blocked pending approval of this plan.
- 2026-02-26: Baseline inventory captured for web unit, web e2e, and server authorization/sync tests; posture rated `adequate` with over-broad local E2E gate.
- 2026-02-26: Implemented two-tier E2E gate split (local/branch-push smoke vs PR full matrix), plus Playwright cache/install refinements in CI.
- 2026-02-26: Updated reliability policy doc with explicit gate split and command ownership.

## Decision log (append-only, dated)

- 2026-02-24: Chosen approach is optimize-by-mapping (coverage matrix + runtime baseline) before changing gates.
- 2026-02-26: Keep all required hooks/gates but reduce local pre-push E2E to deterministic Chromium smoke via `@smoke` tagging.
- 2026-02-26: Keep full cross-browser validation in pre-merge CI by running Playwright as a browser matrix on pull requests only.
- 2026-02-26: Cache Playwright browser assets in CI and install only needed browser per job to reduce repeated setup cost.
