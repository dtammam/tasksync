import { expect, test } from '@playwright/test';

test('@smoke homepage loads', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
});

test('@smoke runtime config asset is served', async ({ page }) => {
	const response = await page.request.get('/runtime-config.js');
	expect(response.status()).toBe(200);
});

test('@smoke Star action closes the quick shelf', async ({ page }) => {
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

	// Tap Star — the shelf should close immediately.
	await row.getByRole('button', { name: 'Star' }).click();
	await expect(row.locator('.quick')).not.toBeVisible();
});
