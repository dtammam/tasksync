# Execution Plan: Streak (DDR-style combo meter)

## Goal

Add an optional "Streak" feature that displays a DDR-style combo meter in the center of the screen when a user completes tasks. The meter counts consecutive completions, breaks on punts/cancellations/deletions, supports multiple visual themes, and plays announcer audio clips at milestone counts. The streak count and settings persist cross-device via server sync.

## Non-goals

- User-uploadable custom streak theme assets (V1 only ships bundled themes)
- Per-task accuracy grading (judgment tier is streak-count-based, not timing-based)
- Multiplayer / shared streak between users
- Streak leaderboards

## Constraints

- **Performance**: overlay must not affect interaction paint budget (<50 ms). All assets pre-loaded.
- **Offline-first**: streak state updates must be optimistic/local-first. Server sync is best-effort.
- **No spaghetti**: `StreakDisplay` component must not import from `data/`. State flows through `stores/streak.ts`.
- **Layer rules**: streak store may depend on types/repo; UI component depends only on the store.
- **Announcer audio**: reuses the existing WebAudio runtime (pre-decoded buffers, same gain control path as completion sounds).

## Current state

- `UiPreferences` lives in `shared/types/settings.ts` and syncs via `/auth/preferences` (GET/PATCH).
- Preferences are stored as columns on the `user` table. New prefs = new migration.
- Task completion fires through `tasks.toggle()` in `web/src/lib/stores/tasks.ts`, which already has a `shouldPlayCompletion` flag pattern — a clean hook for streak events.
- Sound runtime lives in `web/src/lib/sound/`; completion sounds are pre-decoded and played via WebAudio.
- The settings modal is defined by `settingsMenu.ts` and renders in `Sidebar.svelte`.
- Static audio lives in `web/static/sounds/`; no existing `web/static/streak/` directory.

## Proposed approach

### Phase 1 — Types and shared contracts

1. Add to `shared/types/settings.ts`:
   - `StreakTheme = 'ddr'` (union, extensible)
   - `StreakResetMode = 'daily' | 'endless'`
   - `StreakSettings { enabled: boolean; theme: StreakTheme; resetMode: StreakResetMode }`
   - `StreakState { count: number; countedTaskIds: string[]; lastResetDate: string | null }`
   - Extend `UiPreferences` with `streakSettings: StreakSettings`
   - Extend `UiPreferencesWire` with `streakSettingsJson?: string` and `streakStateJson?: string`

2. Update `fromWire` / `toWire` in `preferences.ts` to handle the new fields.

### Phase 2 — Server migration and endpoint extension

3. New migration `0015_user_streak.sql`:
   ```sql
   alter table user add column streak_settings_json text;
   alter table user add column streak_state_json text;
   ```

4. Extend `server/src/routes.rs`:
   - `load_ui_preferences_for_user`: add `streak_settings_json`, `streak_state_json` to SELECT
   - `auth_update_preferences`: read + write both new columns (passthrough blob with light validation)
   - `UiPreferencesResponse` struct: add both fields as `Option<String>`
   - `UpdateUiPreferencesBody` struct: add both fields as `Option<String>`
   - Server validates that `streak_settings_json` (if present) is valid JSON and enabled/theme/resetMode are in the allowed set. Rejects unknown themes.
   - `streak_state_json` is stored as-is (trusted client state; no server-side invariants needed here).

5. Update backup export query to include `streak_settings_json` and `streak_state_json` in the user row (consistent with how `ui_theme`, `ui_sidebar_panels`, custom sound fields, etc. are already exported). Update restore to write them back. This ensures a user who restores from backup gets their streak count and preferences back.

### Phase 3 — Streak store (`web/src/lib/stores/streak.ts`)

This is the core runtime. Responsibilities:
- Hold `StreakSettings` (from preferences store, reactive)
- Hold `StreakState` (local + server-synced)
- Expose `increment(taskId: string)` — called by `tasks.toggle()` on completion
- Expose `break()` — called by `tasks.toggle()` on punt/cancel and by `tasks.deleteRemote()`
- Expose `undoCompletion(taskId: string)` — called when toggling done→pending (no-op for count, removes taskId from countedSet so a re-completion would count again)
- Handle DDR midnight reset logic (check `lastResetDate` on hydration; if stale date, reset count but not settings)
- Debounce server sync of state (250 ms, same pattern as other settings)
- Expose a derived readable for the display: `{ count, visible, justIncremented }`

