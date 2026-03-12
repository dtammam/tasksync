/**
 * createHydrateGuard — lightweight race guard for async store hydration.
 *
 * Pattern: each mutation bumps a version counter before any async work
 * begins. When the async work completes, it checks whether the version
 * it captured is still current. If not, a concurrent mutation happened
 * while the async call was in-flight and the result should be discarded
 * to avoid clobbering the newer local state.
 *
 * Usage:
 *   const guard = createHydrateGuard();
 *   // In each synchronous mutation:
 *   guard.bump();
 *   // At the start of each async hydrate:
 *   const snap = guard.snapshot();
 *   ... await ...
 *   if (!guard.isCurrent(snap)) return; // discard stale result
 */
export const createHydrateGuard = () => {
	let version = 0;
	return {
		/** Call before any synchronous mutation that should invalidate in-flight hydrations. */
		bump() {
			version += 1;
		},
		/** Capture the current version at the start of an async hydration. */
		snapshot() {
			return version;
		},
		/** Returns true if no mutation has occurred since snapshot() was called. */
		isCurrent(snap: number) {
			return version === snap;
		}
	};
};
