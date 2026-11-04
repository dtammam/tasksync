import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import TaskRow from './TaskRow.svelte';
import { tasks } from '$lib/stores/tasks';
import type { Task } from '$shared/types/task';

// ── Store mocks ────────────────────────────────────────────────────────────

vi.mock('$lib/stores/tasks', () => ({
	tasks: {
		setDueDate: vi.fn(),
		setDueToday: vi.fn(),
		setPriority: vi.fn(),
		setEmoji: vi.fn(),
		punt: vi.fn(),
		deleteRemote: vi.fn().mockResolvedValue(undefined),
		softDelete: vi.fn(),
		toggle: vi.fn(),
		catchUp: vi.fn(),
		undoRecurringCompletion: vi.fn(),
	}
}));

// Mutable lists store: empty by default; the list-name slot cases seed one.
const { listsState } = vi.hoisted(() => ({ listsState: { current: null as unknown } }));
vi.mock('$lib/stores/lists', async () => {
	const { writable } = await import('svelte/store');
	const store = writable([] as unknown[]);
	listsState.current = store;
	return { lists: store };
});
const setLists = (value: unknown[]) =>
	(listsState.current as ReturnType<typeof import('svelte/store').writable>).set(value);

// Mutable auth store: owner by default; the contributor case swaps the user.
const { authState } = vi.hoisted(() => ({ authState: { current: null as unknown } }));
vi.mock('$lib/stores/auth', async () => {
	const { writable } = await import('svelte/store');
	const store = writable({
		status: 'authenticated' as const,
		mode: 'token' as const,
		source: null,
		user: { user_id: 'user-1', role: 'owner', name: 'Test User', email: 'test@example.com' },
		error: null,
	});
	authState.current = store;
	return { auth: store };
});

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

	it('deleteTask soft-deletes and closes the shelf, with no confirm dialog', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm');

		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Delete'));

		expect(tasks.softDelete).toHaveBeenCalledTimes(1);
		expect(confirmSpy).not.toHaveBeenCalled(); // undo toast, not a blocking confirm
		expect(container.querySelector('.quick')).toBeNull();
	});

	it('openDetailFromMenu closes the shelf (regression guard)', async () => {
		const { container, getByText } = await openShelf(makeTask());
		expect(container.querySelector('.quick')).toBeTruthy();

		await fireEvent.click(getByText('Details'));

		expect(container.querySelector('.quick')).toBeNull();
	});
});

describe('TaskRow quick tag', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('untagged: chip opens the picker; picking applies the tag and closes it', async () => {
		const { container, getByTestId, queryByTestId, getByRole } = render(TaskRow, {
			props: { task: makeTask() }
		});
		const chip = getByTestId('task-tag-chip');
		expect(chip.nextElementSibling?.classList.contains('actions-chip')).toBe(true);

		await fireEvent.click(chip);
		expect(getByTestId('task-tag-picker')).toBeTruthy();
		expect(container.querySelector('[data-testid="task-tag-clear"]')).toBeNull();

		await fireEvent.click(getByRole('radio', { name: 'Goal-focused' }));
		expect(tasks.setEmoji).toHaveBeenCalledWith('task-1', '🎯');
		expect(queryByTestId('task-tag-picker')).toBeNull();
	});

	it('tagged: emoji is a button, chip is absent, current tag is checked, Clear tag clears', async () => {
		const { getByTestId, queryByTestId, getByRole } = render(TaskRow, {
			props: { task: makeTask({ emoji: '🎯' }) }
		});
		const indicator = getByTestId('task-emoji-indicator');
		expect(indicator.tagName).toBe('BUTTON');
		expect(queryByTestId('task-tag-chip')).toBeNull();

		await fireEvent.click(indicator);
		expect(getByRole('radio', { name: 'Goal-focused' }).getAttribute('aria-checked')).toBe('true');

		await fireEvent.click(getByTestId('task-tag-clear'));
		expect(tasks.setEmoji).toHaveBeenCalledWith('task-1', undefined);
		expect(queryByTestId('task-tag-picker')).toBeNull();
	});

	it('contributor who is not the owner gets no chip and a non-interactive emoji', async () => {
		(authState.current as ReturnType<typeof import('svelte/store').writable>).set({
			status: 'authenticated',
			mode: 'token',
			source: null,
			user: { user_id: 'user-2', role: 'contributor', name: 'C', email: 'c@example.com' },
			error: null,
		});
		try {
			const untagged = render(TaskRow, { props: { task: makeTask() } });
			expect(untagged.queryByTestId('task-tag-chip')).toBeNull();
			await fireEvent.click(untagged.getByText('⋯'));
			expect(untagged.queryByTestId('task-tag-menu')).toBeNull();
			untagged.unmount();

			const tagged = render(TaskRow, { props: { task: makeTask({ emoji: '🎯' }) } });
			const indicator = tagged.getByTestId('task-emoji-indicator');
			expect(indicator.tagName).not.toBe('BUTTON');
			await fireEvent.click(indicator);
			expect(tagged.queryByTestId('task-tag-picker')).toBeNull();
		} finally {
			(authState.current as ReturnType<typeof import('svelte/store').writable>).set({
				status: 'authenticated',
				mode: 'token',
				source: null,
				user: { user_id: 'user-1', role: 'owner', name: 'Test User', email: 'test@example.com' },
				error: null,
			});
		}
	});

	it('⋯ shelf Tag entry opens the picker and closes the shelf', async () => {
		const { container, getByTestId, getByRole } = await openShelf(makeTask());
		await fireEvent.click(getByTestId('task-tag-menu'));
		expect(container.querySelector('.quick')).toBeNull();
		expect(getByTestId('task-tag-picker')).toBeTruthy();
		expect(getByRole('radio', { name: 'Goal-focused' })).toBeTruthy();
	});

	it('opening the shelf closes the picker', async () => {
		const { container, getByTestId, queryByTestId, getByText } = render(TaskRow, {
			props: { task: makeTask() }
		});
		await fireEvent.click(getByTestId('task-tag-chip'));
		expect(getByTestId('task-tag-picker')).toBeTruthy();
		await fireEvent.click(getByText('⋯'));
		expect(queryByTestId('task-tag-picker')).toBeNull();
		expect(container.querySelector('.quick')).toBeTruthy();
	});
});

