import { expect, test } from '@playwright/test';

test('homepage loads', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
});

test('runtime config asset is served', async ({ page }) => {
	const response = await page.request.get('/runtime-config.js');
	expect(response.status()).toBe(200);
});
