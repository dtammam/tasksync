import { expect, test, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEEDED_TASK_TITLE = 'Streak sync smoke task';
// A second task stays pending so completing the first does NOT trigger day_complete.
const SEEDED_TASK_TITLE_2 = 'Streak sync second task';

const SEEDED_LISTS = [
	{ id: 'my-day', name: 'My Day', icon: '🌅', order: 'a' },
	{ id: 'goal-management', name: 'Goal Management', icon: '🎯', order: 'b' },
	{ id: 'daily-management', name: 'Daily Management', icon: '📅', order: 'c' },
	{ id: 'tasks', name: 'Tasks', icon: '🗒', order: 'd' },
	{ id: 'health', name: 'Health', icon: '💪', order: 'e' },
	{ id: 'tech', name: 'Tech Ideas', icon: '💻', order: 'f' },
];

const TEST_USER = {
	user_id: 'admin',
	email: 'admin@example.com',
	display: 'Admin',
	space_id: 's1',
	role: 'admin',
};

// Prefs storage key for the test user (mirrors preferences.ts storageKey())
const PREFS_KEY = `tasksync:ui-preferences:${TEST_USER.space_id}:${TEST_USER.user_id}`;

// ---------------------------------------------------------------------------
// Auth seed helper — mirrors setAuthenticatedClientState from offline.spec.ts
// ---------------------------------------------------------------------------

const setAuthenticatedClientState = async (page: Page) => {
	await page.addInitScript((user) => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.setItem('tasksync:auth-token', 'test-token');
		localStorage.setItem(
			'tasksync:auth-user',
			JSON.stringify({
				...user,
				role: 'admin',
			})
		);
	}, TEST_USER);
};

// ---------------------------------------------------------------------------
// Streak-aware server mock
//
// Closure-local mutable state tracks server streak revision so the
// /auth/preferences GET response evolves after the /auth/streak/op POST.
// ---------------------------------------------------------------------------

