# Polish Batch: FOUC Fix, Daily Skip Investigation, Draggable Lists

## Goal

Ship three targeted polish items: eliminate the flash of unstyled content on cold app load, investigate and fix (or confirm correct behavior for) daily recurring task skip from the Missed section, and add drag-to-reorder for lists in the sidebar.

## Scope

### Item 1: FOUC fix

- Add a small inline `<script>` block to `web/src/app.html` that reads `localStorage` for `tasksync:ui-preferences:*` and sets `data-ui-theme` and `data-ui-font` on `<html>` synchronously, before the first paint.
- The script must apply the same valid-theme and valid-font whitelist already enforced by the preferences store (`validThemes`, `validFonts`). Unknown values must fall back to `default` / `sora` without throwing.
- The script must be SSR-safe: wrapped in a `typeof localStorage !== 'undefined'` guard so it does not throw in Node environments or when running under SvelteKit's SSG adapter.
- The script must be Capacitor-safe: it must not make assumptions about the origin or path of the `runtime-config.js` script, and must not block parsing.
- The key lookup logic must try `tasksync:ui-preferences:anon` as the fallback when no space/user-scoped key is present; this is the key written before authentication.
- No changes to `preferences.ts`, `+layout.svelte`, or any store logic. The inline script is purely additive HTML-shell behavior.

### Item 2: Daily skip investigation

- Audit the `skip()` method in `web/src/lib/stores/tasks.ts` and `nextRecurringDueAfterCurrent()` for correctness against all recurrence rules, with specific focus on `daily`.
- Audit edge cases: task overdue by exactly 1 day, task overdue by multiple days, task with `punted_from_due_date` set.
- Audit whether a skipped daily task that lands on today (1-day-overdue case) is immediately removed from the Missed section (i.e., whether the reactive derived store recomputes correctly).
- If a bug is confirmed: implement the minimal fix and add regression test(s).
- If behavior is correct: add test coverage for the identified edge cases so correctness is proven and protected.
- Either way, produce at least two new unit tests covering the daily-skip edge cases.

### Item 3: Draggable lists — sidebar only

- Replace the arrow-button reorder UI in the sidebar list section with native HTML5 drag-and-drop (using `draggable` attribute and `dragstart` / `dragover` / `drop` / `dragend` events) for manual-sort mode (`listSortMode === 'manual'`).
- Drag-to-reorder is scoped to admin users only (gate on `adminMode`). Arrow buttons in the settings Manage Lists section remain unchanged.
- On drop, compute a new `order` value for the moved list using the existing `manualOrderValue` index scheme and call `lists.updateRemote(id, { order })` for affected lists — same as `moveList()` does today.
- When `listSortMode === 'alpha'`, drag handles must not appear (dragging alphabetically-sorted lists makes no sense).
- Visual drag state (dragging highlight, drop target indicator) must be communicated via CSS classes only — no inline styles.
- Must work on desktop pointer (mouse). Touch/mobile drag-and-drop is explicitly out of scope for this batch (arrow buttons remain as the mobile fallback).
- Must not regress pull-to-refresh or any scroll behavior on mobile.
- My Day (`list.id === 'my-day'`) must remain pinned at the top and must not be draggable or a drop target.

## Out of scope

- Drag-to-reorder in the appearance/settings sections or any section other than the sidebar list rail.
- Touch/mobile drag-to-reorder for lists (deferred; arrow buttons remain).
- Changes to the sync protocol or data model for list ordering (the existing `order` field and `updateRemote` are sufficient).
- Server-side changes of any kind.
- Fractional index computation beyond the existing `manualOrderValue` scheme.
- FOUC for any property other than `data-ui-theme` and `data-ui-font`.
- Any changes to the preferences store, layout component, or CSS cascade for the FOUC fix — the inline script is the only change.
- Skip behavior for non-daily recurrence rules (weekly, monthly, etc.) is not the target of this investigation, but tests must not break.

