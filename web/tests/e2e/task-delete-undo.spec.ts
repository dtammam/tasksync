import { expect, test } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

test.describe('Quick delete + undo', () => {
	test('@smoke deleting a task shows an undo toast; Undo restores it, expiry commits it', async ({
		page
	}) => {
		await setAuthenticatedClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		// Add a task (stays local — the committed delete is a pure client removal).
		const title = makeTitle('Delete me');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		const row = () => page.getByTestId('task-row').filter({ hasText: title });
		await expect(row()).toHaveCount(1);

		const openDelete = async () => {
			await row().locator('button.actions-chip').click();
			await row().getByRole('button', { name: 'Delete' }).click();
		};

		// Delete → row vanishes immediately, no confirm dialog, undo toast appears.
		await openDelete();
		await expect(row()).toHaveCount(0);
		const toast = page.getByTestId('undo-delete-toast');
		await expect(toast).toBeVisible();
		await expect(toast).toContainText(title);

		// Undo → task comes back, toast dismisses.
		await page.getByTestId('undo-delete').click();
		await expect(row()).toHaveCount(1);
		await expect(toast).toBeHidden();

		// Delete again and let the grace window elapse (the toast auto-hides when the
		// delete commits) → the task stays gone.
		await openDelete();
		await expect(row()).toHaveCount(0);
		await expect(toast).toBeVisible();
		await expect(toast).toBeHidden({ timeout: 15_000 }); // grace window commits
		await expect(row()).toHaveCount(0);
	});
});
