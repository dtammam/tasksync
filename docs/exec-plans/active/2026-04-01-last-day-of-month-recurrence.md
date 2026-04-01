# Last Day of Month Recurrence Option

## Goal

Add a `lastDayOfMonth` recurrence rule so that recurring tasks always land on the final calendar day of the target month (Jan 31, Feb 28/29, Mar 31, Apr 30, etc.), closing the gap left by the existing `monthly` rule which naively preserves day-of-month and produces incorrect results for month-end tasks.

## Scope

- New string literal `'lastDayOfMonth'` appended to the `recurrenceRules` const tuple in `web/src/lib/tasks/recurrence.ts`, extending the `RecurrenceRule` union type automatically.
- Human-readable label (e.g. `'Last day of month'`) added to `recurrenceRuleLabels` for the UI dropdown.
- New `case 'lastDayOfMonth':` in `nextDueForRecurrence`: advances the anchor by one calendar month and snaps to the last day of the resulting month.
- New `case 'lastDayOfMonth':` in `prevDueForRecurrence`: retreats the anchor by one calendar month and snaps to the last day of the resulting month.
- Unit tests in `web/src/lib/tasks/recurrence.test.ts` covering forward and backward recurrence for all 12 target months, including February in both leap and non-leap years, and year-boundary transitions (Dec → Jan, Jan → Dec).
- One E2E `@smoke` test verifying the 'Last day of month' option appears in the task-detail recurrence dropdown and can be selected and persisted.

## Out of scope

- Changes to any of the existing 8 recurrence rules (`daily`, `weekdays`, `weekly`, `biweekly`, `monthly`, `quarterly`, `biannual`, `annual`).
- Changes to the server (Rust) — `recur_state` is stored and synced as an opaque string; no server changes are required.
- Changes to `shared/types/task.ts` — `recur_state?: string` already accommodates any valid string.
- Changes to the sync protocol, conflict resolution rules, or IndexedDB schema.
- UI changes beyond adding the new option to the existing recurrence dropdown (no new controls, no layout changes).
- Any modification to the `monthly` rule's behavior (it is intentionally preserved as-is for tasks that do not want month-end semantics).

## Constraints

- **Offline-first**: The new rule must compute entirely client-side with no server dependency. The date calculation must be deterministic given only the anchor date string.
- **Sync determinism**: The wire value `'lastDayOfMonth'` must round-trip through push/pull without ambiguity. It is a valid opaque string to the server; `isRecurrenceRule()` validates it on the client.
- **Performance**: The new switch cases add only a trivial date arithmetic operation. No computational cost beyond what the existing rules already incur.
- **Type safety**: No `any`, no `@ts-nocheck`. The `recurrenceRuleLabels` `Record<RecurrenceRule, string>` type will enforce at compile time that the new rule has a label.
- **No silent failures**: All catch blocks must log; no new fire-and-forget async paths are introduced by this change.
- **Test coverage**: CONTRIBUTING.md requires that every exported function has explicit test coverage. Both `nextDueForRecurrence` and `prevDueForRecurrence` are exported and must have tests for the new rule.
- **E2E coverage**: CONTRIBUTING.md requires E2E smoke for user-visible cross-module flows. Selecting a recurrence rule crosses UI → store → recurrence module → IDB persistence, so one E2E `@smoke` test is required.

## Acceptance criteria

- [ ] `isRecurrenceRule('lastDayOfMonth')` returns `true`.
- [ ] `isRecurrenceRule('monthly')` still returns `true` (no regression to existing rules).
- [ ] `nextDueForRecurrence` with `'lastDayOfMonth'` returns the last calendar day of the following month for every month of the year:
  - Jan 31 → Feb 28 (non-leap year, e.g. 2026)
  - Jan 31 → Feb 29 (leap year, e.g. 2024)
  - Feb 28 → Mar 31
  - Mar 31 → Apr 30
  - Apr 30 → May 31
  - Nov 30 → Dec 31
  - Dec 31 → Jan 31 of the next year
- [ ] `prevDueForRecurrence` with `'lastDayOfMonth'` returns the last calendar day of the preceding month:
  - Feb 28 (non-leap 2026) → Jan 31
  - Mar 31 → Feb 28 (non-leap) or Feb 29 (leap)
  - Jan 31 → Dec 31 of the prior year
- [ ] The task-detail recurrence dropdown includes a `'Last day of month'` option (visible in the UI).
- [ ] Selecting `'lastDayOfMonth'` in the dropdown persists the value to the task's `recur_state` field (verified by E2E `@smoke` test).
- [ ] Completing a `lastDayOfMonth` recurring task rolls the due date to the last day of the next month (verified via unit test on `nextDueForRecurrence`).
- [ ] All 8 existing recurrence rules pass their existing unit tests without modification (no regression).
- [ ] All quality gates pass: `npm run lint`, `npm run check`, `npm run test`, Playwright `@smoke` (Chromium).

## Design

### Approach

