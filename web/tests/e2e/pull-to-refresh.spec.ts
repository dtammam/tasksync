import { devices, expect, test } from '@playwright/test';

// --- Touch gesture tests (mobile device) ---
test.describe('PTR touch gesture', () => {
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
		const style = await content.getAttribute('style');
		expect(style).toContain('translateY(');
		expect(style).not.toContain('translateY(0px)');

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

	test('pull-to-refresh mouse drag triggers sync @smoke', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const indicator = page.locator('.ptr-indicator');

		// Indicator starts hidden (opacity 0).
		await expect(indicator).toHaveCSS('opacity', '0');

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
		const style = await content.getAttribute('style');
		expect(style).toContain('translateY(');
		expect(style).not.toContain('translateY(0px)');

		// Indicator should be fully visible while held past threshold.
		await expect(indicator).toHaveCSS('opacity', '1');

		// Release to trigger the refresh.
		await page.mouse.up();

		// After release the indicator animates out — opacity returns to 0.
		// The CSS transition takes 300 ms; Playwright polls until the condition is met.
		await expect(indicator).toHaveCSS('opacity', '0');
	});
});
