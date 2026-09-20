import { expect, test, type Page } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const addTask = async (page: Page, title: string) => {
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();
	await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
};

const pick = (page: Page, title: string) =>
	page.getByRole('checkbox', { name: `Select "${title}"` });

test.describe('Multi-select + bulk delete', () => {
	test('@smoke list view: select two tasks, bulk-delete, Undo restores the batch', async ({
		page
	}) => {
		await setAuthenticatedClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const a = makeTitle('Bulk A');
		const b = makeTitle('Bulk B');
		const c = makeTitle('Keep C');
		for (const title of [a, b, c]) await addTask(page, title);

		// Enter selection mode → toolbar appears, the Select pill is replaced.
		await page.getByTestId('list-select-mode').click();
		await expect(page.getByTestId('bulk-select-toolbar')).toBeVisible();

		// Pick two of the three.
		await pick(page, a).check();
		await pick(page, b).check();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('2 selected');

		// Bulk delete → the two picked rows vanish, the third stays.
		await page.getByTestId('bulk-delete').click();
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: c })).toHaveCount(1);

		// A single batched undo toast, not two single toasts.
		const toast = page.getByTestId('undo-delete-batch-toast');
		await expect(toast).toBeVisible();
		await expect(toast).toContainText('Deleted 2 tasks');

		// Undo restores both; selection mode has exited (Select pill is back).
		await page.getByTestId('undo-delete-batch').click();
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(1);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(1);
		await expect(toast).toBeHidden();
		await expect(page.getByTestId('list-select-mode')).toBeVisible();
	});

	test('@smoke My Day: bulk-delete commits after the grace window elapses', async ({ page }) => {
		await setAuthenticatedClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const a = makeTitle('Day A');
		const b = makeTitle('Day B');
		for (const title of [a, b]) await addTask(page, title);

		await page.getByTestId('myday-select-mode').click();
		await page.getByTestId('bulk-select-all').click(); // select all eligible
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('2 selected');

		await page.getByTestId('bulk-delete').click();
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(0);

		// Let the grace window commit; the toast auto-hides and the tasks stay gone.
		const toast = page.getByTestId('undo-delete-batch-toast');
		await expect(toast).toBeVisible();
		await expect(toast).toBeHidden({ timeout: 15_000 });
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(0);
	});
});
