import { expect, test, type Page } from '@playwright/test';
import { defaultTestUser, setAuthenticatedClientState } from './helpers/auth';

// Fixed slots under the task title (plan 2026-11-04-row-fixed-slots): on every
// row the date, action, tag and ⋯ slots sit at identical x-positions however
// the row varies, and the line never wraps.

const LONG_LIST = 'An extremely long list name that can never fit beside the slots';
const isoPlus = (days: number) => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const LISTS = [
	{ id: 'my-day', name: 'My Day', icon: '🌅', order: 'a' },
	{ id: 'goal-management', name: 'Goal Management', icon: '🎯', order: 'b' },
	{ id: 'tasks', name: 'Tasks', icon: '🗒', order: 'd' },
	{ id: 'slots-long', name: LONG_LIST, icon: '📏', order: 'z' }
];

interface Seed { title: string; list_id: string; due_date?: string; recurrence_id?: string; my_day?: boolean; emoji?: string }

// Every axis varies: long/short list name, dated/recurring/undated,
// Catch Up/My Day/neither, tagged/untagged.
const SEEDS: Seed[] = [
	{ title: 'Slots dated long', list_id: 'slots-long', due_date: isoPlus(0) },
	{ title: 'Slots recurring short', list_id: 'tasks', due_date: isoPlus(0), recurrence_id: 'weekly' },
	{ title: 'Slots undated tagged', list_id: 'slots-long', my_day: true, emoji: '🎯' },
	{ title: 'Slots missed catchup', list_id: 'tasks', due_date: isoPlus(-1), recurrence_id: 'daily' },
	{ title: 'Slots missed tagged', list_id: 'slots-long', due_date: isoPlus(-3), recurrence_id: 'weekly', emoji: '🎯' },
	{ title: 'Slots missed plain', list_id: 'tasks', due_date: isoPlus(-1) },
	{ title: 'Slots list undated', list_id: 'slots-long' },
	{ title: 'Slots list future', list_id: 'slots-long', due_date: isoPlus(3) },
	{ title: 'Slots later tagged', list_id: 'slots-long', due_date: isoPlus(5), emoji: '🎯' }
];

// Seed IndexedDB while the app is NOT running (a static asset page on the same
// origin), so no in-memory store can overwrite the seed (cf. tech-debt 052).
const seed = async (page: Page) => {
	await setAuthenticatedClientState(page);
	await page.goto('/robots.txt');
	await page.evaluate(
		async ({ user, lists, seeds }) => {
			const scope = `space:${user.space_id}:user:${user.user_id}`
				.toLowerCase()
				.replace(/[^a-z0-9_-]/g, '_')
				.slice(0, 80);
			const now = Date.now();
			await new Promise<void>((resolve, reject) => {
				const req = indexedDB.open(`tasksync_${scope}`, 2);
				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists', { keyPath: 'id' });
					if (!db.objectStoreNames.contains('tasks')) {
						db.createObjectStore('tasks', { keyPath: 'id' }).createIndex('by-list', 'list_id');
					}
					if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
				};
				req.onerror = () => reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					const tx = db.transaction(['lists', 'tasks'], 'readwrite');
					for (const list of lists) tx.objectStore('lists').put(list);
					seeds.forEach((s, i) =>
						tx.objectStore('tasks').put({
							id: `slots-${i}`,
							status: 'pending',
							my_day: false,
							priority: 0,
							checklist: [],
							order: `slots-${String(i).padStart(2, '0')}`,
							created_ts: now,
							updated_ts: now,
							created_by_user_id: user.user_id,
							assignee_user_id: user.user_id,
							occurrences_completed: 0,
							dirty: false,
							local: false,
							...s
						})
					);
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => reject(tx.error);
				};
			});
		},
		{ user: defaultTestUser, lists: LISTS, seeds: SEEDS }
	);
};

interface RowBox {
	title: string;
	rowRight: number;
	subHeight: number;
	moreHeight: number;
	slots: Record<'more' | 'action' | 'tag' | 'date', number | null>;
	firstSlotLeft: number;
	list: { right: number; title: string | null; overflow: string; whiteSpace: string; truncated: boolean } | null;
}

const measureRows = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-testid="task-row"]')]
			.filter((row) => row.querySelector('[data-testid="task-title"]')?.textContent?.startsWith('Slots '))
			.map((row): RowBox => {
				const sub = row.querySelector<HTMLElement>('.sub')!;
				const right = (sel: string) => {
					const el = sub.querySelector<HTMLElement>(sel);
					return el ? el.getBoundingClientRect().right : null;
				};
				const more = sub.querySelector<HTMLElement>('.actions-chip')!;
				const slotEls = [...sub.querySelectorAll<HTMLElement>('[data-testid="task-date"], [data-testid="task-catchup"], [data-testid="task-myday-btn"], [data-testid="task-tag-chip"], .actions-chip')];
				const listEl = sub.querySelector<HTMLElement>('[data-testid="task-list-name"]');
				const cs = listEl ? getComputedStyle(listEl) : null;
				return {
					title: row.querySelector('[data-testid="task-title"]')!.textContent!.trim(),
					rowRight: row.getBoundingClientRect().right,
					subHeight: sub.getBoundingClientRect().height,
					moreHeight: more.getBoundingClientRect().height,
					slots: {
						more: more.getBoundingClientRect().right,
						action: right('[data-testid="task-catchup"], [data-testid="task-myday-btn"]'),
						tag: right('[data-testid="task-tag-chip"]'),
						date: right('[data-testid="task-date"]')
					},
					firstSlotLeft: Math.min(...slotEls.map((el) => el.getBoundingClientRect().left)),
					list:
						listEl && cs
							? {
									right: listEl.getBoundingClientRect().right,
									title: listEl.getAttribute('title'),
									overflow: cs.textOverflow,
									whiteSpace: cs.whiteSpace,
									truncated: listEl.scrollWidth > listEl.clientWidth
								}
							: null
				};
			})
	);

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

