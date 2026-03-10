# Exec Plan: My Day → Set Due Today + Recurrence Catch Up

**Branch:** `feat/my-day-due-today-and-recurrence-catchup`
**Date:** 2026-03-10
**Author:** User + Claude

---

## Goal

Two distinct UX improvements:

1. **My Day → Set Due Today**: When a user clicks "My Day" on a task, set `due_date = today` instead of toggling the `my_day` boolean flag. A task due today already appears in My Day automatically — the flag is redundant. The button hides when the task is already in My Day. In the detail drawer, clicking "My Day" immediately updates the due date field to today; if already due today, a non-interactive "In My Day" badge shows instead.

2. **Recurrence Catch Up**: For missed recurring tasks (`due_date < today`), show a "Catch Up" chip directly on the task row. Clicking it advances `due_date` to the next occurrence *after today*, skipping all missed instances in one action.

---

## Non-goals

- Removing the `my_day` column from the database or data model (backward compat preserved).
- Auto-advancing missed recurring tasks without user intent.
- Changing `inMyDay()` — `my_day: true` tasks continue to show in My Day unchanged.
- Changing the server-side contributor restriction on the `my_day` flag.
- Modifying the markdown import `@myday` annotation path (`import.ts`) — that is an independent batch-import feature.
- Adding a "Catch Up All" bulk action.

---

## Constraints

- **Offline-first**: Both actions update local IDB and mark the task `dirty` for sync. No network required.
- **Sync determinism**: Both use the existing dirty-task sync path. No sync protocol changes.
- **Performance**: Synchronous store mutations. No budget risk.
- **No new `my_day: true` from user gestures**: All UI paths that previously wrote `my_day: true` will instead write `due_date = today`.

---

## Current State

### My Day flag

| Location | Line | Current behavior |
|----------|------|-----------------|
| `tasks.ts` | 437 | `setMyDay(id, bool)` — toggles `my_day` field |
| `tasks.ts` | 33–75 | `makeLocalTask` — supports `due_date?` in opts, but callers don't expose it |
| `tasks.ts` | 163 | `createLocal` opts — only exposes `my_day`, `assignee_user_id` |
| `tasks.ts` | 166 | `createLocalWithOptions` opts — no `due_date` in type |
| `tasks.ts` | 452 | `setDueDate` — clears `my_day` only for future dates, not today |
| `tasks.ts` | 544 | `punt()` — already writes `my_day: false` ✓ |
| `tasks.ts` | 716 | `inMyDay()` — returns true if `task.my_day` OR `due_date === today` |
| `+page.svelte` | 210 | `quickAdd()` creates tasks with `my_day: true` |
| `+page.svelte` | 218 | `addSuggestionToMyDay()` calls `tasks.setMyDay(id, true)` |
| `TaskRow.svelte` | 245 | `<label><input type="checkbox">My Day</label>` chip |
| `TaskDetailDrawer.svelte` | 52 | Hydrates local `myDay` from `task.my_day` |
| `TaskDetailDrawer.svelte` | 108 | Save passes `my_day: canEditMyDay ? myDay : task.my_day ?? false` |
| `TaskDetailDrawer.svelte` | 202–209 | `detail-myday-toggle` button, text "My Day" / "Add to My Day" |

### Not changing

| Location | Why untouched |
|----------|--------------|
| `sync.ts:92,116` | Maps `my_day: task.my_day ?? false` — will just send `0` instead of `1` after our changes. No edit needed. |
| `import.ts:43` | `@myday` markdown token — independent import path, not a UI action. Leave as-is. |
| `offline.spec.ts:607,662,727` | Seeds `my_day: true` to place tasks in My Day view for sync tests. Never asserts on the flag. Unaffected. |
| `sync.test.ts` | Tests sync payload shape — `my_day` field still present in payloads, just `0` now. No behavior change in sync. |
| `list/[id]/+page.svelte:190` | Passes `my_day: item.my_day` through during batch import. Preserves imported flag. Leave as-is. |
| `tasks.ts:502 skip()` | Advances ONE occurrence and calls `streak.break()`. Used by "Skip next" in missed-actions and "Skip Occurrence" in drawer. `catchUp` is a different action — both coexist. |
| `tasks.test.ts:257-299` | Three `skip()` tests — unaffected. |

### Recurrence catch-up