## Constraints

- **Performance:** Interaction paint under 50 ms. The FOUC fix inline script must be minimal — no parsing, no external fetches, no blocking. The drag implementation must not add jank during list reorder (no unnecessary store writes on `dragover`; writes only on `drop`).
- **Offline-first:** All three items must function without a server connection. The FOUC fix reads only localStorage (always available). The drag reorder must update IDB optimistically via the existing `updateRemote` path (which already handles offline via store update + IDB write before the remote call).
- **No `@ts-nocheck`:** All TypeScript must be strict-typed.
- **No fire-and-forget IDB writes:** All `repo.saveLists()` calls must retain their existing `.catch` or `void`-with-catch pattern.
- **Store ownership:** The drag handler in `Sidebar.svelte` calls `lists.updateRemote()` — it does not write to the list store directly.
- **Layer boundaries:** `Sidebar.svelte` is a component; it must not import from `data/` directly.
- **SSR/Capacitor safety** (FOUC fix): the inline script must not throw in non-browser environments.
- **Admin-only enforcement:** Drag handles must not render and drop events must not fire for contributor-role users.
- **Tests required:** Every changed surface must have at least one unit test. The skip investigation must produce new tests regardless of outcome. A Playwright E2E smoke test for drag-to-reorder is required (desktop Chromium at minimum).

## Acceptance criteria

### FOUC fix

- [ ] On cold load (cleared cache, no prior hydration), the app renders immediately with the user's saved theme applied — no flash of the default theme colors before Svelte hydrates.
- [ ] On cold load with a saved non-default font, the app renders with the correct `--ui-font` CSS variable applied from the first paint.
- [ ] If `localStorage` contains no preferences key, the inline script applies no attributes (falls through gracefully to the CSS default, which is already correct).
- [ ] If the stored theme value is not in the valid-themes list, the inline script ignores it and does not set `data-ui-theme` (the store will apply the default after hydration).
- [ ] If the stored font value is not in the valid-fonts list, the inline script ignores it and does not set `data-ui-font`.
- [ ] The inline script does not break SSR/SSG builds (no `localStorage is not defined` errors during `vite build` or `svelte-check`).
- [ ] The inline script does not break the Capacitor iOS wrapper (app still launches; theme is applied correctly after WKWebView load).
- [ ] The existing preferences store behavior is unchanged: `applyThemeToDocument` and `applyFontToDocument` still run after hydration and remain the authoritative source on subsequent preference changes.
- [ ] `npm run check` and `npm run lint` pass with no new errors.

### Daily skip investigation

- [ ] The investigation produces a written finding (in the Progress log of this plan) stating whether skip is correct or buggy for each identified edge case: 1-day overdue daily, multi-day overdue daily, and daily with `punted_from_due_date` set.
- [ ] Unit tests exist (new or updated) that cover: skip on a daily task overdue by 1 day, skip on a daily task overdue by 3 days, and skip on a daily task with `punted_from_due_date` set. All three tests must pass.
- [ ] If a bug is confirmed: the bug is fixed and the corresponding test demonstrates the fix (fails before, passes after).
- [ ] If behavior is correct: existing unit tests are not broken and new tests confirm the correct behavior.
- [ ] After skip on a 1-day-overdue daily task, the task's new `due_date` is today or later (it must not remain in the past).
- [ ] After skip on a multi-day-overdue daily task, the task's new `due_date` is strictly after today (it must advance past today into tomorrow or later).
- [ ] `npm run test` passes with no regressions.

### Draggable lists