This feature adds a single new recurrence rule (`'lastDayOfMonth'`) to the existing recurrence system. The implementation follows the established pattern exactly: append to the `recurrenceRules` tuple, add a label, and add `case` branches to both `nextDueForRecurrence` and `prevDueForRecurrence`. No new modules, abstractions, or architectural concepts are introduced.

The key technical detail is the date arithmetic for "last day of month N." The standard JS `Date` trick is: `new Date(year, month, 0).getDate()` — setting day to `0` returns the last day of the *previous* month, so `new Date(y, m + 1, 0)` gives the last day of month `m`. This is used by a new private helper `lastDayOfMonth(dateStr, monthOffset)` that shifts the anchor by `monthOffset` months and snaps to the last calendar day of the resulting month.

The UI requires zero layout changes. The `TaskDetailDrawer` builds its recurrence dropdown by mapping `recurrenceRules` through `recurrenceRuleLabels`, so appending the new rule to the tuple automatically adds it to the dropdown. The new option will appear last in the list, after "Annually."

### Date arithmetic: `lastDayOfMonth` helper

```text
function lastDayOfMonth(dateStr: string, monthOffset: number): string
  1. Parse dateStr → Date d (using existing parseIsoDate)
  2. Compute target month: d.getMonth() + monthOffset
  3. Create snapped date: new Date(d.getFullYear(), d.getMonth() + monthOffset + 1, 0)
     — day=0 of month N+1 yields last day of month N
  4. Return toLocalIsoDate(snapped)
```

This helper is private (not exported). It handles:

- **Forward**: `lastDayOfMonth('2026-01-31', 1)` → month 1+1+1=3, day 0 → Feb 28 → `'2026-02-28'`
- **Backward**: `lastDayOfMonth('2026-03-31', -1)` → month 2-1+1=2, day 0 → Feb 28 → `'2026-02-28'`
- **Leap year**: `lastDayOfMonth('2024-01-31', 1)` → `'2024-02-29'`
- **Year boundary (forward)**: `lastDayOfMonth('2026-12-31', 1)` → Jan 31 2027 → `'2027-01-31'`
- **Year boundary (backward)**: `lastDayOfMonth('2026-01-31', -1)` → Dec 31 2025 → `'2025-12-31'`

JS `Date` constructor handles month overflow/underflow natively (month 13 → January next year, month -1 → December prior year), so no manual year arithmetic is needed.

### Component changes

- **`web/src/lib/tasks/recurrence.ts`** (core changes):
  - Append `'lastDayOfMonth'` to the `recurrenceRules` tuple (after `'annual'`).
  - Add `lastDayOfMonth: 'Last day of month'` to `recurrenceRuleLabels`.
  - Add private helper `lastDayOfMonth(dateStr: string, monthOffset: number): string` implementing the day-0 snap algorithm above.
  - Add `case 'lastDayOfMonth': return lastDayOfMonth(anchor, 1);` in `nextDueForRecurrence`.
  - Add `case 'lastDayOfMonth': return lastDayOfMonth(current, -1);` in `prevDueForRecurrence`.
  - No changes to `isRecurrenceRule` — it already validates against `recurrenceRules.includes()`, so the new entry is automatically recognized.

- **`web/src/lib/tasks/recurrence.test.ts`** (unit tests):
  - Add `describe('nextDueForRecurrence — lastDayOfMonth')` with cases for all 12 month transitions forward, including Feb in leap/non-leap years and Dec→Jan year boundary.
  - Add `describe('prevDueForRecurrence — lastDayOfMonth')` with cases for all 12 month transitions backward, including Mar→Feb in leap/non-leap years and Jan→Dec year boundary.
  - Add `isRecurrenceRule('lastDayOfMonth')` assertion within existing or new describe block.

- **`web/tests/e2e/` (new E2E spec)**: One `@smoke`-tagged Playwright test that opens a task detail, selects "Last day of month" from the recurrence dropdown, and verifies persistence. (Exact file location TBD by SDE — likely `recurrence.spec.ts` or added to an existing task-detail spec.)

- **`web/src/lib/components/TaskDetailDrawer.svelte`**: **No changes needed.** The dropdown is dynamically built from `recurrenceRules` + `recurrenceRuleLabels`, so the new option appears automatically.

### Data model changes

None. The `recur_state` field on `Task` is typed as `string` (opaque). The server stores and syncs it as-is. No schema migration, no server changes, no IDB changes.

### API changes

None. No new endpoints. No changed signatures. The wire value `'lastDayOfMonth'` is a valid opaque string that round-trips through the existing sync protocol unchanged.

### Alternatives considered

**Modify `monthly` to auto-detect month-end**: If the anchor date is the last day of its month (e.g., Jan 31), the `monthly` rule could automatically snap to the last day of the target month instead of naively preserving the day number. This was rejected because:

- It changes existing behavior — users with `monthly` tasks anchored on the 31st currently get JS Date's overflow behavior (Jan 31 → Mar 3 for months without 31 days). Silently changing that would be a breaking semantic change.
- It conflates two distinct user intents: "on the 31st (or nearest)" vs. "on the last day of the month." A user who sets a task on Jan 30 doesn't necessarily want month-end semantics.
- A dedicated rule is explicit, discoverable in the UI, and avoids magic heuristics.

