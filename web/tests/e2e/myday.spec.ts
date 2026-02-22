import { expect, test, type Page } from '@playwright/test';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;
const toLocalIsoDate = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDaysLocalIso = (days: number) => {
	const value = new Date();
	value.setDate(value.getDate() + days);
	return toLocalIsoDate(value);
};

const waitForTaskInIdb = async (page: Page, title: string) => {
	await expect
		.poll(async () =>
			page.evaluate(async (taskTitle) => {
				const resolveScopedDbName = () => {
					const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
					const rawUser = localStorage.getItem('tasksync:auth-user');
					let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
					if (rawUser) {
						try {
							const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
							if (parsed.user_id && parsed.space_id) {
								scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
							}
						} catch {
							// Keep fallback scope.
						}
					}
					const sanitized =
						scope
							.toLowerCase()
							.replace(/[^a-z0-9_-]/g, '_')
							.slice(0, 80) || 'legacy';
					return `tasksync_${sanitized}`;
				};
				const dbName = resolveScopedDbName();
				const db = await new Promise<IDBDatabase | null>((resolve) => {
					const req = indexedDB.open(dbName);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => resolve(null);
				});
				if (!db) return false;
				const storeNames = Array.from(db.objectStoreNames);
				if (!storeNames.includes('tasks')) {
					db.close();
					return false;
				}
				const all = await new Promise<unknown[]>((resolve) => {
					try {
						const tx = db.transaction('tasks', 'readonly');
						const store = tx.objectStore('tasks');
						const allReq = store.getAll();
						allReq.onsuccess = () => resolve(allReq.result ?? []);
						allReq.onerror = () => resolve([]);
					} catch {
						resolve([]);
					}
				});
				db.close();
				return all.some((task) => {
					if (!task || typeof task !== 'object') return false;
					if (!('title' in task)) return false;
					return (task as { title?: unknown }).title === taskTitle;
				});
			}, title)
		)
		.toBe(true);
};

