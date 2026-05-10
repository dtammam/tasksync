# Remove Sidebar Pin/Unpin Button

## Goal

Remove the vestigial Pin/Unpin sidebar button and all associated pinning logic so the sidebar header is uncluttered and the layout code in `+layout.svelte` is simplified.

## Non-goals

- No server changes — pin state was client-only and never synced.
- No store changes — pin state lived in local variables in `+layout.svelte`, not in a Svelte store.
- No new navigation or sidebar features — this is a removal only.
- No changes to how the sidebar opens or closes on desktop (it is always visible via the grid layout).

## Constraints

- Sidebar must open and close correctly on mobile (drawer slide-in/out) after removal.
- Sidebar must remain permanently visible on desktop without any pinning logic.
- The three-zone sidebar layout (frozen top, scrollable list zone, frozen bottom) introduced in the `sidebar-fixed-zones` plan must remain intact and unaffected.
- All existing E2E tests except the pin-specific test must continue to pass after removal.
- The `tasksync:nav-pinned` localStorage key must be absent from new sessions (the key should simply not be written any more; stale keys left by prior sessions are harmless).
- Performance budgets from `docs/RELIABILITY.md` must not be violated — this change removes DOM elements and branches, so regression risk is negligible, but the smoke suite must confirm no timing regressions.

## Current state

### `web/src/lib/components/Sidebar.svelte`

- Exports a `navPinned` prop (boolean, default `false`).
- Declares a `togglePin()` function that dispatches a `togglePin` event.
- Renders a `<button class="pin" data-testid="nav-pin" aria-pressed={navPinned}>` inside `.title-row` in the frozen top zone.
- Has `.pin` and `.pin.active` CSS rules (lines ~1479–1494).

### `web/src/routes/+layout.svelte`

- Declares `const NAV_PIN_KEY = 'tasksync:nav-pinned'` (line 29).
- Declares `let navPinned = false` (line 31).
- `toggleNav()` branches on `navPinned`: if pinned and open, it calls `savePinned(false)` and closes (lines 41–47).
- `closeNav()` guards on `navPinned`: only closes if not pinned (lines 49–51).
- `savePinned(pinned)` writes to localStorage under `NAV_PIN_KEY` and sets `navOpen = true` if pinning (lines 60–68).
- `afterNavigate` closes the nav only when `!navPinned` (lines 70–74).
- `onMount` reads `NAV_PIN_KEY` from localStorage and sets both `navPinned` and `navOpen` from it (lines 272–274).
- The `app-shell` div applies CSS classes `nav-split` (when pinned and open) and `nav-drawer-open` (when open and not pinned) (line 406).
- Passes `navPinned` prop and `on:togglePin` handler to `<Sidebar>` (lines 413–414).
- The backdrop button (`drawer-backdrop`) is conditionally rendered `{#if navOpen && !navPinned}` (line 418).
- Mobile-only CSS rules for `.app-shell.nav-split` and `.app-shell.nav-drawer-open` exist in the `<style>` block (lines 874–881).

### `web/tests/e2e/myday.spec.ts`

- Contains one test: `'keeps mobile sidebar open when pinned'` (line 1005–1030), which opens the sidebar, clicks `data-testid="nav-pin"`, navigates, asserts the drawer stays open, reloads, and unpins.

## Proposed approach

### 1. `Sidebar.svelte`

- Remove the `export let navPinned = false` prop declaration.
- Remove the `togglePin()` function.
- Remove the `<button class="pin" ...>` element (and surrounding whitespace) from the `.title-row` template.
- Remove the `.pin` and `.pin.active` CSS rules.
- The `.title-row` div stays; the `app-title` span remains the only child.

### 2. `+layout.svelte` — script block

- Remove `const NAV_PIN_KEY = 'tasksync:nav-pinned'`.
- Remove `let navPinned = false`.
- Simplify `toggleNav()`: remove the `navPinned` branch; the function simply toggles `navOpen`.
- Simplify `closeNav()`: remove the `if (!navPinned) navOpen = false` guard; the function simply sets `navOpen = false` (the `settingsDialogOpen` guard stays).
- Remove `savePinned()` entirely.
- Simplify `afterNavigate`: remove the `if (!navPinned)` condition; always set `navOpen = false`.
- Remove the `navPinned = localStorage.getItem(NAV_PIN_KEY) === '1'; navOpen = navPinned;` lines from `onMount` (the `navOpen = false` initial value suffices).
- Remove the `on:togglePin` handler from the `<Sidebar>` component usage.
- Remove the `navPinned={navPinned}` prop from the `<Sidebar>` component usage.

### 3. `+layout.svelte` — template

