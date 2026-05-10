import { expect, test } from '@playwright/test';

/**
 * Hamburger button visibility E2E tests.
 *
 * Verifies that the navigation toggle button is hidden on desktop viewports
 * (display: none; in base rule) and visible on mobile viewports (restored by
 * the @media (max-width: 900px) block via normal cascade ordering).
 */

test('@smoke hamburger is hidden on desktop viewport', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});

	const toggle = page.locator('button[aria-label="Toggle navigation"]');

	// The button must not be visible (display: none removes it from layout).
	await expect(toggle).not.toBeVisible();

	// Assert zero layout box: display:none (not just visibility:hidden).
	// boundingBox() returns null when the element has no rendered box.
	const box = await toggle.boundingBox();
	expect(box).toBeNull();
});

test('@smoke hamburger is visible on mobile viewport', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 667 });
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});

	const toggle = page.locator('button[aria-label="Toggle navigation"]');

	// The media query restores display: inline-flex on narrow viewports.
	await expect(toggle).toBeVisible();
});
