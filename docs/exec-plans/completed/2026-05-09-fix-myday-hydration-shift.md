# Fix My Day Hydration Layout Shift

## Goal

Eliminate the visible layout shift and spurious entry animations that occur on cold launch of the My Day page, caused by task rows materializing with fly/fade transitions after IndexedDB hydration completes.

## Scope

- Suppress entry transitions on task rows (`in:fly`) during initial IDB hydration on the My Day page
- Suppress the bliss state `bliss-arrive` scale-up animation if it appears before IDB hydration completes
- Suppress the `transition:fade` on `MissedTaskBanner` items during initial hydration
- Cover the completed-tasks section if it is rendered during the hydration window

## Out of scope

- Changes to when or how IDB hydration is initiated (async timing of `hydrateFromDb()` remains unchanged)
- Offline boot performance — this fix must not change the < 3s offline boot budget
- Transitions on the list route (`/list/[id]`) — only My Day is in scope
- Any server-side changes
- Changes to the sync pipeline or store architecture

## Constraints

- Must not regress offline boot time (< 3s per `docs/RELIABILITY.md`)
- Must not break existing fly/fade/scale transitions triggered by user actions: adding a task, completing a task, reordering, deleting
- Must remain fully offline-first — no server dependency for the initial render or hydration guard
- The `appReady` flag already exists in `+layout.svelte` and is set to `true` only after `hydrateScopedStores()` resolves; any solution must be consistent with this existing signal

## Acceptance criteria

- [x] On cold launch of My Day with tasks already in IDB, no fly, fade, or scale animation is visible as task rows appear for the first time
- [x] On cold launch with zero tasks in IDB, no bliss state animation is visible during or immediately after hydration
- [x] On cold launch where missed tasks exist in IDB, the `MissedTaskBanner` appears without a visible fade-in transition
- [x] After hydration is complete, adding a new task to My Day still plays the `in:fly` entry animation normally
- [x] After hydration is complete, completing a task still plays the `out:fade` exit animation normally
- [x] The bliss state still plays its `bliss-arrive` scale-up animation when the last pending task is completed by user action (not on load)
- [x] The `data-ready="true"` attribute on `.app-shell` (set in `+layout.svelte`) is present before any post-hydration user interaction; existing E2E tests that depend on it must still pass
- [x] Offline boot time as measured by the existing smoke suite does not regress
- [x] All existing Playwright `@smoke` tests pass without modification

## Design

### Approach

The root cause is that SvelteKit renders the My Day page immediately with empty
stores, then when `hydrateScopedStores()` resolves, reactive store updates
populate the `{#each}` blocks. Svelte treats every newly-rendered element as a
DOM insertion, firing `in:fly`, `out:fade`, `transition:fade`, and the CSS
`@keyframes bliss-arrive` animation on every task row simultaneously. The fix
uses a **suppress-transitions** strategy: render immediately but with zero-duration
transitions during hydration, so items appear instantly without animation. After
hydration completes, transitions are re-enabled and subsequent user actions
(add, complete, delete) animate normally.

The hydration-ready signal is propagated via a **new lightweight Svelte writable
store** (`web/src/lib/stores/hydration.ts`) rather than Svelte context. A store
is chosen over context because: (a) the codebase has no existing `setContext` /
`getContext` usage, so a store is consistent with established patterns; (b) a
store is reactive and subscribable from any depth without prop-drilling; (c)
context set in `+layout.svelte` would need to be read via `getContext` in
`+page.svelte` and then passed as a prop to `MissedTaskBanner`, adding coupling.
A dedicated store keeps the signal self-contained and testable.

Each Svelte transition directive is made conditional: when `$hydrated` is false,
the transition parameters use `duration: 0` (effectively instant/invisible).
When `$hydrated` is true, the original durations apply. The CSS `bliss-arrive`
animation is suppressed via a conditional class that sets `animation: none`.

### Component changes

- **`web/src/lib/stores/hydration.ts`** (new file): A minimal Svelte writable
  store exporting `hydrated` (a `Writable<boolean>`, default `false`) and a
  `markHydrated()` function that sets it to `true`. Approximately 10 lines.

- **`web/src/routes/+layout.svelte`**: After line 279 (`appReady = true`), add
  a call to `markHydrated()` imported from the new hydration store. This ensures
  the hydration signal is set at the same moment as `appReady` but is available
  as a subscribable store to any component.

