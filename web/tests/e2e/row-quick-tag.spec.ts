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

const openList = async (page: Page) => {
	await setAuthenticatedClientState(page);
	await page.goto('/list/goal-management');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
};

test.describe('Row quick tag', () => {
	test('@smoke chip -> pick tags the task; emoji -> Clear tag removes it; survives reload', async ({
		page
	}) => {
		await openList(page);
		const title = makeTitle('Quick tag');
		await addTask(page, title);

		await row(page, title).getByTestId('task-tag-chip').click();
		await expect(row(page, title).getByTestId('task-tag-picker')).toBeVisible();
		await page.getByRole('radio', { name: 'Goal-focused' }).click();

		await expect(row(page, title).getByTestId('task-emoji-indicator')).toHaveText('🎯');
		await expect(row(page, title).getByTestId('task-tag-picker')).toHaveCount(0);
		await expect(row(page, title).getByTestId('task-tag-chip')).toHaveCount(0);

		await page.reload();
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(row(page, title).getByTestId('task-emoji-indicator')).toHaveText('🎯');

		await row(page, title).getByTestId('task-emoji-indicator').click();
		await expect(page.getByRole('radio', { name: 'Goal-focused' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		await row(page, title).getByTestId('task-tag-clear').click();
		await expect(row(page, title).getByTestId('task-emoji-indicator')).toHaveCount(0);

		await page.reload();
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(row(page, title)).toHaveCount(1);
		await expect(row(page, title).getByTestId('task-emoji-indicator')).toHaveCount(0);
	});

	test('@smoke in selection mode the chip edits the tag and does not change the selection', async ({
		page
	}) => {
		await openList(page);
		const title = makeTitle('Select tag');
		await addTask(page, title);

		await page.getByTestId('list-select-mode').click();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('0 selected');

		await row(page, title).getByTestId('task-tag-chip').click();
		await expect(row(page, title).getByTestId('task-tag-picker')).toBeVisible();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('0 selected');

		await page.getByRole('radio', { name: 'Goal-focused' }).click();
		await expect(row(page, title).getByTestId('task-emoji-indicator')).toHaveText('🎯');
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('0 selected');

		await row(page, title).getByTestId('task-emoji-indicator').click();
		await expect(row(page, title).getByTestId('task-tag-picker')).toBeVisible();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('0 selected');
	});
});