- `nextRecurringDueAfterCurrent(task)` (`tasks.ts:115`) advances past current `due_date`, not past today. Missed tasks require one toggle per missed instance.
- `skip(id)` (`tasks.ts:502`) advances ONE occurrence using `nextRecurringDueAfterCurrent` and calls `streak.break()`. This powers "Skip next" in the missed-actions area and "Skip Occurrence" in the detail drawer. It is NOT the same as Catch Up.
- `+page.svelte:233` already has `skipMissed()` and a "Skip next" button in the missed-actions area. Catch Up chip on TaskRow and "Skip next" in missed-actions do different things and coexist.
- No catch-up action exists.

---

## Proposed Approach

### Feature 1: My Day → Set Due Today

#### `tasks.ts` store changes

**1. Extend `createLocal` and `createLocalWithOptions` to expose `due_date` (optional type improvement):**

`makeLocalTask` (line 33) already accepts `due_date?` in opts, but `createLocal`/`createLocalWithOptions` don't expose it in their type signatures. Add `due_date?: string` to both so the option is accessible to future callers. Note: `quickAdd()` will use a two-call approach instead (see below), so this is a type correctness improvement, not strictly required for the implementation.

**2. New method `setDueToday(id)`:**
```ts
setDueToday(id: string) {
  const today = todayIso();
  const now = Date.now();
  tasksStore.update((list) =>
    list.map((t) =>
      t.id === id
        ? { ...clearPuntState(t), due_date: today, my_day: false, dirty: true, updated_ts: now }
        : t
    )
  );
  void repo.saveTasks(get(tasksStore));
}
```

**3. Update `setDueDate` to also clear `my_day` when `due_date === today`:**

Currently only clears `my_day` for future dates (line 461). Extend to clear it for today too:
```ts
const isFutureOrToday = !!due_date && due_date >= todayIso();
...(isFutureOrToday ? { my_day: false } : {})
```
This ensures any code path that sets `due_date = today` (date picker, etc.) cleans up the legacy flag.

#### `+page.svelte` changes

- **`quickAdd()` (line 210)**: Use a two-call approach — `createLocal()` (which returns the task), then immediately `setDueToday(task.id)`. No import change needed; `setDueToday` computes today internally. Remove `my_day: true` from the `createLocal` call:
  ```js
  const quickAdd = () => {
    if ($auth.user?.role === 'contributor') return;
    if (!quickTitle.trim()) return;
    const task = tasks.createLocal(quickTitle, defaultListId);
    if (task) tasks.setDueToday(task.id);
    quickTitle = '';
  };
  ```
  Two saves (one per store call) is fine — both are local IDB only, sync happens separately. `window.__addTaskMyDay` at line 196 wraps `quickAdd()` and will pick up the change automatically.
- **`addSuggestionToMyDay()` (line 218)**: Change `tasks.setMyDay(id, true)` → `tasks.setDueToday(id)`.
- **Suggestion behavior shift**: Tasks with `due_date = tomorrow` in the suggestions panel will have their date moved to today when "Add" is clicked. Correct — adding to My Day means due today.

#### `TaskRow.svelte` changes

Remove `toggleMyDay` and its contributor guard. The My Day chip lives inside the existing `{#if !inMyDayView}` block (line 244) — keep that outer guard in place. Replace the inner `<label><input checkbox>` with a conditional button:

```svelte
{#if !inMyDayView}
  {#if !task.my_day && task.due_date !== todayKey}
    <button
      class="chip ghost day-chip"
      type="button"
      on:click={() => tasks.setDueToday(task.id)}
      data-testid="task-myday-btn"
    >
      My Day
    </button>
  {/if}
{/if}
```

The outer `{#if !inMyDayView}` guard already existed — the chip is never shown in the My Day view. The inner condition hides it when the task is already in My Day. Button shown for all roles (setting due_date is not contributor-restricted).

**Visibility rules:**

| Scenario | Button shown? | Click result |
|----------|:---:|-------------|
| No due_date, no flag | ✓ | due_date = today → enters My Day Pending |
| `my_day: true`, no due_date | ✗ | Already in My Day |
| `due_date = today` | ✗ | Already in My Day |
| `due_date` in future | ✓ | due_date = today → replaces future date |
| `due_date` in past (missed) | ✓ | due_date = today → leaves Missed, enters My Day Pending |

#### `TaskDetailDrawer.svelte` changes

