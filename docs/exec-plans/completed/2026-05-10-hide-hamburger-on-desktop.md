# Hide hamburger menu on desktop

## Goal

Remove the hamburger (nav-toggle) button from the header when the sidebar is permanently visible at the desktop breakpoint (viewport width > 900px), reclaiming its layout space so the TaskSync logo sits flush-left.

## Problem statement

On desktop viewports the sidebar is always rendered in the grid layout — the hamburger button next to the TaskSync logo has no useful function because the sidebar is already open and cannot be collapsed. Clicking it merely steals focus from the task page. The button should be hidden (and its space reclaimed) whenever the sidebar is always-on, and remain fully functional on narrow/mobile viewports where the sidebar is a slide-in drawer.

## Locked decisions (agreed with user — not up for discussion)

1. **Hide trigger:** tied to sidebar visibility. The sidebar is always-on at the desktop breakpoint (> 900px), so hiding the button is equivalent to hiding it on desktop. Use whichever signal already exists in the codebase — do not invent a new one.
2. **Layout strategy:** reclaim the space. Use `{#if}` (conditional render) or `display:none`. Do NOT use `visibility:hidden` (which leaves the layout slot occupied).
3. **Mobile / narrow viewport (≤ 900px):** hamburger remains, behavior unchanged.

## Scope

**In:**
- Hiding the `.nav-toggle` button on desktop viewports (> 900px) so it is absent from the rendered layout.

**Out:**
- Refactoring the header structure.
- Refactoring the sidebar toggle mechanism (`navOpen`, `toggleNav`, `closeNav`).
- Changing what the hamburger does on mobile.
- Touching any component other than `web/src/routes/+layout.svelte`.

## Constraints

- No new stores, no new media-query watchers — use the existing CSS breakpoint at 900px.
- No regressions to mobile sidebar open/close behavior.
- Must pass all existing quality gates (lint, check, vitest, Playwright smoke).

## Affected files

| File | Change |
|------|--------|
| `web/src/routes/+layout.svelte` | The only file that needs to change. The hamburger is the `<button class="nav-toggle">` at line 411. The desktop/mobile breakpoint is the existing `@media (max-width: 900px)` block. |

### Exact button location

`web/src/routes/+layout.svelte`, lines 411–413:
```html
<button class="nav-toggle" aria-label="Toggle navigation" on:click={toggleNav}>
    ☰
</button>
```

### Sidebar visibility signal

There is no JavaScript store for sidebar visibility. The sidebar is always-on at desktop via the CSS grid layout (`.app-shell { grid-template-columns: 240px 1fr }`) and becomes a slide-in drawer only inside `@media (max-width: 900px)`. The correct signal is **this same 900px CSS breakpoint** — it is already the canonical source of truth for sidebar permanence in this codebase.

Idiomatic implementation options (both are acceptable; choice deferred to the principal engineer):
- **CSS-only:** add `display: none` to `.nav-toggle` in the default (desktop) styles, and restore it to `display: inline-flex` inside the `@media (max-width: 900px)` block (it already has `display: inline-flex` there — move/clarify as needed).
- **Svelte conditional + `matchMedia`:** wrap the button in `{#if isMobile}` where `isMobile` is derived from a `window.matchMedia('(max-width: 900px)')` listener scoped to `+layout.svelte`. This makes the element absent from the DOM rather than just hidden.

Either approach satisfies locked decision 2. The CSS-only path is the smallest diff.

## Acceptance criteria

- [ ] At viewport width > 900px, the `.nav-toggle` button is not visible and does not occupy layout space (either absent from DOM or `display: none`). The TaskSync logo and brand name shift left to fill the reclaimed space.
- [ ] At viewport width ≤ 900px, the `.nav-toggle` button is present, visible, and clicking it opens/closes the sidebar drawer (existing behavior unchanged).
- [ ] The change is confined to `web/src/routes/+layout.svelte`. No other component is modified.
- [ ] All existing quality gates pass: `npm run lint`, `npm run check`, `npm run test`, Playwright `@smoke` on Chromium.