const readTaskFromIdb = async (page: Page, title: string) =>
	page.evaluate(async (taskTitle) => {
		const resolveScopedDbName = () => {
			const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
			const rawUser = localStorage.getItem('tasksync:auth-user');
			let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
			if (rawUser) {
				try {
					const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
					if (parsed.user_id && parsed.space_id) {
						scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
					}
				} catch {
					// Keep fallback scope.
				}
			}
			const sanitized =
				scope
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, '_')
					.slice(0, 80) || 'legacy';
			return `tasksync_${sanitized}`;
		};
		const dbName = resolveScopedDbName();
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open(dbName);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		if (!db) return null;
		const storeNames = Array.from(db.objectStoreNames);
		if (!storeNames.includes('tasks')) {
			db.close();
			return null;
		}
		const all = await new Promise<unknown[]>((resolve) => {
			try {
				const tx = db.transaction('tasks', 'readonly');
				const store = tx.objectStore('tasks');
				const allReq = store.getAll();
				allReq.onsuccess = () => resolve(allReq.result ?? []);
				allReq.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
		db.close();
		const matched = all.find((task) => {
			if (!task || typeof task !== 'object') return false;
			if (!('title' in task)) return false;
			return (task as { title?: unknown }).title === taskTitle;
		});
		if (!matched || typeof matched !== 'object') return null;
		return matched as {
			due_date?: string;
			punted_from_due_date?: string;
			punted_on_date?: string;
		};
	}, title);

const updateTaskInIdb = async (
	page: Page,
	title: string,
	patch: Partial<{ due_date: string; punted_from_due_date: string; punted_on_date: string }>
) =>
	page.evaluate(
		async ({
			taskTitle,
			taskPatch
		}: {
			taskTitle: string;
			taskPatch: Partial<{ due_date: string; punted_from_due_date: string; punted_on_date: string }>;
		}) => {
			const resolveScopedDbName = () => {
				const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
				const rawUser = localStorage.getItem('tasksync:auth-user');
				let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
				if (rawUser) {
					try {
						const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
						if (parsed.user_id && parsed.space_id) {
							scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
						}
					} catch {
						// Keep fallback scope.
					}
				}
				const sanitized =
					scope
						.toLowerCase()
						.replace(/[^a-z0-9_-]/g, '_')
						.slice(0, 80) || 'legacy';
				return `tasksync_${sanitized}`;
			};
			const dbName = resolveScopedDbName();
			const db = await new Promise<IDBDatabase | null>((resolve) => {
				const req = indexedDB.open(dbName);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			if (!db) return false;
			const storeNames = Array.from(db.objectStoreNames);
			if (!storeNames.includes('tasks')) {
				db.close();
				return false;
			}
			try {
				const all = await new Promise<unknown[]>((resolve) => {
					const tx = db.transaction('tasks', 'readonly');
					const store = tx.objectStore('tasks');
					const allReq = store.getAll();
					allReq.onsuccess = () => resolve(allReq.result ?? []);
					allReq.onerror = () => resolve([]);
				});
				const matched = all.find((task) => {
					if (!task || typeof task !== 'object') return false;
					if (!('title' in task)) return false;
					return (task as { title?: unknown }).title === taskTitle;
				});
				if (!matched || typeof matched !== 'object') {
					db.close();
					return false;
				}
				const updated = {
					...matched,
					...taskPatch,
					dirty: true,
					updated_ts: Date.now()
				};
				await new Promise<boolean>((resolve) => {
					const tx = db.transaction('tasks', 'readwrite');
					const store = tx.objectStore('tasks');
					const putReq = store.put(updated);
					putReq.onsuccess = () => resolve(true);
					putReq.onerror = () => resolve(false);
				});
				db.close();
				return true;
			} catch {
				db.close();
				return false;
			}
		},
		{ taskTitle: title, taskPatch: patch }
	);

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
	await resetClientState(page);
	await page.goto('/list/goal-management');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

	const title = makeTitle('Suggestion seed');
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();

	const row = page.getByTestId('task-row').filter({ hasText: title });
	await expect(row).toHaveCount(1);
	await row.getByRole('button', { name: '⋯' }).click();
	await page.getByRole('button', { name: 'Star' }).click();
	await row.getByRole('button', { name: 'Close', exact: true }).click();

	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
	const suggestionsButton = page.getByRole('button', { name: /^Suggestions \d+/ });
	await expect(suggestionsButton).toBeVisible();
	return suggestionsButton;
};

test.describe('My Day', () => {
	test('shows tasks and moves to completed when toggled', async ({ page }) => {
		await resetClientState(page);
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

	test('can create a new task and persist after reload', async ({ page }) => {
		await resetClientState(page);
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

	test('keeps alphabetical sort mode and direction after reload', async ({ page }) => {
		await resetClientState(page);
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
		await resetClientState(page);
		await ensureSoundPanelOpen(page);
		await expect(page.getByTestId('sound-enabled')).toBeChecked();

		await page.getByTestId('sound-enabled').uncheck();
		await page.getByTestId('sound-theme').selectOption('wood_tick');
		await page.getByTestId('sound-volume').evaluate((el) => {
			const input = el as HTMLInputElement;
			input.value = '25';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(300);
		await page.reload();
		await ensureSoundPanelOpen(page);

		await expect(page.getByTestId('sound-enabled')).not.toBeChecked();
		await expect(page.getByTestId('sound-theme')).toHaveValue('wood_tick');
		await expect(page.getByTestId('sound-volume')).toHaveValue('25');
	});

	test('keeps recurring cadence when punting only a single scheduled instance', async ({ page }) => {
		await resetClientState(page);
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

		await openTaskActions();
		await page.getByRole('button', { name: 'Punt' }).first().click();
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.due_date ?? null)
			.toBe(tomorrow);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_from_due_date ?? null)
			.toBe(today);
		await expect
			.poll(async () => (await readTaskFromIdb(page, title))?.punted_on_date ?? null)
			.toBe(today);
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(0);

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
		await resetClientState(page);
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
		await page.getByRole('button', { name: 'Save' }).click();

		await row.getByRole('button', { name: '⋯' }).click();
		await expect(row.getByRole('button', { name: 'Punt' })).toHaveCount(0);
	});

	test('shows punt indicator when a task lands on today from a previous-day punt', async ({ page }) => {
		await resetClientState(page);
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
		await resetClientState(page);
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
});

test.describe('List view', () => {
	test('filters tasks by list', async ({ page }) => {
		await resetClientState(page);
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
		await resetClientState(page);
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
		await resetClientState(page);
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

		const dueSoonRow = await openTaskMenu(dueSoonTitle);
		await page.getByRole('button', { name: 'Tomorrow' }).click();
		await dueSoonRow.getByRole('button', { name: 'Close', exact: true }).click();

		const dueLaterRow = await openTaskMenu(dueLaterTitle);
		await page.getByRole('button', { name: 'Next week' }).click();
		await dueLaterRow.getByRole('button', { name: 'Close', exact: true }).click();

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
		await resetClientState(page);
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

		await rowB.getByRole('button', { name: 'Details' }).click();
		await expect(page.getByTestId('detail-star-indicator')).toBeVisible();
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
});

test.describe('Navigation', () => {
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
		await resetClientState(page);
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
		await resetClientState(page);
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
		await resetClientState(page);

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
});
