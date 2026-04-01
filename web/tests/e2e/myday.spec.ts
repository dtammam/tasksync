import { expect, test, type Page } from '@playwright/test';
import { waitForTaskInIdb, readTaskFromIdb, updateTaskInIdb } from './helpers/idb';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;
const toLocalIsoDate = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDaysLocalIso = (days: number) => {
	const value = new Date();
	value.setDate(value.getDate() + days);
	return toLocalIsoDate(value);
};


const ensureSoundPanelOpen = async (page: Page) => {
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
	const soundEnabled = page.getByTestId('sound-enabled');
	if (await soundEnabled.count()) {
		return;
	}
	const openSettings = page.getByTestId('settings-open');
	const soundSection = page.getByTestId('settings-section-sound');
	await expect
		.poll(
			async () =>
				(await soundEnabled.count()) +
				(await openSettings.count()) +
				(await page.getByTestId('settings-window').count()),
			{ timeout: 10_000 }
		)
		.toBeGreaterThan(0);
	if (await soundEnabled.count()) {
		return;
	}
	if (!(await page.getByTestId('settings-window').count())) {
		await expect(openSettings.first()).toBeVisible();
		await openSettings.first().scrollIntoViewIfNeeded();
		await openSettings.first().click();
	}
	await expect(soundSection.first()).toBeVisible();
	await soundSection.first().click();
	await expect(soundEnabled).toHaveCount(1);
};

