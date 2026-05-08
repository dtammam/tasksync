# Gate page content rendering behind IDB hydration

## Goal

Prevent the brief flash of empty/bliss UI on cold launch by deferring `<slot />` rendering in `+layout.svelte` until `appReady` is true (i.e., after `hydrateScopedStores()` completes).

## Scope

- Wrap `<slot />` inside `<PullToRefresh>` in `web/src/routes/+layout.svelte` with `{#if appReady}...{/if}` so that routed page content does not render until IDB hydration is complete.
- Verifying the app shell (header, sidebar, PullToRefresh wrapper) remains visible throughout hydration.
- Verifying the `data-ready` E2E gate attribute continues to work correctly.
- Verifying the `$hydrated` transition-suppression store continues to work alongside this change (items appear instantly on hydration mount, animate normally on subsequent user actions).
- Verifying all existing E2E tests pass without modification.

## Out of scope

- Adding loading spinners, skeleton screens, or any placeholder UI during hydration.
- Changing the `$hydrated` store (`web/src/lib/stores/hydration.ts`) or the transition-suppression logic it drives.
- Changing the `data-ready` attribute location, name, or behavior.
- Server-side changes.
- Changes to stores, sync logic, or data model.
- Changes to any route file other than `+layout.svelte`.

## Constraints

- The `data-ready={appReady ? 'true' : 'false'}` attribute on the `app-shell` div (line 408) must continue to be the E2E gate — E2E tests across `myday.spec.ts`, `offline.spec.ts`, `smoke.spec.ts`, `auth.spec.ts`, `perf.spec.ts`, and `sidebar-drag.spec.ts` all await `data-ready="true"` before proceeding. This attribute must not be moved or removed.
- The fix must not cause a visible layout shift when page content mounts after hydration. The app shell chrome (header, sidebar) must remain stable.
- Offline-first invariant: the app shell must still render from local cache on a cold offline launch. Gating only the `<slot />` satisfies this — the shell is outside the `{#if}` block.
- Performance budget: the change removes rendering work performed before hydration; it must not add latency. No new async paths, timers, or store subscriptions are introduced.
- This is a narrow, surgical change. The diff is expected to touch only the `<slot />` region of `+layout.svelte`.
- No `@ts-nocheck`, no fire-and-forget IDB writes, no new stores (CONTRIBUTING.md coding standards apply even to single-line changes).

## Acceptance criteria

- [ ] On cold launch with existing local tasks, no flash of empty-state or bliss UI is visible before real task data appears. (The My Day "bliss" message and "Completed 0" counts must not appear transiently before tasks load.)
- [ ] The app shell (header bar, sidebar, pull-to-refresh wrapper) is visible and interactive during IDB hydration — it does not disappear or shift while waiting for the slot content.
- [ ] The `data-ready` attribute on the `app-shell` div transitions from `"false"` to `"true"` at the same point as before — after `hydrateScopedStores()` and `markHydrated()` complete — and E2E tests can still use it as a hydration gate without modification.
- [ ] All existing Playwright E2E tests pass without any modification to test files.
- [ ] After hydration, task rows appear instantly (no fly/fade transition on initial load), confirming the `$hydrated` transition-suppression mechanism is unaffected.
- [ ] After hydration, user-initiated actions (task add, complete, delete) still play their normal entry/exit transitions, confirming the `$hydrated` suppression correctly applies only to the initial render.
- [ ] On a cold offline launch, the app shell renders from cache and local task data is visible once hydration completes, with no regression to offline-first behavior.
- [ ] `npm run lint`, `npm run check`, and `npm run test` all pass.

## Design

### Approach

In `web/src/routes/+layout.svelte`, line 483, the `<slot />` inside `<PullToRefresh>` renders immediately on mount — before `appReady` is set to `true` (line 280, after `hydrateScopedStores()`). During this hydration gap, child pages render against empty stores and display incorrect empty/bliss states.

The fix is a single conditional gate:

