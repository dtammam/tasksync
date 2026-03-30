<script lang="ts">
	import { createEventDispatcher, onMount, onDestroy } from 'svelte';
	import {
		pickRandomPullEmoji,
		applyPullDamping,
		meetsRefreshThreshold,
		REFRESH_EMOJI
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

	/** Pixel height of the pull indicator. */
	const INDICATOR_HEIGHT = 56;

	// ── Gesture state ──────────────────────────────────────────────────────────

	/** Root element bound via bind:this; used to locate the <main> scroll container. */
	let containerEl: HTMLDivElement;

	/** Damped pull distance driven by touchmove; drives content translation + emoji. */
	let pullDistance = 0;

	/** True while a downward pull from scrollTop===0 is being tracked. */
	let isTracking = false;

	/** True while a sync is in flight; blocks new gestures. */
	let isRefreshing = false;

	/** clientY recorded at touchstart (rebased to first qualifying touchmove). */
	let startTouchY = 0;

	/**
	 * True after touchstart until the first touchmove resolves whether to track.
	 * Allows the component to defer the scrollTop guard to touchmove so a gesture
	 * can begin at the top of the scroll container even after partial scrolling.
	 */
	let pendingGesture = false;

	/** Emoji picked once when tracking activates; stays fixed for the full gesture. */
	let gestureEmoji = '';

	// ── UI state ───────────────────────────────────────────────────────────────

	/** Text for the aria-live region; set after each sync settles. */
	let statusMessage = '';

	/** Whether the user has prefers-reduced-motion enabled. */
	let reducedMotion = false;

	/** Enables CSS transitions on indicator + content (retract after pull or after refresh). */
	let animateOut = false;

	// ── Pending timer IDs (cleared on destroy to avoid stale-closure writes) ──

	/** Timer that clears the animateOut flag after the retract transition completes. */
	let animateOutTimer: ReturnType<typeof setTimeout> | null = null;

	/** Timer that clears the aria-live statusMessage after screen readers have announced it. */
	let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Derived / reactive ─────────────────────────────────────────────────────

	/**
	 * How far down the page content should be translated.
	 * Proportional to pull progress (capped at INDICATOR_HEIGHT) during a gesture;
	 * held at INDICATOR_HEIGHT while refreshing; 0 at rest.
	 */
	$: contentTranslateY = isRefreshing
		? INDICATOR_HEIGHT
		: isTracking
			? Math.min((pullDistance / threshold) * INDICATOR_HEIGHT, INDICATOR_HEIGHT)
			: 0;

	/** Emoji to display: hourglass while refreshing, recycle for reduced motion, else gesture emoji. */
	$: currentEmoji = isRefreshing ? REFRESH_EMOJI : reducedMotion ? '🔄' : gestureEmoji || '🔄';

	/** Indicator opacity: fades from 0 to 1 as pull approaches threshold. */
	$: indicatorOpacity = isRefreshing ? 1 : Math.min(pullDistance / threshold, 1);

	// ── Scroll container ───────────────────────────────────────────────────────

	/**
	 * Return the nearest <main> ancestor used as the scroll container.
	 * Called on touchmove (not touchstart) so partial-scroll-then-pull works correctly.
	 */
	function getScrollContainer(): HTMLElement | null {
		if (!containerEl) return null;
		const main = containerEl.closest('main');
		return main instanceof HTMLElement ? main : null;
	}

	// ── Touch event handlers ───────────────────────────────────────────────────

	/**
	 * Record the initial touch position and enter pending-gesture mode.
	 * The scrollTop guard is deferred to touchmove so the gesture can activate
	 * seamlessly once the user scrolls to the top.
	 * Must be registered as a passive listener (no preventDefault needed here).
	 */
	function handleTouchStart(event: TouchEvent): void {
		if (isRefreshing) {
			isTracking = false;
			return;
		}

		startTouchY = event.touches[0].clientY;
		pendingGesture = true;
		isTracking = false;
		pullDistance = 0;
		animateOut = false;
	}

	/**
	 * Resolve pending gesture or accumulate pull distance.
	 *
	 * When pendingGesture is set, check whether conditions are met to begin
	 * tracking (scroll container at top and finger moving downward). On the
	 * first qualifying touchmove, startTouchY is rebased to the current position
	 * and a single gesture emoji is chosen — it stays fixed for the entire drag.
	 *
	 * Once isTracking, accumulate damped pull distance and suppress native scroll.
	 * Must be registered as a non-passive listener so preventDefault is available.
	 */
	function handleTouchMove(event: TouchEvent): void {
		if (!pendingGesture && !isTracking) return;

		const currentY = event.touches[0].clientY;

		if (pendingGesture && !isTracking) {
			const main = getScrollContainer();
			const scrollTop = main ? main.scrollTop : 0;

			if (scrollTop <= 0 && currentY > startTouchY) {
				// Rebase so pull distance is measured from tracking activation point.
				isTracking = true;
				pendingGesture = false;
				startTouchY = currentY;
				gestureEmoji = pickRandomPullEmoji();
				event.preventDefault(); // Claim the gesture so Chromium does not classify it as a scroll.
			} else if (scrollTop > 0) {
				// Container is scrolled — allow normal scroll, keep pending.
				return;
			} else {
				// Finger moving up or horizontally — cancel gesture.
				pendingGesture = false;
			}
			// Don't accumulate pull distance on the activation event itself.
			return;
		}

		// isTracking is true here.
		const rawDelta = currentY - startTouchY;

		if (rawDelta <= 0) {
			event.preventDefault();
			pullDistance = 0;
			return;
		}

		event.preventDefault();
		pullDistance = applyPullDamping(rawDelta);
	}

	/**
	 * Settle the gesture: either trigger a refresh or retract the indicator.
	 */
	function handleTouchEnd(): void {
		pendingGesture = false;

		if (!isTracking) return;
		isTracking = false;

		if (meetsRefreshThreshold(pullDistance, threshold)) {
			void doRefresh().catch((err: unknown) => console.error('doRefresh failed', err));
		} else {
			// Retract the content and indicator with a CSS transition.
			animateOut = true;
			pullDistance = 0;
			if (animateOutTimer !== null) clearTimeout(animateOutTimer);
			animateOutTimer = setTimeout(() => {
				animateOut = false;
				animateOutTimer = null;
			}, 300);
		}
	}

	/**
	 * Cancel the gesture cleanly without triggering a refresh.
	 * Called when the browser cancels the touch (e.g. incoming call, gesture conflict).
	 */
	function handleTouchCancel(): void {
		pendingGesture = false;
		if (!isTracking) return;
		isTracking = false;
		animateOut = true;
		pullDistance = 0;
		if (animateOutTimer !== null) clearTimeout(animateOutTimer);
		animateOutTimer = setTimeout(() => {
			animateOut = false;
			animateOutTimer = null;
		}, 300);
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
		containerEl.addEventListener('touchcancel', handleTouchCancel);

		return () => {
			mql.removeEventListener('change', handleMqlChange);
			containerEl.removeEventListener('touchstart', handleTouchStart);
			containerEl.removeEventListener('touchmove', handleTouchMove);
			containerEl.removeEventListener('touchend', handleTouchEnd);
			containerEl.removeEventListener('touchcancel', handleTouchCancel);
		};
	});

	// ── Refresh logic ──────────────────────────────────────────────────────────

	/**
	 * Enter refreshing state, dispatch the `refresh` event, await the promise
	 * set by the parent, then animate the indicator and content back to rest.
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
			// Animate content and indicator back to rest via CSS transition.
			animateOut = true;
			isRefreshing = false;
			// pullDistance is already 0; setting again drives contentTranslateY to 0.
			pullDistance = 0;
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
		Pull indicator: absolute, sits at the top of ptr-wrap.
		Revealed by content translating down; only opacity is animated.
		touch-action: none prevents browser gesture interpretation while active.
	-->
	<div
		class="ptr-indicator"
		class:ptr-animate={animateOut}
		class:ptr-reduced={reducedMotion}
		style="opacity: {indicatorOpacity};"
		aria-hidden="true"
	>
		<span
			class="ptr-emoji"
			class:ptr-spin={isRefreshing && !reducedMotion}
		>{currentEmoji}</span>
	</div>

	<!-- Visually hidden region that announces sync result to screen readers. -->
	<span class="ptr-sr-only" aria-live="polite">{statusMessage}</span>

	<!--
		Content wrapper: translates down to reveal the indicator during a pull.
		ptr-animate enables the CSS transition for the retract animation.
	-->
	<div
		class="ptr-content"
		class:ptr-animate={animateOut}
		style={contentTranslateY > 0 ? `transform: translateY(${contentTranslateY}px)` : ''}
	>
		<slot />
	</div>
</div>

<style>
	.ptr-wrap {
		position: relative;
		width: 100%;
		min-height: 100%;
	}

	/*
	 * Indicator sits absolutely at the top of .ptr-wrap, out of document flow.
	 * Content translates down to reveal it. Only opacity is animated.
	 */
	.ptr-indicator {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		display: flex;
		justify-content: center;
		align-items: center;
		pointer-events: none;
		touch-action: none;
		will-change: opacity;
		transition: none;
	}

	/* Enable opacity transition for retract-after-pull and dismiss-after-refresh. */
	.ptr-indicator.ptr-animate {
		transition: opacity 0.3s ease;
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
	 * Content wrapper: translates down during pull gesture to reveal the indicator.
	 * Only transform is animated — no layout properties change.
	 * No will-change here — it creates a containing block that breaks position:fixed descendants.
	 * Modern browsers auto-promote elements with active transforms to the compositor.
	 */
	.ptr-content {
		transition: none;
	}

	/* Enable transform transition for the retract animation. */
	.ptr-content.ptr-animate {
		transition: transform 0.3s ease;
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