**Use `Date.setDate(0)` on the current month instead of next-month-minus-one**: Semantically equivalent but less readable. `new Date(y, m+1, 0)` is the idiomatic JS pattern and is well-documented.

### Risks and mitigations

- **Risk**: Timezone edge cases — `parseIsoDate` creates dates in the local timezone. If a user crosses timezones, the same ISO date string could produce a different `Date` object. → **Mitigation**: This is an existing risk shared by all recurrence rules. The `parseIsoDate` helper constructs dates using `new Date(year, month, day)` (local time, no UTC offset), and `toLocalIsoDate` reads back local components. The new rule uses the same helpers, so it inherits the same timezone behavior. No new risk introduced.

- **Risk**: Leap year correctness — February 29 must appear only in leap years. → **Mitigation**: The `new Date(year, month, 0)` constructor handles this natively. Unit tests explicitly cover Feb in both leap (2024) and non-leap (2026) years.

- **Risk**: TypeScript exhaustiveness — after adding the new rule, the `switch` in `nextDueForRecurrence` and `prevDueForRecurrence` must handle it. If missed, TS won't flag it because the functions don't have exhaustive `never` checks. → **Mitigation**: The `recurrenceRuleLabels` Record type *will* produce a compile error if the label is missing, which serves as the compile-time safety net. Unit tests provide runtime coverage. The SDE should verify both switch statements are updated.

### Performance impact

No expected impact on performance budgets. The new `case` branch performs a single `Date` construction (`new Date(y, m, 0)`) — equivalent cost to the existing `addMonths` helper used by `monthly`/`quarterly`/`biannual`/`annual`. No new async paths, no new DOM operations, no new store subscriptions.

## Task breakdown

### Task 1: Add lastDayOfMonth rule to recurrence tuple and labels
- **Files**: `web/src/lib/tasks/recurrence.ts`
- **Work**: Append `'lastDayOfMonth'` to the `recurrenceRules` tuple (after `'annual'`). Add `lastDayOfMonth: 'Last day of month'` to `recurrenceRuleLabels`.
- **Done when**: `isRecurrenceRule('lastDayOfMonth')` returns `true`, `npm run check` passes, existing tests still pass.

### Task 2: Implement lastDayOfMonth helper and switch cases
- **Files**: `web/src/lib/tasks/recurrence.ts`
- **Work**: Add private helper `lastDayOfMonth(dateStr: string, monthOffset: number): string` using the day-0 snap algorithm (`new Date(y, m + monthOffset + 1, 0)`). Add `case 'lastDayOfMonth': return lastDayOfMonth(anchor, 1)` to `nextDueForRecurrence`. Add `case 'lastDayOfMonth': return lastDayOfMonth(current, -1)` to `prevDueForRecurrence`.
- **Done when**: Both switch statements handle the new rule, `npm run check` passes, existing tests still pass.

### Task 3: Add unit tests for lastDayOfMonth recurrence
- **Files**: `web/src/lib/tasks/recurrence.test.ts`
- **Work**: Add tests for: (1) `isRecurrenceRule('lastDayOfMonth')` returns true. (2) `nextDueForRecurrence` with `'lastDayOfMonth'` for all 12 forward month transitions, including Feb in leap (2024) and non-leap (2026) years, and Dec-to-Jan year boundary. (3) `prevDueForRecurrence` with `'lastDayOfMonth'` for all 12 backward month transitions, including Mar-to-Feb in leap/non-leap years, and Jan-to-Dec year boundary.
- **Done when**: All new and existing tests pass via `npm run test`.

### Task 4: Add E2E smoke test for lastDayOfMonth dropdown selection
- **Files**: `web/tests/e2e/` (new or existing spec)
- **Work**: One Playwright `@smoke` test that opens a task detail, selects "Last day of month" from the recurrence dropdown, and verifies the selection persists.
- **Done when**: E2E smoke test passes via `npm run test:e2e:smoke`.

## Progress log

- 2026-04-01: Exec plan created by product-manager. Feature in discovery stage.
- 2026-04-01: Design completed by principal-engineer. Approach: new `lastDayOfMonth` rule using day-0 snap algorithm, private helper, two switch cases, no architecture changes.

## Decision log

- 2026-04-01: `'lastDayOfMonth'` chosen as the wire value (camelCase, consistent with existing rule naming conventions in the tuple). Human-readable label `'Last day of month'` chosen to match existing label style (sentence case, no trailing punctuation).
- 2026-04-01: Out-of-scope explicitly confirms `monthly` rule is NOT changed — tasks pinned to a specific day-of-month continue to use `monthly`; this new rule is for tasks that semantically belong at month-end.
- 2026-04-01: E2E smoke included in scope — CONTRIBUTING.md mandates it for user-visible cross-module flows; recurrence selection crosses UI → store → recurrence module → IDB.