```svelte
<PullToRefresh on:refresh={handlePullRefresh}>
    {#if appReady}<slot />{/if}
</PullToRefresh>
```

### Components changed

- `web/src/routes/+layout.svelte` — wrap `<slot />` in `{#if appReady}` block. No other files.

### How it interacts with existing mechanisms

1. **App shell visibility**: Everything outside `<slot />` (header, sidebar, PullToRefresh wrapper) renders immediately. The shell is visible and stable during the hydration window.
2. **`appReady` flag**: Already exists as a local `let appReady = false` set to `true` at line 280 after `hydrateScopedStores()` resolves. The `{#if}` block reacts to this existing flag — no new state introduced.
3. **`$hydrated` transition suppression**: `markHydrated()` is called one line after `appReady = true` (line 281). When Svelte mounts the slot content in response to `appReady`, the `$hydrated` store is still `false`, so all transition durations evaluate to `0` — items appear instantly with no animation. Then `markHydrated()` fires, enabling normal transitions for subsequent user actions. This sequence is preserved exactly.
4. **`data-ready` attribute**: Set on the `app-shell` div (line 408) as `data-ready={appReady ? 'true' : 'false'}`. Unaffected by this change — it already tracks the same `appReady` flag.
5. **E2E tests**: All E2E tests wait for `[data-ready="true"]` before asserting on content. Since `appReady` gates both the attribute and the slot, tests see content only after the gate opens. No test modifications needed.

### Risks

- **E2E tests not waiting for `data-ready`**: If any test assumes content is present before `data-ready="true"`, it would break. Mitigation: audited all E2E specs — they all use the `data-ready` gate.
- **Layout shift on slot mount**: The slot content appears all at once when `appReady` flips. Mitigation: the app shell chrome is stable, and slot content mounts with `duration: 0` transitions (via `$hydrated` suppression), so there is no visible animation or shift.

### Alternatives considered

- **Loading spinner / skeleton UI**: Rejected. Hydration is fast (sub-100ms typical). Adding a spinner would be more visual noise than the problem it solves.
- **CSS visibility toggle**: Could hide slot via CSS instead of `{#if}`. Rejected — Svelte `{#if}` prevents component initialization entirely, which is cleaner than hiding already-rendered empty-state content.

### Data model impact

None. No store, persistence, or sync changes.

## Task breakdown

### T1: Wrap slot in {#if appReady} gate

- **File**: `web/src/routes/+layout.svelte`
- **Change**: On line 483, replace `<slot />` with `{#if appReady}<slot />{/if}` inside the `<PullToRefresh>` block.
- **Quality gates**: Run `npm run lint`, `npm run check`, `npm run test`, and `npm run test:e2e:smoke` from `web/`. All must pass.
- **Done when**: The `{#if appReady}` gate is in place, and all four quality commands pass with zero failures.

## Progress log

- 2026-05-09 — Discovery complete. Exec plan written. Root cause: `<slot />` in `+layout.svelte` (line 483) renders immediately on mount, before `appReady` is set to `true` at line 280 (after `hydrateScopedStores()`). During the hydration gap, child pages render against empty stores and display incorrect empty/bliss states. Fix is to wrap `<slot />` in `{#if appReady}...{/if}`. The `$hydrated` store and `data-ready` attribute are complementary and unaffected.
- 2026-05-09 — Design and task breakdown complete (combined stage). Single task: wrap `<slot />` in `{#if appReady}` gate. Routing T1 to SDE.
- 2026-05-09 — Feature complete. Exec plan moved to completed/.

## Decision log

- 2026-05-09 — Confirmed no loading placeholder or skeleton UI is needed: hydration is fast and the app shell remains visible throughout the gate window. The user sees no blank screen — only the chrome shell is present briefly.
- 2026-05-09 — Confirmed `data-ready` attribute position (line 408, on app-shell div) is unaffected by this change. E2E tests do not need modification because they already wait for `data-ready="true"` before asserting on content, which is precisely when `appReady` becomes true and the slot renders.
