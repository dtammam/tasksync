/**
 * Wire contracts for the server-authoritative streak operations API.
 * Shared between the SvelteKit web client and the Rust server.
 * These are pure type declarations — no runtime code.
 */

/** The kind of streak mutation being requested. */
export type StreakOpKind = "increment" | "break" | "day_complete" | "reset";

/**
 * Why a streak break occurred.
 * Only meaningful when `kind === 'break'`.
 */
export type StreakBreakCause = "punt" | "skip" | "delete" | "manual";

/** Request body for POST /auth/streak/op. */
export interface StreakOpRequest {
	/** Idempotency key; max 128 characters. Server deduplicates on (user_id, opKey). */
	opKey: string;
	kind: StreakOpKind;
	/** Client-side timestamp in milliseconds since Unix epoch. Server uses its own clock for applied_ts. */
	occurredAt: number;
	/** Cause of a break; only meaningful when kind === 'break'. */
	cause?: StreakBreakCause | null;
}

/** Canonical response body from POST /auth/streak/op. */
export interface StreakOpResponse {
	revision: number;
	count: number;
	/** ISO date in YYYY-MM-DD format. */
	lastResetDate: string;
	/** ISO date in YYYY-MM-DD format, or null if day-complete has not fired today. */
	dayCompleteDate: string | null;
	/** False when this request was a replay of an already-applied opKey. */
	appliedThisCall: boolean;
	/** True only if this specific request transitioned the day_complete state. */
	dayCompleteFiredThisCall: boolean;
}
