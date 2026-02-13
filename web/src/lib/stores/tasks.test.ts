import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';
import { auth } from '$lib/stores/auth';
import { api } from '$lib/api/client';

vi.mock('$lib/sound/sound', () => ({
	playCompletion: vi.fn()
}));

import { myDayCompleted, myDayMissed, myDayPending, myDaySuggestions, tasks } from './tasks';
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
	url: overrides.url,
	completed_ts: overrides.completed_ts,
	assignee_user_id: overrides.assignee_user_id,
	created_by_user_id: overrides.created_by_user_id
});

describe('tasks store helpers', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-02T12:00:00Z'));
		localStorage.clear();
		auth.logout();
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

	it('surfaces overdue pending tasks in the missed bucket', () => {
		tasks.setAll([
			baseTask({ id: 'overdue', due_date: '2026-02-01', status: 'pending' }),
			baseTask({ id: 'today', due_date: '2026-02-02', status: 'pending' }),
			baseTask({ id: 'done-overdue', due_date: '2026-02-01', status: 'done' })
		]);

		expect(get(myDayPending).map((t) => t.id)).toEqual(['today']);
		expect(get(myDayMissed).map((t) => t.id)).toEqual(['overdue']);
	});

	it('shows only tasks assigned to the signed-in user in My Day buckets', async () => {
		const meSpy = vi.spyOn(api, 'me').mockResolvedValueOnce({
			user_id: 'u-me',
			email: 'me@example.com',
			display: 'Me',
			space_id: 's1',
			role: 'admin'
		});
		localStorage.setItem('tasksync:auth-token', 'test-token');
		localStorage.setItem('tasksync:auth-mode', 'token');
		await auth.hydrate();
		meSpy.mockRestore();

		tasks.setAll([
			baseTask({
				id: 'mine-pending',
				my_day: true,
				status: 'pending',
				assignee_user_id: 'u-me',
				created_by_user_id: 'u-me'
			}),
			baseTask({
				id: 'mine-missed',
				due_date: '2026-02-01',
				status: 'pending',
				assignee_user_id: 'u-me',
				created_by_user_id: 'u-me'
			}),
			baseTask({
				id: 'mine-done',
				my_day: true,
				status: 'done',
				completed_ts: new Date('2026-02-02T10:00:00Z').getTime(),
				assignee_user_id: 'u-me',
				created_by_user_id: 'u-me'
			}),
			baseTask({
				id: 'theirs',
				my_day: true,
				status: 'pending',
				assignee_user_id: 'u-other',
				created_by_user_id: 'u-other'
			})
		]);

		expect(get(myDayPending).map((t) => t.id)).toEqual(['mine-pending']);
		expect(get(myDayMissed).map((t) => t.id)).toEqual(['mine-missed']);
		expect(get(myDayCompleted).map((t) => t.id)).toEqual(['mine-done']);
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
		expect(typeof updated?.completed_ts).toBe('number');
	});

	it('shows recurring tasks completed today in My Day completed after next due is scheduled', () => {
		tasks.setAll([
			baseTask({
				id: 'rec-complete',
				recurrence_id: 'daily',
				due_date: '2026-02-02',
				status: 'pending'
			})
		]);

		tasks.toggle('rec-complete');

		expect(get(myDayCompleted).map((t) => t.id)).toEqual(['rec-complete']);
	});

	it('can undo a same-day recurring completion back to the original due date', () => {
		tasks.setAll([
			baseTask({
				id: 'rec-undo',
				recurrence_id: 'daily',
				due_date: '2026-02-02',
				status: 'pending',
				occurrences_completed: 0
			})
		]);

		tasks.toggle('rec-undo');
		let updated = tasks.getAll().find((t) => t.id === 'rec-undo');
		expect(updated?.due_date).toBe('2026-02-03');
		expect(updated?.occurrences_completed).toBe(1);
		expect(typeof updated?.completed_ts).toBe('number');
		expect(get(myDayCompleted).map((t) => t.id)).toEqual(['rec-undo']);

		tasks.undoRecurringCompletion('rec-undo');
		updated = tasks.getAll().find((t) => t.id === 'rec-undo');
		expect(updated?.due_date).toBe('2026-02-02');
		expect(updated?.occurrences_completed).toBe(0);
		expect(updated?.completed_ts).toBeUndefined();
		expect(get(myDayCompleted)).toEqual([]);
		expect(get(myDayPending).map((t) => t.id)).toEqual(['rec-undo']);
	});

	it('rolls weekday recurrence to next business day', () => {
		vi.setSystemTime(new Date('2026-02-06T12:00:00Z'));
		const rec = baseTask({
			id: 'rec-weekdays',
			recurrence_id: 'weekdays',
			due_date: '2026-02-06',
			status: 'pending',
			dirty: true
		});
		tasks.setAll([rec]);

		tasks.toggle('rec-weekdays');
		const updated = tasks.getAll().find((t) => t.id === 'rec-weekdays');
		expect(updated?.due_date).toBe('2026-02-09');
	});

	it('rolls quarterly, biannual, and annual recurrences forward correctly', () => {
		tasks.setAll([
			baseTask({
				id: 'rec-quarterly',
				recurrence_id: 'quarterly',
				due_date: '2026-02-02',
				status: 'pending'
			}),
			baseTask({
				id: 'rec-biannual',
				recurrence_id: 'biannual',
				due_date: '2026-02-02',
				status: 'pending'
			}),
			baseTask({
				id: 'rec-annual',
				recurrence_id: 'annual',
				due_date: '2026-02-02',
				status: 'pending'
			})
		]);

		tasks.toggle('rec-quarterly');
		tasks.toggle('rec-biannual');
		tasks.toggle('rec-annual');

		const nextDueById = new Map(tasks.getAll().map((task) => [task.id, task.due_date]));
		expect(nextDueById.get('rec-quarterly')).toBe('2026-05-02');
		expect(nextDueById.get('rec-biannual')).toBe('2026-08-02');
		expect(nextDueById.get('rec-annual')).toBe('2027-02-02');
	});

	it('clears a missed recurring task from missed when skipping to next occurrence', () => {
		tasks.setAll([
			baseTask({
				id: 'missed-recurring',
				recurrence_id: 'daily',
				due_date: '2026-02-01',
				status: 'pending'
			})
		]);

		expect(get(myDayMissed).map((t) => t.id)).toEqual(['missed-recurring']);

		tasks.skip('missed-recurring');

		expect(get(myDayMissed)).toEqual([]);
		expect(get(myDayPending).map((t) => t.id)).toEqual(['missed-recurring']);
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
			baseTask({
				id: 'due-tomorrow-recurring',
				due_date: '2026-02-03',
				status: 'pending',
				recurrence_id: 'daily'
			}),
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

	it('shows completed My Day tasks only for the completion day', () => {
		tasks.setAll([
			baseTask({
				id: 'done-today',
				status: 'done',
				my_day: true,
				completed_ts: new Date('2026-02-02T08:00:00Z').getTime()
			}),
			baseTask({
				id: 'done-yesterday',
				status: 'done',
				my_day: true,
				completed_ts: new Date('2026-02-01T08:00:00Z').getTime()
			})
		]);

		const completed = get(myDayCompleted);
		expect(completed.map((t) => t.id)).toEqual(['done-today']);
	});

	it('drops completed My Day tasks after midnight while the view stays open', () => {
		vi.setSystemTime(new Date('2026-02-02T23:59:00'));
		tasks.setAll([
			baseTask({
				id: 'done-today',
				status: 'done',
				my_day: true,
				completed_ts: new Date('2026-02-02T23:50:00').getTime()
			})
		]);

		let completed: Task[] = [];
		const unsubscribe = myDayCompleted.subscribe((items) => {
			completed = items;
		});

		expect(completed.map((t) => t.id)).toEqual(['done-today']);

		vi.setSystemTime(new Date('2026-02-03T00:01:00'));
		vi.advanceTimersByTime(60 * 1000);

		expect(completed).toEqual([]);
		unsubscribe();
	});

	it('replaces in-memory tasks with empty storage snapshot during hydrate', async () => {
		tasks.setAll([baseTask({ id: 'stale' })]);
		const loadSpy = vi.spyOn(repo, 'loadAll').mockResolvedValueOnce({ lists: [], tasks: [] });

		await tasks.hydrateFromDb();

		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(tasks.getAll()).toEqual([]);
		loadSpy.mockRestore();
	});

	it('deletes unsynced local tasks without remote API calls', async () => {
		tasks.setAll([baseTask({ id: 'local-temp', local: true, dirty: true })]);
		await tasks.deleteRemote('local-temp');
		expect(tasks.getAll()).toEqual([]);
	});
});
