# Sidebar Fixed Zones on Mobile

**Date:** 2026-05-09
**Status:** Complete (2026-05-09)

## Goal

Restructure the mobile sidebar layout so that the header/Today area is frozen at the top, the user list area is the sole scrollable region, and the Workspace/Settings area is always visible at the bottom — without changing the desktop layout or any non-CSS behavior.

## Scope

- Add three structural wrapper elements inside `.sidebar-main` in `Sidebar.svelte` to create top, middle, and bottom zones.
- Apply `@media (max-width: 900px)` CSS to `.sidebar`, `.sidebar-main`, and the three zone wrappers that: pins the sidebar to `100vh`, sets the sidebar itself to `display: flex; flex-direction: column`, freezes the top zone, makes the middle zone the only `overflow-y: auto` region, and freezes the bottom zone.
- Changes are confined to `Sidebar.svelte` (template structure + scoped CSS block).

**Zone 1 — Frozen top (~25–30% of sidebar height):**
- `.title-row` (app title + pin button)
- `.section-label` "Today"
- `.list-sort` sort controls
- The My Day `<a>` element (the `{#if list.id === 'my-day'}` branch of the `{#each sidebarLists}` loop)

**Zone 2 — Scrollable middle (~50–60% of sidebar height):**
- All non-My Day `<a>` elements from the `{:else}` branch of the `{#each sidebarLists}` loop
- Must retain all drag-and-drop event handlers (`draggable`, `on:dragstart`, `on:dragover`, `on:dragleave`, `on:drop`, `on:dragend`)

**Zone 3 — Frozen bottom (~15–20% of sidebar height):**
- `.section-label.muted` "Workspace"
- `.sidebar-nav-action.settings-entry` Settings button

## Out of scope

- Any changes to `+layout.svelte` or the `.sidebar-drawer` mechanism
- Desktop sidebar layout (viewports > 900px must render identically to today)
- New Svelte components, stores, utility files, or routes
- Any functional changes to list CRUD, drag-and-drop logic, settings dialog, auth, or sync
- Animation or transition changes to the sidebar drawer open/close
- iOS/Android native wrapper changes

## Constraints

- **Mobile-only**: all three-zone layout rules must live inside `@media (max-width: 900px)`. Desktop (> 900px) CSS is untouched.
- **CSS/layout only**: no JavaScript changes, no new reactive statements, no store writes.
- **Drag-and-drop must continue to work**: the scrollable middle zone must not interfere with the existing `dragstart`/`dragover`/`dragleave`/`drop`/`dragend` handlers on list `<a>` elements.
- **No layout jank**: the three zones must render stably on first paint on iOS Safari and Chrome Android; no layout shift after hydration.
- **Performance budgets**: interaction paint must remain under 16 ms per `docs/RELIABILITY.md`. This change adds no JS execution; the constraint is met by construction, but must not be contradicted by any added CSS complexity (avoid expensive properties like `filter` or `backdrop-filter` on the zone wrappers).
- **Offline-first**: layout is pure CSS; no impact on offline behavior.
- **No `@ts-nocheck`**, no suppressed type errors, no fire-and-forget IDB writes introduced.
- **Tests required**: at minimum one new E2E test verifying the bottom zone (Settings) is visible without scrolling on a mobile viewport. Existing `sidebar-drag.spec.ts` must pass unchanged (drag-and-drop regression). All existing `@smoke` tests must pass.

## Acceptance criteria

- [ ] **AC-1 Settings always visible**: On a mobile viewport (<= 900px), the Workspace label and Settings button are visible at the bottom of the sidebar without any scrolling, regardless of how many list items exist in the middle zone.
- [ ] **AC-2 Lists scroll independently**: When the number of user lists exceeds the available height of the middle zone, only the middle zone scrolls. The top zone (header, Today label, sort controls, My Day link) and bottom zone (Workspace + Settings) do not move.
- [ ] **AC-3 Desktop unchanged**: On viewports > 900px the sidebar renders identically to the current behavior — single scrollable column, no zone wrappers visible as structural changes.
- [ ] **AC-4 Drag-and-drop works**: On mobile, list reordering via drag-and-drop in the scrollable middle zone still functions correctly. The existing `sidebar-drag.spec.ts` `@smoke` test passes.
- [ ] **AC-5 Drawer mechanism intact**: The sidebar drawer open/close/pin behavior (slide in, `translateX`, backdrop, pin-to-split) is visually and functionally unchanged. No layout or transition regressions observable in `+layout.svelte` behavior.
- [ ] **AC-6 Settings dialog works**: Clicking the Settings button still opens the settings overlay correctly and the overlay covers the full viewport.
- [ ] **AC-7 My Day in top zone**: The My Day link renders inside the frozen top zone, above the scrollable middle zone. It does not scroll out of view.
- [ ] **AC-8 All existing E2E tests pass**: `npm run test:e2e:smoke` passes with no new failures. The full Playwright suite (chromium, firefox, webkit) passes in CI.
- [ ] **AC-9 No layout jank on mobile**: The three-zone layout renders without visual glitch or layout shift on iOS Safari and Chrome Android. Verified by a new E2E test at a 390×844 viewport (iPhone-class) that asserts the Settings button bounding box is within the visible viewport without scrolling.
- [ ] **AC-10 No TypeScript or lint errors**: `npm run check` and `npm run lint` both pass clean after the change.