- [ ] In the sidebar, when `listSortMode === 'manual'` and the user is an admin, lists (excluding My Day) can be reordered by dragging and dropping.
- [ ] After a successful drag-and-drop reorder, the lists appear in the new order immediately (optimistic update) and `lists.updateRemote()` is called with the correct new `order` values.
- [ ] When `listSortMode === 'alpha'`, no drag handles appear and lists are not draggable.
- [ ] When the user role is `contributor` (not admin), no drag handles appear and lists are not draggable even in manual sort mode.
- [ ] My Day is always pinned at the top and is neither draggable nor a valid drop target.
- [ ] Dragging a list item applies a visible drag-in-progress CSS class to the dragged item.
- [ ] Dropping a list item on a valid target applies the reorder immediately; the drag-state CSS class is cleaned up after drop or dragend.
- [ ] The arrow-button reorder controls in the settings Manage Lists section are not removed or altered by this change.
- [ ] The drag implementation does not regress pull-to-refresh behavior on mobile (scroll and touch events are unaffected).
- [ ] At least one Playwright E2E smoke test (`@smoke`) covers: drag list A below list B as admin → verify new order is reflected in the sidebar.
- [ ] `npm run check`, `npm run lint`, and `npm run test` all pass.

## Design

### Item 1: FOUC fix

#### Approach

Add a synchronous inline `<script>` block inside the existing `<head>` of
`web/src/app.html`, placed after the `runtime-config.js` script and before
`%sveltekit.head%`. The script reads localStorage, extracts the saved theme
and font values, validates them against hardcoded whitelists that mirror
the ones in `preferences.ts`, and sets `data-ui-theme` / `data-ui-font`
attributes on `document.documentElement`. Because CSS selectors in
`+layout.svelte` already target `html[data-ui-theme='...']` and
`html[data-ui-font='...']`, setting these attributes before SvelteKit's
stylesheet evaluates eliminates the flash entirely.

The script is self-contained: it duplicates the valid-theme and valid-font
arrays as literal string arrays within the inline block. This is intentional --
importing from `preferences.ts` is not possible from a raw `<script>` in
`app.html`, and the arrays are small (17 themes, 23 fonts) and change only
when new themes/fonts are added (at which point the inline script must be
updated in lockstep). A code comment in both locations must reference the
other to prevent drift.

Key lookup order: the script scans all localStorage keys matching the prefix
`tasksync:ui-preferences:` and picks the first match. If none match, it
tries the explicit fallback key `tasksync:ui-preferences:anon`. If neither
exists, the script is a no-op and the CSS defaults apply (which is
already correct for first-time users). The scan approach avoids needing to
know the current `space_id` or `user_id` at HTML-shell time.

SSR/Capacitor safety: the entire body of the inline script is guarded by
`if (typeof localStorage !== 'undefined')`. This prevents errors during
SvelteKit SSG builds (`adapter-static`) and server-side rendering, and is
harmless inside Capacitor's WKWebView where localStorage is available.

#### Files changed

- **`web/src/app.html`**: Add one inline `<script>` block (~30 lines) in
  `<head>`, after the runtime-config script. No other files change.

#### Data model changes

None.

#### Risks

- **Risk**: Theme/font whitelist in the inline script drifts from
  `preferences.ts`. **Mitigation**: Add a comment in both `app.html` and
  `preferences.ts` referencing the other. Add a unit test that imports the
  whitelists from `preferences.ts` and verifies they match the inline
  script's whitelists (by parsing `app.html` as text). This test fails
  immediately if someone adds a theme to the store but not the inline script.
- **Risk**: Multiple preference keys in localStorage (e.g., `anon` plus a
  scoped key after login). The script might pick the wrong one.
  **Mitigation**: Prefer scoped keys (they contain `space_id:user_id`) over
  the `anon` key. In practice, after login the store writes to the scoped
  key and the anon key is stale but harmless. If a user logs out and back
  in as a different user, the last-written scoped key wins, which is the
  correct behavior (it matches the most recent session).

#### Alternative considered

**Alternative: Apply theme/font in `+layout.svelte` `onMount` before first
render.** This does not work because Svelte's hydration happens after the
initial browser paint. By the time `onMount` fires, the user has already
seen one frame of the default theme. The inline script in `app.html` runs
during HTML parsing, before any paint, which is the only reliable way to
prevent FOUC.

