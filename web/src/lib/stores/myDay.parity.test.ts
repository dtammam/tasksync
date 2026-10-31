import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import fixture from '$shared/fixtures/my-day-cases.json';
import type { Task, TaskStatus } from '$shared/types/task';

vi.mock('$lib/sound/sound', () => ({ playCompletion: vi.fn() }));
vi.mock('$lib/stores/streak', () => ({
	streak: {
		increment: vi.fn().mockReturnValue(false),
		undoCompletion: vi.fn(),
		break: vi.fn(),
		triggerDayComplete: vi.fn().mockReturnValue(false)
	}
}));

import { myDayCompleted, myDayPending, tasks } from './tasks';

// Parity with GET /api/tasks?view=today (server/src/routes/task_views.rs): both
// suites select from shared/fixtures/my-day-cases.json and must agree on ids.
// completed_at is local wall-clock time, so the fixture holds in any zone.
const toTask = (t: (typeof fixture.tasks)[number]): Task => ({
	id: t.id,
	title: t.title,
	status: t.status as TaskStatus,
	list_id: 'l1',
	my_day: t.my_day,
	priority: 0,
	checklist: [],
	order: 'a',
	created_ts: 0,
	updated_ts: t.completed_at ? new Date(t.completed_at).getTime() : 0,
	dirty: false,
	occurrences_completed: 0,
	due_date: t.due_date ?? undefined,
	recurrence_id: t.recur_rule ?? undefined,
	completed_ts: t.completed_at ? new Date(t.completed_at).getTime() : undefined,
	assignee_user_id: t.assignee_user_id ?? undefined,
	created_by_user_id: t.created_by_user_id ?? undefined
});

describe('My Day parity fixture', () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(`${fixture.today}T12:00`));
		localStorage.clear();
		const meSpy = vi.spyOn(api, 'me').mockResolvedValueOnce({
			user_id: fixture.user_id,
			email: 'me@example.com',
			display: 'Me',
			space_id: 's1',
			role: 'admin'
		});
		localStorage.setItem('tasksync:auth-token', 'test-token');
		await auth.hydrate();
		meSpy.mockRestore();
		tasks.setAll(fixture.tasks.map(toTask));
	});

	afterEach(() => {
		auth.logout();
		tasks.setAll([]);
		vi.useRealTimers();
	});

	it('myDayPending selects the expected ids', () => {
		expect(get(myDayPending).map((t) => t.id)).toEqual(fixture.expected_pending);
	});

	it('myDayCompleted selects the expected done-today ids', () => {
		expect(get(myDayCompleted).map((t) => t.id)).toEqual(fixture.expected_done_today);
	});
});
