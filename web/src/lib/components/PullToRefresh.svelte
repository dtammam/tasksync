<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import { scale } from 'svelte/transition';
	import {
		PULL_EMOJIS,
		computeEmojiIndex,
		applyPullDamping,
		meetsRefreshThreshold
	} from './pullToRefreshUtils';

	// ── Props ──────────────────────────────────────────────────────────────────

	/** Minimum pull distance in pixels required to trigger refresh. */
	export let threshold = 64;

	// ── Event dispatcher ───────────────────────────────────────────────────────

	/**
	 * The `refresh` event carries a mutable `detail.promise` field.
	 * The parent handler must set `event.detail.promise` to the Promise that
	 * represents the ongoing sync. The component awaits that promise to know
	 * when to dismiss the indicator.
	 *
	 * Example parent handler:
	 *   function handleRefresh(e) { e.detail.promise = runSync(); }
	 */
	interface RefreshDetail {
		promise: Promise<void>;
	}
	const dispatch = createEventDispatcher<{ refresh: RefreshDetail }>();

	// ── Constants ──────────────────────────────────────────────────────────────

	/** Pixel height of the pull indicator overlay. */
	const INDICATOR_HEIGHT = 56;

	// ── Gesture state ──────────────────────────────────────────────────────────

	/** Root element bound via bind:this; used to locate the <main> scroll container. */
	let containerEl: HTMLDivElement;

	/** Damped pull distance driven by touchmove; drives indicator position + emoji. */
	let pullDistance = 0;

	/** True while a downward pull from scrollTop===0 is being tracked. */
	let isTracking = false;

	/** True while a sync is in flight; blocks new gestures. */
	let isRefreshing = false;

	/** clientY of the initial touchstart contact. */
	let startTouchY = 0;

	/** True until the first touchmove direction has been evaluated. */
	let isFirstMove = true;

	// ── UI state ───────────────────────────────────────────────────────────────

	/** Text for the aria-live region; set after each sync settles. */
	let statusMessage = '';

	/** Whether the user has prefers-reduced-motion enabled. */
	let reducedMotion = false;

	/** Enables CSS transitions on the indicator (retract after pull or after refresh). */
	let animateOut = false;

	// ── Pending timer IDs (cleared on destroy to avoid stale-closure writes) ──

	/** Timer that clears the animateOut flag after the retract transition. */
	let animateOutTimer: ReturnType<typeof setTimeout> | null = null;

	/** Timer that clears the aria-live statusMessage after screen readers have had time to announce it. */
	let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Derived / reactive ─────────────────────────────────────────────────────

	$: emojiIndex = computeEmojiIndex(pullDistance, threshold);

	/**
	 * Key for the {#key} block that drives emoji swap transitions.
	 * -1 locks to the refreshing emoji; 0 is used for reduced-motion mode
	 * so the static emoji never animates.
	 */
	$: keyedIndex = isRefreshing ? -1 : reducedMotion ? 0 : emojiIndex;

	/** Emoji to display: hourglass while refreshing, recycle for reduced motion, else cycling. */
	$: currentEmoji = isRefreshing
		? '⏳'
		: reducedMotion
			? '🔄'
			: PULL_EMOJIS[Math.max(0, emojiIndex)];

	/**
	 * Indicator translateY: slides from -INDICATOR_HEIGHT (hidden above) to 0 (fully visible).
	 * Clamped so it never pushes below its natural position during over-pull.
	 * Stays at 0 while refreshing.
	 */
	$: translateY = isRefreshing
		? 0
		: Math.min((pullDistance / threshold - 1) * INDICATOR_HEIGHT, 0);

	/** Indicator opacity: fades from 0 to 1 as pull approaches threshold. */
	$: indicatorOpacity = isRefreshing ? 1 : Math.min(pullDistance / threshold, 1);

	// ── Scroll container ───────────────────────────────────────────────────────

	/**
	 * Return the nearest <main> ancestor used as the scroll container.
	 * Reads scrollTop once per gesture (on touchstart) to avoid per-frame layout reads.
	 */
	function getScrollContainer(): HTMLElement | null {
		if (!containerEl) return null;
		const main = containerEl.closest('main');
		return main instanceof HTMLElement ? main : null;
	}

	// ── Touch event handlers ───────────────────────────────────────────────────

	function handleTouchStart(event: TouchEvent): void {
		// Ignore new gestures while a sync is in flight.
		if (isRefreshing) {
			isTracking = false;
			return;
		}

		// Scroll guard: only track if the scroll container is at the very top.
		const main = getScrollContainer();
		const scrollTop = main ? main.scrollTop : 0;
		if (scrollTop > 0) {
			isTracking = false;
			return;
		}

		isTracking = true;
		isFirstMove = true;
		startTouchY = event.touches[0].clientY;
		pullDistance = 0;
		animateOut = false;
	}

	function handleTouchMove(event: TouchEvent): void {
		if (!isTracking) return;

		const currentY = event.touches[0].clientY;
		const rawDelta = currentY - startTouchY;

		// On the first move, abort if the gesture is upward or sideways.
		if (isFirstMove) {
			isFirstMove = false;
			if (rawDelta <= 0) {
				isTracking = false;
				return;
			}
		}

		// If the user pulls back above the start point, retract to 0.
		if (rawDelta <= 0) {
			event.preventDefault();
			pullDistance = 0;
			return;
		}

		// Suppress native scroll while the indicator is showing.
		event.preventDefault();

		pullDistance = applyPullDamping(rawDelta);
	}

	function handleTouchEnd(): void {
		if (!isTracking) return;
		isTracking = false;

		if (meetsRefreshThreshold(pullDistance, threshold)) {
			void doRefresh().catch((err: unknown) => console.error('doRefresh failed', err));
		} else {
			// Retract the indicator with a CSS transition.
			animateOut = true;
			pullDistance = 0;
			if (animateOutTimer !== null) clearTimeout(animateOutTimer);
			animateOutTimer = setTimeout(() => {
				animateOut = false;
				animateOutTimer = null;
			}, 300);
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	onMount(() => {
		// Reduced-motion preference.
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mql.matches;
		const handleMqlChange = (e: MediaQueryListEvent) => {
			reducedMotion = e.matches;
		};
		mql.addEventListener('change', handleMqlChange);

		// Register touch listeners directly so we can control passive/active options.
		// touchstart is passive (read-only, no preventDefault needed).
		// touchmove is non-passive so we can call preventDefault when tracking.
		containerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
		containerEl.addEventListener('touchmove', handleTouchMove, { passive: false });
		containerEl.addEventListener('touchend', handleTouchEnd);

		return () => {
			mql.removeEventListener('change', handleMqlChange);
			containerEl.removeEventListener('touchstart', handleTouchStart);
			containerEl.removeEventListener('touchmove', handleTouchMove);
			containerEl.removeEventListener('touchend', handleTouchEnd);
		};
	});

	// ── Refresh logic ──────────────────────────────────────────────────────────

	/**
	 * Enter refreshing state, dispatch the `refresh` event, await the promise
	 * set by the parent, then animate the indicator out.
	 */
	async function doRefresh(): Promise<void> {
		if (isRefreshing) return;

		isRefreshing = true;
		pullDistance = 0;
		animateOut = false;
		statusMessage = '';

		// Dispatch event; parent must set detail.promise to the sync promise.
		const detail: RefreshDetail = { promise: Promise.resolve() };
		dispatch('refresh', detail);

		try {
			await detail.promise;
			statusMessage = 'Tasks refreshed';
		} catch (err) {
			console.warn('PullToRefresh: sync failed', err);
			statusMessage = 'Refresh failed';
		} finally {
			// Animate indicator out via CSS transition.
			animateOut = true;
			isRefreshing = false;
			// Remove transition class once the animation completes.
			if (animateOutTimer !== null) clearTimeout(animateOutTimer);
			animateOutTimer = setTimeout(() => {
				animateOut = false;
				animateOutTimer = null;
			}, 300);
			// Keep aria-live message long enough for screen readers to announce it.
			if (statusClearTimer !== null) clearTimeout(statusClearTimer);
			statusClearTimer = setTimeout(() => {
				statusMessage = '';
				statusClearTimer = null;
			}, 2000);
		}
	}

	function handleRefreshButton(): void {
		void doRefresh().catch((err: unknown) => console.error('doRefresh failed', err));
	}

	// ── Cleanup ────────────────────────────────────────────────────────────────

	onDestroy(() => {
		if (animateOutTimer !== null) {
			clearTimeout(animateOutTimer);
			animateOutTimer = null;
		}
		if (statusClearTimer !== null) {
			clearTimeout(statusClearTimer);
			statusClearTimer = null;
		}
	});
</script>

<div class="ptr-wrap" bind:this={containerEl}>
	<!--
		Pull indicator: fixed overlay animated with transform + opacity only.
		touch-action: none prevents browser gesture interference while visible.
	-->
	<div
		class="ptr-indicator"
		class:ptr-animate={animateOut}
		class:ptr-reduced={reducedMotion}
		style="transform: translateY({translateY}px); opacity: {indicatorOpacity};"
		aria-hidden="true"
	>
		{#key keyedIndex}
			<span
				class="ptr-emoji"
				class:ptr-spin={isRefreshing && !reducedMotion}
				in:scale={{ duration: reducedMotion ? 0 : 150, start: 1.2, opacity: 1 }}
			>{currentEmoji}</span>
		{/key}
	</div>

	<!--
		Accessible refresh button: visible on mobile (max-width 900px), hidden on desktop.
		Keyboard-reachable via Tab + Enter/Space.
	-->
	<button
		class="ptr-btn"
		type="button"
		aria-label="Refresh tasks"
		on:click={handleRefreshButton}
		disabled={isRefreshing}
	>
		🔄
	</button>

	<!-- Visually hidden region that announces sync result to screen readers. -->
	<span class="ptr-sr-only" aria-live="polite">{statusMessage}</span>

	<slot />
</div>

<style>
	.ptr-wrap {
		position: relative;
		width: 100%;
		min-height: 100%;
	}

	/*
	 * Fixed overlay below the app header.
	 * Only transform and opacity are animated — no layout properties change.
	 * will-change hints the compositor to promote this layer.
	 */
	.ptr-indicator {
		position: fixed;
		top: 56px;
		left: 0;
		right: 0;
		height: 56px;
		z-index: 150;
		display: flex;
		justify-content: center;
		align-items: center;
		pointer-events: none;
		/* Prevent browser gesture interpretation while the overlay is active. */
		touch-action: none;
		will-change: transform, opacity;
		/* No transition during active pull (for immediate, jank-free response). */
		transition: none;
	}

	/* Enable CSS transition for retract-after-pull and dismiss-after-refresh. */
	.ptr-indicator.ptr-animate {
		transition:
			transform 0.3s ease,
			opacity 0.3s ease;
	}

	/* Reduced-motion: never transition. */
	.ptr-indicator.ptr-reduced {
		transition: none;
	}

	.ptr-emoji {
		font-size: 2rem;
		line-height: 1;
		display: inline-block;
		transform-origin: center;
	}

	/* Hourglass spin animation while a sync is in flight. */
	.ptr-emoji.ptr-spin {
		animation: ptr-spin 1s linear infinite;
	}

	@keyframes ptr-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/*
	 * Refresh button: hidden on desktop, shown as a floating pill on mobile.
	 * Positioned above the typical bottom nav / quick-add bar.
	 */
	.ptr-btn {
		display: none;
		position: fixed;
		bottom: 80px;
		right: 16px;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		border: 2px solid var(--color-border, #d1d5db);
		background: var(--color-surface, #ffffff);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		z-index: 50;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
		padding: 0;
	}

	.ptr-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@media (max-width: 900px) {
		.ptr-btn {
			display: flex;
		}
	}

	/* Visually hidden but announced by screen readers via aria-live. */
	.ptr-sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