---

### Item 2: Daily skip investigation

#### Approach

The investigation is complete at design time. Here are the findings:

**Analysis of `nextRecurringDueAfterCurrent(task)` for daily recurrence:**

The function computes `anchor = punted_from_due_date ?? due_date`, then
calls `nextDueForRecurrence(anchor, 'daily')` which returns `anchor + 1 day`.
The while loop advances `next` only while `next <= task.due_date`. For daily
tasks, `next` is already `due_date + 1`, so the loop never executes -- the
function always returns `due_date + 1`.

**Edge case analysis:**

1. **1-day overdue daily** (e.g., `due_date = yesterday`): `skip()` sets
   `due_date` to `yesterday + 1 = today`. Since `isMissedTask` checks
   `date < todayIso()`, the task is no longer missed. It enters
   `myDayPending` (since `isToday(due_date)` is true). This is **correct**.

2. **Multi-day overdue daily** (e.g., `due_date = 3 days ago`): `skip()`
   sets `due_date` to `3_days_ago + 1 = 2_days_ago`. The task is still in
   the past and still appears in `myDayMissed`. The acceptance criteria
   require that after skipping a multi-day-overdue daily, the new due date
   is **strictly after today**. Current behavior does not satisfy this --
   it only advances by one occurrence. This is a **bug** (or at minimum a
   UX defect that the acceptance criteria classify as incorrect).

3. **Daily with `punted_from_due_date` set**: `anchor` becomes
   `punted_from_due_date` instead of `due_date`. For a daily task this is
   the date the task was originally due before punting. Since `clearPuntState`
   is called inside `skip()`, the punt fields are cleared before the
   resulting task is written. The next due date is `punted_from_due_date + 1`.
   If `punted_from_due_date` is before `due_date` (normal punt case), the
   result could be earlier than or equal to `due_date`, which means the task
   could end up with a due date in the past or the same as today. However,
   in practice punt is blocked for daily tasks (the `punt()` method returns
   early for `recurrence_id === 'daily'`), so `punted_from_due_date` should
   never be set on a daily task. This case is effectively unreachable for
   daily recurrence but should still be covered by a test for defensive
   correctness.

**Fix for case 2:** Change `skip()` to use `nextRecurringDueAfterToday(t)`
instead of `nextRecurringDueAfterCurrent(t)`. The function
`nextRecurringDueAfterToday` already exists and advances past today by
looping until `next > today`. This ensures that skipping a multi-day-overdue
task always lands on a future date (tomorrow at earliest for daily). For
the 1-day-overdue case, `nextRecurringDueAfterToday` also returns tomorrow
(since it uses `>` not `>=` against today), which is stricter than the
current behavior but still correct -- the user explicitly chose to skip,
so advancing to tomorrow is the expected outcome.

Alternatively, `skip()` could use a new helper that advances to
`max(nextRecurringDueAfterCurrent, tomorrow)`, but that introduces
unnecessary complexity. `nextRecurringDueAfterToday` already handles all
recurrence rules and is the natural choice for "skip past today."

#### Files changed

- **`web/src/lib/stores/tasks.ts`**: In `skip()`, change
  `nextRecurringDueAfterCurrent(t)` to `nextRecurringDueAfterToday(t)`.
  This is a one-line change.
- **`web/src/lib/stores/tasks.test.ts`**: Add three new unit tests:
  1. Skip on a daily task overdue by 1 day: assert `due_date >= todayIso()`.
  2. Skip on a daily task overdue by 3 days: assert `due_date > todayIso()`.
  3. Skip on a daily task with `punted_from_due_date` set: assert the result
     uses the correct anchor and `punted_from_due_date` is cleared.

#### Data model changes

None.

#### Risks