- **`web/src/routes/+page.svelte`**: Import `hydrated` from the hydration store.
  Modify the five transition directives to be conditional on `$hydrated`:
  - Line 307: `in:fly={{ y: -6, duration: $hydrated ? 150 : 0 }}`
    and `out:fade={{ duration: $hydrated ? 150 : 0 }}`
  - Line 312: `in:fly={{ y: -4, duration: $hydrated ? 200 : 0 }}`
  - Line 329: `transition:fade={{ duration: $hydrated ? 150 : 0 }}`
  - Line 455 (CSS animation on `.bliss`): Add a conditional class
    `class:no-animate={!$hydrated}` on the bliss div. Add a CSS rule:
    `.bliss.no-animate { animation: none; }`.

- **`web/src/lib/components/MissedTaskBanner.svelte`**: Uses a `suppressTransitions`
  prop instead of importing the hydrated store directly, respecting the component
  contract (props in, events out, no store access).

### Data model changes

None.

### API changes

None.

### Mechanism details

**Why `duration: 0` instead of removing the directive entirely?** Svelte
transition directives cannot be conditionally attached/detached in the template
syntax without duplicating the entire `{#each}` block. Using `duration: 0`
keeps the directive in place (Svelte still runs the transition lifecycle) but
makes it visually instantaneous. This is the idiomatic Svelte approach for
conditional transitions.

**Why a separate store instead of reusing `appReady` directly?** The `appReady`
variable is a local `let` in `+layout.svelte`, not a store. It cannot be
subscribed to from child routes or components without prop-drilling or context.
Creating a dedicated `hydrated` store follows the project's existing pattern
(stores in `$lib/stores/`) and keeps the signal decoupled from the layout
component's internal state.

**Timing guarantee**: `markHydrated()` is called on the same line / same
microtask as `appReady = true` (line 279 of `+layout.svelte`). Since Svelte
batches reactive updates within the same microtask, the `$hydrated` store
update and the store-driven re-render of task lists happen in the same Svelte
update cycle. By the time Svelte processes the `{#each}` insertions from the
hydrated task store, `$hydrated` is already `false`, so transitions use
`duration: 0`. On the next tick, `$hydrated` flips to `true`, but no new
DOM insertions happen, so no transitions fire. Subsequent user actions
(adding/completing tasks) occur after `$hydrated` is `true`, so they get
full animations.

**Edge case: scope change re-hydration** (line 344-370 of `+layout.svelte`).
When the auth scope changes, `hydrateScopedStores()` runs again, which
repopulates stores. The `hydrated` store is already `true` at this point, so
transitions would fire. This is acceptable behavior: scope changes are rare
(switching users/spaces) and a brief animation on task appearance is not jarring
in that context. If suppression is desired for scope changes in the future, the
store could be temporarily set to `false` before re-hydration and `true` after,
but that is out of scope for this fix.

### Alternatives considered

**Alternative 1: Gate rendering with `{#if appReady}`**

Wrap the `<slot />` in `+layout.svelte` with `{#if appReady}` so the page does
not render until hydration completes. This prevents the empty-to-populated
transition entirely.

Pros: Simpler, no per-transition changes needed.
Cons: (a) Would cause a flash of empty content (FOEC) since the entire page
including header, input bar, and page chrome would be hidden until hydration.
(b) When the `{#if}` block becomes true, ALL elements enter the DOM at once,
and Svelte `in:` transitions STILL fire on each element. So this approach alone
does not solve the problem without also suppressing transitions. (c) Risks
regressing offline boot time perception since the user sees nothing until IDB
resolves.

Rejected because it does not actually prevent transitions from firing and adds
a visible empty state.

**Alternative 2: Svelte context instead of a store**

Use `setContext('hydrated', writable(false))` in `+layout.svelte` and
`getContext('hydrated')` in `+page.svelte` and `MissedTaskBanner.svelte`.

Pros: No new file; keeps the signal scoped to the component tree.
Cons: (a) The codebase has zero existing `setContext`/`getContext` usage, so
this introduces a new pattern. (b) `MissedTaskBanner` would need to call
`getContext` directly, coupling it to the layout's context key. (c) Context
values are not reactive by default; you would need to wrap a writable store
in context anyway, which is equivalent to just exporting a store.

Rejected because it adds pattern complexity for no functional benefit over a
simple store module.

### Risks and mitigations

- **Risk**: Svelte may batch the `hydrated` store update and the task store
  updates into the same cycle, causing `$hydrated` to be `true` by the time
  transitions evaluate. **Mitigation**: `markHydrated()` must be called AFTER
  `hydrateScopedStores()` resolves (which is already the case at line 279).
  The task stores are populated inside `hydrateScopedStores()`, so their
  reactive updates are queued first. `markHydrated()` is called afterward,
  meaning `$hydrated` is still `false` when Svelte processes the task
  insertions. A unit test should verify the ordering: populate stores, then
  check that transitions would see `hydrated = false`.

