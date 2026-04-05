import { type CDPSession, devices, expect, type Page, test } from '@playwright/test';

/**
 * Wait for the PullToRefresh component's onMount to register event listeners.
 * SSR renders the DOM before JS hydration completes, so visual assertions
 * (heading visible, indicator opacity) pass while event listeners haven't
 * been attached yet. This polls via CDP until the specified listener type
 * appears on .ptr-wrap.
 */
async function waitForPtrListeners(
	page: Page,
	client: CDPSession,
	listenerType: string
): Promise<void> {
	const { root } = await client.send('DOM.getDocument');
	const { nodeId } = await client.send('DOM.querySelector', {
		nodeId: root.nodeId,
		selector: '.ptr-wrap'
	});
	const { object } = await client.send('DOM.resolveNode', { nodeId });
	await expect(async () => {
		const { listeners } = await client.send('DOMDebugger.getEventListeners', {
			objectId: object.objectId!,
			depth: 0
		});
		expect(listeners.some((l: { type: string }) => l.type === listenerType)).toBe(true);
	}).toPass({ timeout: 10_000 });
}

// --- Touch gesture tests (mobile device) ---
test.describe('PTR touch gesture', () => {
	test.skip(({ browserName }) => browserName === 'firefox', 'isMobile not supported in Firefox');
	// Omit defaultBrowserType: test.use() inside a describe block cannot set
	// defaultBrowserType because it forces a new worker.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { defaultBrowserType: _dbt, ...pixel5 } = devices['Pixel 5'];
	test.use(pixel5);

	test('pull-to-refresh gesture triggers sync @smoke', async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'CDP required for raw touch simulation');
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const indicator = page.locator('.ptr-indicator');

		// Indicator starts hidden (opacity 0, translated above viewport).
		await expect(indicator).toHaveCSS('opacity', '0');

		// Simulate a downward pull-drag past the refresh threshold.
		// Component threshold = 64px with 0.5 damping → raw delta must be ≥ 128px.
		const wrapBox = await page.locator('.ptr-wrap').boundingBox();
		if (!wrapBox) throw new Error('.ptr-wrap not found');
		const cx = Math.round(wrapBox.x + wrapBox.width / 2);
		const startY = Math.round(wrapBox.y + 10); // 10px inside the top edge
		const pullY = startY + 200; // 200px raw delta → pullDistance ≈ 100px ≥ 64px threshold

		// Reset scroll position so the component's scroll guard does not fire.
		await page.evaluate(() => {
			document.querySelector('main')?.scrollTo(0, 0);
		});

		// Use CDP-level touch events so that input goes through the browser's real
		// touch pipeline.  Synthetic TouchEvents created with `new TouchEvent()`
		// inside page.evaluate() are untrusted and do not reliably trigger
		// addEventListener-registered handlers in Chromium's device-emulation mode.
		const client = await page.context().newCDPSession(page);
		await waitForPtrListeners(page, client, 'touchstart');

		function touchPoint(x: number, y: number) {
			return { x, y, radiusX: 0.5, radiusY: 0.5, rotationAngle: 0, force: 0.5, id: 1 };
		}

		// touchstart — records startTouchY, begins tracking
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [touchPoint(cx, startY)]
		});

		// First touchmove — positive rawDelta passes the direction guard
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [touchPoint(cx, startY + 40)]
		});

		// Second touchmove — pulls past threshold
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [touchPoint(cx, pullY)]
		});

		// (5a) Content wrapper must be translated down while the gesture is held.
		// pullDistance ≈ 80px (160px raw × 0.5 damping), threshold = 64px →
		// contentTranslateY = min((80/64)*56, 56) = 56px.
		const content = page.locator('.ptr-content');
		await expect(content).toHaveAttribute('style', /translateY\(/);
		await expect(content).not.toHaveAttribute('style', /translateY\(0px\)/);

		// (5b) Indicator should be fully visible while held past threshold.
		// toHaveCSS retries with the configured expect.timeout (10 s), giving
		// Svelte plenty of time to flush reactive updates to the DOM.
		await expect(indicator).toHaveCSS('opacity', '1');

		// Release the touch to trigger the refresh.
		await client.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [touchPoint(cx, pullY)]
		});

		await client.detach();

		// (6) After release the indicator animates out — opacity returns to 0.
		// The CSS transition takes 300 ms; Playwright polls until the condition is met.
		await expect(indicator).toHaveCSS('opacity', '0');
	});
});