## Design

### Approach

The fix is a CSS-driven layout restructuring confined to `Sidebar.svelte`. The
current `.sidebar-main` div contains all sidebar elements as a flat list of
siblings. We add three wrapper divs inside `.sidebar-main` to group elements
into frozen-top, scrollable-middle, and frozen-bottom zones. On mobile
(`@media (max-width: 900px)`), flexbox rules pin the top and bottom zones in
place and confine vertical scrolling to the middle zone. On desktop (>900px),
the wrappers are transparent -- they use `display: contents` so the existing
flat-flex layout and single-scrollbar behavior are completely preserved.

The My Day link must be extracted from the shared `{#each sidebarLists}` loop
because it belongs to the top zone while all other lists belong to the scrollable
middle zone. Since `sidebarLists` is a reactive derived array that always sorts
my-day to index 0 (via the `if (a.id === 'my-day') return -1` comparator on
line 734), we can split the single `{#each}` into two separate rendering passes
without altering any JavaScript. The template will use Svelte `{#each}` with an
`{#if}`/`{:else}` filter: the top zone renders only the `my-day` item; the
middle zone renders all non-my-day items. The reactive statement, the sort
comparator, and all drag-and-drop handlers remain untouched.

No changes to `+layout.svelte`, stores, or any JavaScript are required.

### Component changes

- **`Sidebar.svelte` (template, lines 748-823)**: Restructure the flat contents
  of `.sidebar-main` into three wrapper divs:

  **Zone 1 wrapper** (`.sidebar-zone-top`): Wraps everything from `.title-row`
  through the My Day link. Specifically contains:
  - `.title-row` (app title + pin button)
  - `.section-label` "Today"
  - `.list-sort` sort controls
  - The My Day `<a>` -- rendered via its own `{#each}`/`{#if}` pass that filters
    for `list.id === 'my-day'`

  **Zone 2 wrapper** (`.sidebar-zone-lists`): Wraps only the non-My Day list
  links. Contains:
  - A `{#each sidebarLists as list}` block with `{#if list.id !== 'my-day'}`
    that renders each list `<a>` element with all existing drag-and-drop
    attributes (`draggable`, `on:dragstart`, `on:dragover`, `on:dragleave`,
    `on:drop`, `on:dragend`) exactly as they are today

  **Zone 3 wrapper** (`.sidebar-zone-bottom`): Wraps the bottom section.
  Contains:
  - `.section-label.muted` "Workspace"
  - `.sidebar-nav-action.settings-entry` Settings button

  The template transformation looks like this (pseudocode showing structure
  only; the actual `<a>` elements and their attributes are unchanged):

  ```svelte
  <div class="sidebar-main">
    <div class="sidebar-zone-top">
      <div class="title-row">...</div>
      <div class="section-label">Today</div>
      <label class="list-sort">...</label>
      {#if sidebarLists}
        {#each sidebarLists as list}
          {#if list.id === 'my-day'}
            <a ...>My Day link</a>
          {/if}
        {/each}
      {/if}
    </div>

    <div class="sidebar-zone-lists">
      {#if sidebarLists}
        {#each sidebarLists as list}
          {#if list.id !== 'my-day'}
            <a ... draggable on:dragstart ...>list link</a>
          {/if}
        {/each}
      {/if}
    </div>

    <div class="sidebar-zone-bottom">
      <div class="section-label muted">Workspace</div>
      <button class="sidebar-nav-action settings-entry ...">Settings</button>
    </div>
  </div>
  ```