const resetClientState = async (page: Page) => {
	await page.addInitScript(() => {
		// Keep e2e deterministic: signed-out token mode disables live server sync for this suite.
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
};

const seedSuggestions = async (page: Page) => {
	await page.goto('/list/goal-management');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

	const title = makeTitle('Suggestion seed');
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();

	const row = page.getByTestId('task-row').filter({ hasText: title });
	await expect(row).toHaveCount(1);
	await row.getByRole('button', { name: '⋯' }).click();
	await page.getByRole('button', { name: 'Star' }).click();
	// Star now auto-closes the shelf; no manual Close click needed.

	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
	const suggestionsButton = page.getByRole('button', { name: /^Suggestions \d+/ });
	await expect(suggestionsButton).toBeVisible();
	return suggestionsButton;
};

test.describe('My Day', () => {
	test.beforeEach(async ({ page }) => { await resetClientState(page); });

	test('@smoke shows tasks and moves to completed when toggled', async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

		const title = makeTitle('Playwright seed');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		const seedRow = page.getByTestId('task-row').filter({ hasText: title });
		await expect(seedRow).toHaveCount(1);

		const toggle = seedRow.getByTestId('task-toggle');
		await toggle.click();
		await expect(toggle).toHaveAttribute('data-acknowledged', 'true');
		const completedRows = page
			.locator('[data-testid="completed-section"] [data-testid="task-row"]')
			.filter({ hasText: title });
		await expect(completedRows).toHaveCount(1);
	});

	test('@smoke can create a new task and persist after reload', async ({ page }) => {
		const title = makeTitle('Playwright-added task');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		const rows = page.getByTestId('task-row');
		await expect(rows.filter({ hasText: title })).toHaveCount(1);
		await waitForTaskInIdb(page, title);
		await page.reload();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});

	test('@smoke persists first detail save deterministically with recurrence and My Day button state', async ({
		page
	}) => {
		const title = makeTitle('Detail persist');
		const notes = `Detail notes ${Math.random().toString(36).slice(2, 6)}`;
		const today = addDaysLocalIso(0);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();

		// Task was created via quickAdd which calls setDueToday — badge should show
		const myDayBadge = page.getByTestId('detail-myday-badge');
		await expect(myDayBadge).toHaveText('In My Day');
		await expect(page.getByLabel('Due date')).toHaveValue(today);

		await page.getByLabel('Recurrence').selectOption('weekly');
		await page.getByLabel('Notes').fill(notes);
		await page.getByRole('button', { name: 'Save' }).click();

		await expect.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null).toBe(today);
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.recurrence_id ?? null).toBe(
			'weekly'
		);
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.my_day ?? null).toBe(false);
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.notes ?? null).toBe(notes);

		await page.reload();
		const reloadedRow = page.getByTestId('task-row').filter({ hasText: title });
		await expect(reloadedRow).toHaveCount(1);
		await reloadedRow.getByRole('button', { name: '⋯' }).click();
		await reloadedRow.getByRole('button', { name: 'Details' }).click();
		await expect(page.getByTestId('detail-myday-badge')).toHaveText('In My Day');
		await expect(page.getByLabel('Due date')).toHaveValue(today);
		await expect(page.getByLabel('Recurrence')).toHaveValue('weekly');
		await expect(page.getByLabel('Notes')).toHaveValue(notes);
		await page.getByRole('button', { name: '×' }).click();
	});

	test('@smoke can select last day of month recurrence and persists to IDB', async ({ page }) => {
		const title = makeTitle('LDM recur');

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();

		await page.getByLabel('Recurrence').selectOption('lastDayOfMonth');
		await page.getByRole('button', { name: 'Save' }).click();

		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.recurrence_id ?? null)
			.toBe('lastDayOfMonth');
	});

	test('shows Marked Done state in details immediately after status toggle', async ({ page }) => {
		const title = makeTitle('Detail mark done');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();

		const statusToggle = page.locator('button.status-toggle').first();
		await expect(statusToggle).toHaveText('Mark Done');
		await statusToggle.click();
		await expect(statusToggle).toHaveText('Marked Done');
		await expect(statusToggle).toHaveClass(/active/);
		await page.getByRole('button', { name: '×' }).click();
	});

	test('keeps alphabetical sort mode and direction after reload', async ({ page }) => {
		const marker = makeTitle('Sort marker');
		const titleB = `${marker} B`;
		const titleA = `${marker} A`;

		await page.getByTestId('new-task-input').fill(titleB);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(titleA);
		await page.getByTestId('new-task-submit').click();

		await page.getByLabel('Sort tasks').selectOption('alpha');
		await page.getByLabel('Sort direction').selectOption('desc');
		await expect(page.getByLabel('Sort tasks')).toHaveValue('alpha');
		await expect(page.getByLabel('Sort direction')).toHaveValue('desc');
		const plannedSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Planned' }),
		});
		const plannedRows = plannedSection.getByTestId('task-row');
		const sortedRows = plannedRows.filter({ hasText: marker });
		await expect(sortedRows).toHaveCount(2);
		await expect(sortedRows.nth(0)).toContainText(titleB);

		await page.reload();
		await expect(page.getByLabel('Sort tasks')).toHaveValue('alpha');
		await expect(page.getByLabel('Sort direction')).toHaveValue('desc');
		await expect(
			plannedSection.getByTestId('task-row').filter({ hasText: marker }).nth(0)
		).toContainText(titleB);
	});

	test('persists sound settings changes across reload', async ({ page }) => {
		await ensureSoundPanelOpen(page);
		await expect(page.getByTestId('sound-enabled')).toBeChecked();

		await page.getByTestId('sound-enabled').uncheck();
		await page.getByTestId('sound-theme').selectOption('wood_tick');
		await page.getByTestId('sound-volume').evaluate((el) => {
			const input = el as HTMLInputElement;
			input.value = '25';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect.poll(() =>
			page.evaluate(() => {
				const stored = localStorage.getItem('tasksync:sound-settings');
				if (!stored) return null;
				try {
					return (JSON.parse(stored) as { volume?: number }).volume ?? null;
				} catch {
					return null;
				}
			})
		).toBe(25);
		await page.reload();
		await ensureSoundPanelOpen(page);

		await expect(page.getByTestId('sound-enabled')).not.toBeChecked();
		await expect(page.getByTestId('sound-theme')).toHaveValue('wood_tick');
		await expect(page.getByTestId('sound-volume')).toHaveValue('25');
	});

	test('keeps recurring cadence when punting only a single scheduled instance', async ({ page }) => {
		const title = makeTitle('Punt recurrence');
		const today = addDaysLocalIso(0);
		const tomorrow = addDaysLocalIso(1);
		const nextWeek = addDaysLocalIso(7);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		const openTaskActions = async () => {
			const row = page.getByTestId('task-row').filter({ hasText: title });
			await expect(row).toHaveCount(1);
			await row.getByRole('button', { name: '⋯' }).click();
		};
		const openTaskDetails = async () => {
			await openTaskActions();
			await page.getByRole('button', { name: 'Details' }).first().click();
		};

		await openTaskDetails();
		await page.getByLabel('Due date').fill(today);
		await page.getByLabel('Recurrence').selectOption('weekly');
		await page.getByRole('button', { name: 'Save' }).click();

		await openTaskDetails();
		const puntToggle = page.getByTestId('detail-punt-toggle');
		await expect(puntToggle).toHaveText(/Punt/);
		await expect(puntToggle).toBeEnabled();
		await puntToggle.click();
		await expect(puntToggle).toHaveText(/Punted/);
		await expect(puntToggle).toBeDisabled();
		await page.getByRole('button', { name: '×' }).click();
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null)
			.toBe(tomorrow);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_from_due_date ?? null)
			.toBe(today);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_on_date ?? null)
			.toBe(today);
		await expect(
			page.locator('[data-testid="completed-section"] [data-testid="task-row"]').filter({ hasText: title })
		).toHaveCount(1);
		await expect(
			page.locator('[data-testid="completed-section"] [data-testid="task-row"]').filter({ hasText: title }).getByTestId('task-punt-indicator')
		).toHaveCount(1);

		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		const row = page.getByTestId('task-row').filter({ hasText: title });
		await row.getByTestId('task-toggle').click();
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null)
			.toBe(nextWeek);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_from_due_date ?? null)
			.toBe(null);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_on_date ?? null)
			.toBe(null);
	});

	test('does not offer punt for daily recurrence tasks', async ({ page }) => {
		const title = makeTitle('Daily no punt');
		const today = addDaysLocalIso(0);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();
		await page.getByLabel('Due date').fill(today);
		await page.getByLabel('Recurrence').selectOption('daily');
		await expect(page.getByTestId('detail-punt-toggle')).toHaveCount(0);
		await page.getByRole('button', { name: 'Save' }).click();

		await row.getByRole('button', { name: '⋯' }).click();
		await expect(row.getByRole('button', { name: 'Punt' })).toHaveCount(0);
	});

	test('shows punt indicator when a task lands on today from a previous-day punt', async ({ page }) => {
		const title = makeTitle('Punt marker');
		const today = addDaysLocalIso(0);
		const yesterday = addDaysLocalIso(-1);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		const wasUpdated = await updateTaskInIdb(page, title, {
			due_date: today,
			punted_from_due_date: yesterday,
			punted_on_date: yesterday
		});
		expect(wasUpdated).toBe(true);

		await page.reload();
		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId('task-punt-indicator')).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();
		await expect(page.getByTestId('detail-punt-indicator')).toContainText(yesterday);
	});

	test('keeps starred tasks at top in My Day sorting', async ({ page }) => {
		const marker = makeTitle('MyDay star sort');
		const titleA = `${marker} A`;
		const titleB = `${marker} B`;

		await page.getByTestId('new-task-input').fill(titleA);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(titleB);
		await page.getByTestId('new-task-submit').click();

		const rowB = page.getByTestId('task-row').filter({ hasText: titleB });
		await rowB.getByRole('button', { name: '⋯' }).click();
		await rowB.getByRole('button', { name: 'Star' }).click();
		await expect(rowB.getByTestId('task-star-indicator')).toHaveCount(1);

		await page.getByLabel('Sort tasks').selectOption('created');
		await page.getByLabel('Sort direction').selectOption('asc');
		const plannedSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Planned' }),
		});
		const markerRows = plannedSection.getByTestId('task-row').filter({ hasText: marker });
		await expect(markerRows.first()).toContainText(titleB);

		await page.getByLabel('Sort tasks').selectOption('alpha');
		await page.getByLabel('Sort direction').selectOption('asc');
		await expect(markerRows.first()).toContainText(titleB);
	});

	test('completing last pending My Day non-recurring task triggers day-complete', async ({
		page
	}) => {
		// Enable streak before page load so hydrateFromLocal picks it up
		await page.addInitScript(() => {
			localStorage.setItem(
				'tasksync:ui-preferences:anon',
				JSON.stringify({
					theme: 'default',
					font: 'sora',
					completionQuotes: [],
					sidebarPanels: {
						lists: false,
						members: false,
						sound: false,
						backups: false,
						account: true
					},
					listSort: { mode: 'created', direction: 'asc' },
					streakSettings: { enabled: true, theme: 'ddr', resetMode: 'daily' }
				})
			);
		});

		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const title = makeTitle('Day complete trigger');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);

		// Complete the task — it is the only pending My Day task and has no recurrence
		await page
			.getByTestId('task-row')
			.filter({ hasText: title })
			.getByTestId('task-toggle')
			.click();

		// day-complete fires once and writes dayCompleteDate into the prefs blob
		await expect
			.poll(() =>
				page.evaluate(() => {
					const raw = localStorage.getItem('tasksync:ui-preferences:anon');
					if (!raw) return null;
					try {
						const blob = JSON.parse(raw) as {
							streakState?: { dayCompleteDate?: string };
						};
						return blob.streakState?.dayCompleteDate ?? null;
					} catch {
						return null;
					}
				})
			)
			.toBeTruthy();
	});
});

