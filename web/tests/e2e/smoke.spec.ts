import { expect, test } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

test('@smoke homepage loads', async ({ page }) => {
	await setAuthenticatedClientState(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
});

test('@smoke runtime config asset is served', async ({ page }) => {
	const response = await page.request.get('/runtime-config.js');
	expect(response.status()).toBe(200);
});

test('@smoke quick shelf has no Star action and Close closes it', async ({ page }) => {
	await setAuthenticatedClientState(page);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

	// Create a task to interact with.
	const title = `Shelf close smoke ${Math.random().toString(36).slice(2, 8)}`;
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();
	await expect(page.getByTestId('new-task-input')).toHaveValue('');

	const row = page.getByTestId('task-row').filter({ hasText: title });
	await expect(row).toHaveCount(1);

	// Open the quick shelf.
	await row.getByRole('button', { name: '⋯' }).click();
	await expect(row.locator('.quick')).toBeVisible();

	// Starred is retired (the ⭐ tag replaces it): no Star / Unstar in the shelf.
	await expect(row.getByRole('button', { name: /^(un)?star$/i })).toHaveCount(0);
	await expect(row.getByTestId('task-star-indicator')).toHaveCount(0);

	await row.getByRole('button', { name: 'Close' }).click();
	await expect(row.locator('.quick')).not.toBeVisible();
});
