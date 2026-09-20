import { expect, test, type Page } from '@playwright/test';
import { setAuthenticatedClientState, defaultTestUser, type TestUser } from './helpers/auth';
import { readTasksFromIdbByTitle } from './helpers/idb';
import { expectAppSynced } from './helpers/ready';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

/**
 * Minimal mocked sync server for the add-task-details-resilience test.
 *
 * Two things matter here:
 * 1. The create-ack ECHOES the client-supplied task id (`body.id`) — matching the
 *    real server, which accepts the client id verbatim (server/src/routes/tasks.rs;
 *    the create_task idempotency test). A mock that minted a fresh server id would
 *    swap the task id on ack regardless of the fix and would not be faithful.
 * 2. `/sync/push` is gated by `pushEnabled` so the created task stays optimistic
 *    (local/dirty) until the test has opened its details drawer — the create-ack
 *    must land WHILE the drawer is open to exercise the bug.
 */
const mockSyncServerEchoingIds = async (page: Page, user: TestUser) => {
	let clock = 0;
	let pushEnabled = false;
	// Tasks the server "knows about" — created tasks are added here so the re-pull
	// that runs after a successful push returns them (an empty pull would drop the
	// just-synced task from the client and defeat the test).
	const serverTasks = new Map<string, Record<string, unknown>>();
	const json = (body: unknown) => ({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});

	await page.route('**/auth/me', (r) => r.fulfill(json({ ...user, role: 'admin' })));
	await page.route('**/auth/sound', (r) =>
		r.fulfill(json({ enabled: true, volume: 70, theme: 'chime_soft' }))
	);
	await page.route('**/auth/preferences', (r) => r.fulfill(json({ theme: 'default' })));
	await page.route('**/auth/members', (r) => r.fulfill(json([{ ...user, role: 'admin' }])));

	await page.route('**/sync/pull', (r) => {
		clock += 1;
		return r.fulfill(
			json({
				protocol: 'delta-v1',
				cursor_ts: clock,
				lists: [],
				tasks: Array.from(serverTasks.values()),
				deleted_tasks: []
			})
		);
	});

	await page.route('**/sync/push', async (route) => {
		if (!pushEnabled) {
			// Keep the create optimistic: the client retains the task as local/dirty
			// and retries later, so the drawer can be opened before the ack lands.
			await route.abort('failed');
			return;
		}
		const payload = route.request().postDataJSON() as {
			changes?: { kind?: string; body?: Record<string, unknown> }[];
		};
		const applied: Record<string, unknown>[] = [];
		for (const change of payload.changes ?? []) {
			clock += 1;
			if (change.kind === 'create_task') {
				const created = {
					id: change.body?.id, // echo the client's id (real server behavior)
					space_id: user.space_id,
					title: change.body?.title,
					status: change.body?.status ?? 'pending',
					list_id: change.body?.list_id,
					my_day: change.body?.my_day ? 1 : 0,
					priority: change.body?.priority ?? 0,
					order: change.body?.order ?? String(clock),
					created_ts: clock,
					updated_ts: clock,
					assignee_user_id: change.body?.assignee_user_id ?? user.user_id,
					created_by_user_id: user.user_id
				};
				serverTasks.set(String(created.id), created);
				applied.push(created);
			}
		}
		await route.fulfill(json({ protocol: 'delta-v1', cursor_ts: clock, applied, rejected: [] }));
	});

	return {
		enablePush: () => {
			pushEnabled = true;
		}
	};
};

test.describe('Add-task details resilience', () => {
	test('@smoke details drawer stays open through the create-sync ack', async ({ page }) => {
		await setAuthenticatedClientState(page);
		const mock = await mockSyncServerEchoingIds(page, defaultTestUser);

		await page.goto('/');
		await expectAppSynced(page);

		// Add a task; while push is gated it stays optimistic (local/dirty).
		const title = makeTitle('Resilience task');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();

		const row = page.getByTestId('task-row').filter({ hasText: title });
		await expect(row).toHaveCount(1);

		// Open its details immediately, before its create-ack has applied.
		await row.locator('button.actions-chip').click();
		await row.getByRole('button', { name: 'Details' }).click();
		const drawer = page.getByRole('dialog', { name: 'Task details' });
		await expect(drawer).toBeVisible();
		await expect(drawer.locator('input.title-input')).toHaveValue(title);

		// Now let the create push→ack round-trip complete WHILE the drawer is open.
		// Pre-fix, the ack swapped local-<uuid> → <uuid>, the detailId lookup failed,
		// and TaskDetailDrawer's `{#if open && task}` unmounted the drawer mid-edit.
		// Post-fix the id is stable so the ack is a same-value no-op.
		mock.enablePush();
		const pushDone = page.waitForResponse(
			(res) => res.url().includes('/sync/push') && res.request().method() === 'POST' && res.ok()
		);
		await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		await pushDone;

		// Wait until the ack has actually been applied (task synced, no longer local)
		// — i.e. past the exact moment replaceWithRemote runs — then assert the drawer
		// survived it, still mounted and showing the same task.
		await expect
			.poll(async () => {
				const rows = await readTasksFromIdbByTitle(page, title);
				return rows.length === 1 && rows[0]?.local === false;
			})
			.toBe(true);

		await expect(drawer).toBeVisible();
		await expect(drawer.locator('input.title-input')).toHaveValue(title);
		// Idempotency is covered by the poll above (exactly one synced task in IDB);
		// we don't assert the My Day *row* here because quickAdd creates a
		// my_day:false task that legitimately leaves the My Day filter after sync —
		// it stays in $tasks (which is why the drawer still resolves it), just not
		// in myDayPending. The drawer surviving the id swap is the regression under test.
	});
});