**What gets removed:**
- `let myDay = false;` — local variable gone.
- `myDay = t.my_day ?? false;` from `hydrate()`.
- `$: if (canEditMyDay && due && due > todayKey) myDay = false;` reactive — badge/button now derives from `due` directly.
- `const toggleMyDay = () => { ... }` function.

**What stays:**
- `$: canEditMyDay = !isContributor;` — still used in the save logic. Do NOT remove.

**New reactive** to derive in-My-Day state from `due`:
```ts
$: isInMyDay = due === todayKey || (!due && (task?.my_day ?? false));
```
The second clause handles legacy `my_day: true, no due_date` tasks — shows the badge without touching the due field.

**Clicking "Add to My Day" fires immediately** — sets `due = todayKey` (local state), updating the due date input visually. Committed on Save.

Template change:
```svelte
<label>
  My Day
  {#if isInMyDay}
    <button
      class="ghost detail-toggle myday-toggle active"
      type="button"
      data-testid="detail-myday-badge"
      disabled
    >In My Day</button>
  {:else}
    <button
      class="ghost detail-toggle myday-toggle"
      type="button"
      data-testid="detail-myday-toggle"
      on:click={() => { if (canEditTask) due = todayKey; }}
      disabled={!canEditTask}
    >
      Add to My Day
    </button>
  {/if}
</label>
```

**`data-testid` notes:**
- `detail-myday-toggle` preserved on the "Add to My Day" button state — existing E2E references still resolve.
- `detail-myday-badge` is new for the "In My Day" disabled-button state.
- Using a disabled button (not a `<span>`) for "In My Day" reuses the existing `button.ghost.myday-toggle.active` CSS at drawer line 377. No new CSS needed.

**Save behavior** — `canEditMyDay` stays and is used here:
```ts
my_day: canEditMyDay ? false : (task.my_day ?? false)
```
Admin saves always write `my_day: false`, cleaning up legacy flags on next edit. Contributor saves pass through unchanged.

---

### Feature 2: Recurrence Catch Up

#### New helper (`tasks.ts`)

```ts
const nextRecurringDueAfterToday = (task: Task): string | undefined => {
  const today = todayIso();
  const anchor = task.punted_from_due_date ?? task.due_date;
  let next = nextDueForRecurrence(anchor, task.recurrence_id);
  if (!next) return task.due_date;
  while (next <= today) {
    const candidate = nextDueForRecurrence(next, task.recurrence_id);
    if (!candidate || candidate === next) break;
    next = candidate;
  }
  return next;
};
```

Identical to `nextRecurringDueAfterCurrent` but advances until `next > today` instead of `next > task.due_date`.

#### New store method `catchUp(id)` (`tasks.ts`)

```ts
catchUp(id: string) {
  const now = Date.now();
  tasksStore.update((list) =>
    list.map((task) => {
      if (task.id !== id) return task;
      if (!task.recurrence_id || !task.due_date) return task; // non-recurring guard
      const next = nextRecurringDueAfterToday(task);
      if (!next || next === task.due_date) return task; // already current, no-op
      return {
        ...clearPuntState(task),
        due_date: next,
        dirty: true,
        updated_ts: now
        // occurrences_completed NOT incremented — skip ≠ completion
        // completed_ts NOT updated
        // streak.break() NOT called — streak is already broken for missed tasks
        //   (contrast with skip() which breaks streak for current/deliberate skips)
      };
    })
  );
  void repo.saveTasks(get(tasksStore));
}
```

#### UI: `TaskRow.svelte` — inline "Catch Up" chip

Shown directly on the task row. **Must NOT be inside the `{#if !inMyDayView}` guard** — the missed section uses `inMyDayView={true}`, and that's exactly where Catch Up needs to show. Gate purely on task state:

```ts
$: showCatchUp = canEditTask
  && !!task.recurrence_id
  && !!task.due_date
  && task.due_date < todayKey
  && task.status === 'pending';
```

```svelte
{#if showCatchUp}
  <button
    class="chip ghost catchup-chip"
    type="button"
    on:click={() => tasks.catchUp(task.id)}
    data-testid="task-catchup"
  >
    Catch Up
  </button>
{/if}
```

**Visibility rules:**

| Scenario | Chip shown? | Result |
|----------|:---:|--------|
| Recurring, missed 3× | ✓ | due_date → next occurrence after today |
| Recurring, due today | ✗ | Not missed |
| Recurring, due tomorrow | ✗ | Not missed |
| Non-recurring, missed | ✗ | No recurrence_id guard |
| Recurring + punted + missed | ✓ | Punt cleared, due_date advanced |
| Daily, missed yesterday | ✓ | due_date → tomorrow |

