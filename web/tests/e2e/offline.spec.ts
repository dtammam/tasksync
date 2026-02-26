import { expect, test, type Page } from '@playwright/test';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;
const seededLists = [
	{ id: 'my-day', name: 'My Day', icon: '🌅', order: 'a' },
	{ id: 'goal-management', name: 'Goal Management', icon: '🎯', order: 'b' },
	{ id: 'daily-management', name: 'Daily Management', icon: '📅', order: 'c' },
	{ id: 'tasks', name: 'Tasks', icon: '🗒', order: 'd' },
	{ id: 'health', name: 'Health', icon: '💪', order: 'e' },
	{ id: 'tech', name: 'Tech Ideas', icon: '💻', order: 'f' }
];

const resetClientState = async (page: Page) => {
	await page.addInitScript(() => {
		// Keep e2e deterministic and local-first: signed-out token mode disables live server sync.
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});
};

const setAuthenticatedClientState = async (page: Page, user: { user_id: string; email: string; display: string; space_id: string }) => {
	await page.addInitScript((initialUser) => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.setItem('tasksync:auth-token', 'test-token');
		localStorage.setItem(
			'tasksync:auth-user',
			JSON.stringify({
				...initialUser,
				role: 'admin'
			})
		);
	}, user);
};

const ensureServiceWorkerControlsPage = async (page: Page) => {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					if (!('serviceWorker' in navigator)) return 'missing';
					const registration = await navigator.serviceWorker.ready;
					if (!registration?.active) return 'missing';
					return navigator.serviceWorker.controller ? 'controlled' : 'active';
				}),
			{ timeout: 20_000 }
		)
		.not.toBe('missing');

	if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) {
		await page.reload();
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(true);
	}
};

const readTasksFromIdbByTitle = async (page: Page, title: string) =>
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
		if (!db) return [];
		if (!Array.from(db.objectStoreNames).includes('tasks')) {
			db.close();
			return [];
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

		return all
			.filter((task) => !!task && typeof task === 'object' && (task as { title?: unknown }).title === taskTitle)
			.map((task) => {
				const candidate = task as { id?: unknown; dirty?: unknown; local?: unknown };
				return {
					id: typeof candidate.id === 'string' ? candidate.id : '',
					dirty: !!candidate.dirty,
					local: !!candidate.local
				};
			});
	}, title);

const seedScopedTaskForUser = async (
	page: Page,
	{
		user,
		title,
		listId,
		myDay
	}: {
		user: { user_id: string; email: string; display: string; space_id: string };
		title: string;
		listId: string;
		myDay: boolean;
	}
) =>
	page.evaluate(
		async ({
			seedUser,
			taskTitle,
			taskListId,
			taskMyDay,
			defaultLists
		}: {
			seedUser: { user_id: string; email: string; display: string; space_id: string };
			taskTitle: string;
			taskListId: string;
			taskMyDay: boolean;
			defaultLists: { id: string; name: string; icon?: string; order: string }[];
		}) => {
			const sanitizeScope = (scope: string) =>
				scope
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, '_')
					.slice(0, 80) || 'legacy';
			const scopedDbName = `tasksync_${sanitizeScope(`space:${seedUser.space_id}:user:${seedUser.user_id}`)}`;
			const anonymousDbName = `tasksync_${sanitizeScope('token-anonymous')}`;
			const now = Date.now();
			const buildTask = (id: string, taskText: string, assigneeUserId: string) => ({
				id,
				title: taskText,
				status: 'pending',
				list_id: taskListId,
				my_day: taskMyDay,
				priority: 0,
				tags: [],
				checklist: [],
				order: `seed-${now}`,
				created_ts: now,
				updated_ts: now,
				assignee_user_id: assigneeUserId,
				created_by_user_id: assigneeUserId,
				dirty: false,
				local: false
			});

			const putSeedData = async (dbName: string, taskText: string, assigneeUserId: string) =>
				await new Promise<void>((resolve, reject) => {
					const req = indexedDB.open(dbName, 2);
					req.onupgradeneeded = () => {
						const db = req.result;
						if (!db.objectStoreNames.contains('lists')) {
							db.createObjectStore('lists', { keyPath: 'id' });
						}
						if (!db.objectStoreNames.contains('tasks')) {
							const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
							tasks.createIndex('by-list', 'list_id');
						}
						if (!db.objectStoreNames.contains('settings')) {
							db.createObjectStore('settings', { keyPath: 'id' });
						}
					};
					req.onerror = () => reject(req.error ?? new Error(`open failed for ${dbName}`));
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction(['lists', 'tasks'], 'readwrite');
						const listStore = tx.objectStore('lists');
						const taskStore = tx.objectStore('tasks');
						for (const list of defaultLists) {
							listStore.put(list);
						}
						taskStore.put(buildTask(`seed-${dbName}-task`, taskText, assigneeUserId));
						tx.oncomplete = () => {
							db.close();
							resolve();
						};
						tx.onerror = () => {
							db.close();
							reject(tx.error ?? new Error(`write failed for ${dbName}`));
						};
					};
				});

			await putSeedData(scopedDbName, taskTitle, seedUser.user_id);
			await putSeedData(anonymousDbName, 'Anonymous scope task', 'anonymous-user');
		},
		{
			seedUser: user,
			taskTitle: title,
			taskListId: listId,
			taskMyDay: myDay,
			defaultLists: seededLists
		}
	);