- **Risk**: Future developers add new transitions to the My Day page without
  conditioning on `$hydrated`, reintroducing the bug. **Mitigation**: Add a
  code comment at the top of `+page.svelte` explaining the hydration
  transition pattern. The E2E test (below) will catch regressions.

- **Risk**: The `hydrated` store is never reset to `false`, so hot-module
  replacement during development might not reproduce the bug after the first
  load. **Mitigation**: This is acceptable for a production fix. Developers
  testing the cold-launch behavior should do a hard refresh.

### Test strategy

1. **Unit test** (`web/src/lib/stores/hydration.test.ts`): Verify that the
   store defaults to `false`, that `markHydrated()` sets it to `true`, and
   that it remains `true` after repeated calls.

2. **E2E test** (extend existing smoke suite or add a focused test): On cold
   launch with seeded IDB data, assert that task rows are visible immediately
   after `data-ready="true"` without any CSS transform or opacity animation
   in progress. This can be done by checking that no task row wrapper has an
   inline `style` attribute containing `transform` or `opacity` (which Svelte
   adds during active transitions). Alternatively, use a
   `page.waitForSelector('[data-ready="true"]')` followed by a visual
   stability assertion (no layout shift for 500ms).

3. **Manual verification**: After hydration, add a task and confirm the fly
   animation plays. Complete a task and confirm the fade animation plays.
   Complete all tasks and confirm the bliss scale-up animation plays.

4. **Regression**: Run the full existing `@smoke` suite to confirm no
   breakage. The `data-ready="true"` attribute is unchanged, so E2E tests
   that wait on it will continue to work.

### Performance impact

No expected impact on performance budgets. The change adds one lightweight
Svelte store subscription (boolean) to three components. The `duration: 0`
transitions are effectively no-ops and do not add to render cost. No new
network requests, no IDB changes, no sync pipeline changes.

## Task breakdown

### T1: Create hydration store and wire it into layout
- **New file**: `web/src/lib/stores/hydration.ts` — writable boolean store (default `false`), `markHydrated()` sets to `true`
- **Modify**: `web/src/routes/+layout.svelte` — call `markHydrated()` immediately after `appReady = true`
- **New file**: `web/src/lib/stores/hydration.test.ts` — unit tests: defaults to false, markHydrated sets true, idempotent
- **Done when**: Store exports work, layout calls markHydrated at the right moment, unit tests pass

### T2: Suppress transitions on My Day page and MissedTaskBanner during hydration
- **Modify**: `web/src/routes/+page.svelte` — all `in:fly`, `out:fade`, `transition:fade` use `duration: $hydrated ? <original> : 0`; `.bliss` div gets `class:no-animate={!$hydrated}` + CSS `.bliss.no-animate { animation: none; }`; code comment at top explaining the pattern
- **Modify**: `web/src/lib/components/MissedTaskBanner.svelte` — accepts `suppressTransitions` prop, `transition:fade` uses conditional duration
- **Done when**: All transitions are conditional, bliss animation suppressed during hydration, code comment present

### T3: Verify all quality gates and run existing E2E smoke suite
- Run `npm run lint`, `npm run check`, `npm run test`, `npm run test:e2e:smoke`
- Confirm `data-ready` attribute unchanged, no existing tests modified
- **Done when**: All quality gates pass with no regressions

### T4: Fix MissedTaskBanner store import violating component contract
- **Modify**: `web/src/lib/components/MissedTaskBanner.svelte` — remove store import, add `suppressTransitions` boolean prop
- **Modify**: `web/src/routes/+page.svelte` — pass `suppressTransitions={!$hydrated}` to MissedTaskBanner
- **Done when**: MissedTaskBanner has zero store imports, uses prop for transition suppression, all quality gates pass

## Progress log

- 2026-05-09: Exec plan written by PM. Discovery complete, moving to design.
- 2026-05-09: Design written by PE. Approach: suppress transitions via conditional `duration: 0` driven by a new `hydrated` store. New file: `hydration.ts`. Changes to `+layout.svelte`, `+page.svelte`, `MissedTaskBanner.svelte`. CSS `bliss-arrive` suppressed via conditional class.
- 2026-05-09: All tasks implemented (T1-T4). T4 added mid-implementation to fix QA finding: MissedTaskBanner store import violated component contract. Replaced with `suppressTransitions` prop. All quality gates pass. Feature complete.

## Decision log

- 2026-05-09: Scope limited to My Day page only. The list route has the same transition pattern but is not reported as a user-visible problem; adding it would broaden scope without confirmed need.
- 2026-05-09: Offline boot time budget (< 3s) and user-initiated transition behavior are non-negotiable constraints per `docs/RELIABILITY.md`.
- 2026-05-09: MissedTaskBanner must not import stores directly per component contract in docs/FRONTEND.md. Used `suppressTransitions` prop instead.
