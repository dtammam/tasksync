# Offline-First Shell And Sync Continuity

Date: 2026-02-26
Status: In Progress
Owner: Codex + project maintainer

## Goal

Make tasksync usable during full network loss (including hard reload / app relaunch): users should be able to open the app, see previously cached data, keep working, and sync safely when connectivity returns.

## Non-goals

- No weakening of server-side role enforcement or auth boundaries.
- No migration to a user-managed local file UX (unless explicitly approved later).
- No replacement of existing sync conflict rules in this phase.

## Constraints (perf/offline/security)

- Preserve `docs/RELIABILITY.md` invariants:
  - offline local mutations continue to work.
  - push/pull idempotency and deterministic convergence remain testable.
- Preserve perceived performance budgets (fast startup and interaction responsiveness).
- Keep auth and role checks server-authoritative for remote operations.
- Do not regress existing pre-commit/pre-push/CI quality gates.

## Current state (what exists today)

- Local data persistence and offline queueing already exist in IndexedDB-backed stores.
- Auth store can retain token-mode cached user for some network-failure hydrations.
- Startup hydrates local stores, then refreshes settings/preferences/members from server.
- Critical gap: offline app-shell boot is not guaranteed on hard reload/relaunch because there is no explicit service worker caching strategy for the SvelteKit shell/assets.

## External reference model (Actual Budget)

Observed behaviors from Actual docs/source-of-truth pages:

- They position data as local-first: data resides locally and sync is optional/continuous when configured.
- They describe background syncing to a chosen server when connectivity is available.
- Their install docs explicitly call out offline usage support for installed web/PWA flows.

Design takeaway for tasksync:
- Keep local data as the source for immediate UX.
- Treat server as sync rendezvous and durability peer, not a hard runtime dependency for app boot.

Confidence note:
- This plan currently uses public Actual docs as a behavioral benchmark only.
- We have not yet completed a deep code-level protocol review of Actual sync internals; if needed, that can be added as a discrete discovery sub-task before implementation details are finalized.

## Proposed approach

1. Offline app-shell boot (PWA baseline)
- Add an explicit service worker strategy for app-shell assets and route entry so a hard reload can render UI while offline.
- Ensure manifest/icon/runtime config assets required for first paint are cacheable and version-safe.

2. Deterministic local-first startup path
- Reorder/guard startup so route UI can render from local stores before best-effort server calls complete.
- Keep explicit offline states in UI (for clarity) without blocking local interaction.

3. Resilient auth-scope hydration offline
- Ensure last-known authenticated scope remains available for local data access when connectivity is down and token mode has cached identity.
- Avoid accidental scope fallbacks that hide existing local data during transient outages.

4. Sync recovery and correctness hardening
- On reconnect/focus, replay queued changes and reconcile remote snapshots using existing idempotent semantics.
- Add assertions for no-duplication and deterministic end state after prolonged offline work.

5. Test and measurement expansion
- Add/expand automated tests for:
  - hard reload while offline still opens app shell and local tasks.
  - offline edit/create flows across reload boundaries.
  - reconnect replay correctness (no duplicates, convergence preserved).
- Add a lightweight startup timing capture for offline launch path to avoid latency regressions.

## Alternatives considered

- Introduce user-selected local data files (manual download/open workflow).
  - Deferred: adds UX/operational complexity beyond immediate gap.
- Keep current model and only improve messaging.
  - Rejected: does not solve inability to open and continue during hard offline.

## Risks and mitigations

- Risk: stale cached shell mismatches server/runtime config.
  - Mitigation: versioned cache keys and explicit SW update strategy.
- Risk: auth/session ambiguity offline exposes wrong local scope.
  - Mitigation: strict cached-identity validation and scoped hydration tests.
- Risk: sync replay edge cases after long offline sessions.
  - Mitigation: deterministic integration tests for replay and tombstone/convergence cases.

## Acceptance criteria

- App can hard reload offline and render usable UI from local cache.
- Existing local tasks/lists are visible offline for last signed-in user scope.
- Local create/edit/complete actions continue to work offline and survive reload.
- Reconnect sync converges deterministically without duplicate entities.
- CI contains explicit automated coverage for offline boot + replay correctness.

## Test plan

- Unit/integration:
  - startup bootstrap behavior (local-first render gating).
  - auth scope selection during offline/online transitions.
  - sync replay idempotency invariants under queued mutation bursts.
- E2E (Playwright):
  - seed data online, go offline, hard reload, verify data visible.
  - perform offline mutations, restore network, verify convergence and no duplicates.
- Performance checks:
  - compare offline boot render time before/after implementation.

## Rollout / migration plan

- Phase 1: land plan + baseline failing tests for offline hard-reload gap.
- Phase 2: implement SW shell caching + startup gating adjustments behind incremental PRs.
- Phase 3: land replay hardening and reconnection test coverage.
- Phase 4: monitor first release cycle for offline regressions and sync anomaly reports.

## Progress log (append-only, dated)

- 2026-02-26: Branch created (`feat/offline-local-cache-ux`) and planning artifact drafted.
- 2026-02-26: External reference review (Actual Budget docs) captured as local-first benchmark input.
- 2026-02-26: Corrected Actual reference scope to docs-backed behavior only; deep protocol specifics remain unclaimed pending code review.
- 2026-02-26: Phase 1 started: added SvelteKit service worker shell/runtime caching scaffold and Playwright offline hard-reload continuity coverage.
- 2026-02-26: Startup bootstrap updated so app readiness is driven by local hydration, while remote preferences/member refresh runs best-effort in background.

## Decision log (append-only, dated)

- 2026-02-26: Plan-first approach selected; coding blocked pending plan approval.
- 2026-02-26: Chosen direction is local-first shell boot + deterministic replay, not local-file-first UX.

## References

- https://actualbudget.org/docs/install/
- https://actualbudget.org/docs/getting-started/sync/
- https://actualbudget.org/docs/faq/
- https://github.com/actualbudget/actual
