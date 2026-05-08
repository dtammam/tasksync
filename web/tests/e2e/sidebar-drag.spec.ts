import { expect, test, type Page } from '@playwright/test';

const mockLists = [
	{
		id: 'list-alpha',
		name: 'Alpha List',
		space_id: 's1',
		icon: 'A',
		color: '#3b82f6',
		order: 'm-0000',
	},
	{
		id: 'list-beta',
		name: 'Beta List',
		space_id: 's1',
		icon: 'B',
		color: '#ef4444',
		order: 'm-0001',
	},
];

const setupAdminSession = async (page: Page) => {
	await page.addInitScript(() => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.setItem('tasksync:auth-token', 'test-token');
		localStorage.setItem(
			'tasksync:auth-user',
			JSON.stringify({
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: 's1',
				role: 'admin',
			})
		);
		localStorage.setItem('tasksync:sort:sidebar-lists', 'manual');
		// Delete the scoped IDB so the app does not load stale lists from a prior run.
		indexedDB.deleteDatabase('tasksync_space_s1_user_admin');
	});

	await page.route('**/auth/me', async (route) => {
		const authHeader = route.request().headers()['authorization'];
		if (authHeader !== 'Bearer test-token') {
			await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: 's1',
				role: 'admin',
			}),
		});
	});

	await page.route('**/auth/members', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					user_id: 'admin',
					email: 'admin@example.com',
					display: 'Admin',
					space_id: 's1',
					role: 'admin',
				},
			]),
		});
	});

	await page.route('**/auth/sound', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: route.request().postData() ?? '{}',
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ enabled: true, volume: 70, theme: 'chime_soft' }),
		});
	});

	await page.route('**/auth/preferences', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: route.request().postData() ?? JSON.stringify({ theme: 'default' }),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ theme: 'default' }),
		});
	});

	// Mock the sync pull endpoint — this is how the app loads lists from the server.
	await page.route('**/sync/pull', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: Date.now(),
				lists: mockLists,
				tasks: [],
				deleted_tasks: [],
			}),
		});
	});

	// Mock sync push (no-op — no local dirty tasks to push in this test).
	await page.route('**/sync/push', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: Date.now(),
				applied: [],
				rejected: [],
			}),
		});
	});

	// Capture PATCH calls to individual lists so the test can verify persistence.
	const patchedIds: string[] = [];

	await page.route('**/lists/*', async (route) => {
		if (route.request().method() === 'PATCH') {
			const url = route.request().url();
			const id = url.split('/lists/')[1]?.split('?')[0] ?? '';
			patchedIds.push(id);
			const body = route.request().postDataJSON() as Record<string, unknown>;
			const match = mockLists.find((l) => l.id === id) ?? mockLists[0];
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ...match, ...body }),
			});
			return;
		}
		await route.fulfill({ status: 404, body: '' });
	});

	await page.route('**/lists', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(mockLists),
		});
	});

	await page.route('**/tasks', async (route) => {
		await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
	});

	return { patchedIds };
};

test('@smoke admin in manual sort mode can drag a sidebar list to reorder it', async ({ page }) => {
	const { patchedIds } = await setupAdminSession(page);

	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});

	const items = page.getByTestId('sidebar-list-item');

	// Wait for sync to deliver the two mocked lists to the sidebar.
	await expect.poll(async () => items.count()).toBe(2);

	// Verify initial sidebar order: Alpha first, Beta second.
	await expect(items.nth(0)).toContainText('Alpha List');
	await expect(items.nth(1)).toContainText('Beta List');

	// Drag Alpha List (index 0) onto Beta List (index 1) to move Alpha below Beta.
	await items.nth(0).dragTo(items.nth(1));

	// After the drop the sidebar order should be reversed: Beta first, Alpha second.
	await expect
		.poll(async () => {
			const texts = await items.allTextContents();
			const betaIdx = texts.findIndex((t) => t.includes('Beta List'));
			const alphaIdx = texts.findIndex((t) => t.includes('Alpha List'));
			// Positive when Beta precedes Alpha (desired post-drag state).
			return alphaIdx - betaIdx;
		})
		.toBeGreaterThan(0);

	// Verify that at least one PATCH was sent to persist the new order.
	await expect.poll(() => patchedIds.length).toBeGreaterThan(0);
});
