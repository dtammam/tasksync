import { writable } from 'svelte/store';

/**
 * hydrated — becomes true once IDB hydration completes (markHydrated is called
 * from +layout.svelte immediately after appReady = true).
 *
 * Consumers use $hydrated to suppress entry transitions during the initial
 * render so that task rows appear instantly on cold launch. After hydration,
 * user-initiated transitions (add, complete, delete) play normally.
 */
const _hydrated = writable<boolean>(false);

export const hydrated = { subscribe: _hydrated.subscribe };

export function markHydrated(): void {
	_hydrated.set(true);
}
