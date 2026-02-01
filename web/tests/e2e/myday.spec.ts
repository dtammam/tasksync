import { expect, test, type Page } from '@playwright/test';

interface TaskHelpers extends Window {
	__addTaskMyDay?: () => void;
	__addTaskList?: () => void;
}

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const resetClientState = async (page: Page) => {
	await page.goto('/');
	await page.evaluate(async () => {
		await new Promise<void>((resolve) => {
			const req = indexedDB.deleteDatabase('tasksync');
			req.onsuccess = () => resolve();
			req.onerror = () => resolve();
			req.onblocked = () => resolve();
		});
		localStorage.clear();
		sessionStorage.clear();
	});
	await page.reload();
};

test.describe('My Day', () => {
	test('shows tasks and moves to completed when toggled', async ({ page }) => {
		await resetClientState(page);
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const title = makeTitle('Playwright seed');
		await page.getByTestId('new-task-input').fill(title);
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskMyDay === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskMyDay?.());
		const seedRow = page.getByTestId('task-row').filter({ hasText: title });
		await expect(seedRow).toHaveCount(1);

		await seedRow.getByTestId('task-toggle').click();
		const completedRows = page
			.locator('[data-testid="completed-section"] [data-testid="task-row"]')
			.filter({ hasText: 'Playwright seed' });
		await expect(completedRows).toHaveCount(1);
	});

	test('can create a new task and persist after reload', async ({ page }) => {
		await resetClientState(page);
		const title = makeTitle('Playwright-added task');
		await page.getByTestId('new-task-input').fill(title);
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskMyDay === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskMyDay?.());
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		const rows = page.getByTestId('task-row');
		await expect(rows.filter({ hasText: title })).toHaveCount(1);
		await page.reload();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});
});

test.describe('List view', () => {
	test('filters tasks by list', async ({ page }) => {
		await resetClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByRole('heading', { name: 'Goal Management' })).toBeVisible();

		const title = makeTitle('List seed task');
		await page.getByTestId('new-task-input').fill(title);
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskList === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskList?.());
		const listRows = page.locator('[data-testid="task-row"]');
		await expect(listRows.filter({ hasText: title })).toHaveCount(1);
	});

	test('can add a task to list', async ({ page }) => {
		await resetClientState(page);
		await page.goto('/list/goal-management');
		const title = makeTitle('Goal list task');
		await page.getByTestId('new-task-input').fill(title);
		await page.waitForFunction(() => typeof (window as TaskHelpers).__addTaskList === 'function');
		await page.evaluate(() => (window as TaskHelpers).__addTaskList?.());
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});
});