- **Risk**: Changing `skip()` to use `nextRecurringDueAfterToday` alters
  behavior for non-daily recurrence rules (e.g., a weekly task overdue by
  1 day would now skip to next week from today, not from its original due
  date). **Mitigation**: This is actually the desired behavior -- skip means
  "I do not want to do this occurrence; advance to the next one that is in
  the future." The existing weekly skip tests must be verified to still
  pass (or updated if the old behavior was also wrong for the same reason).
  The existing test "clears a missed recurring task from missed when
  skipping to next occurrence" uses `due_date: '2026-02-01'` which is far
  in the past relative to test execution; the test asserts the task leaves
  `myDayMissed`, which remains true with `nextRecurringDueAfterToday`
  since the result will be after today.
- **Risk**: `nextRecurringDueAfterToday` calls `todayIso()` internally,
  which reads the system clock. Tests that run on different days could get
  different results. **Mitigation**: The existing tests already deal with
  this by using dates far in the past (e.g., `'2026-02-01'`). New tests
  should use `todayIso()` at test time to compute expected values, or use
  dates sufficiently in the past that the result is deterministic.

#### Alternative considered

**Alternative: Keep `nextRecurringDueAfterCurrent` and add a post-hoc
`while (next <= today) next = nextDueForRecurrence(next, ...)` loop inside
`skip()` itself.** This duplicates logic already present in
`nextRecurringDueAfterToday`. It is more code, harder to test in isolation,
and violates DRY. Rejected in favor of reusing the existing helper.

---

### Item 3: Draggable lists (sidebar)

#### Approach

Add HTML5 drag-and-drop to the sidebar list items in `Sidebar.svelte`. The
implementation uses native browser drag events (`dragstart`, `dragover`,
`drop`, `dragend`) on the existing `<a>` elements for each list. No
third-party drag library is needed -- the sidebar list is short (typically
5-15 items), the items are simple link elements, and native DnD is
sufficient for desktop pointer interactions.

The drag-and-drop behavior is gated behind two conditions:
`listSortMode === 'manual'` AND `adminMode === true`. When either condition
is false, the `draggable` attribute is not set and no drag event handlers
are attached. My Day (`list.id === 'my-day'`) is always excluded: it does
not get `draggable`, and its element rejects `dragover` (preventing it from
becoming a drop target).

**State management during drag:**

- `dragstart`: Store the dragged list's `id` in a component-local variable
  (`draggedListId`). Set `event.dataTransfer.effectAllowed = 'move'`. Add a
  CSS class `dragging` to the element via `event.currentTarget.classList`.
- `dragover`: Prevent default to allow drop. Track the current drop target
  by adding a `drag-over` CSS class to the hovered list element. Use a
  component-local variable (`dragOverListId`) to track which element is the
  current target, and remove the class from the previous target when it
  changes. Do NOT write to the store on dragover -- this would cause
  unnecessary reactive updates and potential jank.
- `dragleave`: Remove the `drag-over` CSS class from the element.
- `drop`: Compute the new order. Remove the dragged item from the current
  sorted list, insert it at the drop target's position, then assign new
  `manualOrderValue` strings to all affected items. Call
  `lists.updateRemote(id, { order })` for each item whose order changed.
  This mirrors the existing `moveList()` logic. Clean up CSS classes.
- `dragend`: Clean up all drag-related CSS classes (`dragging`, `drag-over`)
  and reset component-local state (`draggedListId`, `dragOverListId`). This
  fires even if the drop was cancelled (e.g., user released outside a valid
  target).

**Reorder computation:** On drop, the component builds the reordered array
the same way `moveList()` does: take the current `sortByOrder` list
(excluding My Day), splice out the dragged item, splice it back at the
target index, then assign `manualOrderValue(i)` to each position. Only
items whose order actually changed are sent to `lists.updateRemote()`.

**Visual feedback:** Two CSS classes are used:
- `.dragging` on the item being dragged (applied during dragstart, removed
  on dragend). Style: reduced opacity (e.g., `opacity: 0.5`).
- `.drag-over` on the current drop target (applied during dragover, removed
  on dragleave/drop/dragend). Style: a top or bottom border highlight to
  indicate insertion position.