## Test plan

### Unit / component

No store or logic changes are expected, so a Svelte component unit test is not strictly required for a pure CSS fix. If the Svelte `{#if}` path is chosen, add a focused test in `web/src/lib/` (or alongside the layout) asserting that the button is absent from the rendered DOM when a desktop viewport width is simulated.

### E2E

Add a test in `web/tests/e2e/` (new file `hamburger-desktop.spec.ts` or added to `smoke.spec.ts`) tagged `@smoke` with two cases:
1. **Desktop viewport (e.g. 1280 × 800):** navigate to `/`, assert that `button[aria-label="Toggle navigation"]` is not visible (Playwright `toBeHidden()` or `not.toBeVisible()`).
2. **Mobile viewport (e.g. 390 × 844):** navigate to `/`, assert that `button[aria-label="Toggle navigation"]` is visible and that clicking it causes the sidebar drawer to become visible.

Existing mobile E2E in `sidebar-zones.spec.ts` and `smoke.spec.ts` provide supplementary coverage and must continue to pass.

## Design

### Chosen approach: Option A — CSS-only

Add `display: none` to the default (desktop) `.nav-toggle` rule in `+layout.svelte`. The existing
`@media (max-width: 900px)` block already declares `.nav-toggle { display: inline-flex; ... }` at
line 867, which restores the button on mobile. No second edit is needed inside the media query.

This is the smallest, safest path. It matches the existing pattern in this codebase — the sidebar's
own desktop/mobile permanence is CSS-driven via the same 900px breakpoint, with no JavaScript
involved in deciding where the sidebar lives. There is no SSR/hydration mismatch (the server-rendered
HTML matches what the browser shows at all widths), no `matchMedia` listener to attach or tear down,
and no risk of FOUC where the button briefly appears before JS evaluates a media query. The button
stays in the DOM but takes zero layout space at desktop width, which lets the flexbox in
`.brand` close up and the logo sit flush-left automatically.

### Exact change

Single-file edit to `web/src/routes/+layout.svelte`.

**Before** (current `.nav-toggle` base rule, around line 726):

```css
.nav-toggle {
    background: var(--surface-1);
    border: 1px solid var(--border-1);
    color: var(--app-text);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    box-shadow: var(--ring-shadow);
}
```

**After**:

```css
.nav-toggle {
    display: none;
    background: var(--surface-1);
    border: 1px solid var(--border-1);
    color: var(--app-text);
    border-radius: 10px;
    padding: 6px 10px;
    cursor: pointer;
    box-shadow: var(--ring-shadow);
}
```

The existing mobile override at line 867 is untouched and continues to do its job:

```css
@media (max-width: 900px) {
    /* ...existing rules... */
    .nav-toggle { display: inline-flex; align-items: center; justify-content: center; }
    /* ...existing rules... */
}
```

No change to the markup at lines 411–413 — the button stays in the DOM at all widths; CSS controls visibility and layout participation.

### Expected diff size

+1 line in `web/src/routes/+layout.svelte`. 0 lines removed. No other files touched (test file is additive, covered below).

### Risks

None of consequence. This is pure presentation with no logic, state, or accessibility regression:

- **A11y:** at desktop the button is `display: none`, which removes it from the accessibility
  tree as well as the layout. That is the desired outcome — at desktop the sidebar is already
  open and the button has no useful action, so removing it from screen-reader traversal is
  correct, not a regression.
- **Print/UA stylesheets:** the base rule wins on the cascade in both screen and print contexts;
  there is no print-specific override of `.nav-toggle`.
- **Cascade specificity:** the media-query override has identical specificity but appears later
  in the stylesheet, so `display: inline-flex` correctly wins inside `(max-width: 900px)`.

### Test approach

The PM test plan is sufficient. Use Option A's lighter path:

