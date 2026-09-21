import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';
import { auth } from '$lib/stores/auth';
import { api } from '$lib/api/client';
import { lists } from '$lib/stores/lists';

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

import {
	myDayCompleted,
	myDayMissed,
	myDayPending,
	myDaySuggestions,
	pendingDelete,
	pendingDeleteBatch,
	tasks
} from './tasks';
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
	created_by_user_id: overrides.created_by_user_id,
	emoji: overrides.emoji
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
		// Fake timer: today is 2026-02-02. Yesterday is 2026-02-01.
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

		// Task is no longer in the missed bucket.
		expect(get(myDayMissed)).toEqual([]);
		// Task advances strictly past today (to 2026-02-03), so it is not in myDayPending either.
		const skipped = tasks.getAll().find((t) => t.id === 'missed-recurring');
		expect(skipped?.due_date).toBe('2026-02-03');
	});

	it('skip() on a daily task overdue by 1 day advances due_date strictly after today', () => {
		// Fake timer: today is 2026-02-02. Yesterday is 2026-02-01.
		tasks.setAll([
			baseTask({
				id: 'skip-overdue-1',
				recurrence_id: 'daily',
				due_date: '2026-02-01',
				status: 'pending'
			})
		]);

		tasks.skip('skip-overdue-1');

		const updated = tasks.getAll().find((t) => t.id === 'skip-overdue-1');
		// Should land on tomorrow (2026-02-03), not today or in the past.
		expect(updated?.due_date).toBe('2026-02-03');
	});

	it('skip() on a daily task overdue by 3 days advances due_date strictly after today', () => {
		// Fake timer: today is 2026-02-02. Three days ago is 2026-01-30.
		tasks.setAll([
			baseTask({
				id: 'skip-overdue-3',
				recurrence_id: 'daily',
				due_date: '2026-01-30',
				status: 'pending'
			})
		]);

		tasks.skip('skip-overdue-3');

		const updated = tasks.getAll().find((t) => t.id === 'skip-overdue-3');
		// Should land on tomorrow (2026-02-03), not a date still in the past.
		expect(updated?.due_date).toBe('2026-02-03');
	});

	it('skip() on a daily task with punted_from_due_date clears punt state and advances past today', () => {
		// Fake timer: today is 2026-02-02. Yesterday is 2026-02-01, two days ago is 2026-01-31.
		tasks.setAll([
			baseTask({
				id: 'skip-punted',
				recurrence_id: 'daily',
				due_date: '2026-02-01',
				punted_from_due_date: '2026-01-31',
				status: 'pending'
			})
		]);

		tasks.skip('skip-punted');

		const updated = tasks.getAll().find((t) => t.id === 'skip-punted');
		// due_date should be strictly after today (tomorrow or later).
		expect(updated?.due_date).toBe('2026-02-03');
		// punted_from_due_date should be cleared by clearPuntState.
		expect(updated?.punted_from_due_date).toBeUndefined();
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

	it('keeps the emoji tag stable when the server ack echoes back the same value', () => {
		const local = baseTask({
			id: 'emoji-roundtrip',
			emoji: '🥦',
			dirty: true,
			local: false
		});
		tasks.setAll([local]);

		tasks.replaceWithRemote(
			'emoji-roundtrip',
			baseTask({ id: 'emoji-roundtrip', emoji: '🥦', dirty: false, local: false }),
			{ ...local }
		);

		const updated = tasks.getAll().find((t) => t.id === 'emoji-roundtrip');
		expect(updated?.emoji).toBe('🥦');
	});

	it('preserves a local emoji edit made after push but before the ack lands, over a stale remote echo', () => {
		const sent = baseTask({ id: 'emoji-race', emoji: '🥦', dirty: true, local: false });
		tasks.setAll([sent]);

		// User changes the tag locally while the push for the original value is in flight.
		tasks.setAll([{ ...sent, emoji: '🧀' }]);

		// The ack that comes back reflects what was actually sent (the stale value), not the new local edit.
		tasks.replaceWithRemote(
			'emoji-race',
			baseTask({ id: 'emoji-race', emoji: '🥦', dirty: false, local: false }),
			{ ...sent }
		);

		const updated = tasks.getAll().find((t) => t.id === 'emoji-race');
		expect(updated?.emoji).toBe('🧀');
		expect(updated?.dirty).toBe(true);
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

	it('clearListRemote removes only the cleared list\'s tasks, after the server call succeeds', async () => {
		tasks.setAll([
			baseTask({ id: 'a1', list_id: 'list-a' }),
			baseTask({ id: 'a2', list_id: 'list-a', status: 'done' }),
			baseTask({ id: 'b1', list_id: 'list-b' })
		]);
		const clearSpy = vi
			.spyOn(api, 'clearListTasks')
			.mockResolvedValueOnce({ deleted_count: 2 });

		const deletedCount = await tasks.clearListRemote('list-a');

		expect(clearSpy).toHaveBeenCalledWith('list-a');
		expect(deletedCount).toBe(2);
		expect(tasks.getAll().map((t) => t.id)).toEqual(['b1']);
		clearSpy.mockRestore();
	});

	it('clearListRemote does not remove any local tasks when the server call fails', async () => {
		tasks.setAll([baseTask({ id: 'a1', list_id: 'list-a' })]);
		const clearSpy = vi.spyOn(api, 'clearListTasks').mockRejectedValueOnce(new Error('API 500'));

		await expect(tasks.clearListRemote('list-a')).rejects.toThrow('API 500');
		expect(tasks.getAll().map((t) => t.id)).toEqual(['a1']);
		clearSpy.mockRestore();
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

	it('applies a list default tag to a manually created task that did not specify one', () => {
		const originalLists = get(lists);
		lists.setAll(
			originalLists.map((l) => (l.id === 'goal-management' ? { ...l, default_emoji: '🎯' } : l))
		);
		try {
			const created = tasks.createLocalWithOptions('New goal', 'goal-management');
			expect(created?.emoji).toBe('🎯');

			const explicit = tasks.createLocalWithOptions('Tagged goal', 'goal-management', {
				emoji: '⭐'
			});
			expect(explicit?.emoji).toBe('⭐');
		} finally {
			lists.setAll(originalLists);
		}
	});

	it('mints a bare-UUID id for a locally created task (no local- prefix)', () => {
		tasks.setAll([]);
		const created = tasks.createLocalWithOptions('Fresh task', 'goal-management');
		expect(created).toBeTruthy();
		// A bare RFC-4122 UUID — the same shape the server stores and acks back.
		expect(created?.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		);
		expect(created?.id.startsWith('local-')).toBe(false);
		expect(created?.local).toBe(true);
	});

	it('keeps a locally created task id stable across its create-sync ack (drawer/keyed-row identity survives)', () => {
		// Regression for fix-add-task-details-reload: the details drawer resolves
		// its task by id (detailId lookup) and the task rows are keyed by task.id,
		// so if the ack changed the id the drawer would unmount mid-edit.
		tasks.setAll([]);
		const created = tasks.createLocalWithOptions('Fresh task', 'goal-management');
		const id = created?.id ?? '';
		expect(id).not.toBe('');

		// Server accepts the client-supplied id verbatim and acks it back unchanged.
		tasks.replaceWithRemote(
			id,
			baseTask({ id, title: 'Fresh task', list_id: 'goal-management', local: false, dirty: false }),
			{ ...(created as Task) }
		);

		const after = tasks.getAll().find((t) => t.id === id);
		expect(after).toBeTruthy(); // a lookup by the ORIGINAL id still resolves
		expect(after?.id).toBe(id); // id did not change across the ack (no-op overwrite)
		expect(after?.local).toBe(false); // and it is now synced
	});

	it('treats a list default_emoji of empty string (cleared via the icon/color idiom) as no default', () => {
		// Sidebar clears icon/color/default_emoji by sending '' (to work around
		// the server's coalesce semantics), so a cleared default persists as a
		// literal '' server-side, not null/undefined. New tasks must not pick
		// up '' as their tag -- an empty string is never a valid tag (D2).
		const originalLists = get(lists);
		lists.setAll(
			originalLists.map((l) => (l.id === 'goal-management' ? { ...l, default_emoji: '' } : l))
		);
		try {
			const created = tasks.createLocalWithOptions('No real default', 'goal-management');
			expect(created?.emoji).toBeUndefined();

			tasks.setAll([]);
			const result = tasks.importBatch(
				[{ title: 'Also no default', status: 'pending', list_id: 'goal-management' }],
				'goal-management'
			);
			expect(result.created).toBe(1);
			expect(tasks.getAll()[0]?.emoji).toBeUndefined();
		} finally {
			lists.setAll(originalLists);
		}
	});

	it('applies a list default tag to freshly created tasks during import, not to reactivated ones', () => {
		const originalLists = get(lists);
		lists.setAll(
			originalLists.map((l) => (l.id === 'goal-management' ? { ...l, default_emoji: '🥦' } : l))
		);
		try {
			tasks.setAll([
				baseTask({
					id: 'existing-untagged',
					title: 'Already here',
					list_id: 'goal-management',
					status: 'done'
				})
			]);

			const result = tasks.importBatch(
				[
					{ title: 'Already here', status: 'pending', list_id: 'goal-management' },
					{ title: 'Brand new item', status: 'pending', list_id: 'goal-management' }
				],
				'goal-management'
			);

			expect(result).toEqual({ created: 1, skipped: 1, reactivated: 1 });
			const all = tasks.getAll();
			expect(all.find((t) => t.title === 'Brand new item')?.emoji).toBe('🥦');
			// A reactivated existing task keeps whatever tag it already had (none here) --
			// the list default only seeds brand-new tasks, it never overwrites one in place.
			expect(all.find((t) => t.title === 'Already here')?.emoji).toBeUndefined();
		} finally {
			lists.setAll(originalLists);
		}
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

describe('tasks quick delete + undo (grace window)', () => {
	const syncedTask = (over: Partial<Task> = {}): Task =>
		baseTask({
			id: '11111111-1111-4111-8111-111111111111',
			title: 'Delete me',
			local: false,
			dirty: false,
			...over
		});
	let deleteSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		tasks.setAll([]);
		deleteSpy = vi.spyOn(api, 'deleteTask').mockResolvedValue(undefined as never);
	});
	afterEach(() => {
		deleteSpy.mockRestore();
		vi.useRealTimers();
	});

	it('hides the task as pending-delete with no server call, and undo restores it', () => {
		const t = syncedTask();
		tasks.setAll([t]);

		tasks.softDelete(t.id);
		expect(get(tasks).some((x) => x.id === t.id)).toBe(false); // hidden from every view
		expect(tasks.getAll().some((x) => x.id === t.id)).toBe(true); // still in the raw store
		expect(get(pendingDelete)?.id).toBe(t.id); // drives the undo toast
		expect(deleteSpy).not.toHaveBeenCalled();

		tasks.undoDelete(t.id);
		expect(get(tasks).some((x) => x.id === t.id)).toBe(true); // restored, byte-identical
		expect(get(pendingDelete)).toBeNull();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('commits exactly one server delete when the grace window elapses', async () => {
		const t = syncedTask();
		tasks.setAll([t]);

		tasks.softDelete(t.id);
		expect(deleteSpy).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5000);

		expect(deleteSpy).toHaveBeenCalledTimes(1);
		expect(deleteSpy).toHaveBeenCalledWith(t.id);
		expect(tasks.getAll().some((x) => x.id === t.id)).toBe(false);
		expect(get(pendingDelete)).toBeNull();
	});

	it('undo before the window elapses cancels the delete entirely', async () => {
		const t = syncedTask();
		tasks.setAll([t]);

		tasks.softDelete(t.id);
		tasks.undoDelete(t.id);
		await vi.advanceTimersByTimeAsync(5000);

		expect(deleteSpy).not.toHaveBeenCalled();
		expect(tasks.getAll().some((x) => x.id === t.id)).toBe(true);
	});

	it('a second soft-delete commits the previous one (one at a time)', () => {
		const a = syncedTask({ id: '11111111-1111-4111-8111-111111111111', title: 'A' });
		const b = syncedTask({ id: '22222222-2222-4222-8222-222222222222', title: 'B' });
		tasks.setAll([a, b]);

		tasks.softDelete(a.id);
		tasks.softDelete(b.id); // commits a synchronously

		expect(deleteSpy).toHaveBeenCalledWith(a.id);
		expect(get(pendingDelete)?.id).toBe(b.id);
	});
});

describe('tasks bulk delete (batched grace window)', () => {
	const synced = (id: string, title: string): Task =>
		baseTask({ id, title, local: false, dirty: false });
	const uuid = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
	let deleteSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		tasks.undoDeleteAll(); // clear any grace window left open by a prior test
		tasks.setAll([]);
		deleteSpy = vi.spyOn(api, 'deleteTask').mockResolvedValue(undefined as never);
	});
	afterEach(() => {
		tasks.undoDeleteAll(); // don't leak an open window into the next test
		deleteSpy.mockRestore();
		vi.useRealTimers();
	});

	it('hides every staged task under one window with no server call; batch drives the "N" toast', () => {
		const a = synced(uuid(1), 'A');
		const b = synced(uuid(2), 'B');
		const c = synced(uuid(3), 'C');
		tasks.setAll([a, b, c]);

		tasks.softDeleteMany([a.id, b.id]);

		// Both hidden from every view, both still in the raw store (a pull can't resurrect them).
		expect(get(tasks).map((t) => t.id).sort()).toEqual([c.id]);
		expect(tasks.getAll().length).toBe(3);
		// Two staged → the batched toast, not the single-task toast.
		expect(get(pendingDelete)).toBeNull();
		expect(get(pendingDeleteBatch)).toEqual({ count: 2 });
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('undoDeleteAll restores the whole batch with no server call', () => {
		const a = synced(uuid(1), 'A');
		const b = synced(uuid(2), 'B');
		tasks.setAll([a, b]);

		tasks.softDeleteMany([a.id, b.id]);
		expect(get(tasks).length).toBe(0);

		tasks.undoDeleteAll();
		expect(get(tasks).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
		expect(get(pendingDeleteBatch)).toBeNull();
		expect(deleteSpy).not.toHaveBeenCalled();
	});

	it('commits one server delete per staged task when the window elapses', async () => {
		const a = synced(uuid(1), 'A');
		const b = synced(uuid(2), 'B');
		const c = synced(uuid(3), 'C');
		tasks.setAll([a, b, c]);

		tasks.softDeleteMany([a.id, b.id, c.id]);
		expect(deleteSpy).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5000);

		expect(deleteSpy).toHaveBeenCalledTimes(3);
		expect(deleteSpy.mock.calls.map((call: unknown[]) => call[0]).sort()).toEqual(
			[a.id, b.id, c.id].sort()
		);
		expect(tasks.getAll().length).toBe(0);
		expect(get(pendingDeleteBatch)).toBeNull();
	});

	it('mixes local and synced tasks: only server ids hit the API, both are removed', async () => {
		const local = baseTask({ id: 'local-abc', title: 'Local', local: true, dirty: true });
		const server = synced(uuid(2), 'Server');
		tasks.setAll([local, server]);

		tasks.softDeleteMany([local.id, server.id]);
		await vi.advanceTimersByTimeAsync(5000);

		expect(deleteSpy).toHaveBeenCalledTimes(1);
		expect(deleteSpy).toHaveBeenCalledWith(server.id);
		expect(tasks.getAll().length).toBe(0);
	});

	it('drops unknown ids and is a no-op when none are known tasks', () => {
		const a = synced(uuid(1), 'A');
		tasks.setAll([a]);

		tasks.softDeleteMany(['nope-1', 'nope-2']);
		expect(get(tasks).length).toBe(1); // nothing hidden
		expect(get(pendingDeleteBatch)).toBeNull();

		tasks.softDeleteMany([a.id, 'nope-1']); // known + unknown → only the known one stages
		expect(get(tasks).length).toBe(0);
		expect(get(pendingDelete)?.id).toBe(a.id); // exactly one staged → single toast
		expect(get(pendingDeleteBatch)).toBeNull();
	});

	it('single softDelete still behaves as a batch of one (slice-1 parity)', () => {
		const a = synced(uuid(1), 'A');
		tasks.setAll([a]);

		tasks.softDelete(a.id);
		expect(get(pendingDelete)?.id).toBe(a.id);
		expect(get(pendingDeleteBatch)).toBeNull();
	});

	it('deletes a recurring task in a batch like any other (deletes the series, no special branch)', async () => {
		const recurring = synced(uuid(1), 'Water plants');
		recurring.recurrence_id = 'daily';
		recurring.due_date = '2026-02-02';
		const normal = synced(uuid(2), 'One-off');
		tasks.setAll([recurring, normal]);

		tasks.softDeleteMany([recurring.id, normal.id]);
		await vi.advanceTimersByTimeAsync(5000);

		// The recurring task commits through the same deleteRemote → api.deleteTask
		// path — the whole series is gone, no reschedule, no divergence from single delete.
		expect(deleteSpy).toHaveBeenCalledTimes(2);
		expect(deleteSpy.mock.calls.map((call: unknown[]) => call[0]).sort()).toEqual(
			[recurring.id, normal.id].sort()
		);
		expect(tasks.getAll().some((t) => t.id === recurring.id)).toBe(false);
	});

	it('keeps staged tasks hidden while their real deletes are in-flight (no flash-back mid-commit)', async () => {
		const a = synced(uuid(1), 'A');
		const b = synced(uuid(2), 'B');
		tasks.setAll([a, b]);

		// A deleteTask that stays pending until we release it — models the network RTT.
		let releaseDeletes: (() => void) | undefined;
		const inFlight = new Promise<undefined>((resolve) => {
			releaseDeletes = () => resolve(undefined);
		});
		deleteSpy.mockReturnValue(inFlight);

		tasks.softDeleteMany([a.id, b.id]);
		await vi.advanceTimersByTimeAsync(5000); // fires the commit → both deleteTask calls, still pending

		// Mid-commit: both hidden from views, both still in the raw store (not yet removed),
		// so a /sync/pull landing now can't resurrect them.
		expect(deleteSpy).toHaveBeenCalledTimes(2);
		expect(get(tasks).length).toBe(0);
		expect(tasks.getAll().length).toBe(2);

		releaseDeletes?.();
		await vi.advanceTimersByTimeAsync(0); // flush the resolve → remove + unstage

		expect(tasks.getAll().length).toBe(0);
		expect(get(pendingDeleteBatch)).toBeNull();
	});
});

describe('tasks setEmojiMany (bulk tag)', () => {
	const t = (id: string, over: Partial<Task> = {}): Task =>
		baseTask({ id, title: id, local: false, dirty: false, ...over });

	beforeEach(() => {
		tasks.setAll([]);
	});

	it('applies one tag to every matching id and marks them dirty; leaves the rest', () => {
		tasks.setAll([t('a'), t('b'), t('c')]);

		const changed = tasks.setEmojiMany(['a', 'c'], '🎯');

		expect(changed).toBe(2);
		const byId = Object.fromEntries(tasks.getAll().map((task) => [task.id, task]));
		expect(byId.a.emoji).toBe('🎯');
		expect(byId.a.dirty).toBe(true);
		expect(byId.c.emoji).toBe('🎯');
		expect(byId.c.dirty).toBe(true);
		// Untouched task keeps its (absent) tag and its clean flag.
		expect(byId.b.emoji).toBeUndefined();
		expect(byId.b.dirty).toBe(false);
	});

	it('overwrites an existing tag (single-tag model)', () => {
		tasks.setAll([t('a', { emoji: '🔥' }), t('b', { emoji: '🔥' })]);

		tasks.setEmojiMany(['a', 'b'], '🎯');

		expect(tasks.getAll().every((task) => task.emoji === '🎯')).toBe(true);
	});

	it('clears the tag on all when emoji is undefined', () => {
		tasks.setAll([t('a', { emoji: '🎯' }), t('b', { emoji: '🎯' })]);

		const changed = tasks.setEmojiMany(['a', 'b'], undefined);

		expect(changed).toBe(2);
		expect(tasks.getAll().every((task) => task.emoji === undefined)).toBe(true);
		expect(tasks.getAll().every((task) => task.dirty === true)).toBe(true);
	});

	it('ignores unknown ids and is a no-op (returns 0) when none match', () => {
		tasks.setAll([t('a', { emoji: '🎯' })]);

		expect(tasks.setEmojiMany([], '🔥')).toBe(0);
		expect(tasks.setEmojiMany(['nope'], '🔥')).toBe(0);
		// The known task is untouched by the no-op calls.
		expect(tasks.getAll()[0].emoji).toBe('🎯');
		expect(tasks.getAll()[0].dirty).toBe(false);

		// A mix stages only the known id.
		expect(tasks.setEmojiMany(['a', 'nope'], '🔥')).toBe(1);
		expect(tasks.getAll()[0].emoji).toBe('🔥');
	});
});

describe('tasks moveToListMany (bulk move)', () => {
	const t = (id: string, over: Partial<Task> = {}): Task =>
		baseTask({ id, title: id, list_id: 'list-a', local: false, dirty: false, ...over });

	beforeEach(() => {
		tasks.setAll([]);
	});

	it('reattributes every eligible id to the target and marks them dirty; leaves the rest', () => {
		tasks.setAll([t('a'), t('b'), t('c', { list_id: 'list-b' })]);

		const moved = tasks.moveToListMany(['a', 'c'], 'list-b');

		// 'a' moves list-a → list-b; 'c' is already in list-b, so it's a no-op.
		expect(moved).toBe(1);
		const byId = Object.fromEntries(tasks.getAll().map((task) => [task.id, task]));
		expect(byId.a.list_id).toBe('list-b');
		expect(byId.a.dirty).toBe(true);
		// Already-in-target task is untouched (not re-dirtied).
		expect(byId.c.list_id).toBe('list-b');
		expect(byId.c.dirty).toBe(false);
		// Unselected task stays put and clean.
		expect(byId.b.list_id).toBe('list-a');
		expect(byId.b.dirty).toBe(false);
	});

	it('changes only list_id/dirty/updated_ts — every other field is preserved', () => {
		// Pin updated_ts to a clearly-old value so the "refreshed" assertion below
		// can't be a same-millisecond tie with Date.now().
		const before = t('a', {
			title: 'buy milk',
			emoji: '🧀',
			status: 'done',
			order: 'zzz',
			my_day: true,
			due_date: '2026-09-21',
			updated_ts: 1
		});
		tasks.setAll([before]);

		tasks.moveToListMany(['a'], 'list-b');

		const after = tasks.getAll()[0];
		expect(after.list_id).toBe('list-b');
		expect(after.dirty).toBe(true);
		// updated_ts is bumped so sync/LWW merge orders the move correctly.
		expect(after.updated_ts).toBeGreaterThan(before.updated_ts);
		// Nothing else moved.
		expect(after.title).toBe('buy milk');
		expect(after.emoji).toBe('🧀');
		expect(after.status).toBe('done');
		expect(after.order).toBe('zzz');
		expect(after.my_day).toBe(true);
		expect(after.due_date).toBe('2026-09-21');
	});

	it('ignores unknown ids, an empty selection, and a repeated move (all return 0)', () => {
		tasks.setAll([t('a', { list_id: 'list-a' })]);

		expect(tasks.moveToListMany([], 'list-b')).toBe(0);
		expect(tasks.moveToListMany(['nope'], 'list-b')).toBe(0);
		// The known task is untouched by the no-op calls.
		expect(tasks.getAll()[0].list_id).toBe('list-a');
		expect(tasks.getAll()[0].dirty).toBe(false);

		// First real move counts; the immediate repeat is a no-op (already there).
		expect(tasks.moveToListMany(['a', 'nope'], 'list-b')).toBe(1);
		expect(tasks.moveToListMany(['a'], 'list-b')).toBe(0);
		expect(tasks.getAll()[0].list_id).toBe('list-b');
	});
});

describe('tasks checkAllInList (bulk complete)', () => {
	const mockedIncrement = vi.mocked(streak.increment);
	const mockedUndo = vi.mocked(streak.undoCompletion);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-02T12:00:00Z'));
		tasks.setAll([]);
		mockedIncrement.mockClear();
		mockedUndo.mockClear();
		mockedPlayCompletion.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('completes a list’s pending tasks, contributor-scoped, and returns the count', () => {
		tasks.setAll([
			baseTask({ id: 'p1', list_id: 'tasks', status: 'pending', created_by_user_id: 'me' }),
			baseTask({ id: 'p2', list_id: 'tasks', status: 'pending', created_by_user_id: 'other' }),
			baseTask({ id: 'done1', list_id: 'tasks', status: 'done', created_by_user_id: 'me' }),
			baseTask({ id: 'other-list', list_id: 'health', status: 'pending', created_by_user_id: 'me' })
		]);

		// Admin (no ownerUserId): completes both pending tasks in the list, not other lists / already-done.
		const changed = tasks.checkAllInList('tasks');
		expect(changed).toBe(2);
		expect(tasks.getAll().find((t) => t.id === 'p1')?.status).toBe('done');
		expect(tasks.getAll().find((t) => t.id === 'p2')?.status).toBe('done');
		expect(tasks.getAll().find((t) => t.id === 'other-list')?.status).toBe('pending');
		expect(tasks.getAll().find((t) => t.id === 'p1')?.dirty).toBe(true);
		// Streak accounting is silent, one per completed task; one completion sound for the batch.
		expect(mockedIncrement).toHaveBeenCalledWith('p1', { silent: true });
		expect(mockedIncrement).toHaveBeenCalledTimes(2);
		expect(mockedPlayCompletion).toHaveBeenCalledTimes(1);
	});

	it('is contributor-scoped: only completes tasks the caller created', () => {
		tasks.setAll([
			baseTask({ id: 'mine', list_id: 'tasks', status: 'pending', created_by_user_id: 'me' }),
			baseTask({ id: 'theirs', list_id: 'tasks', status: 'pending', created_by_user_id: 'other' })
		]);

		const changed = tasks.checkAllInList('tasks', { ownerUserId: 'me' });
		expect(changed).toBe(1);
		expect(tasks.getAll().find((t) => t.id === 'mine')?.status).toBe('done');
		expect(tasks.getAll().find((t) => t.id === 'theirs')?.status).toBe('pending');
	});

	it('advances a pending recurring task one occurrence (not a flat done), and undoes its streak id', () => {
		tasks.setAll([
			baseTask({
				id: 'rec',
				list_id: 'tasks',
				status: 'pending',
				recurrence_id: 'daily',
				due_date: '2026-02-02',
				occurrences_completed: 0
			})
		]);

		const changed = tasks.checkAllInList('tasks');
		expect(changed).toBe(1);
		const rec = tasks.getAll().find((t) => t.id === 'rec');
		expect(rec?.status).toBe('pending'); // recurring stays pending
		expect(rec?.due_date).toBe('2026-02-03'); // rolled forward one occurrence
		expect(rec?.occurrences_completed).toBe(1);
		expect(typeof rec?.completed_ts).toBe('number');
		// recurring reuses its id → increment then undo so the next occurrence can count
		expect(mockedIncrement).toHaveBeenCalledWith('rec', { silent: true });
		expect(mockedUndo).toHaveBeenCalledWith('rec');
	});

	it('skips a recurring task already completed today (no double-advance)', () => {
		tasks.setAll([
			baseTask({
				id: 'rec-done',
				list_id: 'tasks',
				status: 'pending',
				recurrence_id: 'daily',
				due_date: '2026-02-03',
				occurrences_completed: 1,
				completed_ts: new Date('2026-02-02T10:00:00Z').getTime()
			})
		]);

		const changed = tasks.checkAllInList('tasks');
		expect(changed).toBe(0);
		const rec = tasks.getAll().find((t) => t.id === 'rec-done');
		expect(rec?.due_date).toBe('2026-02-03'); // unchanged
		expect(rec?.occurrences_completed).toBe(1);
		expect(mockedIncrement).not.toHaveBeenCalled();
	});

	it('is a no-op (returns 0, no sound) when the list has no eligible pending tasks', () => {
		tasks.setAll([baseTask({ id: 'd', list_id: 'tasks', status: 'done' })]);
		expect(tasks.checkAllInList('tasks')).toBe(0);
		expect(mockedPlayCompletion).not.toHaveBeenCalled();
	});
});
