import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import TaskRow from './TaskRow.svelte';
import type { Task } from '$shared/types/task';

// ── Store mocks ────────────────────────────────────────────────────────────

vi.mock('$lib/stores/tasks', () => ({
	tasks: {
		setDueDate: vi.fn(),
		setDueToday: vi.fn(),
		setPriority: vi.fn(),
		punt: vi.fn(),
		deleteRemote: vi.fn().mockResolvedValue(undefined),
		toggle: vi.fn(),
		catchUp: vi.fn(),
		undoRecurringCompletion: vi.fn(),
	}
}));

vi.mock('$lib/stores/lists', () => ({
	lists: readable([])
}));

// Non-contributor role so canEditTask is always true in these tests.
vi.mock('$lib/stores/auth', () => ({
	auth: readable({
		status: 'authenticated' as const,
		mode: 'token' as const,
		source: null,
		user: {
			user_id: 'user-1',
			role: 'owner',
			name: 'Test User',
			email: 'test@example.com',
		},
		error: null,
	})
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const todayIso = (): string => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: 'task-1',
	title: 'Test task',
	priority: 0,
	status: 'pending',
	list_id: 'list-1',
	my_day: false,
	tags: [],
	checklist: [],
	order: '1',
	due_date: todayIso(),
	created_ts: Date.now(),
	updated_ts: Date.now(),
	created_by_user_id: 'user-1',
	assignee_user_id: 'user-1',
	occurrences_completed: 0,
	...overrides,
});

/** Render the component with the shelf open, ready to click an action button. */
async function openShelf(task: Task) {
	const result = render(TaskRow, { props: { task } });
	// The ⋯ chip toggles the shelf open
	await fireEvent.click(result.getByText('⋯'));
	return result;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TaskRow action shelf — closes after each action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('toggleStar closes the shelf when starring a task', async () => {
		const { container, getByText } = await openShelf(makeTask({ priority: 0 }));
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Star'));

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('toggleStar closes the shelf when unstarring a task', async () => {
		const { container, getByText } = await openShelf(makeTask({ priority: 1 }));
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Unstar'));

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('punt closes the shelf (task due today, not daily-recurring)', async () => {
		// canPunt requires: status=pending, recurrence_id≠daily, due_date=today
		const { container, getByTestId } = await openShelf(
			makeTask({ status: 'pending', due_date: todayIso() })
		);
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByTestId('task-punt'));

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('addTomorrow closes the shelf', async () => {
		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Tomorrow'));

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('addNextWeek closes the shelf', async () => {
		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Next week'));

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('deleteTask closes the shelf (regression guard)', async () => {
		vi.spyOn(window, 'confirm').mockReturnValue(true);

		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		// fireEvent is synchronous but deleteTask is async; wait for the DOM to settle.
		await fireEvent.click(getByText('Delete'));
		// Allow the microtask queue to flush so the async handler completes.
		await Promise.resolve();

		expect(container.querySelector('.quick')).toBeNull();
	});

	it('openDetailFromMenu closes the shelf (regression guard)', async () => {
		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Details'));

		expect(container.querySelector('.quick')).toBeNull();
	});
});