- In the `app-shell` class string, remove `${navPinned && navOpen ? 'nav-split' : ''}` and `${navOpen && !navPinned ? 'nav-drawer-open' : ''}`. Only `settings-open` remains dynamic.
- The `{#if navOpen && !navPinned}` backdrop condition becomes `{#if navOpen}`.

### 4. `+layout.svelte` — CSS

- Remove `.app-shell.nav-split` rule and its two child rules (`.nav-split .sidebar-drawer`, `.nav-split main`) from the `@media (max-width: 900px)` block.
- Remove the `:global(.app-shell.nav-drawer-open .mobile-add)` and `:global(.app-shell.nav-drawer-open .suggestions-toggle)` rules from the `@media (max-width: 900px)` block.

### 5. `web/tests/e2e/myday.spec.ts`

- Delete the entire `'keeps mobile sidebar open when pinned'` test (lines 1005–1030).

## Alternatives considered

- **Keep the pin feature but hide it behind a flag:** Rejected. The user explicitly wants it removed. Dead code is a liability (`docs/CONTRIBUTING.md`: "Delete freely").
- **Replace pinning with a permanent-split mode on desktop:** Out of scope. Desktop already has a permanent sidebar via the grid layout; no replacement is needed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing `navPinned` guard in `closeNav` could cause the sidebar to close when the settings dialog is open | The `if (settingsDialogOpen) return` guard is preserved — that was the separate branch from the pin guard. Both guards were `if` checks at the top of `closeNav`; removing only the pin branch leaves the settings guard intact. |
| Users with `tasksync:nav-pinned = '1'` in localStorage will have stale data | Harmless: the key is simply never read again. No migration needed; stale keys do not affect behavior. |
| `nav-drawer-open` removal could break something that depended on it | Audit shows only `.mobile-add` and `.suggestions-toggle` hide rules used it. Those rules are being removed too. No other selectors reference `nav-drawer-open`. |
| `nav-split` removal could affect layout on mobile | The `nav-split` layout mode was only reachable via the pin button, which is being removed. After removal, the mobile sidebar is always a drawer. No production path reaches `nav-split`. |

## Acceptance criteria

- [ ] The Pin/Unpin button (`data-testid="nav-pin"`) is absent from the rendered DOM on both mobile and desktop viewports.
- [ ] The `navPinned` variable, `savePinned` function, `togglePin` function, and `NAV_PIN_KEY` constant are absent from `+layout.svelte`.
- [ ] The `navPinned` prop export and `togglePin` dispatcher are absent from `Sidebar.svelte`.
- [ ] The `.pin` and `.pin.active` CSS rules are absent from `Sidebar.svelte`.
- [ ] The `nav-split` and `nav-drawer-open` CSS classes and their associated style rules are absent from `+layout.svelte`.
- [ ] The `tasksync:nav-pinned` localStorage key is never written by the application (verified by inspection: no `setItem` calls reference `NAV_PIN_KEY` or the literal string `'tasksync:nav-pinned'`).
- [ ] On mobile (viewport ≤ 900px): tapping the hamburger toggle opens the sidebar drawer; tapping a list link closes it; tapping the backdrop closes it.
- [ ] On desktop (viewport > 900px): the sidebar is permanently visible; the hamburger toggle is present but toggling it does not produce a split-layout or pinned state.
- [ ] After navigation (clicking a list link on mobile), the sidebar drawer closes automatically.
- [ ] The settings dialog still opens and closes correctly from the sidebar Settings button; the sidebar remains open while the settings dialog is open and closes when the dialog closes and the user navigates.
- [ ] The three-zone sidebar layout (frozen top with title + sort control, scrollable list zone, frozen bottom with Settings button) is visually intact.
- [ ] The removed E2E test (`'keeps mobile sidebar open when pinned'`) is absent from `myday.spec.ts`.
- [ ] All remaining E2E tests in the smoke suite pass (`npm run test:e2e:smoke`).
- [ ] `npm run lint`, `npm run check`, and `npm run test` all pass with no new errors or warnings.

## Test plan

- Unit/type level: `npm run check` confirms no TypeScript errors from removed prop/event references.
- Lint: `npm run lint` confirms no unused import or dead-code warnings introduced.
- Unit: `npm run test` (Vitest) — no new failures; no pin-related unit tests exist, so no removals needed beyond the E2E test.
- E2E smoke (Chromium): `npm run test:e2e:smoke` — full smoke suite passes. Manual walkthrough of sidebar open/close on mobile and desktop viewports to confirm behavior.

## Rollout / migration plan

No rollout steps required. This is a pure client-side UI removal. Stale `tasksync:nav-pinned` localStorage keys in user browsers are inert and do not need clearing.

## Design

### Approach

