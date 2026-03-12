/**
 * Performance benchmarks for task store operations on large task sets.
 *
 * Budgets (from docs/RELIABILITY.md):
 *   - Search / filter on 10k tasks: < 100 ms product target
 *   - CI ceiling: < 500 ms (catastrophic-regression gate for slow runners)
 *
 * MiniSearch is not yet integrated (planned for V1). These benchmarks cover
 * the current linear-scan equivalents that serve as the de-facto "search"
 * path until full-text indexing is added.
 */

import { bench, describe, expect } from 'vitest';
import type { Task } from '$shared/types/task';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(i: number): Task {
	const listId = `list-${i % 20}`; // 20 lists
	const statuses = ['pending', 'done', 'cancelled'] as const;
	const status = statuses[i % 3];
	return {
		id: `task-${i}`,
		title: `Task ${i} — project alpha beta ${i % 100}`,
		notes: i % 5 === 0 ? `Some notes for task ${i} about meeting project deadline` : undefined,
		list_id: listId,
		status,
		priority: (i % 4) as 0 | 1 | 2 | 3,
		my_day: i % 10 === 0,
		due_date: i % 7 === 0 ? new Date(Date.now() - 86400000 * (i % 3)).toISOString().slice(0, 10) : undefined,
		order: `${i}`,
		created_ts: Date.now() - i * 1000,
		updated_ts: Date.now() - i * 500,
		tags: [],
		checklist: []
	} as unknown as Task;
}

const TASKS_10K: Task[] = Array.from({ length: 10_000 }, (_, i) => makeTask(i));

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('task store operations at 10k scale', () => {
	bench('listCounts reduce (sidebar badge computation)', () => {
		const result: Record<string, { pending: number; total: number }> = {};
		for (const task of TASKS_10K) {
			const entry = result[task.list_id] ?? { pending: 0, total: 0 };
			entry.total += 1;
			if (task.status === 'pending') entry.pending += 1;
			result[task.list_id] = entry;
		}
		expect(Object.keys(result).length).toBeGreaterThan(0);
	});

	bench('tasksByList filter (list page)', () => {
		const result = TASKS_10K.filter((t) => t.list_id === 'list-3');
		expect(result.length).toBeGreaterThan(0);
	});

	bench('title/notes text search filter — 100ms budget', () => {
		const query = 'alpha beta 42';
		const lower = query.toLowerCase();
		const result = TASKS_10K.filter(
			(t) =>
				t.title.toLowerCase().includes(lower) ||
				(t.notes ?? '').toLowerCase().includes(lower)
		);
		expect(result).toBeDefined();
	});

	bench('myDayPending filter (My Day page)', () => {
		const today = new Date().toISOString().slice(0, 10);
		const result = TASKS_10K.filter(
			(t) =>
				t.status === 'pending' &&
				(t.my_day || t.due_date === today)
		);
		expect(result).toBeDefined();
	});
});
