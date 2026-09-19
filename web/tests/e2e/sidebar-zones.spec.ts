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

	// Locate the Settings button inside the bottom zone.
	const settingsBtn = page.getByTestId('settings-open');
	await expect(settingsBtn).toBeVisible();

	const viewportHeight = 844;

	// The Settings button must sit fully within the viewport — no scrolling. Poll
	// the bottom edge (rather than sleeping through the ~170ms drawer transition
	// and measuring once) so it settles deterministically under load, reporting
	// the actual pixel value on failure instead of a bare boolean.
	await expect
		.poll(async () => {
			const box = await settingsBtn.boundingBox();
			return box ? Math.round(box.y + box.height) : Number.POSITIVE_INFINITY;
		})
		.toBeLessThanOrEqual(viewportHeight);
	// Top edge on-screen (not scrolled off), checked once the box has settled.
	const settledBox = await settingsBtn.boundingBox();
	expect(settledBox?.y ?? -1).toBeGreaterThanOrEqual(0);
});