This is a straight removal of dead feature code across three files. The pin/unpin
button in the sidebar, the pinning state in the layout, and the E2E test that
exercised pinning are all deleted. No new code is introduced. The sidebar becomes
a pure drawer on mobile and a permanent grid column on desktop, which is the
behavior users already experience (the pin button was vestigial).

One correction to the PM's proposed approach: the `nav-drawer-open` CSS class
currently hides `.mobile-add` and `.suggestions-toggle` when the sidebar drawer
is open on mobile. The PM's plan removes these rules entirely, but the hiding
behavior is still desirable -- without it, the fixed-position add-task bar and
suggestion toggle would remain visible behind the semi-transparent backdrop when
the drawer slides in. The correct approach is to **re-home these hide rules**
under the existing `.sidebar-drawer.open` selector (scoped inside the mobile
media query) rather than deleting them outright. This preserves the UX without
depending on a class that no longer exists.

### Component changes

- **`Sidebar.svelte` (script block)**:
  - Remove `export let navPinned = false` (line 22).
  - Remove the `togglePin` function (lines 297-299).
  - `createEventDispatcher` and `dispatch` remain -- still used for
    `settingsOpenChange` event (line 176).

- **`Sidebar.svelte` (template)**:
  - Remove the entire `<button class="pin" ...>` element (lines 753-762) from
    inside `.title-row`. The `.title-row` div and `.app-title` span remain.

- **`Sidebar.svelte` (CSS)**:
  - Remove `.pin` rule (lines 1479-1487).
  - Remove `.pin.active` rule (lines 1489-1493).

- **`+layout.svelte` (script block)**:
  - Remove `const NAV_PIN_KEY = 'tasksync:nav-pinned'` (line 29).
  - Remove `let navPinned = false` (line 31).
  - Simplify `toggleNav()` (lines 40-47): remove the `if (navPinned && navOpen)`
    branch and the `savePinned(false)` call. Result: `navOpen = !navOpen`.
  - Simplify `closeNav()` (lines 48-51): remove the `if (!navPinned)` guard.
    Result: `if (settingsDialogOpen) return; navOpen = false;`. The
    `settingsDialogOpen` guard is a separate `if` statement on line 49 --
    confirmed safe to keep independently.
  - Remove `savePinned()` entirely (lines 60-68).
  - Simplify `afterNavigate` (lines 70-74): remove the `if (!navPinned)`
    condition. Result: unconditionally `navOpen = false`. This is safe on
    desktop because the sidebar is always visible via CSS grid regardless of
    `navOpen` -- `navOpen` only controls the mobile drawer transform.
  - Remove localStorage read of `NAV_PIN_KEY` in `onMount` (lines 272-274).
    `navOpen` starts as `false`, which is correct (mobile drawer closed on
    load, desktop sidebar visible via grid).

- **`+layout.svelte` (template, line 406)**:
  - Simplify the `app-shell` class expression. Remove both
    `${navPinned && navOpen ? 'nav-split' : ''}` and
    `${navOpen && !navPinned ? 'nav-drawer-open' : ''}`. The class becomes:
    `` class={`app-shell ${settingsDialogOpen ? 'settings-open' : ''}`} ``
  - Remove `navPinned={navPinned}` prop from `<Sidebar>` (line 413).
  - Remove `on:togglePin={(e) => savePinned(e.detail.pinned)}` handler (line
    414).
  - Simplify backdrop condition (line 418): `{#if navOpen && !navPinned}`
    becomes `{#if navOpen}`.

- **`+layout.svelte` (CSS, mobile media query starting line 860)**:
  - Remove `.app-shell.nav-split` and its two child rules (lines 874-876).
  - **Do NOT simply delete** the `:global(.app-shell.nav-drawer-open .mobile-add)`
    and `:global(.app-shell.nav-drawer-open .suggestions-toggle)` rules (lines
    877-881). Instead, **replace** them with rules scoped to
    `.sidebar-drawer.open`:

    ```css
    .sidebar-drawer.open ~ main :global(.mobile-add) {
        display: none;
    }
    .sidebar-drawer.open ~ main :global(.suggestions-toggle) {
        display: none;
    }
    ```

    This uses the general sibling combinator to hide these elements when the
    drawer is open, without needing a class on `app-shell`. The `~` combinator
    works because `.sidebar-drawer` and `main` are siblings inside `.app-shell`.

### Data model changes

None.

### API changes

None.

### Ripple-effect audit

Grep results for all pin-related identifiers across the entire codebase
(excluding the exec plan itself):

| Identifier | Files found | Covered by plan? |
|---|---|---|
| `navPinned` | `Sidebar.svelte`, `+layout.svelte` | Yes |
| `NAV_PIN_KEY` | `+layout.svelte` | Yes |
| `savePinned` | `+layout.svelte` | Yes |
| `togglePin` | `Sidebar.svelte`, `+layout.svelte` | Yes |
| `nav-pin` (test ID) | `Sidebar.svelte`, `myday.spec.ts` | Yes |
| `nav-split` | `+layout.svelte` | Yes |
| `nav-drawer-open` | `+layout.svelte` | Yes (re-homed, not just deleted) |
| `nav-pinned` (localStorage key) | `+layout.svelte` | Yes |

