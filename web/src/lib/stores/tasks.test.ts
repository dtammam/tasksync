import { get } from 'svelte/store';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Task } from '$shared/types/task';
import { myDayPending, pendingCount, tasks } from './tasks';
import { repo } from '$lib/data/repo';

const sample: Task = {
	id: 't-new',
	title: 'write tests',
	priority: 1,
	status: 'pending',
	list_id: 'goal-management',
	tags: [],
	checklist: [],
	order: 'z',
	attachments: [],
	created_ts: Date.now(),
	updated_ts: Date.now(),
	my_day: true
};

beforeEach(() => {
	tasks.setAll([]);
	vi.restoreAllMocks();
});

describe('tasks store', () => {
	it('adds tasks and derives pending count', () => {
		tasks.add(sample);
		expect(get(pendingCount)).toBeGreaterThan(0);
	});

	it('marks task done and moves out of my day pending', () => {
		tasks.add(sample);
		const pendingBefore = get(myDayPending).length;
		tasks.toggle(sample.id);
		const pendingAfter = get(myDayPending).length;
		expect(pendingAfter).toBeLessThan(pendingBefore);
	});
});

describe('task creation', () => {
	it('creates local tasks marked dirty/local', () => {
		const created = tasks.createLocal('offline task', 'goal-management', { my_day: true });
		expect(created?.dirty).toBe(true);
		expect(created?.local).toBe(true);
		expect(get(pendingCount)).toBeGreaterThan(0);
	});

	it('hydrates from stored tasks without re-seeding defaults', async () => {
		const stored: Task[] = [
			{
				id: 'srv-1',
				title: 'from db',
				priority: 0,
				status: 'pending',
				list_id: 'goal-management',
				tags: [],
				checklist: [],
				order: 'z',
				attachments: [],
				created_ts: 1,
				updated_ts: 1
			}
		];
		const loadSpy = vi.spyOn(repo, 'loadAll').mockResolvedValue({ lists: [], tasks: stored });

		await tasks.hydrateFromDb();

		expect(tasks.getAll()).toEqual(stored);
		expect(tasks.getAll().some((t) => t.id === 't1')).toBe(false);
		loadSpy.mockRestore();
	});

	it('creates local task with custom status and priority', () => {
		const created = tasks.createLocalWithOptions('done task', 'goal-management', {
			status: 'done',
			priority: 2
		});
		expect(created?.status).toBe('done');
		expect(created?.priority).toBe(2);
	});
});