---

## Complete Affected Files

| File | Change summary |
|------|----------------|
| `web/src/lib/stores/tasks.ts` | Add `setDueToday`, update `setDueDate`, add `nextRecurringDueAfterToday`, add `catchUp`; expose `due_date` in `createLocal`/`createLocalWithOptions` type signatures (body already passes opts through) |
| `web/src/routes/+page.svelte` | Add `toLocalIsoDate` import; `quickAdd` → `due_date: today`; `addSuggestionToMyDay` → `setDueToday` |
| `web/src/lib/components/TaskRow.svelte` | My Day checkbox → conditional button; add Catch Up chip; remove `toggleMyDay` |
| `web/src/lib/components/TaskDetailDrawer.svelte` | My Day toggle → immediate setter + badge; remove `myDay` var + `toggleMyDay`; keep `canEditMyDay`; update save |
| `web/src/lib/stores/tasks.test.ts` | Update existing tests (see below); add new unit tests |
| `web/tests/e2e/myday.spec.ts` | Rewrite @smoke My Day drawer test; add new tests |

**Files confirmed NOT needing changes:**
- `sync.ts` — passes `my_day: task.my_day ?? false`; will send `0` instead of `1` after our changes. No edit needed.
- `import.ts` / `import.test.ts` — independent `@myday` markdown annotation. Leave as-is.
- `sync.test.ts` — tests sync payload shape; `my_day` field still present in payloads. No behavior change.
- `offline.spec.ts` — seeds `my_day: true` only for test setup positioning; never asserts on flag value. Unaffected.
- `list/[id]/+page.svelte` — passes `my_day` through on batch import. Leave as-is.
- `api/client.ts` — type definitions only. No change needed.
- Server (`routes.rs`) — no server-side changes required.

**Dead code created by Feature 1 (note for tech-debt tracker):**
- `tasks.setMyDay(id, bool)` — all callers are removed by this change. The method still compiles and causes no harm, but has no remaining call sites. Mark for future removal.

---

## Existing Tests That Need Updating

### `tasks.test.ts`

| Line | Test name | What changes |
|------|-----------|-------------|
| 783 | "keeps my_day when setDueDate sets a past or same-day date" | Test sets `due_date = today` (the mock date is `2026-02-02`, same as the new date). After our change, `setDueDate(today)` clears `my_day`. Flip assertion to `toBe(false)`. Split into two tests: one for today (clears) and one for a past date (keeps). The "keeps for past date" behavior is unchanged. |
| 700 | `saveFromDetails` test passes `my_day: true` and asserts it's saved | Store behavior unchanged — `saveFromDetails` still accepts and applies `my_day` as passed. Keep test as-is. The change is in the drawer call site, not the store method. |

**Unchanged tests (confirmed safe):**
- `tasks.test.ts:802` — "shows completed My Day tasks only for the completion day" — seeds `my_day: true` tasks, tests derived store output. `inMyDay` is unchanged. ✓
- `tasks.test.ts:822` — "drops completed My Day tasks after midnight" — same, `my_day: true` seed only. ✓
- `tasks.test.ts:770` — "clears my_day automatically when setDueDate moves to a future date" — behavior unchanged. ✓

### `myday.spec.ts`

| Line | Test name | What changes |
|------|-----------|-------------|
| 319 | @smoke "persists first detail save deterministically with recurrence and My Day button state" | Clicks `detail-myday-toggle` twice; asserts `my_day: true` in IDB. **Rewrite**: click "Add to My Day" once (fires immediately, `due` field updates) → do NOT click again → verify `due` field shows today → set recurrence + notes → save → assert IDB: `due_date = today`, `my_day = false`. After reload, verify `detail-myday-badge` shown (not toggle), due field = today, recurrence and notes unchanged. |

---

## New Tests to Add

### `tasks.test.ts` unit tests

**Feature 1 — `setDueToday`:**
- Sets `due_date = today`, clears `my_day`, clears punt state, marks dirty, updates `updated_ts`.
- Non-existent id → no-op (no crash).

**Feature 1 — `setDueDate` update:**
- `setDueDate(id, today)` clears `my_day` (update of existing test at line 783).
- `setDueDate(id, futureDate)` still clears `my_day` (regression check).
- `setDueDate(id, pastDate)` does NOT clear `my_day` (unchanged behavior).

