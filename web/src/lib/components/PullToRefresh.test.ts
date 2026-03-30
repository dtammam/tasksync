import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import {
	PULL_EMOJIS,
	REFRESH_EMOJI,
	pickRandomPullEmoji,
	applyPullDamping,
	meetsRefreshThreshold,
	PULL_DAMPING,
	PULL_MAX
} from './pullToRefreshUtils';
import PullToRefresh from './PullToRefresh.svelte';

// ── Pure utility tests ─────────────────────────────────────────────────────

describe('REFRESH_EMOJI', () => {
	it('is the hourglass emoji reserved for the refreshing/loading state', () => {
		expect(REFRESH_EMOJI).toBe('⏳');
	});
});

describe('PULL_EMOJIS', () => {
	const EXPECTED_EMOJIS = ['🚀', '⚙️', '🔄', '🎯', '💪', '🏆', '🌟', '📌', '⚡', '✨', '💨', '🔥', '🏁', '💥', '🧹'];

	it('contains exactly 15 entries', () => {
		expect(PULL_EMOJIS.length).toBe(15);
	});

	it('every element is one of the 15 expected emoji values', () => {
		for (const emoji of PULL_EMOJIS) {
			expect(EXPECTED_EMOJIS).toContain(emoji);
		}
	});
});

describe('pickRandomPullEmoji', () => {
	it('returns a value that is a member of PULL_EMOJIS', () => {
		const result = pickRandomPullEmoji();
		expect(PULL_EMOJIS).toContain(result);
	});

	it('never returns the hourglass emoji (reserved for the refreshing state)', () => {
		for (let i = 0; i < 100; i++) {
			expect(pickRandomPullEmoji()).not.toBe('⏳');
		}
	});

	it('returns different values over many calls (confirms randomness, not a constant)', () => {
		const results = new Set<string>();
		for (let i = 0; i < 100; i++) {
			results.add(pickRandomPullEmoji());
		}
		expect(results.size).toBeGreaterThan(1);
	});
});

describe('applyPullDamping', () => {
	it('applies the configured damping factor', () => {
		expect(applyPullDamping(100)).toBe(100 * PULL_DAMPING);
	});

	it('clamps to PULL_MAX regardless of raw delta', () => {
		expect(applyPullDamping(1000)).toBe(PULL_MAX);
	});

	it('returns 0 for zero delta', () => {
		expect(applyPullDamping(0)).toBe(0);
	});

	it('is a monotonic function up to the clamp ceiling', () => {
		expect(applyPullDamping(50)).toBeLessThan(applyPullDamping(100));
		expect(applyPullDamping(100)).toBeLessThan(applyPullDamping(200));
	});
});

describe('meetsRefreshThreshold', () => {
	it('returns false when pull distance is strictly below threshold', () => {
		expect(meetsRefreshThreshold(63, 64)).toBe(false);
		expect(meetsRefreshThreshold(0, 64)).toBe(false);
	});

	it('returns true when pull distance exactly meets threshold', () => {
		expect(meetsRefreshThreshold(64, 64)).toBe(true);
	});

	it('returns true when pull distance exceeds threshold', () => {
		expect(meetsRefreshThreshold(100, 64)).toBe(true);
	});
});

// ── Component render tests ─────────────────────────────────────────────────

/**
 * In Svelte 5, createEventDispatcher calls registered callbacks directly from
 * component_context.s.$$events — it does NOT dispatch DOM events. To intercept
 * these in tests, pass a handler via the `$$events` prop that Svelte's legacy
 * compatibility layer reads when the component is mounted.
 *
 * We pass `{ '$$events': { refresh: [handler] } }` so the component's
 * dispatched 'refresh' event calls our handler.
 *
 * The handler receives the CustomEvent and must set `event.detail.promise` to
 * control when the component exits the refreshing state.
 */
function renderWithRefreshHandler(
	props: Record<string, unknown>,
	handler: (event: CustomEvent<{ promise: Promise<void> }>) => void
) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Svelte internal $$events API
	const options: any = { ...props, '$$events': { refresh: [handler] } };
	return render(PullToRefresh, options);
}

