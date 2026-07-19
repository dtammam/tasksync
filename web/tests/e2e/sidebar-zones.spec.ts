import { expect, test } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

/**
 * Sidebar fixed-zones E2E tests.
 *
 * Verifies that on a mobile viewport the Settings button in .sidebar-zone-bottom
 * is visible within the viewport without any scrolling, regardless of how many
 * list items appear in the scrollable middle zone (AC-1, AC-9).
 */

test.use({
	viewport: { width: 390, height: 844 },
});

test('@smoke settings button is visible in viewport on mobile without scrolling', async ({
	page,
}) => {
	await setAuthenticatedClientState(page);
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});

	// Open the sidebar drawer via the hamburger toggle.
	await page.getByRole('button', { name: 'Toggle navigation' }).click();

	// Wait for the sidebar to be open (the drawer receives the `open` class).
	const drawer = page.getByTestId('sidebar-drawer');
	await expect(drawer).toHaveClass(/open/, { timeout: 5_000 });

	// Wait for the CSS transition (170ms) to finish before measuring positions.
	await page.waitForTimeout(300);

	// Locate the Settings button inside the bottom zone.
	const settingsBtn = page.getByTestId('settings-open');
	await expect(settingsBtn).toBeVisible();

	// Assert the Settings button bounding box is fully within the visible viewport.
	// No scrolling should be needed — it must be pinned to the bottom zone.
	const box = await settingsBtn.boundingBox();
	if (!box) throw new Error('Settings button bounding box not found');

	const viewportHeight = 844;

	// The button bottom edge must be within the viewport height.
	expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
	// The button top edge must be within the viewport (not scrolled off screen).
	expect(box.y).toBeGreaterThanOrEqual(0);
});
