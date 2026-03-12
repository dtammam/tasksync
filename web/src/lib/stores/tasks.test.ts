import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';
import { auth } from '$lib/stores/auth';
import { api } from '$lib/api/client';

vi.mock('$lib/sound/sound', () => ({
	playCompletion: vi.fn()
}));

vi.mock('$lib/stores/streak', () => ({
	streak: {
		increment: vi.fn().mockReturnValue(false),
		undoCompletion: vi.fn(),
		break: vi.fn(),
		reset: vi.fn(),
		hydrateFromLocal: vi.fn(),
		hydrateFromServer: vi.fn(),
		checkMissedTasksAndApplyDailyReset: vi.fn(),
		loadThemeAssets: vi.fn(),
		getCount: vi.fn().mockReturnValue(0),
		triggerDayComplete: vi.fn().mockReturnValue(false)
	},
	streakDisplay: { subscribe: vi.fn() },
	streakState: { subscribe: vi.fn() },
	streakWordUrl: { subscribe: vi.fn() },
	getRandomJudgmentImage: vi.fn()
}));

import { myDayCompleted, myDayMissed, myDayPending, myDaySuggestions, tasks } from './tasks';
import { playCompletion } from '$lib/sound/sound';
import { streak } from '$lib/stores/streak';
import type { Task } from '$shared/types/task';

