import { expect, test, type Page } from '@playwright/test';
import { waitForTaskInIdb } from './helpers/idb';

const ensureAccountPanelOpen = async (page: Page, options?: { requireEmail?: boolean }) => {
	const authEmail = page.getByTestId('auth-email');
	if (options?.requireEmail) {
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
			timeout: 30_000
		});
	}
	if ((await authEmail.count()) && options?.requireEmail) {
		await expect(authEmail).toBeVisible();
		return;
	}
	const openSettings = page.getByTestId('settings-open');
	await expect
		.poll(
			async () =>
				(await openSettings.count()) + (await authEmail.count()) + (await page.getByTestId('auth-user').count()),
			{ timeout: 10_000 }
		)
		.toBeGreaterThan(0);
	const settingsWindow = page.getByTestId('settings-window');
	if (!(await settingsWindow.count())) {
		await expect(openSettings).toBeVisible();
		await openSettings.click();
	}
	await expect
		.poll(async () => (await settingsWindow.count()) + (await authEmail.count()), { timeout: 10_000 })
		.toBeGreaterThan(0);
	if (!(await authEmail.count())) {
		const accountSection = page.locator('[data-testid="settings-section-account"]:visible').first();
		await expect(accountSection).toBeVisible();
		await accountSection.click();
	}
	if (options?.requireEmail) {
		await expect(authEmail).toBeVisible();
	}
};

const mockAuthenticatedBootstrap = async (page: Page) => {
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
			body: JSON.stringify({
				enabled: true,
				volume: 70,
				theme: 'chime_soft',
			}),
		});
	});

	await page.route('**/auth/preferences', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body:
					route.request().postData() ??
					JSON.stringify({
						theme: 'default',
					}),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				theme: 'default',
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
};

test('@smoke can sign in with token mode and restore session after reload', async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('pw-auth-init') === '1') return;
		sessionStorage.setItem('pw-auth-init', '1');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	await page.route('**/auth/login', async (route) => {
		const body = route.request().postDataJSON() as {
			email?: string;
			password?: string;
			space_id?: string;
		};
		if (body.email !== 'admin@example.com' || body.password !== 'tasksync') {
			await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				token: 'test-token',
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: body.space_id ?? 's1',
				role: 'admin'
			})
		});
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
				role: 'admin'
			})
		});
	});

	await page.route('**/lists', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await page.route('**/tasks', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await mockAuthenticatedBootstrap(page);

	await page.goto('/');
	await ensureAccountPanelOpen(page, { requireEmail: true });
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-space').fill('s1');
	await page.getByTestId('auth-signin').click();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');
	await expect(page.getByTestId('settings-section-members').first()).toBeVisible();

	await page.reload();
	await expect.poll(() => page.evaluate(() => localStorage.getItem('tasksync:auth-token'))).toBe(
		'test-token'
	);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const raw = localStorage.getItem('tasksync:auth-user');
				if (!raw) return '';
				try {
					const parsed = JSON.parse(raw) as { email?: string };
					return parsed.email ?? '';
				} catch {
					return '';
				}
			})
		)
		.toBe('admin@example.com');
});

test('can change password from account panel', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	let capturedBody: { current_password?: string; new_password?: string } | null = null;

	await page.route('**/auth/login', async (route) => {
		const body = route.request().postDataJSON() as {
			email?: string;
			password?: string;
			space_id?: string;
		};
		if (body.email !== 'admin@example.com' || body.password !== 'tasksync') {
			await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				token: 'test-token',
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: body.space_id ?? 's1',
				role: 'admin'
			})
		});
	});

	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: 's1',
				role: 'admin'
			})
		});
	});

	await page.route('**/auth/password', async (route) => {
		capturedBody = route.request().postDataJSON() as {
			current_password?: string;
			new_password?: string;
		};
		await route.fulfill({ status: 204, body: '' });
	});

	await page.route('**/lists', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await page.route('**/tasks', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await mockAuthenticatedBootstrap(page);

	await page.goto('/');
	await ensureAccountPanelOpen(page, { requireEmail: true });
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-signin').click();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');

	await ensureAccountPanelOpen(page);
	await page.getByRole('button', { name: 'Change password' }).click();
	await page.getByLabel('Current password').fill('tasksync');
	await page.getByPlaceholder('min 8 chars').fill('tasksync-new');
	await page.getByPlaceholder('repeat new password').fill('tasksync-new');
	await page.getByRole('button', { name: 'Update password' }).click();

	await expect(page.getByText('Password updated.')).toBeVisible();
	await expect.poll(() => capturedBody?.current_password).toBe('tasksync');
	await expect.poll(() => capturedBody?.new_password).toBe('tasksync-new');
});

