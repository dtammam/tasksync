import { expect, test, type Page } from '@playwright/test';
import { setAuthenticatedClientState, defaultTestUser } from './helpers/auth';
import { expectAppSynced } from './helpers/ready';

// Regression: on a warm reopen, tag-grouped views (a list, My Day with
// group-by on) first rendered in DEFAULT-palette order and then regrouped a
// moment later once the space's customized palette arrived from the server
// (plan 2026-11-15-fix-regroup-on-load). The palette is now cached locally per
// space, so the first render already uses it.
//
// Measurement: an init script records every distinct `tag-group-title` order
// the DOM shows from the first byte of each page load. After the reload
// settles (sync done, /tags answered) the first recorded non-empty order must
// equal the final one -- no visible rearrangement.

const user = defaultTestUser;
const LIST_ID = 'l-errands';

// Rank order deliberately inverts the default palette, where ⭐ (Time /
// priority) precedes 🥛 (Grocery aisles). Default-order first render would
// show ⭐ first; the customized order shows 🥛 first.
const CUSTOM_PALETTE = [
	{
		section: 'Mine',
		entries: [
			{ emoji: '🥛', label: 'Dairy run' },
			{ emoji: '⭐', label: 'Top' },
		],
	},
];
const CUSTOM_ORDER = ['🥛 Dairy run', '⭐ Top', 'Untagged'];
const DEFAULT_ORDER = ['⭐ Starred', '🥛 Dairy', 'Untagged'];

const serverTasks = [
	{ title: 'Regroup alpha', emoji: '⭐' },
	{ title: 'Regroup bravo', emoji: '🥛' },
	{ title: 'Regroup charlie', emoji: '⭐' },
	{ title: 'Regroup delta' },
].map((t, i) => ({
	id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
	space_id: user.space_id,
	title: t.title,
	status: 'pending',
	list_id: LIST_ID,
	my_day: 1,
	priority: 0,
	order: `a${i}`,
	created_ts: 1000 + i,
	updated_ts: 1000 + i,
	assignee_user_id: user.user_id,
	created_by_user_id: user.user_id,
	...(t.emoji ? { emoji: t.emoji } : {}),
}));

const json = (body: unknown) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify(body),
});

// A small mock server whose /sync/pull always answers with the same lists and
// tasks, so the reload's pull is a genuine no-op (another candidate cause the
// plan asks us to rule in or out).
// `context.setOffline()` does not stop page.route() mocks from answering, so a
// real offline arm must flip `setOffline` here too (every route then aborts).
const installMockServer = async (page: Page, palette: unknown) => {
	let clock = 2000;
	let offline = false;
	const routes: [string, Parameters<Page['route']>[1]][] = [];
	const route = (pattern: string, handler: Parameters<Page['route']>[1]) =>
		routes.push([pattern, handler]);
	route('**/auth/me', (r) => r.fulfill(json({ ...user, role: 'admin' })));
	route('**/auth/sound', (r) =>
		r.fulfill(json({ enabled: true, volume: 70, theme: 'chime_soft' }))
	);
	route('**/auth/preferences', (r) => r.fulfill(json({ theme: 'default' })));
	route('**/auth/members', (r) => r.fulfill(json([{ ...user, role: 'admin' }])));
	route('**/tags', (r) => r.fulfill(json(palette)));
	route('**/sync/pull', (r) => {
		clock += 1;
		return r.fulfill(
			json({
				protocol: 'delta-v1',
				cursor_ts: clock,
				lists: [{ id: LIST_ID, space_id: user.space_id, name: 'Errands', order: 'a' }],
				tasks: serverTasks,
				deleted_tasks: [],
			})
		);
	});
	route('**/sync/push', (r) =>
		r.fulfill(json({ protocol: 'delta-v1', cursor_ts: clock, applied: [], rejected: [] }))
	);
	for (const [pattern, handler] of routes) {
		await page.route(pattern, (r, req) =>
			offline ? r.abort('internetdisconnected') : handler(r, req)
		);
	}
	return {
		setOffline: (value: boolean) => {
			offline = value;
		},
	};
};

