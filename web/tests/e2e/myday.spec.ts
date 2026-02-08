import { expect, test, type Page } from '@playwright/test';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

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
					const sanitized = scope.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'legacy';
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

	test('keeps alphabetical sort mode after reload', async ({ page }) => {
		await resetClientState(page);
		const marker = makeTitle('Sort marker');
		const titleB = `${marker} B`;
		const titleA = `${marker} A`;

		await page.getByTestId('new-task-input').fill(titleB);
		await page.getByTestId('new-task-submit').click();
		await page.getByTestId('new-task-input').fill(titleA);
		await page.getByTestId('new-task-submit').click();

		await page.getByLabel('Sort tasks').selectOption('alpha');
		await expect(page.getByLabel('Sort tasks')).toHaveValue('alpha');
		const plannedSection = page.locator('section.block', {
			has: page.locator('.section-title', { hasText: 'Planned' })
		});
		const plannedRows = plannedSection.getByTestId('task-row');
		const sortedRows = plannedRows.filter({ hasText: marker });
		await expect(sortedRows).toHaveCount(2);
		await expect(sortedRows.nth(0)).toContainText(titleA);

		await page.reload();
		await expect(page.getByLabel('Sort tasks')).toHaveValue('alpha');
		await expect(plannedSection.getByTestId('task-row').filter({ hasText: marker }).nth(0)).toContainText(titleA);
	});

	test('persists sound settings changes across reload', async ({ page }) => {
		await resetClientState(page);
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

		await expect.poll(async () =>
			page.evaluate(
				() => (document.querySelector('[data-testid="sound-enabled"]') as HTMLInputElement).checked
			)
		).toBe(false);
		await expect(page.getByTestId('sound-theme')).toHaveValue('wood_tick');
		await expect(page.getByTestId('sound-volume')).toHaveValue('25');
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
});

test.describe('Navigation', () => {
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