- **No unit test required** — pure CSS change, no Svelte logic added or modified.
- **One E2E smoke check** in a new file `web/tests/e2e/hamburger-desktop.spec.ts`, tagged
  `@smoke`, with two cases:
  1. Desktop viewport 1280 × 800 — navigate to `/`, assert
     `button[aria-label="Toggle navigation"]` resolves to `not.toBeVisible()` (CSS `display: none`
     makes Playwright treat it as not visible).
  2. Mobile viewport 390 × 844 — navigate to `/`, assert the same button is visible, click it,
     and assert `[data-testid="sidebar-drawer"]` has class `open` (or is visible) so existing
     drawer behavior is verified end-to-end.

Existing mobile E2E in `sidebar-zones.spec.ts` and `smoke.spec.ts` provide supplementary coverage
and must continue to pass.

### Architecture impact

None. No new components, no new stores, no new media-query watchers, no new props or events.
`docs/ARCHITECTURE.md`, `docs/FRONTEND.md`, and `docs/RELIABILITY.md` do not require updates.
This is a CSS polish change confined to one file.

## Task breakdown

See the `## Tasks` section below.

## Tasks

This is a trivial diff (+1 CSS line plus one new E2E spec). The CSS change and
its E2E verification are bundled into a single task because splitting them
would just add ceremony without adding signal — the test exists specifically
to prove the CSS rule works at both viewport widths, so they ship together.

### T1 — Hide `.nav-toggle` on desktop via CSS, add E2E smoke coverage

**Status:** pending

**Files:**
- `web/src/routes/+layout.svelte`
- `web/tests/e2e/hamburger-desktop.spec.ts` (new)

**What to do:**

1. In `web/src/routes/+layout.svelte`, locate the base `.nav-toggle` CSS rule
   (around line 726). Add `display: none;` as the first declaration in the
   block. Do not touch the markup at lines 411–413 and do not touch the
   `@media (max-width: 900px)` block — the existing mobile override at ~line
   867 already declares `.nav-toggle { display: inline-flex; ... }`, which
   restores the button at narrow widths via normal cascade ordering.

2. Create a new Playwright spec at `web/tests/e2e/hamburger-desktop.spec.ts`,
   tagged `@smoke`, with two cases:
   - **Desktop 1280 × 800:** navigate to `/`, assert
     `page.locator('button[aria-label="Toggle navigation"]')` is
     `not.toBeVisible()` (CSS `display: none` satisfies Playwright's
     visibility check).
   - **Mobile 390 × 844:** navigate to `/`, assert the same button is
     visible, click it, and assert the sidebar drawer opens (use the
     selector already used by `sidebar-zones.spec.ts` / `smoke.spec.ts` so
     the assertion stays consistent with the existing mobile coverage).

3. Run the local quality gates and fix anything they catch:
   ```
   cd web && npm run lint
   cd web && npm run check
   cd web && npm run test
   cd web && npm run test:e2e:smoke
   ```

**Done when:**
- The base `.nav-toggle` rule in `+layout.svelte` contains `display: none;`
  as its first declaration. The button markup at lines 411–413 is unchanged.
  The `@media (max-width: 900px)` block is unchanged.
- `web/tests/e2e/hamburger-desktop.spec.ts` exists, is tagged `@smoke`, and
  contains both the desktop-hidden and mobile-visible-and-functional cases.
- `npm run lint`, `npm run check`, `npm run test`, and `npm run test:e2e:smoke`
  all pass locally with no new warnings.
- The net diff is +1 line in `+layout.svelte` plus the new test file. No
  other files are touched.

## Progress log

- 2026-05-10: Discovery complete. Exec plan written. Hamburger located in `+layout.svelte` line 411; breakpoint is 900px CSS media query; no new store needed.

## Decision log

- 2026-05-10: Locked decisions inherited from user agreement — hide trigger = 900px breakpoint, reclaim space via CSS `display:none` or `{#if}`, mobile behavior unchanged.