Both classes are added/removed via `classList` in event handlers -- no
inline styles.

#### Files changed

- **`web/src/lib/components/Sidebar.svelte`**:
  - Add component-local variables: `draggedListId: string | null`,
    `dragOverListId: string | null`.
  - Add event handler functions: `handleDragStart`, `handleDragOver`,
    `handleDragLeave`, `handleDrop`, `handleDragEnd`.
  - Modify the `{#each sidebarLists as list}` block for non-My-Day items:
    conditionally add `draggable="true"` and event listeners when
    `adminMode && listSortMode === 'manual'`.
  - Add CSS classes `.dragging` and `.drag-over` in the `<style>` block.
  - The existing `moveList()` function and arrow buttons in the settings
    Manage Lists section remain untouched.
- **`web/tests/e2e/smoke.spec.ts`** (or a new `sidebar.spec.ts`): Add one
  Playwright E2E smoke test tagged `@smoke` that performs a drag-and-drop
  reorder on two lists and verifies the new order.

#### Data model changes

None. The existing `order` field on `List` and `manualOrderValue` scheme
are sufficient.

#### API changes

None. `lists.updateRemote()` already accepts `{ order: string }`.

#### Risks

- **Risk**: Native HTML5 DnD has inconsistent behavior across browsers,
  particularly around `dragover` event firing frequency and `dragleave`
  bubbling. **Mitigation**: The implementation is desktop-only (touch DnD
  is out of scope). Chromium and Firefox handle native DnD reliably for
  simple list reorder. The E2E test runs on Chromium; CI matrix covers
  Firefox and WebKit. If cross-browser issues emerge, they surface in CI.
- **Risk**: The drag events might interfere with the sidebar's existing
  click navigation (clicking a list link to navigate). **Mitigation**:
  HTML5 DnD distinguishes between a click (mousedown + mouseup without
  movement) and a drag (mousedown + movement exceeding the drag threshold).
  The browser does not fire `dragstart` on a simple click, so navigation
  is unaffected.
- **Risk**: On mobile, `draggable="true"` can interfere with touch scroll.
  **Mitigation**: The `draggable` attribute is only set when
  `adminMode && listSortMode === 'manual'`. On mobile, touch DnD is
  explicitly out of scope and the drag attribute does not trigger native
  touch DnD without additional touch-event wiring. The existing scroll and
  pull-to-refresh behavior is unaffected because HTML5 drag events are
  pointer-only, not touch-event-based.
- **Risk**: `lists.updateRemote()` makes a network call and updates the
  store asynchronously. If the server is offline, the promise rejects.
  **Mitigation**: `updateRemote` already handles this -- it updates the
  local store optimistically (the `listStore.update()` call happens before
  the `await api.updateList()` resolves). On rejection, the local state
  reflects the new order and IDB persists it via `repo.saveLists`. When
  connectivity returns, the next sync cycle reconciles. Note: the existing
  `repo.saveLists` calls in `lists.ts` use `void` without `.catch()` --
  this is a pre-existing issue outside this feature's scope, but worth
  noting.

#### Alternative considered

**Alternative: Use a third-party drag library (e.g., `svelte-dnd-action`,
`@hello-pangea/dnd`).** These provide smoother animations, better
accessibility, and built-in touch support. However, they add a dependency,
increase bundle size, and are overkill for a short sidebar list that only
needs desktop mouse DnD. The native HTML5 DnD API is zero-dependency,
well-supported on desktop, and sufficient for the scoped requirements.
Touch DnD is explicitly out of scope and can be reconsidered in a future
batch if needed.

---

### Cross-cutting

#### Test strategy