const mockedStreakBreak = vi.mocked(streak.break);

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
	created_ts: overrides.created_ts ?? Date.now(),
	updated_ts: overrides.updated_ts ?? Date.now(),
	dirty: overrides.dirty ?? false,
	occurrences_completed: overrides.occurrences_completed ?? 0,
	punted_from_due_date: overrides.punted_from_due_date,
	punted_on_date: overrides.punted_on_date,
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

	it('skip() breaks the streak combo', () => {
		mockedStreakBreak.mockClear();
		tasks.setAll([
			baseTask({
				id: 'skip-me',
				recurrence_id: 'daily',
				due_date: '2026-02-01',
				status: 'pending'
			})
		]);

		tasks.skip('skip-me');

		expect(mockedStreakBreak).toHaveBeenCalledOnce();
	});

	it('skip() does not break the streak if the task has no recurrence_id', () => {
		mockedStreakBreak.mockClear();
		tasks.setAll([
			baseTask({ id: 'no-recurrence', due_date: '2026-02-01', status: 'pending' })
		]);

		tasks.skip('no-recurrence'); // no-op since not recurring

		expect(mockedStreakBreak).not.toHaveBeenCalled();
	});

	it('punts a due-today task into tomorrow while marking today as addressed', () => {
		tasks.setAll([
			baseTask({
				id: 'punt-once',
				due_date: '2026-02-02',
				my_day: true,
				status: 'pending'
			})
		]);

		tasks.punt('punt-once');

		const updated = tasks.getAll().find((t) => t.id === 'punt-once');
		expect(updated?.my_day).toBe(false);
		expect(updated?.due_date).toBe('2026-02-03');
		expect(updated?.punted_from_due_date).toBe('2026-02-02');
		expect(updated?.punted_on_date).toBe('2026-02-02');
		expect(get(myDayPending).map((t) => t.id)).not.toContain('punt-once');
		expect(get(myDayCompleted).map((t) => t.id)).toContain('punt-once');

		vi.setSystemTime(new Date('2026-02-03T12:00:00Z'));
		expect(get(myDayCompleted).map((t) => t.id)).not.toContain('punt-once');
		expect(get(myDayPending).map((t) => t.id)).toContain('punt-once');
	});

	it('does not punt daily recurrence tasks because they already roll to tomorrow on completion', () => {
		tasks.setAll([
			baseTask({
				id: 'punt-daily',
				recurrence_id: 'daily',
				due_date: '2026-02-02',
				status: 'pending'
			})
		]);

		tasks.punt('punt-daily');

		const updated = tasks.getAll().find((t) => t.id === 'punt-daily');
		expect(updated?.due_date).toBe('2026-02-02');
		expect(updated?.punted_from_due_date).toBeUndefined();
		expect(updated?.punted_on_date).toBeUndefined();
	});

	it('keeps weekly cadence after punting an instance before completing it', () => {
		tasks.setAll([
			baseTask({
				id: 'punt-weekly',
				recurrence_id: 'weekly',
				due_date: '2026-02-02',
				status: 'pending'
			})
		]);

		tasks.punt('punt-weekly');
		vi.setSystemTime(new Date('2026-02-03T12:00:00Z'));
		tasks.toggle('punt-weekly');

		const updated = tasks.getAll().find((t) => t.id === 'punt-weekly');
		expect(updated?.due_date).toBe('2026-02-09');
		expect(updated?.punted_from_due_date).toBeUndefined();
		expect(updated?.punted_on_date).toBeUndefined();
	});

	it('clears punt state when missed punted recurring task is completed and next occurrence is today', () => {
		// Simulate: weekly task punted Mon→Tue, never completed on Tue.
		// One week later (next Monday = today) user completes from missed bucket.
		// next_occurrence = nextDueForRecurrence(punted_from = Mon, weekly) = next Mon = TODAY.
		// The next occurrence landing today should NOT show punt state.
		vi.setSystemTime(new Date('2026-02-09T12:00:00Z')); // "today" = next Monday
		tasks.setAll([
			baseTask({
				id: 'missed-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03', // punted-to Tuesday, now missed
				status: 'pending',
				punted_from_due_date: '2026-02-02', // original Monday
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		tasks.toggle('missed-punt');

		const updated = tasks.getAll().find((t) => t.id === 'missed-punt')!;
		expect(updated.due_date).toBe('2026-02-09'); // next Monday = today
		expect(updated.punted_from_due_date).toBeUndefined();
		expect(updated.punted_on_date).toBeUndefined();
	});

	it('clears punt state when missed punted weekdays recurring task is completed and next occurrence is today', () => {
		// Simulate: weekdays task punted Mon→Tue, never completed on Tue.
		// Next weekday Wednesday = today: user completes from missed bucket.
		// anchor = Mon, nextDueForRecurrence = Tue = task.due_date → while advances to Wed = today.
		vi.setSystemTime(new Date('2026-02-04T12:00:00Z')); // Wednesday = today
		tasks.setAll([
			baseTask({
				id: 'missed-weekday-punt',
				recurrence_id: 'weekdays',
				due_date: '2026-02-03', // Tuesday (punted-to), now missed
				status: 'pending',
				punted_from_due_date: '2026-02-02', // Monday
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		tasks.toggle('missed-weekday-punt');

		const updated = tasks.getAll().find((t) => t.id === 'missed-weekday-punt')!;
		expect(updated.due_date).toBe('2026-02-04'); // Wednesday = today
		expect(updated.punted_from_due_date).toBeUndefined();
		expect(updated.punted_on_date).toBeUndefined();
	});

	it('preserves punt metadata when remote merge matches the same pending occurrence', () => {
		const local = baseTask({
			id: 'remote-punt',
			recurrence_id: 'weekly',
			due_date: '2026-02-03',
			status: 'pending',
			punted_from_due_date: '2026-02-02',
			punted_on_date: '2026-02-02',
			dirty: false,
			local: false
		});
		tasks.setAll([local]);

		tasks.mergeRemote([
			baseTask({
				id: 'remote-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				dirty: false,
				local: false
			})
		]);

		const updated = tasks.getAll().find((t) => t.id === 'remote-punt');
		expect(updated?.punted_from_due_date).toBe('2026-02-02');
		expect(updated?.punted_on_date).toBe('2026-02-02');
	});

	it('preserves punt metadata when push replace returns the same pending occurrence', () => {
		const local = baseTask({
			id: 'replace-punt',
			recurrence_id: 'weekly',
			due_date: '2026-02-03',
			status: 'pending',
			punted_from_due_date: '2026-02-02',
			punted_on_date: '2026-02-02',
			dirty: true,
			local: false
		});
		tasks.setAll([local]);

		tasks.replaceWithRemote(
			'replace-punt',
			baseTask({
				id: 'replace-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				dirty: false,
				local: false
			}),
			{ ...local }
		);

		const updated = tasks.getAll().find((t) => t.id === 'replace-punt');
		expect(updated?.punted_from_due_date).toBe('2026-02-02');
		expect(updated?.punted_on_date).toBe('2026-02-02');
	});

	it('does not carry punt state to next occurrence after completing a punted recurring task via sync round-trip', () => {
		// Simulate a full punt → sync → complete → sync cycle.
		// Set up: weekly task synced in punted state (dirty:false after push).
		tasks.setAll([
			baseTask({
				id: 'punted-roundtrip',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				punted_from_due_date: '2026-02-02',
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		// Pull comes in with same punted state from server — punt state preserved.
		tasks.mergeRemote([
			baseTask({
				id: 'punted-roundtrip',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				punted_from_due_date: '2026-02-02',
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		// Day advances to the punted-to date; user completes the task.
		vi.setSystemTime(new Date('2026-02-03T12:00:00Z'));
		tasks.toggle('punted-roundtrip');

		let t = tasks.getAll().find((x) => x.id === 'punted-roundtrip')!;
		expect(t.due_date).toBe('2026-02-09');
		expect(t.punted_from_due_date).toBeUndefined();
		expect(t.punted_on_date).toBeUndefined();
		expect(t.dirty).toBe(true);

		// Push response arrives — server returns updated task at next occurrence, no punt state.
		const serverResponseAfterCompletion = baseTask({
			id: 'punted-roundtrip',
			recurrence_id: 'weekly',
			due_date: '2026-02-09',
			status: 'pending',
			dirty: false,
			local: false
		});
		tasks.replaceWithRemote('punted-roundtrip', serverResponseAfterCompletion, { ...t });

		t = tasks.getAll().find((x) => x.id === 'punted-roundtrip')!;
		expect(t.due_date).toBe('2026-02-09');
		expect(t.punted_from_due_date).toBeUndefined();
		expect(t.punted_on_date).toBeUndefined();
		expect(t.dirty).toBe(false);

		// Re-pull: server returns same state — must not resurrect punt state.
		tasks.mergeRemote([serverResponseAfterCompletion]);

		t = tasks.getAll().find((x) => x.id === 'punted-roundtrip')!;
		expect(t.due_date).toBe('2026-02-09');
		expect(t.punted_from_due_date).toBeUndefined();
		expect(t.punted_on_date).toBeUndefined();
	});

	it('does not carry punt state to next occurrence when server pull lags behind local completion', () => {
		// Simulates the case where a pull arrives AFTER the completion push,
		// but the server still returns old punted state (stale pull). The local
		// dirty flag should protect the completion from being overwritten.
		tasks.setAll([
			baseTask({
				id: 'lagged-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				punted_from_due_date: '2026-02-02',
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		vi.setSystemTime(new Date('2026-02-03T12:00:00Z'));
		tasks.toggle('lagged-punt');

		// Task is now dirty with next occurrence details.
		let t = tasks.getAll().find((x) => x.id === 'lagged-punt')!;
		expect(t.due_date).toBe('2026-02-09');
		expect(t.dirty).toBe(true);

		// Stale pull arrives: server has old punted state. Dirty flag must protect.
		tasks.mergeRemote([
			baseTask({
				id: 'lagged-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				punted_from_due_date: '2026-02-02',
				punted_on_date: '2026-02-02',
				dirty: false,
				local: false
			})
		]);

		t = tasks.getAll().find((x) => x.id === 'lagged-punt')!;
		expect(t.due_date).toBe('2026-02-09');
		expect(t.punted_from_due_date).toBeUndefined();
		expect(t.punted_on_date).toBeUndefined();
	});

	it('does not preserve stale punt state when due_date has advanced past punted_on + 1 day', () => {
		// Regression: the server's COALESCE bug left stale punt fields on tasks after
		// completion. Local cache (IDB) also held this stale state. On each pull,
		// preservePuntState re-applied the stale punt from existing onto the incoming
		// server task, making the "Punted" arrival chip perpetually appear.
		//
		// The fix: reject preservation when due_date > punted_on_date + 1 day.
		vi.setSystemTime(new Date('2026-02-09T12:00:00Z')); // next Monday = today

		// Stale server state: completed on 2026-02-03 (Tue) but punt fields not cleared;
		// task rolled to next_week (2026-02-09 = today) with old punt still attached.
		const staleServerTask = baseTask({
			id: 'stale-punt',
			recurrence_id: 'weekly',
			due_date: '2026-02-09', // next Monday (today) — should have no punt
			status: 'pending',
			punted_from_due_date: '2026-02-02', // Monday of previous week
			punted_on_date: '2026-02-02', // punted on that Monday
			dirty: false,
			local: false
		});

		// Local IDB also holds the same stale state (picked up from a previous pull).
		tasks.setAll([{ ...staleServerTask }]);

		// Pull arrives with server task that also has stale punt (server not yet migrated).
		tasks.mergeRemote([staleServerTask]);

		const afterMerge = tasks.getAll().find((t) => t.id === 'stale-punt')!;
		// stale punt (punted_on = Mon, due = next Mon = 7 days later) must be stripped
		expect(afterMerge.punted_from_due_date).toBeUndefined();
		expect(afterMerge.punted_on_date).toBeUndefined();
	});

	it('still preserves valid punt state when due_date is exactly punted_on + 1 day', () => {
		// Ensure the stale-punt guard does not break normal punt preservation.
		// A task punted Mon→Tue should still show the arrival chip on Tuesday.
		vi.setSystemTime(new Date('2026-02-03T12:00:00Z')); // Tuesday = today

		const local = baseTask({
			id: 'valid-punt',
			recurrence_id: 'weekly',
			due_date: '2026-02-03', // Tuesday (punted-to date)
			status: 'pending',
			punted_from_due_date: '2026-02-02', // Monday
			punted_on_date: '2026-02-02', // punted on Monday
			dirty: false,
			local: false
		});
		tasks.setAll([local]);

		// Pull comes in without punt (e.g., server hasn't received the punt push yet).
		tasks.mergeRemote([
			baseTask({
				id: 'valid-punt',
				recurrence_id: 'weekly',
				due_date: '2026-02-03',
				status: 'pending',
				dirty: false,
				local: false
			})
		]);

		const updated = tasks.getAll().find((t) => t.id === 'valid-punt')!;
		// Valid punt (due = punted_on + 1) must be preserved
		expect(updated.punted_from_due_date).toBe('2026-02-02');
		expect(updated.punted_on_date).toBe('2026-02-02');
	});

	it('removes local tasks when remote tombstones arrive', () => {
		tasks.setAll([
			baseTask({
				id: 'deleted-1',
				status: 'pending',
				dirty: false,
				local: false
			})
		]);

		tasks.applyRemoteDeletes([{ id: 'deleted-1', deleted_ts: 1770033600001 }]);

		expect(tasks.getAll().find((task) => task.id === 'deleted-1')).toBeUndefined();
	});

	it('keeps clean tasks newer than tombstones to allow recreate-after-delete', () => {
		tasks.setAll([
			baseTask({
				id: 'recreated-1',
				status: 'pending',
				updated_ts: 100,
				dirty: false,
				local: false
			})
		]);

		tasks.applyRemoteDeletes([{ id: 'recreated-1', deleted_ts: 50 }]);

		expect(tasks.getAll().find((task) => task.id === 'recreated-1')).toBeTruthy();
	});

	it('renames a task and marks it dirty', () => {
		const t = baseTask({ id: 'r1', title: 'old', dirty: false });
		tasks.setAll([t]);

		tasks.rename('r1', 'new title');
		const updated = tasks.getAll().find((x) => x.id === 'r1');
		expect(updated?.title).toBe('new title');
		expect(updated?.dirty).toBe(true);
	});

	it('saves detail edits in one mutation and one persistence call', () => {
		const saveSpy = vi.spyOn(repo, 'saveTasks').mockResolvedValue(undefined);
		tasks.setAll([
			baseTask({
				id: 'detail-1',
				title: 'Original title',
				list_id: 'goal-management',
				status: 'pending',
				my_day: false
			})
		]);
		saveSpy.mockClear();

		tasks.saveFromDetails('detail-1', {
			title: 'Updated title',
			due_date: '2026-02-06',
			recurrence_id: 'weekly',
			url: 'https://example.com',
			notes: 'Updated notes',
			priority: 1,
			my_day: true,
			list_id: 'goal-management',
			assignee_user_id: 'u-me'
		});

		const updated = tasks.getAll().find((task) => task.id === 'detail-1');
		expect(updated).toMatchObject({
			title: 'Updated title',
			due_date: '2026-02-06',
			recurrence_id: 'weekly',
			url: 'https://example.com',
			notes: 'Updated notes',
			priority: 1,
			my_day: true,
			list_id: 'goal-management',
			assignee_user_id: 'u-me',
			dirty: true
		});
		expect(saveSpy).toHaveBeenCalledTimes(1);
		saveSpy.mockRestore();
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

	it('clears my_day automatically when setDueDate moves a task to a future date', () => {
		tasks.setAll([baseTask({ id: 'md-1', my_day: true, due_date: '2026-02-02', status: 'pending' })]);
		expect(get(myDayPending).map((t) => t.id)).toContain('md-1');

		tasks.setDueDate('md-1', '2099-01-01');

		const updated = tasks.getAll().find((t) => t.id === 'md-1');
		expect(updated?.my_day).toBe(false);
		expect(updated?.due_date).toBe('2099-01-01');
		expect(updated?.dirty).toBe(true);
		expect(get(myDayPending).map((t) => t.id)).not.toContain('md-1');
	});

	it('clears my_day when setDueDate sets today', () => {
		tasks.setAll([baseTask({ id: 'md-2', my_day: true, due_date: '2026-02-01', status: 'pending' })]);

		tasks.setDueDate('md-2', '2026-02-02'); // mock date is 2026-02-02 (today)

		const updated = tasks.getAll().find((t) => t.id === 'md-2');
		expect(updated?.my_day).toBe(false);
		expect(updated?.due_date).toBe('2026-02-02');
	});

	it('keeps my_day when setDueDate sets a past date', () => {
		tasks.setAll([baseTask({ id: 'md-3', my_day: true, due_date: '2026-02-02', status: 'pending' })]);

		tasks.setDueDate('md-3', '2026-01-15'); // past date

		const updated = tasks.getAll().find((t) => t.id === 'md-3');
		expect(updated?.my_day).toBe(true);
		expect(updated?.due_date).toBe('2026-01-15');
	});

	it('setDueToday sets due_date to today, clears my_day and punt state, marks dirty', () => {
		tasks.setAll([
			baseTask({
				id: 'sdt-1',
				my_day: true,
				due_date: '2026-03-01',
				punted_from_due_date: '2026-03-01',
				punted_on_date: '2026-03-01',
				status: 'pending'
			})
		]);

		tasks.setDueToday('sdt-1');

		const updated = tasks.getAll().find((t) => t.id === 'sdt-1');
		expect(updated?.due_date).toBe('2026-02-02'); // mock today
		expect(updated?.my_day).toBe(false);
		expect(updated?.punted_from_due_date).toBeUndefined();
		expect(updated?.punted_on_date).toBeUndefined();
		expect(updated?.dirty).toBe(true);
	});

	it('setDueToday on non-existent id is a no-op', () => {
		tasks.setAll([baseTask({ id: 'sdt-x' })]);
		tasks.setDueToday('does-not-exist');
		expect(tasks.getAll()).toHaveLength(1);
	});

	it('catchUp advances missed recurring task to next occurrence after today', () => {
		tasks.setAll([
			baseTask({
				id: 'cu-1',
				recurrence_id: 'daily',
				due_date: '2026-01-30', // 3 days before mock today (2026-02-02)
				status: 'pending'
			})
		]);

		expect(get(myDayMissed).map((t) => t.id)).toContain('cu-1');

		tasks.catchUp('cu-1');

		const updated = tasks.getAll().find((t) => t.id === 'cu-1');
		expect(updated?.due_date).toBe('2026-02-03'); // next daily after today
		expect(updated?.occurrences_completed).toBe(0); // not incremented
		expect(updated?.completed_ts).toBeUndefined();
		expect(updated?.dirty).toBe(true);
		expect(get(myDayMissed).map((t) => t.id)).not.toContain('cu-1');
	});

	it('catchUp clears punt state', () => {
		tasks.setAll([
			baseTask({
				id: 'cu-2',
				recurrence_id: 'weekly',
				due_date: '2026-01-19', // ~2 weeks before today
				punted_from_due_date: '2026-01-19',
				punted_on_date: '2026-01-19',
				status: 'pending'
			})
		]);

		tasks.catchUp('cu-2');

		const updated = tasks.getAll().find((t) => t.id === 'cu-2');
		expect(updated?.punted_from_due_date).toBeUndefined();
		expect(updated?.punted_on_date).toBeUndefined();
		expect(updated?.due_date).toBe('2026-02-09'); // next weekly after 2026-02-02
	});

	it('catchUp is a no-op for non-recurring tasks', () => {
		tasks.setAll([
			baseTask({ id: 'cu-3', due_date: '2026-01-30', status: 'pending' })
		]);

		tasks.catchUp('cu-3');

		const updated = tasks.getAll().find((t) => t.id === 'cu-3');
		expect(updated?.due_date).toBe('2026-01-30'); // unchanged
	});

	it('catchUp is a no-op when task has no due_date', () => {
		tasks.setAll([
			baseTask({ id: 'cu-4', recurrence_id: 'daily', due_date: undefined, status: 'pending' })
		]);

		tasks.catchUp('cu-4');

		const updated = tasks.getAll().find((t) => t.id === 'cu-4');
		expect(updated?.due_date).toBeUndefined();
	});

	it('catchUp does not call streak.break()', () => {
		mockedStreakBreak.mockClear();
		tasks.setAll([
			baseTask({
				id: 'cu-5',
				recurrence_id: 'daily',
				due_date: '2026-01-30',
				status: 'pending'
			})
		]);

		tasks.catchUp('cu-5');

		expect(mockedStreakBreak).not.toHaveBeenCalled();
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

	it('imports tasks in batch and skips duplicates from existing and import payload', () => {
		tasks.setAll([
			baseTask({
				id: 'existing',
				title: 'Buy milk',
				list_id: 'goal-management',
				status: 'pending'
			})
		]);

		const result = tasks.importBatch(
			[
				{ title: 'Buy milk', status: 'pending', list_id: 'goal-management' },
				{ title: 'Buy eggs', status: 'pending', list_id: 'goal-management' },
				{ title: 'Buy eggs', status: 'pending', list_id: 'goal-management' },
				{ title: 'Buy carrots', status: 'done', list_id: 'goal-management' },
				{ title: 'Buy bread', status: 'pending', list_id: 'goal-management' }
			],
			'goal-management'
		);

		expect(result).toEqual({ created: 3, skipped: 2, reactivated: 0 });
		const all = tasks.getAll();
		expect(all.filter((task) => task.title === 'Buy eggs')).toHaveLength(1);
		expect(all.find((task) => task.title === 'Buy eggs')?.status).toBe('pending');
		expect(all.find((task) => task.title === 'Buy carrots')?.status).toBe('done');
		expect(all.find((task) => task.title === 'Buy bread')?.status).toBe('pending');
	});

	it('reactivates matching completed tasks when duplicates are imported', () => {
		tasks.setAll([
			baseTask({
				id: 'done-duplicate',
				title: 'Refill pantry',
				list_id: 'goal-management',
				status: 'done'
			})
		]);

		const result = tasks.importBatch(
			[{ title: 'Refill pantry', status: 'pending', list_id: 'goal-management' }],
			'goal-management'
		);

		expect(result).toEqual({ created: 0, skipped: 1, reactivated: 1 });
		const updated = tasks.getAll().find((task) => task.id === 'done-duplicate');
		expect(updated?.status).toBe('pending');
		expect(updated?.completed_ts).toBeUndefined();
		expect(updated?.dirty).toBe(true);
	});

	it('unchecks completed tasks in a list while leaving other lists untouched', () => {
		tasks.setAll([
			baseTask({ id: 'l1-done', title: 'Done A', list_id: 'goal-management', status: 'done' }),
			baseTask({ id: 'l1-pending', title: 'Pending A', list_id: 'goal-management', status: 'pending' }),
			baseTask({ id: 'l2-done', title: 'Done B', list_id: 'daily-management', status: 'done' })
		]);

		const changed = tasks.uncheckAllInList('goal-management');

		expect(changed).toBe(1);
		const all = tasks.getAll();
		expect(all.find((task) => task.id === 'l1-done')?.status).toBe('pending');
		expect(all.find((task) => task.id === 'l1-done')?.dirty).toBe(true);
		expect(all.find((task) => task.id === 'l2-done')?.status).toBe('done');
	});

	it('only unchecks owned tasks when owner filter is provided', () => {
		tasks.setAll([
			baseTask({
				id: 'mine',
				title: 'Mine',
				list_id: 'goal-management',
				status: 'done',
				created_by_user_id: 'u-me'
			}),
			baseTask({
				id: 'theirs',
				title: 'Theirs',
				list_id: 'goal-management',
				status: 'done',
				created_by_user_id: 'u-other'
			})
		]);

		const changed = tasks.uncheckAllInList('goal-management', { ownerUserId: 'u-me' });

		expect(changed).toBe(1);
		expect(tasks.getAll().find((task) => task.id === 'mine')?.status).toBe('pending');
		expect(tasks.getAll().find((task) => task.id === 'theirs')?.status).toBe('done');
	});
});
