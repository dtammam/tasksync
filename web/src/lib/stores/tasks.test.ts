import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Task } from '$shared/types/task';
import { myDayPending, pendingCount, tasks } from './tasks';

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

describe('tasks store', () => {
	it('adds tasks and derives pending count', () => {
		tasks.add(sample);
		expect(get(pendingCount)).toBeGreaterThan(0);
	});

	it('marks task done and moves out of my day pending', () => {
		const pendingBefore = get(myDayPending).length;
		tasks.toggle(sample.id);
		const pendingAfter = get(myDayPending).length;
		expect(pendingAfter).toBeLessThan(pendingBefore);
	});
});
