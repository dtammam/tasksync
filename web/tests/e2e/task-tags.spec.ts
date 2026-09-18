import { expect, test, type Page } from '@playwright/test';
import { updateTaskInIdb, waitForTaskInIdb } from './helpers/idb';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const resetClientState = async (page: Page) => {
	await setAuthenticatedClientState(page);
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
};

test.describe('Task tags', () => {
	test('list view groups into tag-headed sections in palette order, untagged at the bottom', async ({
		page
	}) => {
		await resetClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const untaggedTitle = makeTitle('Untagged item');
		const dairyTitle = makeTitle('Dairy item');
		const priorityTitle = makeTitle('Priority item');

		for (const title of [untaggedTitle, dairyTitle, priorityTitle]) {
			await page.getByTestId('new-task-input').fill(title);
			await page.getByTestId('new-task-submit').click();
			await waitForTaskInIdb(page, title);
		}

		// 🥛 (dairy) is defined after ⭐ (time/priority) in the palette, so its
		// section must render second even though it was tagged in this order.
		await updateTaskInIdb(page, dairyTitle, { emoji: '🥛' });
		await updateTaskInIdb(page, priorityTitle, { emoji: '⭐' });

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		// Three distinct tag states in play (⭐, 🥛, untagged) -> three sections,
		// and ⭐ (Time/priority) is defined before 🥛 (Grocery aisles) in the
		// palette, so it must render first regardless of tagging order; Untagged
		// always sorts last.
		const groupTitles = page.getByTestId('tag-group-title');
		await expect(groupTitles).toHaveCount(3);
		await expect(groupTitles.nth(0)).toContainText('⭐');
		await expect(groupTitles.nth(1)).toContainText('🥛');
		await expect(groupTitles.nth(2)).toContainText('Untagged');

		// Each row actually renders (not just its group header).
		await expect(page.getByTestId('task-title').filter({ hasText: priorityTitle })).toBeVisible();
		await expect(page.getByTestId('task-title').filter({ hasText: dairyTitle })).toBeVisible();
		await expect(
			page.getByTestId('task-title').filter({ hasText: untaggedTitle })
		).toBeVisible();
	});

	test('My Day grouping is off by default and only groups once the toggle is enabled', async ({
		page
	}) => {
		await resetClientState(page);

		const taggedTitle = makeTitle('My Day tagged');
		await page.getByTestId('new-task-input').fill(taggedTitle);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, taggedTitle);
		await updateTaskInIdb(page, taggedTitle, { emoji: '🎯', my_day: true });

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		// Off by default: no group header, even though a tagged task is present.
		await expect(page.getByTestId('tag-group-title')).toHaveCount(0);

		const toggle = page.getByTestId('myday-group-by-tag-toggle');
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');

		await expect(page.getByTestId('tag-group-title').first()).toContainText('🎯');
	});
});
