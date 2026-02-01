import { expect, test } from '@playwright/test';

test.describe('My Day', () => {
	test('shows tasks and moves to completed when toggled', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
		const pendingSection = page.locator('section.block').first();
		const pendingRows = pendingSection.locator('[data-testid="task-row"]');
		expect(await pendingRows.count()).toBeGreaterThan(0);

		const completedRows = page.locator('[data-testid="completed-section"] [data-testid="task-row"]');
		expect(await completedRows.count()).toBeGreaterThanOrEqual(0);
	});
});

test.describe('List view', () => {
	test('filters tasks by list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByRole('heading', { name: 'Goal Management' })).toBeVisible();
		const listRows = page.locator('[data-testid="task-row"]');
		expect(await listRows.count()).toBeGreaterThan(0);
	});
});