test.describe('List view', () => {
	test.beforeEach(async ({ page }) => { await resetClientState(page); });

	test('filters tasks by list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByRole('heading', { name: 'Goal Management' })).toBeVisible();

		const title = makeTitle('List seed task');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		const listRows = page.locator('[data-testid="task-row"]');
		await expect(listRows.filter({ hasText: title })).toHaveCount(1);
	});

	test('can add a task to list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		const title = makeTitle('Goal list task');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('new-task-input')).toHaveValue('');
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});

	test('supports due-date sort with asc/desc order and keeps preference after reload', async ({
		page,
	}) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const marker = makeTitle('List due sort');
		const noDueTitle = `${marker} No due`;
		const dueSoonTitle = `${marker} Due soon`;
		const dueLaterTitle = `${marker} Due later`;

		await page.getByTestId('new-task-input').fill(noDueTitle);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(dueSoonTitle);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(dueLaterTitle);
		await page.getByTestId('new-task-submit').click();

		const openTaskMenu = async (title: string) => {
			const row = page.getByTestId('task-row').filter({ hasText: title });
			await expect(row).toHaveCount(1);
			await row.getByRole('button', { name: '⋯' }).click();
			return row;
		};

		await openTaskMenu(dueSoonTitle);
		await page.getByRole('button', { name: 'Tomorrow' }).click();

		await openTaskMenu(dueLaterTitle);
		await page.getByRole('button', { name: 'Next week' }).click();

		await page.getByTestId('list-sort-mode').selectOption('due_date');
		await page.getByTestId('list-sort-direction').selectOption('asc');

		const pendingSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Pending' }),
		});
		const pendingRows = pendingSection.getByTestId('task-row').filter({ hasText: marker });
		await expect(pendingRows).toHaveCount(3);
		await expect(pendingRows.nth(0)).toContainText(dueSoonTitle);
		await expect(pendingRows.nth(1)).toContainText(dueLaterTitle);
		await expect(pendingRows.nth(2)).toContainText(noDueTitle);

		await page.getByTestId('list-sort-direction').selectOption('desc');
		await expect(pendingRows.nth(0)).toContainText(dueLaterTitle);
		await expect(pendingRows.nth(1)).toContainText(dueSoonTitle);
		await expect(pendingRows.nth(2)).toContainText(noDueTitle);

		await page.reload();
		await expect(page.getByTestId('list-sort-mode')).toHaveValue('due_date');
		await expect(page.getByTestId('list-sort-direction')).toHaveValue('desc');
		await expect(pendingRows.nth(0)).toContainText(dueLaterTitle);
		await expect(pendingRows.nth(1)).toContainText(dueSoonTitle);
		await expect(pendingRows.nth(2)).toContainText(noDueTitle);
	});

	test('shows starred indicator and keeps starred tasks at top for created/alpha sorting', async ({
		page,
	}) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const marker = makeTitle('Star sort');
		const titleA = `${marker} A`;
		const titleB = `${marker} B`;

		await page.getByTestId('new-task-input').fill(titleA);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(titleB);
		await page.getByTestId('new-task-submit').click();

		const rowB = page.getByTestId('task-row').filter({ hasText: titleB });
		await expect(rowB).toHaveCount(1);
		await rowB.getByRole('button', { name: '⋯' }).click();
		await rowB.getByRole('button', { name: 'Star' }).click();
		await expect(rowB.getByTestId('task-star-indicator')).toHaveCount(1);

		// Star auto-closes the shelf; re-open it to access Details.
		await rowB.getByRole('button', { name: '⋯' }).click();
		await rowB.getByRole('button', { name: 'Details' }).click();
		const detailStarToggle = page.getByTestId('detail-star-toggle');
		await expect(detailStarToggle).toHaveText(/Starred/);
		await expect(detailStarToggle).toHaveClass(/active/);
		await page.getByRole('button', { name: '×' }).click();

		const pendingSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Pending' }),
		});
		const markerRows = pendingSection.getByTestId('task-row').filter({ hasText: marker });

		await page.getByTestId('list-sort-mode').selectOption('created');
		await page.getByTestId('list-sort-direction').selectOption('asc');
		await expect(markerRows.first()).toContainText(titleB);

		await page.getByTestId('list-sort-mode').selectOption('alpha');
		await page.getByTestId('list-sort-direction').selectOption('asc');
		await expect(markerRows.first()).toContainText(titleB);
	});

	test('imports plain text and Joplin-style markdown tasks into the active list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const marker = makeTitle('Import list');
		const pendingOne = `${marker} Milk`;
		const completedOne = `${marker} Eggs`;
		const pendingTwo = `${marker} Bread`;

		await page.getByTestId('new-task-input').fill(pendingOne);
		await page.getByTestId('new-task-submit').click();
		const existingRow = page.getByTestId('task-row').filter({ hasText: pendingOne });
		await existingRow.getByTestId('task-toggle').click();
		await expect(
			page
				.locator('[data-testid="completed-section"] [data-testid="task-row"]')
				.filter({ hasText: pendingOne })
		).toHaveCount(1);

		await page.getByTestId('list-import-open').click();
		await expect(page.getByTestId('list-import-modal')).toBeVisible();
		await page.getByTestId('list-import-input').fill(
			`- [ ] ${pendingOne}\n- [x] ${completedOne}\n${pendingTwo}\n- [ ] ${pendingOne}`
		);
		await page.getByTestId('list-import-apply').click();
		await expect(page.getByTestId('list-import-modal')).toHaveCount(0);
		await expect(page.getByTestId('list-action-message')).toContainText(
			'Imported 2 tasks, reopened 1 duplicate, skipped 2 duplicates.'
		);

		const pendingSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Pending' }),
		});
		await expect(pendingSection.getByTestId('task-row').filter({ hasText: pendingOne })).toHaveCount(1);
		await expect(pendingSection.getByTestId('task-row').filter({ hasText: pendingTwo })).toHaveCount(1);
		await expect(
			page
				.locator('[data-testid="completed-section"] [data-testid="task-row"]')
				.filter({ hasText: completedOne })
		).toHaveCount(1);
	});

	test('unchecks all completed tasks in the current list', async ({ page }) => {
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const marker = makeTitle('Uncheck all');
		const firstTitle = `${marker} A`;
		const secondTitle = `${marker} B`;

		await page.getByTestId('new-task-input').fill(firstTitle);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(secondTitle);
		await page.getByTestId('new-task-submit').click();

		const pendingSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Pending' }),
		});
		const completedSectionRows = page
			.locator('[data-testid="completed-section"] [data-testid="task-row"]');

		const firstPendingRow = pendingSection.getByTestId('task-row').filter({ hasText: firstTitle });
		await expect(firstPendingRow).toHaveCount(1);
		await firstPendingRow.getByTestId('task-toggle').click();
		await expect(completedSectionRows.filter({ hasText: firstTitle })).toHaveCount(1);

		const secondPendingRow = pendingSection.getByTestId('task-row').filter({ hasText: secondTitle });
		await expect(secondPendingRow).toHaveCount(1);
		await secondPendingRow.getByTestId('task-toggle').click();
		await expect(completedSectionRows.filter({ hasText: secondTitle })).toHaveCount(1);

		await expect(
			completedSectionRows.filter({ hasText: marker })
		).toHaveCount(2);

		await page.getByTestId('list-uncheck-all').click();
		await expect(page.getByTestId('list-action-message')).toContainText('Unchecked 2 completed tasks.');
		await expect(completedSectionRows.filter({ hasText: marker })).toHaveCount(0);

		await expect(pendingSection.getByTestId('task-row').filter({ hasText: marker })).toHaveCount(2);
	});
});

