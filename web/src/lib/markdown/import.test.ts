import { describe, expect, it } from 'vitest';
import { parseMarkdownTasks } from './import';

describe('parseMarkdownTasks', () => {
	it('parses status, list, and my day tokens', () => {
		const md = `
		- [ ] First task #alpha
		- [x] Done item @myday
		`;
		const result = parseMarkdownTasks(md, 'default');
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			title: 'First task',
			status: 'pending',
			list_id: 'alpha',
			my_day: false
		});
		expect(result[1]).toEqual({
			title: 'Done item',
			status: 'done',
			list_id: 'default',
			my_day: true
		});
	});

	it('drops empty lines and preserves default list', () => {
		const md = `

		- [ ]   Spaced title
		`;
		const result = parseMarkdownTasks(md, 'goal-management');
		expect(result[0].list_id).toBe('goal-management');
		expect(result[0].title).toBe('Spaced title');
	});
});
