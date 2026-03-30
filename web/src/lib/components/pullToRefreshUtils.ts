/**
 * Pure utility functions for pull-to-refresh gesture logic.
 * Extracted here so they can be unit-tested independently of the Svelte component.
 */

/** Emoji set available during the pull gesture. */
export const PULL_EMOJIS: readonly string[] = ['🚀', '⚙️', '🔄', '🎯', '💪', '🏆', '🌟', '📌', '⚡', '✨', '💨', '🔥', '🏁', '💥', '🧹'];

/** Emoji shown during the refreshing/loading state. */
export const REFRESH_EMOJI = '⏳';

/** Damping factor applied to raw touch delta. */
export const PULL_DAMPING = 0.5;

/** Maximum pull distance in pixels (provides resistance feel). */
export const PULL_MAX = 400;

/**
 * Pick a random emoji to show during the pull gesture.
 *
 * @returns A randomly selected emoji string from PULL_EMOJIS.
 */
export function pickRandomPullEmoji(): string {
	return PULL_EMOJIS[Math.floor(Math.random() * PULL_EMOJIS.length)];
}

/**
 * Apply progressive rubber-band damping and clamp to the raw vertical touch delta.
 *
 * Uses an exponential decay curve so that resistance increases as the user drags
 * further: the pull starts responsive (near 1:1 with the finger near the top) and
 * asymptotically approaches PULL_MAX, never exceeding it.
 *
 * Formula: PULL_MAX * (1 - exp(-rawDelta * PULL_DAMPING / PULL_MAX))
 *
 * @param rawDelta - Raw Y delta from touchstart to current touchmove (px).
 * @returns        Damped, clamped pull distance in pixels.
 */
export function applyPullDamping(rawDelta: number): number {
	return Math.min(PULL_MAX * (1 - Math.exp((-rawDelta * PULL_DAMPING) / PULL_MAX)), PULL_MAX);
}

/**
 * Check whether a pull distance meets the refresh activation threshold.
 *
 * @param pullDistance - Current pull distance in pixels.
 * @param threshold    - Minimum distance required to trigger refresh (px).
 * @returns            True when the gesture should trigger a refresh.
 */
export function meetsRefreshThreshold(pullDistance: number, threshold: number): boolean {
	return pullDistance >= threshold;
}