const mockAuthenticatedSyncServer = async (page: Page, user: { user_id: string; email: string; display: string; space_id: string }) => {
	let serverClock = Date.now();
	let serverTaskCounter = 0;
	const createOpsByTitle = new Map<string, number>();
	const serverLists = seededLists.map((list) => ({
		...list,
		space_id: user.space_id
	}));
	const serverTasks = new Map<
		string,
		{
			id: string;
			space_id: string;
			title: string;
			status: string;
			list_id: string;
			my_day: number;
			priority: number;
			order: string;
			created_ts: number;
			updated_ts: number;
			assignee_user_id?: string;
			created_by_user_id?: string;
		}
	>();

	const nextServerTaskId = () => {
		serverTaskCounter += 1;
		return `10000000-0000-4000-8000-${String(serverTaskCounter).padStart(12, '0')}`;
	};

	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				...user,
				role: 'admin'
			})
		});
	});

	await page.route('**/auth/sound', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: route.request().postData() ?? '{}'
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				enabled: true,
				volume: 70,
				theme: 'chime_soft'
			})
		});
	});

	await page.route('**/auth/preferences', async (route) => {
		if (route.request().method() === 'PATCH') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: route.request().postData() ?? JSON.stringify({ theme: 'default' })
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ theme: 'default' })
		});
	});

	await page.route('**/auth/members', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					...user,
					role: 'admin'
				}
			])
		});
	});

	await page.route('**/sync/pull', async (route) => {
		serverClock += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: serverClock,
				lists: serverLists,
				tasks: Array.from(serverTasks.values()),
				deleted_tasks: []
			})
		});
	});

	await page.route('**/sync/push', async (route) => {
		const payload = route.request().postDataJSON() as {
			changes?: {
				kind?: string;
				op_id?: string;
				task_id?: string;
				body?: {
					title?: string;
					status?: string;
					list_id?: string;
					order?: string;
					my_day?: boolean;
					priority?: number;
					assignee_user_id?: string;
				};
			}[];
		};
		const changes = payload.changes ?? [];
		const applied: {
			id: string;
			space_id: string;
			title: string;
			status: string;
			list_id: string;
			my_day: number;
			priority: number;
			order: string;
			created_ts: number;
			updated_ts: number;
			assignee_user_id?: string;
			created_by_user_id?: string;
		}[] = [];

		for (const change of changes) {
			serverClock += 1;
			if (change.kind === 'create_task') {
				const title = change.body?.title?.trim();
				const listId = change.body?.list_id?.trim();
				if (!title || !listId) continue;
				createOpsByTitle.set(title, (createOpsByTitle.get(title) ?? 0) + 1);
				const now = serverClock;
				const id = nextServerTaskId();
				const created = {
					id,
					space_id: user.space_id,
					title,
					status: 'pending',
					list_id: listId,
					my_day: change.body?.my_day ? 1 : 0,
					priority: change.body?.priority ?? 0,
					order: change.body?.order ?? String(now),
					created_ts: now,
					updated_ts: now,
					assignee_user_id: change.body?.assignee_user_id ?? user.user_id,
					created_by_user_id: user.user_id
				};
				serverTasks.set(id, created);
				applied.push(created);
				continue;
			}
			if (change.kind === 'update_task' && change.task_id) {
				const existing = serverTasks.get(change.task_id);
				if (!existing) continue;
				const updated = {
					...existing,
					title: change.body?.title?.trim() || existing.title,
					status: change.body?.status || existing.status,
					list_id: change.body?.list_id || existing.list_id,
					my_day: change.body?.my_day ? 1 : 0,
					priority: change.body?.priority ?? existing.priority,
					order: change.body?.order || existing.order,
					updated_ts: serverClock,
					assignee_user_id: change.body?.assignee_user_id ?? existing.assignee_user_id
				};
				serverTasks.set(existing.id, updated);
				applied.push(updated);
			}
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: serverClock,
				applied,
				rejected: []
			})
		});
	});

	return {
		getCreateOpsByTitle: (title: string) => createOpsByTitle.get(title) ?? 0
	};
};