const isoPlusDays = (days: number): string => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('TaskRow fixed slots', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setLists([]);
	});

	it('recurring in My Day: date slot shows ↻ <iso> and no "Next:" anywhere', () => {
		const due = todayIso();
		const next = isoPlusDays(7);
		const { getByTestId, container } = render(TaskRow, {
			props: { task: makeTask({ due_date: due, recurrence_id: 'weekly' }), inMyDayView: true }
		});
		expect(getByTestId('task-date').textContent?.replace(/\s+/g, ' ').trim()).toBe(`↻ ${next}`);
		expect(container.textContent).not.toContain('Next:');
	});

	it('recurring outside My Day: date slot stays empty (unchanged rule)', () => {
		const { queryByTestId } = render(TaskRow, {
			props: { task: makeTask({ recurrence_id: 'weekly' }), inMyDayView: false }
		});
		expect(queryByTestId('task-date')).toBeNull();
	});

	it('non-recurring dated: date slot shows the bare ISO date', () => {
		const due = isoPlusDays(2);
		const { getByTestId } = render(TaskRow, { props: { task: makeTask({ due_date: due }) } });
		expect(getByTestId('task-date').textContent?.trim()).toBe(due);
	});

	it('undated: no date element renders', () => {
		const { queryByTestId } = render(TaskRow, { props: { task: makeTask({ due_date: undefined }) } });
		expect(queryByTestId('task-date')).toBeNull();
	});

	it('Catch Up and My Day both applicable: only task-catchup renders', () => {
		// Missed recurring task in a list view: showCatchUp, and My Day's rule also holds.
		const { getByTestId, queryByTestId } = render(TaskRow, {
			props: {
				task: makeTask({ due_date: isoPlusDays(-1), recurrence_id: 'daily', my_day: false }),
				inMyDayView: false
			}
		});
		expect(getByTestId('task-catchup')).toBeTruthy();
		expect(queryByTestId('task-myday-btn')).toBeNull();
	});

	it('My Day alone applicable: task-myday-btn renders, labelled for assistive tech', () => {
		const { getByTestId, queryByTestId } = render(TaskRow, {
			props: { task: makeTask({ due_date: undefined }), inMyDayView: false }
		});
		expect(getByTestId('task-myday-btn').getAttribute('aria-label')).toBe('My Day');
		expect(queryByTestId('task-catchup')).toBeNull();
	});

	it('neither applicable: no action element renders', () => {
		const { queryByTestId } = render(TaskRow, {
			props: { task: makeTask({ due_date: todayIso() }), inMyDayView: false }
		});
		expect(queryByTestId('task-catchup')).toBeNull();
		expect(queryByTestId('task-myday-btn')).toBeNull();
	});

	it('long list name: truncating cell carries the full name in title', () => {
		const name = 'A very long list name that will never fit beside the fixed slots';
		setLists([{ id: 'list-1', name, order: 'a' }]);
		const { getByTestId } = render(TaskRow, { props: { task: makeTask(), inMyDayView: true } });
		const cell = getByTestId('task-list-name');
		expect(cell.textContent).toBe(name);
		expect(cell.getAttribute('title')).toBe(name);
		expect(cell.classList.contains('slot-list')).toBe(true);
	});

	it('list views render no list-name cell', () => {
		setLists([{ id: 'list-1', name: 'Inbox', order: 'a' }]);
		const { queryByTestId } = render(TaskRow, { props: { task: makeTask(), inMyDayView: false } });
		expect(queryByTestId('task-list-name')).toBeNull();
	});
});
