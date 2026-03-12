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

	it('parses plain-text and numbered lines as pending tasks', () => {
		const md = `
		Buy milk
		1. Buy eggs
		- Buy bread
		`;
		const result = parseMarkdownTasks(md, 'goal-management');
		expect(result).toEqual([
			{ title: 'Buy milk', status: 'pending', list_id: 'goal-management', my_day: false },
			{ title: 'Buy eggs', status: 'pending', list_id: 'goal-management', my_day: false },
			{ title: 'Buy bread', status: 'pending', list_id: 'goal-management', my_day: false }
		]);
	});

	it('skips markdown headings and content inside fenced code blocks', () => {
		const md = `
		# Grocery note
		- [ ] Apples
		\`\`\`
		- [x] Not a task here
		\`\`\`
		- [x] Bananas
		`;
		const result = parseMarkdownTasks(md, 'tasks');
		expect(result).toEqual([
			{ title: 'Apples', status: 'pending', list_id: 'tasks', my_day: false },
			{ title: 'Bananas', status: 'done', list_id: 'tasks', my_day: false }
		]);
	});
});
