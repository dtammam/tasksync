/**
 * Pure utility functions for pull-to-refresh gesture logic.
 * Extracted here so they can be unit-tested independently of the Svelte component.
 */

/** Ordered emoji sequence reflecting increasing pull "energy". */
export const PULL_EMOJIS: readonly string[] = ['😴', '🙄', '😏', '😤', '🔥', '🚀'];

/** Damping factor applied to raw touch delta. */
export const PULL_DAMPING = 0.5;

/** Maximum pull distance in pixels (provides resistance feel). */
export const PULL_MAX = 150;

/**
 * Compute which emoji to show based on pull distance and threshold.
 *
 * The pull range [0, threshold] is divided into equal bands, one per emoji.
 * At distance 0 the first emoji is shown; at distance >= threshold the last is shown.
 *
 * @param pullDistance - Current pull distance in pixels (0 to PULL_MAX).
 * @param threshold    - Pull distance required to trigger refresh (px).
 * @returns            An index into PULL_EMOJIS.
 */
export function computeEmojiIndex(pullDistance: number, threshold: number): number {
	const emojiCount = PULL_EMOJIS.length;
	const bandSize = threshold / (emojiCount - 1);
	return Math.min(Math.floor(pullDistance / bandSize), emojiCount - 1);
}

/**
 * Apply damping and clamp to the raw vertical touch delta.
 *
 * @param rawDelta - Raw Y delta from touchstart to current touchmove (px).
 * @returns        Damped, clamped pull distance in pixels.
 */
export function applyPullDamping(rawDelta: number): number {
	return Math.min(rawDelta * PULL_DAMPING, PULL_MAX);
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