// Records the group-title order timeline from the very start of every load.
const installGroupOrderRecorder = async (page: Page) => {
	await page.addInitScript(() => {
		const timeline: string[][] = [];
		Reflect.set(window, '__groupOrderTimeline', timeline);
		const snap = () => {
			const titles = Array.from(document.querySelectorAll('[data-testid="tag-group-title"]')).map(
				(el) => (el.textContent ?? '').trim()
			);
			const last = timeline[timeline.length - 1];
			if (!last || last.join('|') !== titles.join('|')) timeline.push(titles);
		};
		new MutationObserver(snap).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
};

const readTimeline = (page: Page) =>
	page.evaluate(
		() => (Reflect.get(window, '__groupOrderTimeline') as string[][] | undefined) ?? []
	);

const nonEmpty = (timeline: string[][]) => timeline.filter((titles) => titles.length > 0);

const seedClient = async (page: Page) => {
	await setAuthenticatedClientState(page, user);
	await page.addInitScript(() => {
		localStorage.setItem('tasksync:group-by-tag:myday', '1');
	});
};

// First-ever load (empty IndexedDB): on a loaded box the startup pull's tasks
// are occasionally not applied (suspected startup race, tech-debt 058 -- out
// of this plan's scope). Drive one more pull through the app's own focus path
// so the setup is deterministic; the warm reopen under test is unaffected.
const settleFirstLoad = async (page: Page, order: string[] = CUSTOM_ORDER) => {
	await expectAppSynced(page);
	const focusPull = page.waitForResponse((r) => r.url().endsWith('/sync/pull'));
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await focusPull;
	await expect(page.getByTestId('tag-group-title')).toHaveText(order);
};

const measureWarmReopen = async (page: Page, path: string) => {
	await installMockServer(page, CUSTOM_PALETTE);
	await seedClient(page);
	await installGroupOrderRecorder(page);

	// First (online) load: tasks land in IDB, the palette arrives from the server.
	const firstTags = page.waitForResponse((r) => r.url().endsWith('/tags'));
	await page.goto(path);
	await firstTags;
	await settleFirstLoad(page);

	// Warm reopen.
	const reloadTags = page.waitForResponse((r) => r.url().endsWith('/tags'));
	await page.reload({ waitUntil: 'domcontentloaded' });
	await expectAppSynced(page);
	await reloadTags;
	await expect(page.getByTestId('tag-group-title')).toHaveText(CUSTOM_ORDER);

	const timeline = nonEmpty(await readTimeline(page));
	test.info().annotations.push({
		type: 'group-order-timeline',
		description: JSON.stringify(timeline),
	});
	return timeline;
};

test.describe('Tag-group order is stable across a warm reopen', () => {
	test('@smoke list view: first render already uses the customized palette order', async ({
		page,
	}) => {
		const timeline = await measureWarmReopen(page, `/list/${LIST_ID}`);
		expect(timeline[0], `timeline: ${JSON.stringify(timeline)}`).toEqual(CUSTOM_ORDER);
		expect(timeline, 'no rearrangement after first render').toHaveLength(1);
	});

	test('@smoke My Day with group-by on: first render already uses the customized palette order', async ({
		page,
	}) => {
		const timeline = await measureWarmReopen(page, '/');
		expect(timeline[0], `timeline: ${JSON.stringify(timeline)}`).toEqual(CUSTOM_ORDER);
		expect(timeline, 'no rearrangement after first render').toHaveLength(1);
	});

	test('control: an uncustomized space (server palette null) never rearranges', async ({
		page,
	}) => {
		await installMockServer(page, null);
		await seedClient(page);
		await installGroupOrderRecorder(page);
		await page.goto(`/list/${LIST_ID}`);
		await settleFirstLoad(page, DEFAULT_ORDER);
		const reloadTags = page.waitForResponse((r) => r.url().endsWith('/tags'));
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expectAppSynced(page);
		await reloadTags;
		await expect(page.getByTestId('tag-group-title')).toHaveText(DEFAULT_ORDER);
		const timeline = nonEmpty(await readTimeline(page));
		test.info().annotations.push({
			type: 'group-order-timeline',
			description: JSON.stringify(timeline),
		});
		expect(timeline, `timeline: ${JSON.stringify(timeline)}`).toEqual([DEFAULT_ORDER]);
	});
});

test.describe('Tag-group order offline', () => {
	test.use({ serviceWorkers: 'allow' });
	// Same constraint as the 'Offline continuity' describe in offline.spec.ts:
	// page.reload() under context.setOffline() is only reliable on chromium.
	test.skip(({ browserName }) => browserName === 'webkit' || browserName === 'firefox');

	test('@smoke offline reload (My Day) renders groups in the customized order', async ({
		page,
		context,
	}) => {
		const server = await installMockServer(page, CUSTOM_PALETTE);
		await seedClient(page);
		// My Day at `/` (the PWA start URL; group-by is on). A deep `/list/<id>`
		// offline reload doesn't boot at all today, palette or not -- tracked in
		// tech-debt, out of this plan's scope.
		const firstTags = page.waitForResponse((r) => r.url().endsWith('/tags'));
		await page.goto('/');
		await firstTags;
		await settleFirstLoad(page);

		const controlled = await page
			.evaluate(async () => {
				if (!('serviceWorker' in navigator)) return false;
				await navigator.serviceWorker.ready;
				return true;
			})
			.catch(() => false);
		if (!controlled) {
			test.skip(true, 'service worker unavailable in this environment');
			return;
		}
		if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expectAppSynced(page);
			await expect
				.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {
					timeout: 10_000,
				})
				.toBe(true);
		}

		server.setOffline(true);
		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expectAppSynced(page);
		await expect(page.getByTestId('tag-group-title')).toHaveText(CUSTOM_ORDER);
	});
});