**State transition rules:**
- `increment(taskId)`: if taskId already in `countedTaskIds` → no-op. Else: `count++`, add to `countedTaskIds`, update `lastResetDate` to today, trigger display, check announcer milestone.
- `break()`: `count = 0`, `countedTaskIds = []`, sync to server.
- `undoCompletion(taskId)`: remove taskId from `countedTaskIds` (allows re-count on re-complete). Does not change `count`.
- On hydration (daily reset check): if `resetMode === 'daily'` and `lastResetDate !== today` → `count = 0`, `countedTaskIds = []`.
- `countedTaskIds` is scoped to the active combo run; cleared on `break()`.

**Server sync strategy:**
- Settings: saved via existing `uiPreferences` store flow (already handles debounce + server push).
- State: dedicated `queueStateSync()` helper in streak store, debounced 250 ms, PATCH to `/auth/preferences` with only `streakStateJson`.

### Phase 4 — Hook into task actions

Modify `web/src/lib/stores/tasks.ts`:
- `toggle()`: on completion (where `shouldPlayCompletion = true`), call `streak.increment(id)`. On un-complete (done→pending), call `streak.undoCompletion(id)`. On punt (existing punt path), call `streak.break()`.
- `deleteRemote()` / `remove()`: call `streak.break()`.
- Add a `cancel()` path (or wherever task status→cancelled is set): call `streak.break()`.

### Phase 5 — Static assets (placeholder scaffolding)

Directory structure under `web/static/streak/`:
```
web/static/streak/
  ddr/
    digits/
      0.png  1.png  2.png  3.png  4.png
      5.png  6.png  7.png  8.png  9.png
    streak/
      streak-word.png          ← "COMBO" graphic
    judgment/
      marvelous.png            ← top tier (100+)
      excellent.png            ← (50–99)
      great.png                ← (25–49)
      good.png                 ← (5–24)
    announcer/
      1.mp3  2.mp3  3.mp3      ← placeholder (silent or tone)
```

For scaffolding, placeholder PNGs are 1×1 transparent PNGs (or simple labeled SVG-to-PNG exports). Real assets provided by user separately.

**Judgment image selection:**
No count-based tiering. On each streak display event, randomly select one image from the theme's `judgment/` directory. DDR theme V1 ships one image (`marvelous.png`). Future themes and future DDR updates can add more images to the folder; the random-pick logic requires no code change. The `judgment/` folder being empty (or judgment display disabled for a theme) is a valid state — the component simply omits that layer.

### Phase 6 — Announcer audio

**Milestone triggers:** 5, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300

At each milestone, pick a random announcer clip from the theme's `announcer/` directory and play via WebAudio (same runtime as completion sounds, respects global volume). A separate gain node allows announcer volume to be distinct in future; for V1 it shares the master volume.

Announcer clips are pre-decoded on streak enable/hydration. If a clip fails to decode, skip silently.

### Phase 7 — `StreakDisplay.svelte` component

**Placement:** The streak display is a `position: fixed` element anchored to the **top of the content area**, centered on the content pane (sidebar-aware). This makes it work on any page (My Day, list views, etc.) without being My Day-specific, while matching the mockup intent of appearing in the header region rather than blocking the center of the viewport.

Exact positioning:
```css
position: fixed;
top: var(--app-header-height, 56px);   /* just below the global nav bar */
left: calc(var(--sidebar-width, 0px) + 50%);
transform: translateX(-50%);
z-index: 200;
pointer-events: none;
```
On desktop (sidebar pinned), `--sidebar-width` is set by the layout; the display centers itself in the remaining content pane. On mobile, `--sidebar-width` is 0.

The My Day page header has natural whitespace between the title block and sort controls (flex row with space-between). The streak display floating at the top of the content area occupies that visual zone without needing My Day-specific layout slots. This approach also works gracefully on list pages where a task is completed.

