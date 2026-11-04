import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import TaskDetailDrawer from './TaskDetailDrawer.svelte';
import { tasks } from '$lib/stores/tasks';
import type { Task } from '$shared/types/task';

vi.mock('$lib/stores/tasks', () => ({
	tasks: {
		saveFromDetails: vi.fn(),
		toggle: vi.fn(),
		undoRecurringCompletion: vi.fn(),
		punt: vi.fn()
	}
}));

vi.mock('$lib/stores/lists', () => ({
	lists: readable([{ id: 'list-1', name: 'List 1', order: 'a' }])
}));

vi.mock('$lib/stores/members', () => ({
	members: readable([])
}));

vi.mock('$lib/stores/auth', () => ({
	auth: readable({
		status: 'authenticated',
		source: 'token',
		user: { user_id: 'user-1', role: 'admin', display: 'Me', email: 'me@example.com', space_id: 's1' },
		error: null
	})
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: 'Starred legacy task',
	priority: 1,
	status: 'pending',
	list_id: 'list-1',
	my_day: false,
	checklist: [],
	order: '1',
	created_ts: Date.now(),
	updated_ts: Date.now(),
	created_by_user_id: 'user-1',
	occurrences_completed: 0,
	...overrides
});

describe('TaskDetailDrawer — Starred is retired', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders no Starred toggle for a task with priority > 0', () => {
		const { queryByTestId, queryByText } = render(TaskDetailDrawer, {
			props: { task: makeTask(), open: true }
		});
		expect(queryByTestId('detail-star-toggle')).toBeNull();
		expect(queryByText('Starred')).toBeNull();
	});

	it('save does not write priority at all', async () => {
		const { getByText } = render(TaskDetailDrawer, { props: { task: makeTask(), open: true } });

		await fireEvent.click(getByText('Save'));

		expect(tasks.saveFromDetails).toHaveBeenCalledTimes(1);
		const [id, details] = vi.mocked(tasks.saveFromDetails).mock.calls[0];
		expect(id).toBe('task-1');
		expect(details).not.toHaveProperty('priority');
	});
});