describe('PullToRefresh component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders an accessible refresh button with aria-label "Refresh tasks"', () => {
		const { getByRole } = render(PullToRefresh);
		const btn = getByRole('button', { name: 'Refresh tasks' });
		expect(btn).toBeTruthy();
	});

	it('renders an aria-live region for screen reader announcements', () => {
		const { container } = render(PullToRefresh);
		const liveRegion = container.querySelector('[aria-live="polite"]');
		expect(liveRegion).toBeTruthy();
	});

	it('clicking the refresh button dispatches the refresh event exactly once', async () => {
		let dispatchCount = 0;
		const { getByRole } = renderWithRefreshHandler({}, (e) => {
			dispatchCount++;
			// Settle the promise immediately so the component exits refreshing state.
			e.detail.promise = Promise.resolve();
		});

		const btn = getByRole('button', { name: 'Refresh tasks' });
		await fireEvent.click(btn);

		expect(dispatchCount).toBe(1);
	});

	it('does not dispatch refresh while a sync is already in flight (double-fire prevention)', async () => {
		let dispatchCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional hanging promise
		const hangingPromise = new Promise<void>(() => {});
		const { getByRole } = renderWithRefreshHandler({}, (e) => {
			dispatchCount++;
			e.detail.promise = hangingPromise;
		});

		const btn = getByRole('button', { name: 'Refresh tasks' });

		// First click — triggers sync.
		await fireEvent.click(btn);
		// Second click — should be ignored because isRefreshing is true.
		await fireEvent.click(btn);

		expect(dispatchCount).toBe(1);
	});

	it('refresh button is disabled while a sync is in flight', async () => {
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional hanging promise
		const hangingPromise = new Promise<void>(() => {});
		const { getByRole } = renderWithRefreshHandler({}, (e) => {
			e.detail.promise = hangingPromise;
		});

		const btn = getByRole('button', { name: 'Refresh tasks' });
		await fireEvent.click(btn);

		// After first click, button should be disabled.
		expect(btn).toBeDisabled();
	});

	it('displays static recycle emoji when prefers-reduced-motion is enabled', () => {
		// Override the global matchMedia stub to report reduced-motion preference.
		vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
			matches: query === '(prefers-reduced-motion: reduce)',
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn()
		}) as unknown as MediaQueryList);

		const { container } = render(PullToRefresh);
		const emoji = container.querySelector('.ptr-emoji');

		// In reduced-motion mode the static 🔄 emoji is used instead of the cycling set.
		expect(emoji?.textContent).toBe('🔄');

		vi.restoreAllMocks();
	});
});

// ── Touch gesture behavioral tests ────────────────────────────────────────

/**
 * Helper to create a synthetic TouchEvent for JSDOM.
 * JSDOM supports TouchEvent but Touch objects must be cast as any because
 * the Touch constructor API varies across environments.
 */
function makeTouchEvent(
	type: string,
	clientY: number,
	target: EventTarget
): TouchEvent {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSDOM touch shim
	const touch = { identifier: 1, target, clientX: 0, clientY, pageX: 0, pageY: clientY, screenX: 0, screenY: clientY, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 } as any;
	return new TouchEvent(type, {
		touches: type === 'touchend' || type === 'touchcancel' ? [] : [touch],
		changedTouches: [touch],
		bubbles: true,
		cancelable: true
	});
}