test.describe('My Day button', () => {
	test.beforeEach(async ({ page }) => { await resetClientState(page); });

	test('@smoke My Day button on task row sets due_date to today', async ({ page }) => {
		const title = makeTitle('MyDay btn row');
		const today = addDaysLocalIso(0);

		// Create task on My Day page (quickAdd sets due_date = today), then clear it
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, { due_date: undefined, my_day: false });

		// Navigate to list view where the My Day button is visible
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);

		const myDayBtn = row.getByTestId('task-myday-btn');
		await expect(myDayBtn).toBeVisible();
		await myDayBtn.click();

		await expect.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null).toBe(today);
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.my_day ?? null).toBe(false);

		// Verify button disappears (task now due today)
		await expect(row.getByTestId('task-myday-btn')).toHaveCount(0);

		// Verify persists after reload
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});

	test('My Day button hidden when task already due today', async ({ page }) => {
		const title = makeTitle('MyDay btn hidden');

		// quickAdd sets due_date = today
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);

		// Navigate to list view (My Day button only rendered in list views)
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId('task-myday-btn')).toHaveCount(0);
	});

	test('My Day button in drawer fires immediately and saves due_date', async ({ page }) => {
		const title = makeTitle('MyDay drawer');
		const today = addDaysLocalIso(0);

		// Create task and clear its due date
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, { due_date: undefined, my_day: false });

		// Navigate to list view to see the task
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByRole('button', { name: '⋯' }).click();
		await row.getByRole('button', { name: 'Details' }).click();

		const toggle = page.getByTestId('detail-myday-toggle');
		await expect(toggle).toHaveText('Add to My Day');
		await expect(page.getByLabel('Due date')).toHaveValue('');

		await toggle.click();
		// Due field should immediately update
		await expect(page.getByLabel('Due date')).toHaveValue(today);

		await page.getByRole('button', { name: 'Save' }).click();

		await expect.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null).toBe(today);
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.my_day ?? null).toBe(false);
	});

	test('legacy my_day: true task without due_date still shows in My Day', async ({ page }) => {
		const title = makeTitle('MyDay legacy');

		// Create task and patch to legacy state (my_day: true, no due_date)
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, { due_date: undefined, my_day: true });
		await page.reload();

		// Should still appear in My Day Pending (inMyDay returns true for my_day: true)
		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);

		// In list view, My Day button should NOT be shown (already in My Day via legacy flag)
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		const listRow = page.getByTestId('task-row').filter({ hasText: title });
		await expect(listRow).toHaveCount(1);
		await expect(listRow.getByTestId('task-myday-btn')).toHaveCount(0);
	});
});

