import { expect, test, type Page } from '@playwright/test';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const addTask = async (page: Page, title: string) => {
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();
	await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
};

const row = (page: Page, title: string) =>
	page.getByTestId('task-row').filter({ hasText: title });

test.describe('Multi-select: tap-to-select + bulk tag', () => {
	test('@smoke tap a row body to select, then apply a tag to the whole selection', async ({
		page
	}) => {
		await setAuthenticatedClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const a = makeTitle('Tag A');
		const b = makeTitle('Tag B');
		const c = makeTitle('Keep C');
		for (const title of [a, b, c]) await addTask(page, title);

		await page.getByTestId('list-select-mode').click();
		await expect(page.getByTestId('bulk-select-toolbar')).toBeVisible();

		// Tap the row BODY (the title text — not the checkbox, not a button) to select.
		await row(page, a).getByTestId('task-title').click();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('1 selected');
		// Tapping again toggles it back off.
		await row(page, a).getByTestId('task-title').click();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('0 selected');

		// Select two by tapping their bodies.
		await row(page, a).getByTestId('task-title').click();
		await row(page, b).getByTestId('task-title').click();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('2 selected');

		// Open the tag picker and apply "Goal-focused" (🎯) to the selection.
		await page.getByTestId('bulk-tag').click();
		await expect(page.getByTestId('bulk-tag-panel')).toBeVisible();
		await page.getByRole('radio', { name: 'Goal-focused' }).click();

		// Both selected tasks now show the tag; the untouched one does not.
		await expect(row(page, a).getByTestId('task-emoji-indicator')).toHaveText('🎯');
		await expect(row(page, b).getByTestId('task-emoji-indicator')).toHaveText('🎯');
		await expect(row(page, c).getByTestId('task-emoji-indicator')).toHaveCount(0);

		// Selection mode has exited (apply + exit) and a confirmation is shown.
		await expect(page.getByTestId('bulk-select-toolbar')).toHaveCount(0);
		await expect(page.getByTestId('list-select-mode')).toBeVisible();
		await expect(page.getByTestId('list-action-message')).toContainText('Tagged 2 tasks 🎯');
	});

	test('@smoke Clear tag strips the tag from the selection', async ({ page }) => {
		await setAuthenticatedClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const a = makeTitle('Clear A');
		await addTask(page, a);

		// Tag it first.
		await page.getByTestId('list-select-mode').click();
		await row(page, a).getByTestId('task-title').click();
		await page.getByTestId('bulk-tag').click();
		await page.getByRole('radio', { name: 'Goal-focused' }).click();
		await expect(row(page, a).getByTestId('task-emoji-indicator')).toHaveText('🎯');

		// Re-select and Clear tag.
		await page.getByTestId('list-select-mode').click();
		await row(page, a).getByTestId('task-title').click();
		await page.getByTestId('bulk-tag').click();
		await page.getByTestId('bulk-tag-clear').click();

		await expect(row(page, a).getByTestId('task-emoji-indicator')).toHaveCount(0);
		await expect(page.getByTestId('list-action-message')).toContainText('Cleared the tag');
	});
});