| Item | Unit tests | E2E tests |
|------|-----------|-----------|
| FOUC fix | 1 test: verify inline script whitelists match `preferences.ts` whitelists (parse `app.html` as text, extract arrays, compare). | Manual verification (cold load with non-default theme). Automating FOUC detection in E2E is unreliable -- it requires frame-level timing assertions. |
| Daily skip | 3 new tests in `tasks.test.ts`: (1) skip daily 1-day overdue, (2) skip daily 3-day overdue, (3) skip daily with `punted_from_due_date`. | None needed -- the store-level unit tests fully cover the logic. |
| Draggable lists | None at the component level (Sidebar.svelte is not unit-tested today and the drag logic is thin DOM wiring). | 1 new Playwright `@smoke` test: drag list A below list B as admin, verify sidebar order changes. |

#### Performance considerations

- **FOUC fix**: The inline script executes during HTML parsing. It performs
  one `localStorage` key scan (iterating over keys), one `JSON.parse`, and
  two `setAttribute` calls. Total expected time: sub-1ms. No impact on any
  performance budget.
- **Daily skip**: No performance change. One function call substitution.
- **Draggable lists**: Drag events fire frequently during `dragover` but
  the handler only updates a CSS class and a local variable -- no store
  writes. Store writes happen only on `drop`, which is a single event.
  The `Promise.all` for `updateRemote` calls mirrors the existing
  `moveList()` pattern. No impact on interaction paint budget.

No expected impact on performance budgets defined in RELIABILITY.md.

#### Implementation order recommendation

1. **Item 2 (Daily skip)** first -- it is the smallest change (one line in
   `tasks.ts`, three new tests) and has the highest certainty. It can be
   implemented and tested in isolation with no UI changes. Getting it done
   first reduces the in-flight surface area.
2. **Item 1 (FOUC fix)** second -- it is a single-file HTML change with no
   TypeScript compilation dependencies. The whitelist sync test can be
   written immediately after.
3. **Item 3 (Draggable lists)** last -- it is the largest change (new event
   handlers, CSS, E2E test) and benefits from having the other two items
   already committed, reducing merge risk.

## Task breakdown

### T1: Fix daily skip bug — swap to nextRecurringDueAfterToday

**Scope:** One-line change in `skip()` plus three new unit tests.

**Files:**
- `web/src/lib/stores/tasks.ts` — line 522: change `nextRecurringDueAfterCurrent(t)` to `nextRecurringDueAfterToday(t)`
- `web/src/lib/stores/tasks.test.ts` — add three new tests in the skip/recurrence section

**Done when:**
- `skip()` calls `nextRecurringDueAfterToday(t)` instead of `nextRecurringDueAfterCurrent(t)`
- Three new passing unit tests exist:
  1. Skip on a daily task overdue by 1 day: assert `due_date > todayIso()` (advances to tomorrow)
  2. Skip on a daily task overdue by 3 days: assert `due_date > todayIso()` (advances past today)
  3. Skip on a daily task with `punted_from_due_date` set: assert result uses correct anchor and `punted_from_due_date` is cleared
- All existing skip/recurrence tests still pass
- `npm run test` passes with no regressions

**Dependencies:** None (standalone)

---

### T2: FOUC fix — inline theme/font script in app.html

**Scope:** Add a synchronous inline `<script>` block to `web/src/app.html` that reads localStorage preferences and sets `data-ui-theme` / `data-ui-font` on `<html>` before first paint. Add a whitelist-sync unit test.

**Files:**
- `web/src/app.html` — add inline `<script>` in `<head>` after the runtime-config script, before `%sveltekit.head%`
- `web/src/lib/stores/preferences.ts` — add a comment referencing the inline script whitelist (no logic changes)
- New test file (e.g., `web/src/lib/stores/fouc-whitelist.test.ts`) or added to existing preferences test — parse `app.html` text, extract inline whitelists, compare against `validThemes` and `validFonts` from `preferences.ts`