**Three stacked layers (top to bottom):**
  1. **Judgment image** (top) — a randomly selected `<img>` from `web/static/streak/{theme}/judgment/`; omitted entirely if the folder is empty or no judgment image is configured for the theme.
  2. **Digit images** (middle) — each digit rendered as `<img>` side-by-side, sourced from `web/static/streak/{theme}/digits/{n}.png`
  3. **Streak word image** (bottom) — `<img>` from `web/static/streak/{theme}/streak/streak-word.png`

**Visibility / animation lifecycle:**
  - On `increment()` — hidden: fade in + scale 0.8→1.0 (150 ms ease-out); visible: pulse digit layer (scale 1.0→1.08→1.0, 120 ms) + swap digit images; restart 5 s fade-out timer.
  - After 5 s idle: fade out with slight upward float (`opacity 1→0` + `translateY 0→-8px`, 300 ms ease-in). Consistent with app's existing exit transitions (`fly + fade`, ~150–200 ms range; streak uses slightly longer 300 ms because it's a "moment").
  - On `break()` (count was > 0): brief desaturate/dim flash (200 ms), then fast fade out (150 ms).
  - On `break()` (count was 0): no visual.

**Digit rendering:** convert count to string, split into chars, one `<img>` per digit. Max display cap: 9999 (4 digits). Images sized with `height: clamp(48px, 8vw, 96px)` so they scale gracefully across mobile and desktop.

**Mounting:** `web/src/routes/+layout.svelte`, alongside the existing toast. Conditionally rendered only if `streakSettings.enabled`.

### Phase 8 — Settings UI ("Streak" section)

Add "Streak" to `settingsMenu.ts` section list.

Settings panel contains:
- **Enable Streak** — toggle (on/off)
- **Theme** — selector; currently only `ddr`; renders theme name as label
- **Reset Mode** — two options: `Daily (DDR)` resets at midnight, `Endless (ITG)` never resets automatically
- Current streak count displayed as read-only info (e.g., "Current streak: 47")
- Reset button (manual reset, breaks the streak)

### Phase 9 — Tests

**Unit tests** (`web/src/lib/stores/streak.test.ts`):
- `increment()` does not double-count the same task ID
- `increment()` after `undoCompletion()` on the same ID counts correctly
- `break()` resets count and countedTaskIds to zero/empty
- DDR mode: hydration with stale `lastResetDate` resets count
- Endless mode: hydration with stale `lastResetDate` does NOT reset count
- Milestone detection: correct milestones fire for counts 5, 25, 50, 100, 300
- Milestones do not double-fire (crossing 50 once → fires once)

**Unit tests** (settings normalization):
- Unknown streak theme falls back to `ddr`
- Invalid `resetMode` falls back to `daily`
- `streakStateJson` with malformed JSON deserializes to default state

**Server tests** (`server/src/routes.rs`):
- GET preferences returns default `streak_settings_json` and `streak_state_json` for new user
- PATCH with valid `streak_settings_json` persists and round-trips correctly
- PATCH with unknown streak theme returns 400
- PATCH with `streak_state_json` persists opaquely (server stores without rejecting valid JSON)

**Component tests / Playwright smoke (future PR):**
- Completing a task while streak enabled shows the overlay
- Overlay disappears after timeout
- Punting breaks the streak (visual break flash)

## Alternatives considered

- **Ephemeral (localStorage-only) streak state**: simpler, but contradicts user requirement for cross-device persistence and undermines the psychological value of maintaining a real streak.
- **Separate `/auth/streak` endpoint**: cleaner separation but adds a new server route, new auth middleware wiring, and more surface. Extending `/auth/preferences` is the established pattern and avoids that cost.
- **Svelte animation library**: rejected to keep zero new runtime dependencies. CSS transitions + Svelte `transition:` directives cover all animation needs.
- **Sprite sheet for digits**: rejected for simplicity and because individual PNGs are easier for the user to provide/replace per-theme.

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Two devices race on streak state (concurrent completions) | V1 accepts last-write-wins; `countedTaskIds` still prevents double-count on each device. Cross-device double-increment is an edge case. Flag for V2 with set-union merge. |
| Announcer audio blocks interaction on slow devices | Pre-decode on feature enable; play asynchronously; catch and suppress errors silently. |
| `countedTaskIds` grows unbounded | Cleared on every `break()`. During a single unbroken streak, at most N task completions → bounded by realistic task count per session. |
| Overlay obscures UI on small screens | Pointer-events none; 5 s timeout; can be disabled. Scale digit images responsively with `vw`-based sizing. |
| Placeholder assets break build | Placeholder PNGs are valid (1×1 transparent). Audio placeholder is a silent .mp3. Build/import paths guarded by feature flag. |