**Feature 2 — `nextRecurringDueAfterToday`:**
- Daily task, due 3 days ago → returns tomorrow (next after today).
- Weekly task, due 2 weeks ago → returns next week from today (first occurrence > today).
- Task with punt state → uses `punted_from_due_date` as anchor.

**Feature 2 — `catchUp`:**
- Missed daily task → `due_date = tomorrow`, `occurrences_completed` unchanged.
- Missed task with punt state → punt cleared, `due_date` advanced.
- Non-recurring task → no-op (task unchanged).
- Task with `due_date >= today` → no-op.
- Task with no `due_date` → no-op.
- Task with no `recurrence_id` → no-op.

### `myday.spec.ts` E2E tests

**Feature 1 — My Day button:**

1. **@smoke** "My Day button on task row sets due_date to today"
   - Create task (no due date), find it in list view.
   - Verify "My Day" chip button visible (`data-testid="task-myday-btn"`).
   - Click → task appears in My Day Pending.
   - IDB: `due_date = today`, `my_day = false`.
   - Reload → still in My Day Pending.

2. "My Day button hidden when task already due today"
   - Create task, open detail, click "Add to My Day", save.
   - Navigate to list → "My Day" chip NOT shown.

3. "My Day button in drawer fires immediately and saves due_date"
   - Create task (no due date), open detail drawer.
   - "Add to My Day" button visible, due field empty.
   - Click → due field immediately shows today.
   - Save → IDB: `due_date = today`, `my_day = false`.
   - Task visible in My Day Pending.

4. **Regression** "Legacy my_day: true task without due_date still shows in My Day"
   - Inject `{my_day: true, due_date: undefined}` into IDB.
   - Reload → task in My Day Pending.
   - "My Day" chip NOT shown (already in My Day).

**Feature 2 — Catch Up:**

1. **@smoke** "Catch Up advances missed recurring task past today"
   - Inject daily recurring task with `due_date = yesterday`.
   - Reload → task in Missed section, "Catch Up" chip visible.
   - Click chip → task moves to My Day Pending (`due_date = tomorrow`).
   - IDB: `due_date = tomorrow`, `occurrences_completed` unchanged.
   - Reload → persisted.

2. "Catch Up not shown for non-recurring missed task"
   - Inject non-recurring task with `due_date = yesterday`.
   - Reload → in Missed section, no "Catch Up" chip.

3. "Catch Up clears punt state"
   - Inject recurring task with `due_date = yesterday` and `punted_from_due_date` set.
   - Catch Up → punt state cleared, `due_date` advanced.

4. "Catch Up does not increment occurrences_completed"
   - Inject recurring task with `due_date = yesterday`, `occurrences_completed = 2`.
   - Catch Up → `occurrences_completed` remains 2.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Clicking "My Day" on a task with a future due_date silently replaces it with today | Medium | Intentional. The future date chip in the drawer gives a quick path back. |
| Admin drawer save always writing `my_day: false` silently clears legacy flags | Low | Intentional cleanup. `inMyDay` unchanged — no tasks disappear. |
| `setDueDate(today)` clearing `my_day` is a behavior change | Low | Covered by updated unit test. Correct behavior. |
| Catch Up advancing past intended date for low-frequency recurrence (biannual etc.) | Low | Always finds the first occurrence after today — correct by definition. |
| Contributor can now "Add to My Day" via due_date (previously blocked by flag restriction) | Low | Improvement, not regression. Contributors already could set due_date. |

---

## Rollout / Migration Plan

No database migration. No server changes. Both features are client-side store mutations synced via existing dirty-task mechanism.

Existing data compatibility:
- `my_day: true, no due_date` → `inMyDay()` unchanged, still in My Day. ✓
- `my_day: true, due_date = today` → still in My Day. Flag cleared on next drawer save. ✓
- `my_day: false, due_date = today` → already in My Day. No change. ✓

---

## Implementation Order

