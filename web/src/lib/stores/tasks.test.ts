import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Task } from '$shared/types/task';
import { pendingCount, tasks } from './tasks';

const sample: Task = {
	id: 't1',
	title: 'write tests',
	priority: 1,
	status: 'pending',
	list_id: 'inbox',
	tags: [],
	checklist: [],
	order: 'a',
	attachments: [],
	created_ts: Date.now(),
	updated_ts: Date.now()
};

describe('tasks store', () => {
	it('adds tasks and derives pending count', () => {
		tasks.setAll([]);
		tasks.add(sample);
		expect(get(pendingCount)).toBe(1);
	});
});
