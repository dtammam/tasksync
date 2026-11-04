import { describe, expect, it } from 'vitest';
import { sortTasks } from './sort';
import type { Task } from '$shared/types/task';

const task = (id: string, created_ts: number, overrides: Partial<Task> = {}): Task => ({
	id,
	title: id,
	status: 'pending',
	list_id: 'l-inbox',
	my_day: false,
	priority: 0,
	checklist: [],
	order: 'a',
	created_ts,
	updated_ts: created_ts,
	occurrences_completed: 0,
	...overrides
});

describe('sortTasks (no starred-first tier)', () => {
	it('created-asc: a later priority:1 task sorts after an earlier one', () => {
		const earlier = task('earlier', 1);
		const laterStarred = task('later-starred', 2, { priority: 1 });
		expect(sortTasks([laterStarred, earlier], 'created', 'asc').map((t) => t.id)).toEqual([
			'earlier',
			'later-starred'
		]);
	});

	it('created-desc and alpha ignore priority too', () => {
		const a = task('apple', 1, { priority: 3 });
		const b = task('banana', 2);
		expect(sortTasks([a, b], 'created', 'desc').map((t) => t.id)).toEqual(['banana', 'apple']);
		expect(sortTasks([b, a], 'alpha', 'asc').map((t) => t.id)).toEqual(['apple', 'banana']);
		expect(sortTasks([a, b], 'alpha', 'desc').map((t) => t.id)).toEqual(['banana', 'apple']);
	});

	it('due_date keeps undated tasks last regardless of priority', () => {
		const undatedStarred = task('undated', 1, { priority: 1 });
		const dated = task('dated', 2, { due_date: '2026-11-05' });
		expect(sortTasks([undatedStarred, dated], 'due_date', 'asc').map((t) => t.id)).toEqual([
			'dated',
			'undated'
		]);
	});

	it('does not mutate its input', () => {
		const input = [task('b', 2), task('a', 1)];
		sortTasks(input);
		expect(input.map((t) => t.id)).toEqual(['b', 'a']);
	});
});