## Acceptance criteria

- [ ] Completing a task (when streak enabled) increments the counter and shows the overlay
- [ ] Completing the same task twice (toggle done→pending→done) counts only once
- [ ] Punting a task breaks the streak (count resets to 0, break animation plays)
- [ ] Cancelling or deleting a task breaks the streak
- [ ] Un-completing (done→pending) does not break the streak but allows re-count on re-complete
- [ ] DDR reset mode: opening the app on a new calendar day shows count = 0
- [ ] Endless mode: opening on a new day preserves count
- [ ] Milestone counts (5, 25, 50, ...) trigger a random announcer clip
- [ ] Overlay auto-dismisses after 5 s of no new completions
- [ ] New completion while overlay visible restarts the 5 s timer and animates new digit
- [ ] Streak count persists across page reload (server-backed)
- [ ] Streak count is the same on a second device after syncing
- [ ] "Streak" section appears in settings modal, toggle/theme/resetMode save and reload correctly
- [ ] Streak disabled = no overlay, no audio, zero CPU overhead
- [ ] All unit tests pass; server tests pass; pre-commit hook passes

## Test plan

1. Unit: `streak.test.ts` covering all state transitions (see Phase 9)
2. Unit: settings normalization for new streak fields
3. Server: preferences round-trip for streak columns
4. Manual smoke: complete tasks in sequence, verify overlay appears; punt, verify break; reload, verify persistence; switch device, verify sync
5. Pre-push: existing Playwright @smoke suite must still pass (no regressions)

## Rollout / migration plan

- Migration `0015` is additive (nullable columns); safe to roll forward with zero downtime.
- Feature is **opt-in** (disabled by default). Existing users see no change until they enable it in settings.
- Placeholder assets ship with the feature; real DDR-theme assets are dropped in as a follow-up PR once provided by user.
- Backup/restore query updated in the same PR to include new columns (avoids schema drift).

## Progress log

- 2026-03-09: Plan drafted. Design decisions finalized through Q&A. No code written yet.

## Decision log

- 2026-03-09: Streak state persists cross-device via server (not ephemeral). Matches pattern of other user preferences.
- 2026-03-09: Both streak settings and state stored as JSON blobs in two new `user` table columns, via existing `/auth/preferences` endpoint. Avoids new route surface area.
- 2026-03-09: `countedTaskIds` scoped to active combo run; cleared on `break()`. Prevents unbounded growth.
- 2026-03-09: Un-completing (done→pending) removes taskId from countedSet (so re-complete counts) but does not change streak count. No active break on un-complete.
- 2026-03-09: Judgment tier (MARVELOUS/EXCELLENT/etc.) is count-range-based, not timing-based.
- 2026-03-09: Settings section named "Streak" (not "Combo") to support future themes where the streak word graphic differs.
- 2026-03-09: V1 accepts last-write-wins for cross-device streak state race. Set-union merge deferred to V2.
- 2026-03-09: Display timeout fixed at 5 s (not configurable in V1). Restarts on each new completion.
- 2026-03-09: Judgment image selection is random-from-folder (not count-based tiered). No color differentiation needed; single DDR image to start.
- 2026-03-09: Streak display is `position: fixed` at top of content area (sidebar-aware), not center-screen. Works on any page, matches My Day header whitespace visually.
- 2026-03-09: Fade-out uses slight upward float + opacity (300 ms), consistent with app's `fly+fade` exit pattern.
- 2026-03-09: Streak state and settings included in backup export/restore, matching treatment of other per-user data (sound settings, UI preferences).