- **`Sidebar.svelte` (CSS)**: Two sets of changes:

  **Desktop rules (outside any media query, ~line 1414)**: Add rules for the
  three zone wrapper classes that make them invisible to layout:

  ```css
  .sidebar-zone-top,
  .sidebar-zone-lists,
  .sidebar-zone-bottom {
    display: contents;
  }
  ```

  `display: contents` causes the wrapper divs to be ignored by the flex layout
  engine. Their children participate directly in `.sidebar-main`'s flex context,
  preserving the current desktop behavior exactly (flat column, single scroll,
  6px gap between all items).

  **Mobile rules (inside existing `@media (max-width: 900px)` block, ~line
  2108)**: Override the wrappers to create the three-zone flexbox layout:

  ```css
  .sidebar {
    max-width: none;
    padding: 12px 10px;
    height: 100%;
    overflow: hidden;
  }

  .sidebar-main {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 0;
  }

  .sidebar-zone-top {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .sidebar-zone-lists {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    -webkit-overflow-scrolling: touch;
  }

  .sidebar-zone-bottom {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  ```

  Key details:
  - `.sidebar` gets `height: 100%` (fills the `.sidebar-drawer` fixed container)
    and `overflow: hidden` (prevents the entire sidebar from scrolling -- only
    zone 2 scrolls).
  - `.sidebar-main` gets `height: 100%` and `gap: 0` (the zone wrappers own
    their own internal gaps now).
  - `.sidebar-zone-top` and `.sidebar-zone-bottom` get `flex-shrink: 0` so they
    never collapse.
  - `.sidebar-zone-lists` gets `flex: 1; min-height: 0; overflow-y: auto` to
    absorb remaining space and become the sole scroll container. `min-height: 0`
    is critical -- without it, flex items default to `min-height: auto` which
    prevents shrinking below content size.
  - `overscroll-behavior-y: contain` on the middle zone prevents scroll chaining
    from propagating to the parent or triggering browser gestures when the user
    reaches the top/bottom of the list.
  - `-webkit-overflow-scrolling: touch` enables momentum scrolling on older iOS
    Safari versions.

  The existing mobile `.sidebar` rule at line 2109 already sets
  `max-width: none` and `padding: 12px 10px`. These stay; `height: 100%` and
  `overflow: hidden` are added to the same rule block.

### Data model changes

None.

### API changes

None.

### Alternatives considered

1. **`position: sticky` for top and bottom zones**: The top zone would use
   `position: sticky; top: 0` and the bottom zone `position: sticky; bottom: 0`
   within the scrollable sidebar. Rejected because `position: sticky` is fragile
   in nested scroll contexts, especially on iOS Safari where overflow containment
   and sticky positioning interact unpredictably. The flexbox approach is more
   reliable and explicit.

2. **`position: fixed` for top and bottom zones**: The zones would be positioned
   relative to the viewport. Rejected because the sidebar lives inside the
   `.sidebar-drawer` container which uses `position: fixed` on mobile. Fixed
   children inside a fixed parent would break containment and require manual
   positioning math that varies with drawer width. The flexbox approach keeps
   everything contained within the normal flow of `.sidebar-main`.

3. **CSS Grid with `grid-template-rows: auto 1fr auto`**: The three-zone split
   maps naturally to a three-row grid. This would work correctly but is more
   complex than necessary for a simple top/stretch/bottom pattern where flexbox
   with `flex-shrink: 0` / `flex: 1` is idiomatic and well-understood. Grid
   also requires `height: 100%` propagation, which is the same requirement as
   the flexbox approach, so there is no advantage.

4. **Rendering My Day outside the `{#each}` entirely**: Instead of filtering
   `sidebarLists` twice with `{#if}`, we could hardcode the My Day link
   outside the loop and only iterate non-my-day lists. Rejected because the
   My Day item shares its data shape and reactive binding with the rest of
   `sidebarLists`. Extracting it would require either duplicating the My Day
   data derivation or adding a new computed variable. The filter approach is
   zero-JS-change and keeps My Day as part of the same reactive array.

### Risks and mitigations

- **Risk**: iOS Safari rubber-band bounce inside the middle zone. When the user
  scrolls to the top or bottom of `.sidebar-zone-lists`, iOS Safari may show an
  elastic overscroll effect within that zone. This is cosmetic, not functional,
  but may feel unpolished.
  **Mitigation**: `overscroll-behavior-y: contain` suppresses scroll chaining
  and elastic effects on iOS 16+. For older versions,
  `-webkit-overflow-scrolling: touch` ensures smooth inertial scrolling. The
  rubber-band within the zone (not the page) is acceptable and consistent with
  native iOS list behavior.

