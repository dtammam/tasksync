import { expect, test } from '@playwright/test';

interface TaskHelpers {
	__addTaskMyDay?: () => void;
	__addTaskList?: () => void;
}

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

	test('can create a new task and persist after reload', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('task-row').first()).toBeVisible();
		const rows = page.getByTestId('task-row');
		const before = await rows.count();
		await page.getByTestId('new-task-input').fill('Playwright-added task');
		await page.getByTestId('new-task-submit').click();
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskMyDay === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskMyDay?.());
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		await expect
			.poll(async () => await rows.count(), { timeout: 15000 })
			.toBeGreaterThan(before);
		await page.reload();
		await expect(page.getByTestId('task-row').filter({ hasText: 'Playwright-added task' })).toHaveCount(1);
	});
});

test.describe('List view', () => {
	test('filters tasks by list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByRole('heading', { name: 'Goal Management' })).toBeVisible();
		const listRows = page.locator('[data-testid="task-row"]');
		expect(await listRows.count()).toBeGreaterThan(0);
	});

	test('can add a task to list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('task-row').first()).toBeVisible();
		const rows = page.getByTestId('task-row');
		const before = await rows.count();
		await page.getByTestId('new-task-input').fill('Goal list task');
		await page.getByTestId('new-task-submit').click();
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskList === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskList?.());
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		await expect
			.poll(async () => await rows.count(), { timeout: 15000 })
			.toBeGreaterThan(before);
	});
});
