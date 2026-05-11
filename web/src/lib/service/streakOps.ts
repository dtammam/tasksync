/**
 * Pure op-builder functions for the four streak op kinds.
 *
 * These helpers are deterministic and side-effect-free: they read no clocks,
 * access no stores, and perform no I/O. The caller is responsible for
 * supplying `occurredAtMs` (and `dateIso` where applicable) so that retry
 * paths can stamp the values once and reuse them — matching the server-side
 * dedup contract exactly.
 *
 * Return values are fully-formed `StreakOp` objects assignable directly to
 * `streakQueue.enqueue(...)`.
 *
 * Layer boundary: this module MUST NOT import from `data/`, `stores/`,
 * `sync/`, `api/`, `routes/`, or `components/`. Only `$shared/types/*` and
 * `$lib/data/streakQueue` (for the StreakOp type) are permitted.
 */

import type { StreakBreakCause } from '$shared/types/streak';
import type { StreakOp } from '$lib/data/streakQueue';

/** Build an increment op. `dateIso` MUST be the user's local ISO date
 *  (YYYY-MM-DD) at the moment they completed the task — NOT the server's date
 *  and NOT a UTC date. Recurring tasks reuse `taskId` across days; the date in
 *  the opKey is what makes next-day re-counting work. */
export function buildIncrementOp(taskId: string, dateIso: string, occurredAtMs: number): StreakOp {
	return {
		opKey: `inc:${taskId}:${dateIso}`,
		kind: 'increment',
		taskId,
		cause: undefined,
		occurredAt: occurredAtMs,
		enqueuedAt: occurredAtMs,
	};
}

/** Build a break op. Per-event uniqueness — we do NOT collapse multiple breaks
 *  on the same day to a single op. The `occurredAtMs` argument MUST be the
 *  same value across retries of the same logical break (the caller is
 *  responsible for stamping it once and reusing it). `cause` becomes part of
 *  both the opKey AND the StreakOp.cause field. */
export function buildBreakOp(cause: StreakBreakCause, occurredAtMs: number): StreakOp {
	return {
		opKey: `brk:${cause}:${occurredAtMs}`,
		kind: 'break',
		taskId: undefined,
		cause,
		occurredAt: occurredAtMs,
		enqueuedAt: occurredAtMs,
	};
}

/** Build a day-complete op. `dateIso` is the local ISO date the user completed
 *  their last pending My Day task. First-to-server wins; a duplicate from a
 *  second device is a benign idempotent replay. */
export function buildDayCompleteOp(dateIso: string, occurredAtMs: number): StreakOp {
	return {
		opKey: `dc:${dateIso}`,
		kind: 'day_complete',
		taskId: undefined,
		cause: undefined,
		occurredAt: occurredAtMs,
		enqueuedAt: occurredAtMs,
	};
}

/** Build a manual reset op. Keyed by client timestamp so that a network-blip
 *  retry of the same logical reset is idempotent. */
export function buildResetOp(occurredAtMs: number): StreakOp {
	return {
		opKey: `rst:${occurredAtMs}`,
		kind: 'reset',
		taskId: undefined,
		cause: undefined,
		occurredAt: occurredAtMs,
		enqueuedAt: occurredAtMs,
	};
}
