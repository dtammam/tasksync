import { expect, test } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

test.describe('List Check all / Uncheck all', () => {
	test('@smoke Check all completes a list’s pending tasks; Uncheck all reverses it', async ({
		page
	}) => {
		await setAuthenticatedClientState(page);
		// A built-in seed list exists without any sync.
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const checkAll = page.getByTestId('list-check-all');
		const uncheckAll = page.getByTestId('list-uncheck-all');

		// Add two pending tasks (local — no sync needed).
		const a = makeTitle('Check A');
		const b = makeTitle('Check B');
		for (const title of [a, b]) {
			await page.getByTestId('new-task-input').fill(title);
			await page.getByTestId('new-task-submit').click();
			await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
		}

		// With pending tasks, Check all is enabled and Uncheck all is disabled.
		await expect(checkAll).toBeEnabled();
		await expect(uncheckAll).toBeDisabled();

		// Check all → both tasks complete; button state flips.
		await checkAll.click();
		await expect(checkAll).toBeDisabled(); // no pending left
		await expect(uncheckAll).toBeEnabled(); // now there are completed tasks
		// Both tasks still exist (now completed), not deleted.
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(1);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(1);

		// Uncheck all reverses it → back to pending.
		await uncheckAll.click();
		await expect(uncheckAll).toBeDisabled();
		await expect(checkAll).toBeEnabled();
	});
});