test.describe('Catch Up', () => {
	test.beforeEach(async ({ page }) => { await resetClientState(page); });

	test('@smoke Catch Up advances missed recurring task past today', async ({ page }) => {
		const title = makeTitle('CatchUp smoke');
		const yesterday = addDaysLocalIso(-1);
		const tomorrow = addDaysLocalIso(1);

		// Create task on My Day page
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);

		// Patch to missed daily recurring task
		await updateTaskInIdb(page, title, { due_date: yesterday, recurrence_id: 'daily', my_day: false });
		await page.reload();

		// Should be in missed section with catch-up chip
		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		const catchUpBtn = row.getByTestId('task-catchup');
		await expect(catchUpBtn).toBeVisible();

		await catchUpBtn.click();

		// Should advance to tomorrow (next daily after today)
		await expect.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null).toBe(
			tomorrow
		);

		// Verify persistence: task with due_date=tomorrow won't be on My Day, check from list view
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		const listRow = page.getByTestId('task-row').filter({ hasText: title });
		await expect(listRow).toHaveCount(1);
		await expect(listRow.getByTestId('task-catchup')).toHaveCount(0);
	});

	test('Catch Up not shown for non-recurring missed task', async ({ page }) => {
		const title = makeTitle('CatchUp nonrecur');
		const yesterday = addDaysLocalIso(-1);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, { due_date: yesterday, my_day: false });
		await page.reload();

		// Non-recurring missed task appears in Missed section but without Catch Up
		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId('task-catchup')).toHaveCount(0);
	});

	test('Catch Up clears punt state', async ({ page }) => {
		const title = makeTitle('CatchUp punt');
		const yesterday = addDaysLocalIso(-1);
		const twoDaysAgo = addDaysLocalIso(-2);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, {
			due_date: yesterday,
			recurrence_id: 'daily',
			my_day: false,
			punted_from_due_date: twoDaysAgo,
			punted_on_date: yesterday
		});
		await page.reload();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		const catchUpBtn = row.getByTestId('task-catchup');
		await expect(catchUpBtn).toBeVisible();
		await catchUpBtn.click();

		await expect
			.poll(async () => {
				const task = await readTaskFromIdb(page, title);
				return task?.punted_from_due_date ?? null;
			})
			.toBeNull();
		await expect
			.poll(async () => {
				const task = await readTaskFromIdb(page, title);
				return task?.punted_on_date ?? null;
			})
			.toBeNull();
	});

	test('Catch Up does not increment occurrences_completed', async ({ page }) => {
		const title = makeTitle('CatchUp occ');
		const yesterday = addDaysLocalIso(-1);

		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, {
			due_date: yesterday,
			recurrence_id: 'daily',
			my_day: false,
			occurrences_completed: 5
		});
		await page.reload();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);
		await row.getByTestId('task-catchup').click();

		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.occurrences_completed ?? null)
			.toBe(5);
	});
});