const mockStreakSyncServer = async (page: Page) => {
	let serverStreakRevision = 0;
	let streakOpCallCount = 0;

	// streakSettingsJson must be included in every prefs response so that
	// fromWire() does not overwrite the locally-seeded enabled:true with the
	// default enabled:false when the server hydration runs on mount.
	const STREAK_SETTINGS_JSON = JSON.stringify({ enabled: true, theme: 'ddr', resetMode: 'daily' });

	const buildPrefsBody = () => {
		if (serverStreakRevision === 0) {
			return JSON.stringify({
				theme: 'default',
				streakSettingsJson: STREAK_SETTINGS_JSON,
				streakRevision: 0,
			});
		}
		return JSON.stringify({
			theme: 'default',
			streakSettingsJson: STREAK_SETTINGS_JSON,
			streakStateJson: JSON.stringify({ count: 1, lastResetDate: null, dayCompleteDate: null }),
			streakRevision: serverStreakRevision,
		});
	};

	// /auth/me
	await page.route('**/auth/me', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(TEST_USER),
		});
	});

	// /auth/sound
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

	// /auth/preferences — GET response evolves once streakOpCallCount > 0
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
			body: buildPrefsBody(),
		});
	});

	// /auth/members
	await page.route('**/auth/members', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([TEST_USER]),
		});
	});

	// /auth/streak/op — accept the op, bump revision, return canonical state
	await page.route('**/auth/streak/op', async (route) => {
		streakOpCallCount += 1;
		serverStreakRevision += 1;
		const body = route.request().postDataJSON() as { kind?: string };
		// Extra assertion: the POST body should have kind: 'increment'
		if (body.kind !== 'increment') {
			console.warn('[streak-sync spec] unexpected op kind:', body.kind);
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				count: 1,
				lastResetDate: null,
				dayCompleteDate: null,
				revision: serverStreakRevision,
				appliedThisCall: true,
				dayCompleteFiredThisCall: false,
			}),
		});
	});

	// /lists — return seeded lists
	await page.route('**/lists', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(SEEDED_LISTS.map((l) => ({ ...l, space_id: TEST_USER.space_id }))),
		});
	});

	// /tasks — return two seeded pending tasks in my-day.
	//   Having two tasks ensures that completing one does NOT trigger the
	//   day_complete op (final-task guard), so /auth/streak/op receives only
	//   the 'increment' op and the mock stays simple.
	await page.route('**/tasks', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					id: 'seeded-streak-task-001',
					space_id: TEST_USER.space_id,
					title: SEEDED_TASK_TITLE,
					status: 'pending',
					list_id: 'my-day',
					my_day: 1,
					priority: 0,
					order: 'seed-a',
					created_ts: 1000000,
					updated_ts: 1000000,
					assignee_user_id: TEST_USER.user_id,
					created_by_user_id: TEST_USER.user_id,
				},
				{
					id: 'seeded-streak-task-002',
					space_id: TEST_USER.space_id,
					title: SEEDED_TASK_TITLE_2,
					status: 'pending',
					list_id: 'my-day',
					my_day: 1,
					priority: 0,
					order: 'seed-b',
					created_ts: 1000001,
					updated_ts: 1000001,
					assignee_user_id: TEST_USER.user_id,
					created_by_user_id: TEST_USER.user_id,
				},
			]),
		});
	});

	// /sync/pull — return seeded lists + both tasks
	await page.route('**/sync/pull', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: 1000002,
				lists: SEEDED_LISTS.map((l) => ({ ...l, space_id: TEST_USER.space_id })),
				tasks: [
					{
						id: 'seeded-streak-task-001',
						space_id: TEST_USER.space_id,
						title: SEEDED_TASK_TITLE,
						status: 'pending',
						list_id: 'my-day',
						my_day: 1,
						priority: 0,
						order: 'seed-a',
						created_ts: 1000000,
						updated_ts: 1000000,
						assignee_user_id: TEST_USER.user_id,
						created_by_user_id: TEST_USER.user_id,
					},
					{
						id: 'seeded-streak-task-002',
						space_id: TEST_USER.space_id,
						title: SEEDED_TASK_TITLE_2,
						status: 'pending',
						list_id: 'my-day',
						my_day: 1,
						priority: 0,
						order: 'seed-b',
						created_ts: 1000001,
						updated_ts: 1000001,
						assignee_user_id: TEST_USER.user_id,
						created_by_user_id: TEST_USER.user_id,
					},
				],
				deleted_tasks: [],
			}),
		});
	});

	// /sync/push — accept task completions; return applied tasks
	await page.route('**/sync/push', async (route) => {
		const payload = route.request().postDataJSON() as {
			changes?: {
				kind?: string;
				task_id?: string;
				body?: { status?: string };
			}[];
		};
		const applied: unknown[] = [];
		for (const change of payload.changes ?? []) {
			if (change.kind === 'update_task' && change.task_id) {
				applied.push({
					id: change.task_id,
					space_id: TEST_USER.space_id,
					title: SEEDED_TASK_TITLE,
					status: change.body?.status ?? 'done',
					list_id: 'my-day',
					my_day: 1,
					priority: 0,
					order: 'seed-a',
					created_ts: 1000000,
					updated_ts: Date.now(),
					assignee_user_id: TEST_USER.user_id,
					created_by_user_id: TEST_USER.user_id,
				});
			}
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				protocol: 'delta-v1',
				cursor_ts: Date.now(),
				applied,
				rejected: [],
			}),
		});
	});

	return {
		getStreakOpCallCount: () => streakOpCallCount,
	};
};

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test('@smoke streak count increments optimistically and survives hard reload via server roundtrip', async ({
	page,
}) => {
	// 1. Clear localStorage first, then seed auth + prefs
	await page.addInitScript(() => {
		localStorage.clear();
	});

	// 2. Seed authenticated client state (token mode)
	await setAuthenticatedClientState(page);

	// 3. Seed enabled streak settings BEFORE navigation.
	//    preferences.ts readLocal() parses streakSettings as a plain object.
	await page.addInitScript((prefsKey) => {
		const existing = localStorage.getItem(prefsKey);
		let blob: Record<string, unknown> = {};
		if (existing) {
			try {
				blob = JSON.parse(existing) as Record<string, unknown>;
			} catch {
				/* ignore */
			}
		}
		blob.streakSettings = { enabled: true, theme: 'ddr', resetMode: 'daily' };
		localStorage.setItem(prefsKey, JSON.stringify(blob));
	}, PREFS_KEY);

	// 4. Wire up server mocks
	const mockServer = await mockStreakSyncServer(page);

	// 5. Navigate
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});
	await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();

	// 6. Streak overlay must NOT be visible yet (count is 0, display.visible is false)
	await expect(page.locator('.streak-root')).toHaveCount(0);

	// 7. Complete the seeded pending task — triggers streak.increment() optimistically
	const row = page.getByTestId('task-row').filter({ hasText: SEEDED_TASK_TITLE });
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.getByTestId('task-toggle').click();

	// 8. Local optimistic increment: streak overlay appears with count = 1
	const overlay = page.locator('.streak-root');
	await expect(overlay).toBeVisible({ timeout: 5_000 });
	await expect(overlay).toHaveAttribute('aria-label', 'Streak: 1');

	// 9. Wait for the POST /auth/streak/op to land
	await expect
		.poll(() => mockServer.getStreakOpCallCount(), { timeout: 5_000 })
		.toBeGreaterThanOrEqual(1);

	// 10. Hard reload — proves the server-roundtrip path.
	//     After reload, /auth/preferences GET now returns streakStateJson with count=1
	//     and streakRevision=1, so the post-reload hydrate converges to the same count.
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000,
	});

	// 11. Verify the server roundtrip preserved the streak count.
	//     The prefs blob in localStorage must contain streakState.count === 1
	//     regardless of whether the overlay is currently visible.  Both the
	//     optimistic write (before reload) and the server-canonical hydrate
	//     (after reload, /auth/preferences revision=1) converge on count=1.
	const prefsRaw = await page.evaluate(() =>
		localStorage.getItem('tasksync:ui-preferences:s1:admin')
	);
	expect(prefsRaw).not.toBeNull();
	const prefsBlob = JSON.parse(prefsRaw as string) as Record<string, unknown>;
	const streakState = prefsBlob.streakState as { count?: unknown } | undefined;
	expect(streakState).toBeDefined();
	expect(streakState?.count).toBe(1);
});