1. **`tasks.ts`** — expose `due_date` in `createLocal`/`createLocalWithOptions`; add `setDueToday`; update `setDueDate`; add `nextRecurringDueAfterToday`; add `catchUp`
2. **`tasks.test.ts`** — update line 783 test; add all new unit tests; run vitest green
3. **`TaskRow.svelte`** — My Day checkbox → button; add Catch Up chip
4. **`TaskDetailDrawer.svelte`** — My Day toggle → immediate setter + badge; remove `myDay` var; update save
5. **`+page.svelte`** — `quickAdd` and `addSuggestionToMyDay`
6. **`myday.spec.ts`** — rewrite @smoke My Day drawer test; add new E2E tests
7. **Full test suite** — lint + type-check + vitest + smoke E2E
8. **Doc update** — note change to My Day concept in `ARCHITECTURE.md` if warranted

---

## Progress Log

### 2026-03-10
- Initial plan drafted. Branch created: `feat/my-day-due-today-and-recurrence-catchup`.
- Deep codebase scan (pass 1): confirmed `sync.ts`, `import.ts`, `offline.spec.ts`, `list/[id]/+page.svelte` unaffected. Found `makeLocalTask` supports `due_date` but `createLocal`/`createLocalWithOptions` types don't expose it. Found `punt()` already writes `my_day: false`.
- Deep codebase scan (pass 2 — exhaustive): confirmed `canEditMyDay` stays (still used in save logic). Found `+page.svelte` imports no date utility. Confirmed `createLocalWithOptions` body passes opts wholesale. Identified `setMyDay` becomes dead code. Confirmed tests 802–844 unaffected. Detailed all data-testid changes.
- Complete file read (pass 3 — every line): Found `skip()` method at tasks.ts:502 — our `catchUp` is different, no `streak.break()`. Found `skipMissed()` with "Skip next" in +page.svelte missed-actions — Catch Up chip coexists. Found Catch Up chip must NOT be inside `{#if !inMyDayView}` (missed section uses `inMyDayView={true}`). Found "In My Day" badge should be disabled button reusing `.myday-toggle.active` CSS. Chose two-call approach for `quickAdd` — no import change needed. Three `skip()` tests confirmed unaffected. Plan finalized. Ready to implement.
- Implementation complete (steps 1–5): `tasks.ts` store changes, `tasks.test.ts` unit tests (47 pass), `TaskRow.svelte`, `TaskDetailDrawer.svelte`, `+page.svelte` all updated.
- E2E tests complete (step 6): Rewrote @smoke detail-persist test. Added 4 My Day button tests + 4 Catch Up tests. All 9 new/rewritten tests green. Full myday.spec.ts suite: 31/32 pass (1 pre-existing failure in "does not offer punt for daily recurrence" — `canPunt` reactive checks saved `task.recurrence_id` not local dropdown state, unrelated to our changes).
- Full test suite green: 173 unit tests pass, svelte-check 0 errors, build succeeds.

---

## Decision Log

### 2026-03-10
- **Keep `my_day` DB field**: Do not deprecate. Stop generating `my_day: true` from UI. Backward compat preserved.
- **Catch Up does NOT increment `occurrences_completed`**: Skip ≠ complete. Protects streak/history.
- **Catch Up label: "Catch Up"**: Short enough for an inline chip.
- **Catch Up is an inline chip on the task row**: More discoverable than ⋯ menu.
- **Drawer "My Day" fires immediately**: Clicking "Add to My Day" sets `due = today` instantly (visible in due field). Committed on Save.
- **Drawer always sends `my_day: false` on admin save**: Cleans up legacy flags. `inMyDay` unchanged.
- **`setDueDate(today)` clears `my_day`**: Consistent with `setDueToday`. Keeps data clean.
- **`createLocal`/`createLocalWithOptions` need `due_date` type-exposed**: Body already passes opts through. Only the type signatures need updating.
- **`canEditMyDay` reactive stays**: Still required in the save logic even after `myDay` local var is removed.
- **`setMyDay` method becomes dead code**: Log to tech-debt tracker after implementation. No callers remain after this change.
- **`quickAdd()` uses two-call approach**: `createLocal()` + `setDueToday()`. No import change to `+page.svelte` needed. Simpler than passing `due_date` option.
- **"In My Day" badge uses disabled button**: `<button class="ghost detail-toggle myday-toggle active" disabled>`. Reuses existing CSS at drawer line 377. No new CSS class.
- **Catch Up chip NOT inside `{#if !inMyDayView}`**: Missed section uses `inMyDayView={true}`. Chip must show there — gated purely on task state (missed + recurring).
- **`catchUp()` does NOT call `streak.break()`**: Streak already broken for missed tasks. Contrast with `skip()` which breaks streak for deliberate current-task skips.