describe('PullToRefresh touch gesture', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not dispatch refresh when pull distance is below threshold', async () => {
		let dispatched = false;
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatched = true;
			e.detail.promise = Promise.resolve();
		});
		const wrap = container.firstElementChild as HTMLElement;

		// touchmove at y=110 activates tracking (startTouchY rebased to 110), then
		// touchend fires with pullDistance still 0 — well below 64px threshold.
		await fireEvent(wrap, makeTouchEvent('touchstart', 100, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 110, wrap)); // activates tracking
		await fireEvent(wrap, makeTouchEvent('touchend', 110, wrap));

		expect(dispatched).toBe(false);
	});

	it('dispatches refresh exactly once when pull distance meets threshold', async () => {
		let dispatchCount = 0;
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatchCount++;
			e.detail.promise = Promise.resolve();
		});
		const wrap = container.firstElementChild as HTMLElement;

		// First touchmove activates tracking and rebases startTouchY to 10.
		// Second touchmove moves 200px from the rebased origin → 100px damped → exceeds 64px threshold.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap)); // activates tracking, rebase to 10
		await fireEvent(wrap, makeTouchEvent('touchmove', 210, wrap)); // +200px raw → 100px damped > 64
		await fireEvent(wrap, makeTouchEvent('touchend', 210, wrap));

		expect(dispatchCount).toBe(1);
	});

	it('does not track gesture when initial touchmove is upward', async () => {
		let dispatched = false;
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatched = true;
			e.detail.promise = Promise.resolve();
		});
		const wrap = container.firstElementChild as HTMLElement;

		// Move up (negative delta relative to startTouchY) — gesture is cancelled.
		await fireEvent(wrap, makeTouchEvent('touchstart', 200, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 100, wrap)); // upward
		await fireEvent(wrap, makeTouchEvent('touchend', 100, wrap));

		expect(dispatched).toBe(false);
	});

	it('does not track gesture when scrollTop > 0 (scroll guard)', async () => {
		// The component finds its scroll container via containerEl.closest('main').
		// With the new model, the scrollTop check happens on touchmove (not touchstart),
		// so a gesture that starts while scrolled remains blocked until the user returns
		// to scrollTop === 0.
		let dispatched = false;
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatched = true;
			e.detail.promise = Promise.resolve();
		});

		const main = document.createElement('main');
		Object.defineProperty(main, 'scrollTop', { value: 50, configurable: true });
		document.body.appendChild(main);
		main.appendChild(container);

		const wrap = container.firstElementChild as HTMLElement;

		// touchstart sets pendingGesture; touchmove finds scrollTop > 0 → stays pending, no tracking.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 200, wrap));
		await fireEvent(wrap, makeTouchEvent('touchend', 200, wrap));

		expect(dispatched).toBe(false);

		// Cleanup
		document.body.removeChild(main);
	});

	it('does not dispatch refresh while a prior sync is still in flight', async () => {
		let dispatchCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-empty-function -- intentional hanging promise
		const hangingPromise = new Promise<void>(() => {});
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatchCount++;
			e.detail.promise = hangingPromise;
		});
		const wrap = container.firstElementChild as HTMLElement;

		// First gesture: activate tracking then pull past threshold.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap)); // activates tracking, rebase to 10
		await fireEvent(wrap, makeTouchEvent('touchmove', 210, wrap)); // 100px damped > 64
		await fireEvent(wrap, makeTouchEvent('touchend', 210, wrap));
		expect(dispatchCount).toBe(1);

		// Second gesture: should be ignored because isRefreshing is true.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 210, wrap));
		await fireEvent(wrap, makeTouchEvent('touchend', 210, wrap));
		expect(dispatchCount).toBe(1);
	});

	it('ptr-content has a non-zero translateY inline style during a pull gesture', async () => {
		const { container } = render(PullToRefresh, { threshold: 64 });
		const wrap = container.firstElementChild as HTMLElement;

		// First touchmove activates tracking (rebase to y=10).
		// Second touchmove accumulates pull: rawDelta=90 → 45px damped.
		// contentTranslateY = Math.min(45/64 * 56, 56) ≈ 39.375px (non-zero).
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap)); // activates tracking
		await fireEvent(wrap, makeTouchEvent('touchmove', 100, wrap)); // 90px raw → 45px damped

		const content = container.querySelector('.ptr-content') as HTMLElement;
		expect(content).toBeTruthy();

		const styleAttr = content.getAttribute('style') ?? '';
		const match = styleAttr.match(/translateY\((\d+(?:\.\d+)?)px\)/);
		expect(match).toBeTruthy();
		expect(parseFloat(match![1])).toBeGreaterThan(0);
	});

	it('touchcancel does not dispatch refresh even when pull distance exceeded threshold', async () => {
		let dispatched = false;
		const { container } = renderWithRefreshHandler({ threshold: 64 }, (e) => {
			dispatched = true;
			e.detail.promise = Promise.resolve();
		});
		const wrap = container.firstElementChild as HTMLElement;

		// Activate tracking and pull past threshold, then cancel.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap));  // activates tracking, rebase to 10
		await fireEvent(wrap, makeTouchEvent('touchmove', 210, wrap)); // +200px raw → 100px damped > 64
		await fireEvent(wrap, makeTouchEvent('touchcancel', 210, wrap));

		expect(dispatched).toBe(false);
	});

	it('touchcancel resets ptr-content to translateY(0px)', async () => {
		const { container } = render(PullToRefresh, { threshold: 64 });
		const wrap = container.firstElementChild as HTMLElement;

		// Pull past threshold then cancel.
		await fireEvent(wrap, makeTouchEvent('touchstart', 0, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 10, wrap));
		await fireEvent(wrap, makeTouchEvent('touchmove', 210, wrap)); // pull distance > 64
		await fireEvent(wrap, makeTouchEvent('touchcancel', 210, wrap));

		const content = container.querySelector('.ptr-content') as HTMLElement;
		expect(content).toBeTruthy();
		expect(content.getAttribute('style')).toContain('translateY(0px)');
	});
});
