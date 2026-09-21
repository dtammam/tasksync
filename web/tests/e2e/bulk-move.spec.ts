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

test.describe('Multi-select + bulk move', () => {
	test('@smoke list view: select two tasks, move them to another list', async ({ page }) => {
		await setAuthenticatedClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		const a = makeTitle('Move A');
		const b = makeTitle('Move B');
		const c = makeTitle('Stay C');
		for (const title of [a, b, c]) await addTask(page, title);

		// Enter selection mode and pick two of the three.
		await page.getByTestId('list-select-mode').click();
		await expect(page.getByTestId('bulk-select-toolbar')).toBeVisible();
		await pick(page, a).check();
		await pick(page, b).check();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('2 selected');

		// Open the move picker; the source list ('goal-management') is not a target.
		await page.getByTestId('bulk-move').click();
		await expect(page.getByTestId('bulk-move-panel')).toBeVisible();
		await expect(
			page.locator('[data-testid="bulk-move-target"][data-list-id="goal-management"]')
		).toHaveCount(0);

		// Move to "Tasks".
		await page.locator('[data-testid="bulk-move-target"][data-list-id="tasks"]').click();

		// The two picked rows leave the source list; the third stays; selection exits.
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: c })).toHaveCount(1);
		await expect(page.getByTestId('list-action-message')).toContainText('Moved 2 tasks to Tasks');
		await expect(page.getByTestId('list-select-mode')).toBeVisible();

		// They now appear in the target list.
		await page.goto('/list/tasks');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(1);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(1);
	});

	test('@smoke My Day: select all, move to a list, tasks land there and leave their source list', async ({
		page
	}) => {
		await setAuthenticatedClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});

		// Tasks added from My Day land in the default list (goal-management) and
		// show in My Day via the my_day flag — moving them changes list_id only,
		// so they stay in My Day; we assert the move by their list membership.
		const a = makeTitle('MyDay Move A');
		const b = makeTitle('MyDay Move B');
		for (const title of [a, b]) await addTask(page, title);

		await page.getByTestId('myday-select-mode').click();
		await page.getByTestId('bulk-select-all').click();
		await expect(page.getByTestId('bulk-selected-count')).toHaveText('2 selected');

		// Move to "Tasks". My Day spans lists, so the picker excludes only my-day.
		await page.getByTestId('bulk-move').click();
		await expect(page.getByTestId('bulk-move-panel')).toBeVisible();
		await page.locator('[data-testid="bulk-move-target"][data-list-id="tasks"]').click();

		// Selection exits (the Select pill returns).
		await expect(page.getByTestId('myday-select-mode')).toBeVisible();

		// They now belong to the target list…
		await page.goto('/list/tasks');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(1);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(1);

		// …and no longer sit in their original list.
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
		await expect(page.getByTestId('task-row').filter({ hasText: a })).toHaveCount(0);
		await expect(page.getByTestId('task-row').filter({ hasText: b })).toHaveCount(0);
	});
});