**Done when:**
- Inline script in `app.html` reads localStorage for `tasksync:ui-preferences:*` keys, validates theme/font against hardcoded whitelists, sets `data-ui-theme` and `data-ui-font` attributes on `document.documentElement`
- Script is SSR-safe: guarded by `typeof localStorage !== 'undefined'`
- Script falls back gracefully when no preferences key exists (no-op)
- Script ignores invalid theme/font values (does not set attribute)
- Key lookup: scans all `tasksync:ui-preferences:` keys, prefers scoped keys over `anon` fallback
- Whitelist-sync unit test passes: verifies inline script arrays match `preferences.ts` arrays
- Comments in both `app.html` and `preferences.ts` cross-reference each other
- `npm run check`, `npm run lint`, and `npm run test` all pass

**Dependencies:** None (standalone, but ordered after T1 to reduce in-flight surface)

---

### T3: Draggable lists — add HTML5 DnD to sidebar list items

**Scope:** Add drag-and-drop reorder to sidebar list items in `Sidebar.svelte`, gated on `adminMode && listSortMode === 'manual'`. My Day pinned and excluded. CSS-only visual feedback.

**Files:**
- `web/src/lib/components/Sidebar.svelte` — add component-local drag state variables, five event handlers (`handleDragStart`, `handleDragOver`, `handleDragLeave`, `handleDrop`, `handleDragEnd`), conditionally add `draggable="true"` and event listeners to non-My-Day list `<a>` elements, add `.dragging` and `.drag-over` CSS classes

**Done when:**
- In manual sort mode as admin, non-My-Day sidebar lists have `draggable="true"` and respond to drag events
- On drop: reorder array is computed using existing `sortByOrder` + `manualOrderValue` scheme, `lists.updateRemote()` called for each changed item
- My Day is never draggable and never a drop target
- In alpha sort mode OR as contributor, no `draggable` attribute and no drag handlers
- `.dragging` class applied during drag, `.drag-over` class applied to drop target — CSS only, no inline styles
- Existing `moveList()` and arrow buttons in settings Manage Lists section unchanged
- `npm run check` and `npm run lint` pass

**Dependencies:** None (standalone, but ordered last per PE recommendation)

---

### T4: Draggable lists — E2E smoke test

**Scope:** Add one Playwright E2E smoke test for sidebar drag-to-reorder.

**Files:**
- `web/tests/e2e/smoke.spec.ts` (or new `web/tests/e2e/sidebar-drag.spec.ts`) — add `@smoke` tagged test: as admin in manual sort mode, drag list A below list B, verify sidebar order changes

**Done when:**
- One new Playwright `@smoke` test exists that:
  1. Sets up at least two lists in manual sort mode as admin
  2. Drags one list below another using Playwright's `dragTo` API
  3. Asserts the sidebar list order has changed
- Test passes on Chromium via `npm run test:e2e:smoke`
- All existing E2E smoke tests still pass

**Dependencies:** T3 (needs the drag implementation to exist)

## Progress log

- 2026-05-08: Discovery complete. Exec plan written. Requirements normalized from user request and codebase inspection.
- 2026-05-08: Design complete. Daily skip bug confirmed: `skip()` uses `nextRecurringDueAfterCurrent` which only advances one occurrence past `due_date`, leaving multi-day-overdue daily tasks still in the past. Fix: swap to `nextRecurringDueAfterToday`. FOUC fix: inline script in `app.html` with hardcoded whitelists. Draggable lists: native HTML5 DnD in Sidebar.svelte, gated on admin + manual sort.

## Decision log

- 2026-05-08: Drag-to-reorder scoped to sidebar only (not appearance/settings sections) based on user request. Touch/mobile drag deferred — arrow buttons remain as mobile fallback. Inline FOUC script targets only `data-ui-theme` and `data-ui-font` — no other CSS variables are theme-gated in the HTML shell.
- 2026-05-08: Daily skip investigation must produce new tests regardless of verdict (correct or buggy). This satisfies CONTRIBUTING.md's "every public method must have explicit test coverage" requirement — `skip()` for daily tasks currently has no edge-case tests in the codebase.