// --- Desktop pointer gesture tests ---
test.describe('PTR desktop pointer gesture', () => {
	// No device override — uses default desktop viewport

	test('pull-to-refresh mouse drag triggers sync @smoke', async ({ page, browserName }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const indicator = page.locator('.ptr-indicator');

		// Indicator starts hidden (opacity 0).
		await expect(indicator).toHaveCSS('opacity', '0');

		// Wait for hydration — pointer listeners must be registered before interacting.
		// CDP is Chromium-only; fall back to a delay on other browsers.
		if (browserName === 'chromium') {
			const client = await page.context().newCDPSession(page);
			await waitForPtrListeners(page, client, 'pointerdown');
			await client.detach();
		} else {
			await page.waitForTimeout(2000);
		}

		// Reset scroll position so the component's scroll guard does not fire.
		await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));

		const wrapBox = await page.locator('.ptr-wrap').boundingBox();
		if (!wrapBox) throw new Error('.ptr-wrap not found');

		const cx = Math.round(wrapBox.x + wrapBox.width / 2);
		const startY = Math.round(wrapBox.y + 10);
		const pullY = startY + 200; // 200px raw delta

		await page.mouse.move(cx, startY);
		await page.mouse.down();
		// Initial move to activate tracking (positive direction to pass direction guard).
		await page.mouse.move(cx, startY + 40, { steps: 5 });
		// Drag past the refresh threshold.
		await page.mouse.move(cx, pullY, { steps: 10 });

		// While still holding, content wrapper must be translated down.
		const content = page.locator('.ptr-content');
		await expect(content).toHaveAttribute('style', /translateY\(/);
		await expect(content).not.toHaveAttribute('style', /translateY\(0px\)/);

		// Indicator should be fully visible while held past threshold.
		await expect(indicator).toHaveCSS('opacity', '1');

		// Release to trigger the refresh.
		await page.mouse.up();

		// After release the indicator animates out — opacity returns to 0.
		// The CSS transition takes 300 ms; Playwright polls until the condition is met.
		await expect(indicator).toHaveCSS('opacity', '0');
	});
});

// --- Wheel/trackpad gesture tests ---
test.describe('PTR wheel gesture', () => {
	// No device override — uses default desktop viewport

	test('wheel gesture triggers sync @smoke', async ({ page, browserName }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const indicator = page.locator('.ptr-indicator');

		// Indicator starts hidden (opacity 0).
		await expect(indicator).toHaveCSS('opacity', '0');

		// Wait for hydration — wheel listener must be registered before interacting.
		// CDP is Chromium-only; fall back to a delay on other browsers.
		if (browserName === 'chromium') {
			const client = await page.context().newCDPSession(page);
			await waitForPtrListeners(page, client, 'wheel');
			await client.detach();
		} else {
			await page.waitForTimeout(2000);
		}

		// Reset scroll position so the wheel scroll guard (scrollTop === 0) is satisfied.
		await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));

		// Position the mouse over the .ptr-wrap element before dispatching wheel events.
		// page.mouse.wheel() dispatches the event at the current mouse cursor position;
		// the cursor must be within .ptr-wrap so that the containerEl event listener fires.
		const wrapBox = await page.locator('.ptr-wrap').boundingBox();
		if (!wrapBox) throw new Error('.ptr-wrap not found');
		const cx = Math.round(wrapBox.x + wrapBox.width / 2);
		const cy = Math.round(wrapBox.y + 10);
		await page.mouse.move(cx, cy);

		// Send multiple wheel-up events (negative deltaY) to accumulate pull distance
		// past the 64px refresh threshold.
		//
		// The damping formula is: PULL_MAX * (1 - exp(-wheelAccumulator * 0.9 / 140)).
		// To reach pullDistance >= 64px, wheelAccumulator must exceed ~95px.
		// Sending 5 × 40px = 200px raw delta yields pullDistance ≈ 99px, well past threshold.
		//
		// page.mouse.wheel() dispatches real WheelEvent objects in DOM_DELTA_PIXEL mode,
		// which the component's handleWheel handler normalises and accumulates.
		for (let i = 0; i < 5; i++) {
			await page.mouse.wheel(0, -40);
		}

		// Content wrapper must be translated down during the active gesture.
		const content = page.locator('.ptr-content');
		await expect(content).toHaveAttribute('style', /translateY\(/);
		await expect(content).not.toHaveAttribute('style', /translateY\(0px\)/);

		// Indicator must be fully visible while pull distance exceeds threshold.
		await expect(indicator).toHaveCSS('opacity', '1');

		// The wheel handler uses a 150ms debounce for gesture-end detection.
		// After the last wheel event, allow the debounce to settle.
		// Playwright's toHaveCSS auto-retries, so no explicit wait is needed beyond
		// leaving enough time for the debounce (150ms) + CSS transition (300ms) to complete.

		// After settle, indicator animates out — opacity returns to 0.
		await expect(indicator).toHaveCSS('opacity', '0');
	});
});