test.describe('Offline continuity', () => {
	test.use({ serviceWorkers: 'allow' });

	test('hard reload offline keeps cached shell and local data', async ({ page, context }) => {
		await resetClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const title = makeTitle('Offline continuity');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);

		await ensureServiceWorkerControlsPage(page);

		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});

	test('offline create survives reload and converges once after reconnect', async ({ page, context }) => {
		const user = {
			user_id: 'admin',
			email: 'admin@example.com',
			display: 'Admin',
			space_id: 's1'
		};
		await setAuthenticatedClientState(page, user);
		const mockServer = await mockAuthenticatedSyncServer(page, user);

		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
		await ensureServiceWorkerControlsPage(page);

		const title = makeTitle('Offline replay');
		await context.setOffline(true);
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
		await expect
			.poll(async () => {
				const rows = await readTasksFromIdbByTitle(page, title);
				return rows.length === 1 && rows[0]?.dirty && rows[0]?.local;
			})
			.toBe(true);

		await context.setOffline(false);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
		await expect.poll(() => mockServer.getCreateOpsByTitle(title)).toBe(1);
		await expect
			.poll(async () => {
				const rows = await readTasksFromIdbByTitle(page, title);
				return rows.length === 1 && !rows[0]?.dirty && !rows[0]?.local && !rows[0]?.id.startsWith('local-');
			})
			.toBe(true);
	});

	test('offline boot keeps cached authenticated scope instead of anonymous fallback', async ({ page, context }) => {
		await resetClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await ensureServiceWorkerControlsPage(page);

		const user = {
			user_id: 'admin',
			email: 'admin@example.com',
			display: 'Admin',
			space_id: 's1'
		};
		const scopedTaskTitle = makeTitle('Scoped offline');
		await seedScopedTaskForUser(page, {
			user,
			title: scopedTaskTitle,
			listId: 'goal-management',
			myDay: true
		});

		await page.evaluate((nextUser) => {
			localStorage.setItem('tasksync:auth-mode', 'token');
			localStorage.setItem('tasksync:auth-token', 'test-token');
			localStorage.setItem(
				'tasksync:auth-user',
				JSON.stringify({
					...nextUser,
					role: 'admin'
				})
			);
		}, user);

		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
		await expect(page.getByTestId('task-row').filter({ hasText: scopedTaskTitle })).toHaveCount(1);
		await expect(page.getByTestId('task-row').filter({ hasText: 'Anonymous scope task' })).toHaveCount(0);
	});
});
