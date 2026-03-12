# Execution Plan: Streak State — Full Server-Side Persistence

**Branch:** `feat/streak-server-side-state`
**Closes tech debt:** #031

---

## Goal

Make all streak combo state — including the `day-complete-date` guard — first-class server-persisted data, consistent with how every other cross-device preference works in tasksync. Today, `day-complete-date` is a local-only localStorage key; the rest of `StreakState` (count, countedTaskIds, lastResetDate) already syncs to the server via `streakStateJson`. This plan closes that gap and removes the orphaned localStorage key.

---

## Non-goals

- No server-side validation changes — the server already stores `streak_state_json` as an opaque JSON blob; adding `dayCompleteDate` to that blob requires no server migration or schema change.
- No change to the localStorage-as-fast-boot-cache pattern — localStorage remains a local read-ahead cache; the server remains authoritative for cross-device sync. This matches how all other preferences work.
- No changes to streak settings, theme loading, announcer logic, or display behavior.

---

## Constraints

- **Offline-first**: `hasFiredDayCompleteToday()` must remain synchronous (reads in-memory store, not network).
- **Performance**: No new network calls; `dayCompleteDate` rides the existing debounced `queueStateSync` already called on every streak mutation.
- **Idempotency**: Writing `dayCompleteDate` on fire and hydrating it on load must be idempotent — no double-fire risk even if called multiple times.
- **No server changes**: The server treats `streak_state_json` as an opaque blob. We extend the client-side `StreakState` type; the server needs nothing.

---

## Current state

| What | Where | Server-synced? |
|------|-------|---------------|
| `count`, `countedTaskIds`, `lastResetDate` | `stateStore` + **separate** localStorage key `tasksync:streak-state:{space}:{user}` | ✅ via `streakStateJson` |
| `day-complete-date` guard | **Separate** localStorage key `tasksync:streak-state:{space}:{user}:day-complete-date` | ❌ localStorage only |
| All other preferences (theme, font, streak settings, etc.) | `tasksync:ui-preferences:{space}:{user}` blob | ✅ via `/auth/preferences` |

There are currently **three** local persistence keys for streak data (two streak, one preferences), where conceptually the preferences key should be the single source of truth for all cross-device user state.

Key functions involved in `web/src/lib/stores/streak.ts`:

- `localKey()` — builds the separate streak state localStorage key
- `dayCompleteDateKey()` — builds the separate day-complete localStorage key
- `hasFiredDayCompleteToday()` — reads `dayCompleteDateKey()` from localStorage
- `markDayCompleteFired()` — writes today's ISO date to `dayCompleteDateKey()`
- `readLocalState()` / `writeLocalState()` — read/write `StreakState` from the streak-specific key
- `hydrateFromServer()` — parses `streakStateJson`; currently ignores any `dayCompleteDate` field
- `queueStateSync()` — debounced push of full `StreakState` to server

---

## Proposed approach

### Step 1 — Extend `StreakState` type

In `shared/types/settings.ts`, add an optional field:

```ts
export interface StreakState {
  count: number;
  countedTaskIds: string[];
  lastResetDate: string | null;
  dayCompleteDate?: string | null; // ISO date string (YYYY-MM-DD); null = not fired today
}
```

This is a backwards-compatible extension: existing persisted blobs without the field parse cleanly (`undefined` → treated as `null`).

### Step 2 — Collapse streak localStorage into the preferences blob

The streak store's separate `tasksync:streak-state:…` key is eliminated. Streak state is persisted into the **same** `tasksync:ui-preferences:…` blob that preferences already own, under a `streakState` field.

**Implementation:** Add a `streakState?: StreakState` field to the local-only shape written by the preferences store. The streak store calls a new shared helper (e.g., `readStreakStateFromPrefsBlob()` / `writeStreakStateToPrefsBlob()`) that reads and merges the `streakState` field into the preferences blob without touching any other preference fields. The preferences store does not own or interpret `streakState`; it is purely a shared persistence key.

```
tasksync:ui-preferences:{space}:{user}  ← single local blob
  .theme, .font, .streakSettings, …     ← owned by preferences store
  .streakState                           ← owned by streak store; merged in-place
```

This eliminates the separate streak key while avoiding bidirectional store coupling: the streak store reads/writes one field in the shared blob; the preferences store is unaware of it.

### Step 3 — Remove separate day-complete localStorage key; move guard into `stateStore`

Replace the localStorage-only helpers:

```
dayCompleteDateKey()       → delete
hasFiredDayCompleteToday() → read from get(stateStore).dayCompleteDate
markDayCompleteFired()     → stateStore.update(...dayCompleteDate: todayIso()); write to prefs blob; queueStateSync(next)
```

`hasFiredDayCompleteToday()` stays synchronous — it reads `get(stateStore)` (in-memory, same cost as before).

`markDayCompleteFired()` becomes a store mutation like every other streak mutation: update store → write to preferences blob → queue debounced server sync. No new codepaths.

### Step 4 — Update `readLocalState()` / `writeLocalState()`

- `writeLocalState()` → now `writeStreakStateToPrefsBlob()`: merge `StreakState` (including `dayCompleteDate`) into the preferences blob under `.streakState`.
- `readLocalState()` → now `readStreakStateFromPrefsBlob()`: read `.streakState` from the preferences blob. Migration fallback: if absent, check both the old streak key (`tasksync:streak-state:…`) and the old day-complete key (`tasksync:streak-state:…:day-complete-date`). After reading, remove both old keys.

### Step 5 — Update `hydrateFromServer()`

Extend the parsed shape to include `dayCompleteDate`:

```ts
dayCompleteDate: typeof parsed.dayCompleteDate === 'string' ? parsed.dayCompleteDate : null
```

Server wins on hydrate — same rule as the rest of `StreakState`. If device A fires day-complete and syncs, device B gets `dayCompleteDate = "2026-03-12"` and `hasFiredDayCompleteToday()` returns `true` without re-firing.

### Step 6 — Update `streak.reset()`

Clear `dayCompleteDate: null` on manual reset (consistent with clearing count + countedTaskIds).

### Step 7 — Re-hydrate preferences + streak on tab resume (`+layout.svelte`)

**Context:** `+layout.svelte` already has a `visibilitychange` listener (added for task sync) that calls `requestSync('focus')` when the tab becomes visible. That triggers task push/pull but never re-hydrates preferences or streak state. A user who leaves the app open on their computer while completing tasks on their phone returns to a stale tab — correct task list (tasks sync), but stale streak state (no re-hydration).

**Change:** Extend the existing `visibilityListener` to also call `uiPreferences.hydrateFromServer()` and `streak.hydrateFromServer()` on tab resume:

```ts
visibilityListener = () => {
  if (document.visibilityState === 'visible' && auth.isAuthenticated()) {
    requestSync('focus');
    void (async () => {
      const wire = await uiPreferences.hydrateFromServer();
      streak.hydrateFromServer(wire?.streakStateJson);
    })();
  }
};
```

**Why this is safe:**
- `uiPreferences.hydrateFromServer()` already has a `prefsMutationVersion` guard — if a local mutation happened while the tab was backgrounded, the hydration is a no-op on the preference fields that changed. No overwrite risk.
- `streak.hydrateFromServer()` sets server state as authoritative — correct behavior on resume, since the server is the cross-device source of truth.
- Both calls are best-effort (fire-and-forget void), same as the boot flow. Offline or network error silently keeps local state.

**Scope:** One file (`+layout.svelte`), ~5 lines. No new stores, no new API calls.

### Step 9 — Periodic preferences + streak poll for always-open PWA

**Context:** The `visibilitychange` listener (Step 7) covers tab switching and PWA minimize/restore, but a standalone desktop PWA that is perpetually visible and focused never hides — so `visibilitychange` never fires. A user who leaves the PWA open on their Mac all day while completing tasks on their phone would see stale streak state indefinitely.

**Change:** Add a 5-minute `setInterval` (alongside the existing 15-second task-sync retry timer) that polls preferences + streak state whenever the page is visible and the user is authenticated:

```ts
prefsRefreshTimer = setInterval(() => {
  if (!auth.isAuthenticated() || document.visibilityState !== 'visible') return;
  void (async () => {
    const wire = await uiPreferences.hydrateFromServer();
    streak.hydrateFromServer(wire?.streakStateJson);
  })();
}, 5 * 60 * 1000);
```

**Why this is safe:**
- Same hydration path as the `visibilitychange` handler — guarded by `prefsMutationVersion`, best-effort, no overwrite risk.
- `document.visibilityState !== 'visible'` guard skips the poll when the tab is backgrounded (the `visibilitychange` handler will run on restore instead, avoiding a double call).
- 5-minute interval: lightweight (one GET to `/auth/preferences`), unnoticeable to users, provides fresh state within one working interval even for always-open PWAs.