const assertFixedSlots = (rows: RowBox[], expectedCount: number) => {
	expect(rows.map((r) => r.title).sort()).toHaveLength(expectedCount);
	for (const slot of ['more', 'action', 'tag', 'date'] as const) {
		const present = rows.filter((r) => r.slots[slot] !== null);
		// Each slot is both present and absent somewhere, except ⋯ (always present).
		expect(present.length, `${slot} present in ≥2 rows`).toBeGreaterThanOrEqual(2);
		if (slot !== 'more') expect(present.length, `${slot} absent in ≥1 row`).toBeLessThan(rows.length);
		// Same position relative to the row's own right edge, across every row…
		const offsets = present.map((r) => r.rowRight - (r.slots[slot] as number));
		expect(spread(offsets), `${slot} offset from row edge: ${JSON.stringify(offsets)}`).toBeLessThanOrEqual(1);
		// …and the same absolute x across rows that share a container (same row width).
		const byEdge = new Map<number, number[]>();
		for (const r of present) {
			const key = Math.round(r.rowRight);
			byEdge.set(key, [...(byEdge.get(key) ?? []), r.slots[slot] as number]);
		}
		for (const xs of byEdge.values()) expect(spread(xs), `${slot} absolute right`).toBeLessThanOrEqual(1);
	}
	// Same strip height on every row (a dated row is no taller than an undated one).
	expect(spread(rows.map((r) => r.subHeight)), 'strip heights').toBeLessThanOrEqual(1);
	for (const r of rows) {
		// One line: the strip is no taller than its tallest chip.
		expect(r.subHeight, `${r.title} .sub height`).toBeLessThanOrEqual(r.moreHeight + 1);
		// Nothing spills past the row.
		expect(r.slots.more, `${r.title} ⋯ inside row`).toBeLessThanOrEqual(r.rowRight);
		if (r.list) {
			expect(r.list.overflow).toBe('ellipsis');
			expect(r.list.whiteSpace).toBe('nowrap');
			expect(r.list.right, `${r.title} list name clear of slots`).toBeLessThanOrEqual(r.firstSlotLeft);
		}
	}
};

for (const viewport of [
	{ width: 360, height: 740 },
	{ width: 1280, height: 800 }
]) {
	test.describe(`Row fixed slots @ ${viewport.width}px`, () => {
		test.use({ viewport });

		test(`@smoke My Day: slots identical across rows, list name truncates`, async ({ page }) => {
			await seed(page);
			await page.goto('/');
			await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
			// My Day holds the seeds due today or earlier (Missed) plus the legacy my_day one.
			const titles = SEEDS.filter((s) => (s.due_date && s.due_date <= isoPlus(0)) || s.my_day).map((s) => s.title);
			for (const t of titles) await expect(page.getByTestId('task-row').filter({ hasText: t })).toHaveCount(1);

			const rows = await measureRows(page);
			assertFixedSlots(rows, titles.length);
			// No action other than Catch Up appears in My Day; Catch Up only on missed recurring.
			await expect(page.getByTestId('task-myday-btn')).toHaveCount(0);
			const longRows = rows.filter((r) => r.list?.title === LONG_LIST);
			expect(longRows.length).toBeGreaterThanOrEqual(2);
			// At phone width the long name must end in … (at 1280 it fits, so only the style is checked).
			if (viewport.width === 360) {
				for (const r of longRows) expect(r.list?.truncated, `${r.title} truncated`).toBe(true);
			}
			// R3: no "Next:" anywhere; recurring rows show the ↻ glyph.
			await expect(page.getByTestId('task-row').filter({ hasText: 'Next:' })).toHaveCount(0);
			await expect(
				page.getByTestId('task-row').filter({ hasText: 'Slots recurring short' }).getByTestId('task-date')
			).toContainText('↻');
		});

		test(`@smoke list view: slots identical across rows`, async ({ page }) => {
			await seed(page);
			await page.goto('/list/slots-long');
			await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
			const titles = SEEDS.filter((s) => s.list_id === 'slots-long').map((s) => s.title);
			for (const t of titles) await expect(page.getByTestId('task-row').filter({ hasText: t })).toHaveCount(1);

			const rows = await measureRows(page);
			assertFixedSlots(rows, titles.length);
			// List views render no list-name cell, yet the slots sit where they do in My Day.
			expect(rows.every((r) => r.list === null)).toBe(true);
			// Shared action slot (R5): Catch Up wins — a missed recurring task shows no My Day button.
			const missed = page.getByTestId('task-row').filter({ hasText: 'Slots missed tagged' });
			await expect(missed.getByTestId('task-catchup')).toHaveCount(1);
			await expect(missed.getByTestId('task-myday-btn')).toHaveCount(0);
		});
	});
}
