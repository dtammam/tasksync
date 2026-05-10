# Rename Sidebar "Today" Label to "Lists"

## Goal

Rename the misleading sidebar top-zone section label from "Today" to "Lists" so it accurately describes the lists navigation it heads.

## Scope

Single string change on line 749 of `web/src/lib/components/Sidebar.svelte`: `<div class="section-label">Today</div>` becomes `<div class="section-label">Lists</div>`.

## Out of scope

- The `Workspace` label at line 802 (`<div class="section-label muted">Workspace</div>`) — must not change.
- Any other sidebar copy, structure, or behavior.
- New tests (existing E2E covers sidebar structure; quality gates must still pass unchanged).

## Constraints

- Bundle onto the existing `feat/remove-sidebar-pin` branch.
- Standard quality gates must pass: lint, svelte-check, vitest, format.

## Acceptance criteria

- [x] The `.section-label` element inside `.sidebar-zone-top` of `Sidebar.svelte` reads `Lists` (not `Today`).
- [x] The `.section-label.muted` element inside `.sidebar-zone-bottom` still reads `Workspace` (unchanged).
- [x] No other strings in `Sidebar.svelte` are modified by this change.
- [x] `cd web && npm run lint` passes.
- [x] `cd web && npm run check` passes.
- [x] `cd web && npm run test` passes.
- [x] `cd web && npm run format` reports no changes needed.

## Design

Replace the inner text of the `.section-label` element inside `.sidebar-zone-top`
at `web/src/lib/components/Sidebar.svelte` line 749 from `Today` to `Lists`. No
structural, CSS, ARIA, `data-testid`, or behavioral changes. A case-sensitive
grep audit of `web/src/` and `web/tests/` confirmed the literal string `Today`
appears in the sidebar exactly once (line 749). All other matches in `web/src/`
are camelCase identifiers in date-logic helpers (`setDueToday`, `isTodayTs`,
`wasCompletedToday`, etc. in `tasks.ts`, `TaskRow.svelte`, `TaskDetailDrawer.svelte`,
`streak.ts`) and are unrelated to the sidebar label. The single match in
`web/tests/` (`myday.spec.ts:126`) is a code comment referencing `setDueToday`,
not a selector. No E2E test uses `getByText('Today')`, `hasText: 'Today'`, or
`:has-text("Today")`; the project has no i18n layer; the target element carries
no ARIA attribute, `id`, or `data-testid`. The text node is purely visual copy
with no programmatic consumers.

**Risks:** None. The change is a one-token text replacement on a label with no
selectors, hooks, ARIA bindings, or i18n keys tied to it. No performance,
accessibility, or layer-boundary impact.

## Task breakdown

### T1 — Replace sidebar top-zone section label text "Today" with "Lists"

- **Files:** `web/src/lib/components/Sidebar.svelte`
- **Change:** At line 749, change the inner text of the `.section-label`
  element inside `.sidebar-zone-top` from `Today` to `Lists`. Do not modify
  any other line, attribute, ARIA hook, `data-testid`, CSS class, or
  structure. Do not touch the `.section-label.muted` element at line 802
  (`Workspace`).
- **Quality gates (must all pass):**
  - `cd web && npm run lint`
  - `cd web && npm run check`
  - `cd web && npm run test`
  - `cd web && npm run format` (no changes needed)
- **Done when:** `Sidebar.svelte` line 749 reads
  `<div class="section-label">Lists</div>`; line 802 still reads
  `<div class="section-label muted">Workspace</div>`; lint, check, test,
  and format all pass.

Rationale for one task: the PE design audit confirmed zero hidden
dependencies (no selectors, ARIA bindings, i18n keys, or `data-testid`
tied to the label). Splitting further would have no testable benefit.

## Progress log

- 2026-05-10: Exec plan created during Discovery. Target confirmed at Sidebar.svelte line 749. Workspace label at line 802 verified as out of scope.
- 2026-05-10: Design added by principal-engineer. Grep audit of `web/src/` and `web/tests/` for literal `Today` returned 37 hits in src and 1 hit in tests; all non-sidebar hits are camelCase identifiers in date-logic code or a code comment. No E2E selector, ARIA label, i18n hook, or `data-testid` is tied to the sidebar label. Risk assessment: none. Safe to proceed to task breakdown.
- 2026-05-10: T1 implemented by software-developer. Sidebar.svelte line 749 updated. Lint, check, test, and format all pass. Build-specialist confirmed all quality gates green. QA approved. PM acceptance passed all 7 criteria. Plan complete.

## Decision log

- 2026-05-10: No new tests required — change is a single copy string with no logic surface. Existing E2E sidebar coverage is sufficient.
