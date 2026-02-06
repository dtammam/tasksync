import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';

vi.mock('$lib/sound/sound', () => ({
	playCompletion: vi.fn()
}));

import { myDayPending, myDaySuggestions, tasks } from './tasks';
import { playCompletion } from '$lib/sound/sound';
import type { Task } from '$shared/types/task';

const mockedPlayCompletion = vi.mocked(playCompletion);

const baseTask = (overrides: Partial<Task> = {}): Task => ({
	id: overrides.id ?? 't1',
	title: overrides.title ?? 'task',
	status: overrides.status ?? 'pending',
	list_id: overrides.list_id ?? 'goal-management',
	my_day: overrides.my_day ?? false,
	priority: overrides.priority ?? 0,
	tags: overrides.tags ?? [],
	checklist: overrides.checklist ?? [],
	order: overrides.order ?? 'a',
	attachments: overrides.attachments ?? [],
	created_ts: overrides.created_ts ?? Date.now(),
	updated_ts: overrides.updated_ts ?? Date.now(),
	dirty: overrides.dirty ?? false,
	occurrences_completed: overrides.occurrences_completed ?? 0,
	due_date: overrides.due_date,
	recurrence_id: overrides.recurrence_id,
	notes: overrides.notes,
	url: overrides.url
});

describe('tasks store helpers', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-02T12:00:00Z'));
		tasks.setAll([]);
		mockedPlayCompletion.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('puts due-today tasks into My Day even when not explicitly flagged', () => {
		tasks.setAll([
			baseTask({ id: 'due', due_date: '2026-02-02', status: 'pending' }),
			baseTask({ id: 'future', due_date: '2026-02-05', status: 'pending' })
		]);

		const today = get(myDayPending);
		expect(today.find((t) => t.id === 'due')).toBeTruthy();
		expect(today.find((t) => t.id === 'future')).toBeUndefined();
	});

	it('rolls forward recurring tasks when toggled complete', () => {
		const rec = baseTask({
			id: 'rec-1',
			recurrence_id: 'daily',
			due_date: '2026-02-02',
			status: 'pending',
			dirty: true
		});
		tasks.setAll([rec]);

		tasks.toggle('rec-1');
		const updated = tasks.getAll().find((t) => t.id === 'rec-1');
		expect(updated?.occurrences_completed).toBe(1);
		expect(updated?.due_date).toBe('2026-02-03');
		expect(updated?.status).toBe('pending');
	});

	it('renames a task and marks it dirty', () => {
		const t = baseTask({ id: 'r1', title: 'old', dirty: false });
		tasks.setAll([t]);

		tasks.rename('r1', 'new title');
		const updated = tasks.getAll().find((x) => x.id === 'r1');
		expect(updated?.title).toBe('new title');
		expect(updated?.dirty).toBe(true);
	});

	it('suggests tasks due today or tomorrow that are not already in My Day', () => {
		tasks.setAll([
			baseTask({ id: 'due-today', due_date: '2026-02-02', status: 'pending' }),
			baseTask({ id: 'due-tomorrow', due_date: '2026-02-03', status: 'pending' }),
			baseTask({ id: 'already-myday', my_day: true, due_date: '2026-02-02' }),
			baseTask({ id: 'done-task', due_date: '2026-02-02', status: 'done' }),
			baseTask({ id: 'no-due', priority: 1 })
		]);

		const suggestions = get(myDaySuggestions);
		expect(suggestions.map((t) => t.id)).toEqual(['due-tomorrow', 'no-due']);
	});

	it('sets due date and priority via helpers', () => {
		tasks.setAll([baseTask({ id: 'p1', priority: 0, due_date: undefined })]);
		tasks.setPriority('p1', 2);
		tasks.setDueDate('p1', '2026-02-10');
		const updated = tasks.getAll().find((t) => t.id === 'p1');
		expect(updated?.priority).toBe(2);
		expect(updated?.due_date).toBe('2026-02-10');
		expect(updated?.dirty).toBe(true);
	});

	it('plays completion sound only when task moves to done', () => {
		tasks.setAll([baseTask({ id: 'sound-1', status: 'pending' })]);

		tasks.toggle('sound-1');
		tasks.toggle('sound-1');

		expect(mockedPlayCompletion).toHaveBeenCalledTimes(1);
	});

	it('replaces in-memory tasks with empty storage snapshot during hydrate', async () => {
		tasks.setAll([baseTask({ id: 'stale' })]);
		const loadSpy = vi.spyOn(repo, 'loadAll').mockResolvedValueOnce({ lists: [], tasks: [] });

		await tasks.hydrateFromDb();

		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(tasks.getAll()).toEqual([]);
		loadSpy.mockRestore();
	});
});