No references found in any other files, stores, server code, or test files.

### Alternatives considered

- **Delete the `nav-drawer-open` hide rules without replacement** (as the PM
  proposed): Simpler, but leaves `.mobile-add` and `.suggestions-toggle` visible
  behind the drawer backdrop on mobile, which is a visual regression. Rejected in
  favor of re-homing the rules to `.sidebar-drawer.open ~ main`.
- **Keep the pin button but disable it**: Rejected. The user explicitly wants
  removal, and `docs/CONTRIBUTING.md` says "Delete freely."

### Risks and mitigations

- **Risk**: Removing the `navPinned` guard in `closeNav()` could cause the
  sidebar to close when the settings dialog is open.
  **Mitigation**: Verified that `settingsDialogOpen` is a separate early-return
  guard on line 49, independent of the pin guard on line 50. After removal,
  `closeNav` becomes `if (settingsDialogOpen) return; navOpen = false;` which is
  correct.

- **Risk**: `afterNavigate` unconditionally closing `navOpen` could cause
  issues on desktop.
  **Mitigation**: On desktop (viewport > 900px), the sidebar is permanently
  visible via CSS grid (`grid-template-columns: 240px 1fr`). The `navOpen`
  variable only controls the mobile drawer's CSS transform. Setting it to
  `false` on desktop has no visible effect.

- **Risk**: The sibling combinator `.sidebar-drawer.open ~ main` might not
  match if DOM structure changes.
  **Mitigation**: The DOM structure (`sidebar-drawer` followed by `main` as
  siblings inside `app-shell`) is stable and fundamental to the layout. Any
  future restructuring would need to revisit all layout CSS anyway.

- **Risk**: Stale `tasksync:nav-pinned` localStorage keys.
  **Mitigation**: Harmless -- the key is never read. No cleanup migration needed.

### Performance impact

No expected impact on performance budgets. This change removes DOM elements,
CSS rules, event handlers, and localStorage reads -- all net reductions. The
E2E smoke suite will confirm no timing regressions.

## Tasks

### T1: Remove all pin/unpin code from Sidebar.svelte and +layout.svelte

**Files:** `web/src/lib/components/Sidebar.svelte`, `web/src/routes/+layout.svelte`

Remove the `navPinned` prop, `togglePin` function, pin button element, and
`.pin`/`.pin.active` CSS from `Sidebar.svelte`. Remove `NAV_PIN_KEY`,
`navPinned` variable, `savePinned` function, and all pin-related branching from
`+layout.svelte` (`toggleNav`, `closeNav`, `afterNavigate`, `onMount`). Simplify
the `app-shell` class expression to remove `nav-split` and `nav-drawer-open`.
Remove `navPinned` prop and `on:togglePin` handler from the `<Sidebar>` component
usage. Simplify backdrop condition to `{#if navOpen}`. Remove `.app-shell.nav-split`
CSS rules. Re-home the `nav-drawer-open` hide rules for `.mobile-add` and
`.suggestions-toggle` to use `.sidebar-drawer.open ~ main` sibling combinator.

**Done when:** All pin-related identifiers (`navPinned`, `NAV_PIN_KEY`,
`savePinned`, `togglePin`, `nav-pin`, `nav-split`, `nav-drawer-open`) are absent
from both files. The `.pin` CSS rules are gone. The hide rules are re-homed.
`npm run check` and `npm run lint` pass.

### T2: Remove pin-specific E2E test from myday.spec.ts

**Files:** `web/tests/e2e/myday.spec.ts`

Delete the `'keeps mobile sidebar open when pinned'` test from `myday.spec.ts`.
No replacement test needed.

**Done when:** The test is absent. `npm run test:e2e:smoke` passes. No references
to `nav-pin` testid remain in any test file.

## Progress log

- 2026-05-10: Exec plan created by product-manager agent. Discovery complete.
- 2026-05-10: Design section added by principal-engineer.

## Decision log

- 2026-05-10: Decided to remove `nav-drawer-open` CSS class and its two associated `:global()` rules alongside pin removal, since the class was only ever set when `navOpen && !navPinned` — a condition that collapses to simply `navOpen` after pin removal. No external code depends on `nav-drawer-open` for behavior (only hides two mobile UI elements during drawer-open state, which is a cosmetic concern that can be revisited if needed). The `:global(.app-shell.nav-drawer-open ...)` rules are removed to avoid dead selectors.