**Scope:** One file (`+layout.svelte`), ~8 lines. Cleanup in `onDestroy` via `clearInterval(prefsRefreshTimer)`.

### Step 8 — Tests

Update `web/src/lib/stores/streak.test.ts`:

- `markDayCompleteFired()` writes `dayCompleteDate` into `stateStore` and queues a sync
- `hasFiredDayCompleteToday()` returns `true` after firing, `false` on a different date or null
- `hydrateFromServer()` with a blob containing `dayCompleteDate` populates the guard correctly
- Cross-device scenario: hydrating with today's `dayCompleteDate` prevents `triggerDayComplete` from firing
- `streak.reset()` clears `dayCompleteDate`
- Migration fallback: reading with absent `streakState` in prefs blob reads old streak key + old day-complete key; both removed after
- Prefs blob write (`writeStreakStateToPrefsBlob`) does not overwrite other preference fields

---

## Alternatives considered

| Alternative | Reason rejected |
|-------------|-----------------|
| Dedicated server endpoint for `dayCompleteDate` | Over-engineered; existing `streakStateJson` blob path already handles arbitrary streak state — no new endpoint needed |
| Keep `dayCompleteDate` in a separate top-level `UiPreferencesWire` field | Would require a new wire field, server struct field, and migration column — all unnecessary since the blob is already opaque |
| Remove localStorage cache for streak entirely | Breaks offline-first fast-boot guarantee (no local cache = spinner on every cold load until server responds) |
| "Latest date wins" conflict resolution | "Server wins on hydration" is simpler, consistent with the rest of the system, and correct: server is always the most-recently-synced cross-device truth |
| Keep separate streak localStorage key (don't collapse) | Creates two redundant local keys when one exists. The preferences blob is already the cross-device persistence key; streak state is logically co-located alongside `streakSettings` already in that blob |
| Add `streakState` to `UiPreferences` type and have preferences store own it | Tightly couples stores; preferences store would need to understand streak domain logic. Merge-in-place via shared blob helper keeps stores independent |

---

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Double day-complete fire on first boot post-deploy (old keys present, new field absent) | Low — only on the first boot after deploy | Migration fallback: read old streak key and old day-complete key if `streakState` absent from prefs blob; remove both old keys after reading |
| Preferences store write race: streak store merges `streakState` into prefs blob at the same time preferences store writes | Low — both use read-merge-write on the same key; no atomicity in localStorage | Both writes are synchronous and single-threaded in the browser; no actual race. Document the contract: streak store merges its one field; preferences store must not clobber the `streakState` field when writing |
| `queueStateSync` racing with an in-flight push during `markDayCompleteFired` | Low — debounced at 250 ms, same as all other mutations | No change needed; existing debounce handles it |
| Server returning a stale blob that overwrites a freshly fired `dayCompleteDate` | Low — hydration only runs at boot, before any same-session fire | `hydrateFromServer()` is only called from `+layout.svelte` on login/boot; no mid-session hydration |

---

## Acceptance criteria

- [ ] Completing all My Day tasks on device A, then opening device B same day, does NOT re-trigger the day-complete celebration.
- [ ] `dayCompleteDate` appears in the JSON blob stored in `streak_state_json` on the server.
- [ ] `streak.reset()` clears `dayCompleteDate` (and it syncs to server).
- [ ] Offline (no server): day-complete fires correctly using local `stateStore` state; syncs on reconnect.
- [ ] The separate `tasksync:streak-state:…` and `tasksync:streak-state:…:day-complete-date` localStorage keys no longer exist after migration.
- [ ] Streak state appears under `streakState` inside the `tasksync:ui-preferences:…` localStorage blob.
- [ ] Preferences store writes do not clobber `streakState` in the shared blob.
- [ ] First boot after deploy: both old localStorage keys are consumed as migration fallback, then removed.
- [ ] Returning to a backgrounded tab re-hydrates preferences and streak state without a manual refresh.
- [ ] All new unit test cases pass. Pre-commit and pre-push hooks pass clean.

---

## Test plan

**Unit tests** (`web/src/lib/stores/streak.test.ts`):
1. `markDayCompleteFired()` → `dayCompleteDate` set in stateStore and written into prefs blob
2. `hasFiredDayCompleteToday()` → true after fire, false for different date
3. `hydrateFromServer(json)` where json includes `dayCompleteDate: "today"` → guard active
4. `hydrateFromServer(json)` where json includes `dayCompleteDate: "yesterday"` → guard inactive (different date)
5. `streak.reset()` → `dayCompleteDate` is `null`
6. Migration fallback: reading with absent `streakState` in prefs blob reads old streak key + old day-complete key; both removed after
7. Prefs blob write (`writeStreakStateToPrefsBlob`) does not overwrite other preference fields

**Manual smoke** (before PR):
- Log in on two browsers, complete all My Day tasks on one, reload the other — no double celebration
- Confirm `streak_state_json` in server response contains `dayCompleteDate`
- Inspect localStorage — only `tasksync:ui-preferences:…` key; no streak-specific keys
- Leave tab open on device A; complete tasks on device B; switch back to device A tab — streak state updates without manual refresh ✅
- Leave PWA perpetually open on device A (never switch away); add task on device B; wait up to 5 minutes — task appears without manual refresh ✅

---

## Rollout / migration plan

- No schema migration needed (server stores opaque blob).
- No feature flag needed.
- One-boot migration: old `tasksync:streak-state:…` and `tasksync:streak-state:…:day-complete-date` keys are read as fallback if `streakState` is absent from the preferences blob, then deleted.
- Preferences store `writeLocal()` must not clobber the `streakState` field: streak store uses a merge-in-place write helper rather than replacing the whole blob. This is the only coordination contract between the two stores.
- Deploy is transparent — old clients produce blobs without the field; new clients treat absent field as `null` (no re-fire within the same day if the field is absent; first session after deploy may re-fire if already fired that day, acceptable edge case).

---

## Progress log

- **2026-03-12** — Plan authored. Scope confirmed: client-only changes (shared type + streak store + tests). No server changes required.
- **2026-03-12** — Step 9 added and implemented: 5-minute periodic preferences + streak poll for always-open desktop PWA. `prefsRefreshTimer` added alongside `retryTimer` in `+layout.svelte`; cleaned up in `onDestroy`. Skips poll when tab is hidden (visibilitychange handler covers that path).
- **2026-03-12** — Extended Step 9 poll to also call `requestSync('poll')` — task sync was not covered by the original poll, only prefs/streak. A perpetually-open PWA tab never saw tasks added on other devices without this. Verified working in beta.
- **2026-03-12** — Implementation complete. All 9 steps done: `StreakState.dayCompleteDate` added; streak localStorage collapsed into prefs blob; `markDayCompleteFired`/`hasFiredDayCompleteToday` moved to stateStore; `hydrateFromServer` updated; `reset()` clears `dayCompleteDate`, `break()` preserves it; `visibilityListener` extended for prefs+streak re-hydration on tab resume; tests updated and new cases added; tech debt #031 closed; 5-minute full-refresh poll covers always-open desktop PWA. Beta-verified. **COMPLETE.**

---

## Decision log

- **2026-03-12** — Conflict resolution: "server wins on hydration" (same as rest of streak state). Rationale: server is the cross-device source of truth; `hasFiredDayCompleteToday()` is only meaningful per-calendar-day so date-equality check is the guard, not a merge strategy.
- **2026-03-12** — localStorage cache retained: fast-boot offline-first requires synchronous local read. `dayCompleteDate` added to the cache; no separate key.
- **2026-03-12** — Collapse separate streak localStorage key into the preferences blob. User confirmed: streak state should be co-located with other preferences in `tasksync:ui-preferences:…`, eliminating the orphaned `tasksync:streak-state:…` key. Implemented via merge-in-place write helper so stores remain decoupled.
- **2026-03-12** — Migration fallback: read both old keys if `streakState` absent from prefs blob; remove after reading. One-time, low-cost, avoids silent double-fire on first post-deploy boot.
- **2026-03-12** — Scoped in: preferences + streak re-hydration on tab resume (`visibilitychange`). Motivator is streak correctness across devices; benefit extends to all preferences. Implemented as a ~5-line extension to the existing `visibilityListener` in `+layout.svelte`. The `prefsMutationVersion` guard in the preferences store makes repeated hydration safe without additional debounce.
- **2026-03-12** — Scoped in: 5-minute periodic poll for always-open desktop PWA (Step 9). `visibilitychange` covers tab-switching and minimize/restore but never fires for a perpetually visible standalone PWA window. Poll uses same hydration path, guarded by `document.visibilityState` to avoid double calls when the tab is already being covered by the `visibilitychange` handler.