test('shows clear sign-in guidance when login endpoint returns 404', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	await page.route('**/auth/login', async (route) => {
		await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});

	await page.goto('/');
	await ensureAccountPanelOpen(page, { requireEmail: true });
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-space').fill('s1');
	await page.getByTestId('auth-signin').click();

	await expect(
		page.getByText('Sign in endpoint was not found (404). Check the API URL and server version.')
	).toBeVisible();
});

test('stale legacy-mode device resolves to anonymous and orphans legacy-default data', async ({
	page
}) => {
	// Blank same-origin page so the marker database can be seeded before the app runs.
	await page.route('**/e2e-blank', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'text/html',
			body: '<!doctype html><title>blank</title>'
		})
	);
	await page.addInitScript(() => {
		// Seed the pre-upgrade state exactly once; later navigations must not
		// re-create the stale key after the app has cleaned it up.
		if (sessionStorage.getItem('pw-stale-legacy-init') === '1') return;
		sessionStorage.setItem('pw-stale-legacy-init', '1');
		localStorage.setItem('tasksync:auth-mode', 'legacy');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	// Pre-seed a marker task in the retired legacy-default database.
	await page.goto('/e2e-blank');
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const req = indexedDB.open('tasksync_legacy-default', 1);
			req.onupgradeneeded = () => {
				if (!req.result.objectStoreNames.contains('tasks')) {
					req.result.createObjectStore('tasks', { keyPath: 'id' });
				}
			};
			req.onsuccess = () => {
				const db = req.result;
				const tx = db.transaction('tasks', 'readwrite');
				tx.objectStore('tasks').put({ id: 'legacy-marker', title: 'Legacy marker task' });
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			};
			req.onerror = () => reject(req.error);
		});
	});

	// (a) The app loads to the normal anonymous state with sign-in available —
	// no error loop, no blank screen.
	await page.goto('/');
	await ensureAccountPanelOpen(page, { requireEmail: true });

	// (b) hydrate() removed the stale legacy mode key.
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('tasksync:auth-mode')))
		.toBe(null);

	// (c) A task created while signed out lands in the anonymous token scope
	// (waitForTaskInIdb resolves tasksync_token-anonymous for a user-less device).
	await page.goto('/');
	const title = `Stale legacy anon ${Math.random().toString(36).slice(2, 8)}`;
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();
	await waitForTaskInIdb(page, title);

	// (d) The legacy-default database is orphaned: still present, marker untouched.
	const marker = await page.evaluate(async () => {
		const databases = await indexedDB.databases();
		if (!databases.some((db) => db.name === 'tasksync_legacy-default')) return null;
		return new Promise<{ id?: string; title?: string } | null>((resolve) => {
			const req = indexedDB.open('tasksync_legacy-default');
			req.onsuccess = () => {
				const db = req.result;
				if (!Array.from(db.objectStoreNames).includes('tasks')) {
					db.close();
					resolve(null);
					return;
				}
				const tx = db.transaction('tasks', 'readonly');
				const getReq = tx.objectStore('tasks').get('legacy-marker');
				getReq.onsuccess = () => {
					const value = getReq.result as { id?: string; title?: string } | undefined;
					db.close();
					resolve(value ?? null);
				};
				getReq.onerror = () => {
					db.close();
					resolve(null);
				};
			};
			req.onerror = () => resolve(null);
		});
	});
	expect(marker).toEqual({ id: 'legacy-marker', title: 'Legacy marker task' });
});
