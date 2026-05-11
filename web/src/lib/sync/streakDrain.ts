/**
 * Single-flight drainer for the outbound streak-op queue.
 *
 * Responsibilities:
 *  - Process ops from `streakQueue` in FIFO order, posting each to
 *    `POST /auth/streak/op` via the API client.
 *  - On `200 OK`: call the reconciler (which applies the server-canonical state
 *    to the streak store), then remove the op from the queue.
 *  - On permanent `4xx` (not `401`): drop and log; continue to the next op.
 *  - On `401`, `5xx`, or network error: stop draining, leave the op in the
 *    queue, schedule a 30-second retry.
 *  - After the queue empties cleanly: call the hydrator once so peer-device
 *    state propagates in.
 *
 * The reconciler and hydrator are injected via `setReconciler` / `setHydrator`
 * so this module has NO import-time dependency on `streak.ts`. This avoids a
 * circular dependency: `streak.ts` (T11) will import `streakDrain` to call
 * `drain()`; if `streakDrain` imported `streak.ts` at module load that cycle
 * would be unresolvable. Both setters are last-write-wins and default to no-ops
 * so calling `drain()` before T11 wires anything is safe.
 */

import { api, ApiError } from '$lib/api/client';
import { streakQueue } from '$lib/data/streakQueue';
import type { StreakOpResponse } from '$shared/types/streak';

// ---------------------------------------------------------------------------
// Injected callbacks (no-op defaults — wired by T11)
// ---------------------------------------------------------------------------

/** Signature for the reconciler injected from streak.ts at module init. */
export type CanonicalReconciler = (canonical: StreakOpResponse) => void;

/** Default no-op reconciler — replaced by `setReconciler` at runtime. */
const noopReconciler: CanonicalReconciler = () => undefined;

let reconciler: CanonicalReconciler = noopReconciler;

/**
 * Called once from streak.ts at module initialization to register the real
 * `applyServerCanonical` implementation. Tests use this to inject a spy.
 * Last-write-wins; safe to call multiple times (tests reset via
 * `__resetForTests`).
 */
export function setReconciler(fn: CanonicalReconciler): void {
	reconciler = fn;
}

type Hydrator = () => Promise<void>;

/** Default no-op hydrator — replaced by `setHydrator` at runtime. */
const noopHydrator: Hydrator = () => Promise.resolve();

let hydrator: Hydrator = noopHydrator;

/**
 * Called once from streak.ts at module initialization to register the real
 * `streak.hydrateFromServer` callback so the end-of-drain pull is wired
 * correctly. Tests inject a spy to assert the call. Last-write-wins.
 */
export function setHydrator(fn: Hydrator): void {
	hydrator = fn;
}

// ---------------------------------------------------------------------------
// Module-level single-flight state
// ---------------------------------------------------------------------------

/** `true` while a drain pass is in flight. Prevents concurrent drains from
 *  double-processing the queue. */
let draining = false;

/** Handle for the 30-second belt-and-braces retry timer.
 *  `null` when no retry is scheduled. */
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Schedule a single retry in 30 s. Idempotent: if a timer is already
 *  pending this is a no-op. When the timer fires it calls `drain()` and
 *  swallows any rejection (there should never be one — `drain` never rejects,
 *  but the catch guards against future regressions). */
function scheduleRetry(): void {
	if (retryTimer !== null) return;
	retryTimer = setTimeout(() => {
		retryTimer = null;
		void streakDrain.drain().catch((err) => console.error('[streakDrain] retry failed', err));
	}, 30_000);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export const streakDrain = {
	/**
	 * Drain the streakOps queue.
	 *
	 * Single-flight: if a drain is already in flight, concurrent callers
	 * return immediately. The in-flight pass continues and will process any
	 * ops that were enqueued after it started (it loops until empty).
	 *
	 * Never rejects. All error paths are logged and handled internally.
	 */
	async drain(): Promise<void> {
		if (draining) return;
		draining = true;
		try {
			for (;;) {
				// Re-peek the queue at the start of each pass rather than snapshotting once
				// at drain entry. Rationale: producers (increment/break/triggerDayComplete/reset
				// in streak.ts) enqueue mid-drain, and the design's "single-flight, drain to
				// empty" contract (covered by the drain-twice-no-double-count contract test)
				// requires that the in-flight pass picks up those new ops too. Snapshotting
				// at pass start would leave them stranded until the next 30s retry timer.
				const ops = await streakQueue.peekAll();
				if (ops.length === 0) break;

				const op = ops[0];
				let response: StreakOpResponse;

				try {
					response = await api.applyStreakOp({
						opKey: op.opKey,
						kind: op.kind,
						occurredAt: op.occurredAt,
						cause: op.cause ?? null,
					});
				} catch (err) {
					if (
						err instanceof ApiError &&
						err.status >= 400 &&
						err.status < 500 &&
						err.status !== 401
					) {
						// Permanent: server rejected the op (malformed / business rule).
						// Drop it and continue so one bad op does not block the whole queue.
						console.warn('[streakDrain] dropping malformed op', op.opKey, err);
						await streakQueue.remove(op.opKey);
						continue;
					}

					// Transient (network / 5xx) or auth lost (401) — stop draining.
					if (err instanceof ApiError && err.status === 401) {
						console.warn('[streakDrain] auth lost; pausing drain', op.opKey);
					} else {
						console.warn('[streakDrain] transient error; will retry', op.opKey, err);
					}
					scheduleRetry();
					return;
				}

				// Success path: apply canonical state then remove the op.
				reconciler(response);
				await streakQueue.remove(op.opKey);
			}

			// Queue fully drained — pull in any concurrent peer-device state.
			await hydrator();
		} finally {
			draining = false;
		}
	},

	/**
	 * TEST-ONLY hook to reset all module-level state between tests.
	 * Do NOT call from production code. Resets the single-flight guard,
	 * clears any pending retry timer, and restores reconciler/hydrator to
	 * the default no-op stubs.
	 */
	__resetForTests(): void {
		draining = false;
		if (retryTimer !== null) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		reconciler = noopReconciler;
		hydrator = noopHydrator;
	},
} as const;