test.describe('Navigation', () => {
	test.beforeEach(async ({ page }) => { await resetClientState(page); });

	test('hides suggestions button while settings modal is open', async ({ page }) => {
		const suggestionsButton = await seedSuggestions(page);
		await expect(suggestionsButton).toBeVisible();

		await page.getByTestId('settings-open').click();
		await expect(page.getByTestId('settings-window')).toBeVisible();
		await expect(suggestionsButton).toBeHidden();

		await page
			.getByTestId('settings-window')
			.getByRole('button', { name: 'Close', exact: true })
			.click();
		await expect(page.getByTestId('settings-window')).toHaveCount(0);
		await expect(suggestionsButton).toBeVisible();
	});

	test('hides suggestions button while mobile sidebar drawer is open', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const suggestionsButton = await seedSuggestions(page);
		await expect(suggestionsButton).toBeVisible();

		await page.getByRole('button', { name: 'Toggle navigation' }).click();
		await expect(page.getByTestId('sidebar-drawer')).toHaveClass(/open/);
		await expect(suggestionsButton).toBeHidden();

		await page.getByRole('button', { name: 'Close navigation' }).dispatchEvent('click');
		await expect(page.getByTestId('sidebar-drawer')).not.toHaveClass(/open/);
		await expect(suggestionsButton).toBeVisible();
	});

	test('hides add button while settings modal is open', async ({ page }) => {
		const addInput = page.getByTestId('new-task-input');
		const addButton = page.getByTestId('new-task-submit');
		await expect(addInput).toBeVisible();
		await expect(addButton).toBeVisible();

		await page.getByTestId('settings-open').click();
		await expect(page.getByTestId('settings-window')).toBeVisible();
		await expect(addInput).toBeHidden();
		await expect(addButton).toBeHidden();

		await page
			.getByTestId('settings-window')
			.getByRole('button', { name: 'Close', exact: true })
			.click();
		await expect(page.getByTestId('settings-window')).toHaveCount(0);
		await expect(addInput).toBeVisible();
		await expect(addButton).toBeVisible();
	});

	test('hides add field and button while mobile sidebar drawer is open', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const addInput = page.getByTestId('new-task-input');
		const addButton = page.getByTestId('new-task-submit');
		await expect(addInput).toBeVisible();
		await expect(addButton).toBeVisible();

		await page.getByRole('button', { name: 'Toggle navigation' }).click();
		await expect(page.getByTestId('sidebar-drawer')).toHaveClass(/open/);
		await expect(addInput).toBeHidden();
		await expect(addButton).toBeHidden();

		await page.getByRole('button', { name: 'Close navigation' }).dispatchEvent('click');
		await expect(page.getByTestId('sidebar-drawer')).not.toHaveClass(/open/);
		await expect(addInput).toBeVisible();
		await expect(addButton).toBeVisible();
	});

	test('keeps add field anchored when mobile viewport shrinks on first focus', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.addInitScript(() => {
			class FakeVisualViewport extends EventTarget {
				width = window.innerWidth;
				height = window.innerHeight;
				offsetTop = 0;
				offsetLeft = 0;
				pageTop = 0;
				pageLeft = 0;
				scale = 1;

				setHeight(nextHeight: number) {
					this.height = nextHeight;
					this.dispatchEvent(new Event('resize'));
					this.dispatchEvent(new Event('scroll'));
				}
			}

			const fakeViewport = new FakeVisualViewport();
			Object.defineProperty(window, 'visualViewport', {
				configurable: true,
				value: fakeViewport
			});
			Reflect.set(window, '__setFakeViewportHeight', (nextHeight: number) => {
				fakeViewport.setHeight(nextHeight);
			});
		});

		await resetClientState(page);
		const addInput = page.getByTestId('new-task-input');
		await addInput.focus();

		await page.evaluate(() => {
			const setFakeHeight = Reflect.get(window, '__setFakeViewportHeight');
			if (typeof setFakeHeight === 'function') {
				setFakeHeight(window.innerHeight - 320);
			}
		});

		await expect
			.poll(() =>
				page.evaluate(() =>
					getComputedStyle(document.documentElement).getPropertyValue('--mobile-keyboard-offset').trim()
				)
			)
			.toBe('320px');

		await addInput.blur();
		await expect
			.poll(() =>
				page.evaluate(() =>
					getComputedStyle(document.documentElement).getPropertyValue('--mobile-keyboard-offset').trim()
				)
			)
			.toBe('0px');
	});

	test('keeps mobile sidebar open when pinned', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const drawer = page.getByTestId('sidebar-drawer');
		await expect(drawer).not.toHaveClass(/open/);

		await page.getByRole('button', { name: 'Toggle navigation' }).click();
		await expect(drawer).toHaveClass(/open/);

		const navPin = page.getByTestId('nav-pin');
		await navPin.scrollIntoViewIfNeeded();
		await navPin.click();
		await page.getByRole('link', { name: /Goal Management/ }).click();
		await expect(page).toHaveURL(/\/list\/goal-management/);
		await expect(drawer).toHaveClass(/open/);

		await page.reload();
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(drawer).toHaveClass(/open/);

		const navPinAfterReload = page.getByTestId('nav-pin');
		await navPinAfterReload.scrollIntoViewIfNeeded();
		await navPinAfterReload.click();
		await page.getByRole('link', { name: /My Day/ }).click();
		await expect(page).toHaveURL('/');
		await expect(drawer).not.toHaveClass(/open/);
	});

	test('shows planned-empty state when no tasks exist', async ({ page }) => {
		await expect(page.getByTestId('planned-empty')).toBeVisible();
		await expect(page.getByTestId('bliss-state')).not.toBeVisible();
	});

	test('shows bliss state after completing the only planned task', async ({ page }) => {
		const title = makeTitle('Bliss test task');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);

		const toggle = page.getByTestId('task-row').filter({ hasText: title }).getByTestId('task-toggle');
		await toggle.click();
		await expect(toggle).toHaveAttribute('data-acknowledged', 'true');

		await expect(page.getByTestId('bliss-state')).toBeVisible();
		await expect(page.getByTestId('planned-empty')).not.toBeVisible();
	});
});