- **Risk**: Drag-and-drop breaks inside the new wrapper div. Adding a
  `.sidebar-zone-lists` wrapper around the list `<a>` elements could
  theoretically interfere with HTML5 drag events.
  **Mitigation**: Drag event handlers (`dragstart`, `dragover`, `drop`, etc.)
  are attached to the individual `<a>` elements, not to any container. The
  wrapper div has no drag-related attributes and no pointer-event overrides. The
  existing `sidebar-drag.spec.ts` E2E test validates this. No change to the test
  is needed.

- **Risk**: `display: contents` browser support. If a browser does not support
  `display: contents`, the zone wrappers would render as block-level divs on
  desktop, breaking the flat flex layout.
  **Mitigation**: `display: contents` is supported in all browsers the project
  targets (Chrome 65+, Firefox 59+, Safari 11.1+). The project's CI runs
  Playwright against Chromium, Firefox, and WebKit, which all support it. No
  fallback is needed.

- **Risk**: Existing mobile CSS rules that target `a` or `.sidebar` are
  disrupted by the new structure. For example, `a { padding: 7px 8px }` inside
  the mobile media query.
  **Mitigation**: These rules target elements by class or tag, not by structural
  position. The `<a>` elements are still descendants of `.sidebar-main`; they
  are simply one level deeper (inside a zone wrapper). Svelte's scoped CSS
  applies based on the component's generated scope attribute, which is present on
  all elements rendered by the component, including children of the new wrappers.
  No rule specificity or scope changes.

- **Risk**: Layout jank on hydration. The zone wrappers exist in
  server-rendered HTML with Svelte's scoped styles applied inline. No JavaScript
  is needed to establish the three-zone layout.
  **Mitigation**: The layout is pure CSS. The zone wrappers are present in the
  SSR output. The `display: contents` (desktop) and flexbox (mobile) rules take
  effect on first paint. No flash of unstyled content.

### Performance impact

No expected impact on performance budgets. The change adds three lightweight
wrapper divs and pure CSS flexbox rules. No JavaScript execution is added. No
expensive CSS properties (`filter`, `backdrop-filter`, `will-change`, `clip-path`)
are used on zone wrappers. The flexbox layout calculation for three children is
trivial. Interaction paint stays well within the 16ms budget.

## Task breakdown

### T1: Restructure Sidebar.svelte into three zones with mobile CSS

**Files:** `web/src/lib/components/Sidebar.svelte`, `web/tests/e2e/sidebar-zones.spec.ts`

**What to do:**
1. Add three wrapper divs (`.sidebar-zone-top`, `.sidebar-zone-lists`, `.sidebar-zone-bottom`) inside `.sidebar-main` in `Sidebar.svelte`
2. Split the `{#each sidebarLists}` loop: top zone renders only `list.id === 'my-day'`; middle zone renders all `list.id !== 'my-day'` with full drag-and-drop handlers
3. Move Workspace label and Settings button into `.sidebar-zone-bottom`
4. Add desktop CSS: `display: contents` on all three zone wrappers (preserves flat flex layout)
5. Add mobile CSS inside existing `@media (max-width: 900px)`: flexbox three-zone layout with `overflow-y: auto` + `overscroll-behavior-y: contain` on middle zone, `flex-shrink: 0` on top/bottom
6. Write one E2E test (`sidebar-zones.spec.ts`) verifying Settings button is within visible viewport on a 390x844 mobile viewport without scrolling

**Done when:** Template has three zone wrappers. Desktop identical. Mobile has frozen top/bottom, scrollable middle. New E2E passes. All existing tests pass (lint, check, test, test:e2e:smoke).

## Progress log

- 2026-05-09: Design complete. Approach: three wrapper divs inside `.sidebar-main` with `display: contents` on desktop and flexbox three-zone layout on mobile. My Day extracted from shared loop via `{#if}` filter (zero JS changes). Risks assessed: iOS overscroll (mitigated with `overscroll-behavior-y: contain`), drag-and-drop (handlers on `<a>` elements, unaffected by wrapper), `display: contents` support (all target browsers). No changes to `+layout.svelte`, stores, or JS.
- 2026-05-09: Feature complete. T1 built and verified: Sidebar.svelte restructured into three zones, new E2E test passes, all quality gates pass (366 unit tests, 18 E2E smoke tests, lint, check clean).

## Decision log

*(Append-only, dated entries)*
- 2026-05-09: Scoped to CSS/layout restructuring only inside `Sidebar.svelte`. `+layout.svelte` is explicitly out of scope. Three-zone approach chosen (top frozen, middle scrollable, bottom frozen) to solve the "Settings hidden behind list scroll" problem without introducing new components or stores.
