import type { Task } from '$shared/types/task';

export interface ParsedTaskInput {
	title: string;
	status: Task['status'];
	list_id?: string;
	my_day?: boolean;
}

/**
 * Parses markdown lines like:
 * - [ ] Title #list-id @myday
 * - [x] Done task
 *
 * Returns structured task inputs using a provided default list id.
 */
export const parseMarkdownTasks = (markdown: string, defaultListId: string): ParsedTaskInput[] => {
	return markdown
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length)
		.map((line) => {
			const status: Task['status'] = /\[x\]/i.test(line) ? 'done' : 'pending';
			const my_day = /@myday\b/i.test(line);
			const listMatch = line.match(/#([\w-]+)/);
			const list_id = listMatch ? listMatch[1] : defaultListId;
			// strip control tokens
			const title = line
				.replace(/^-+\s*/, '')
				.replace(/\[( |x)\]\s*/i, '')
				.replace(/@myday\b/gi, '')
				.replace(/#([\w-]+)/g, '')
				.trim();
			return { title, status, list_id, my_day };
		})
		.filter((t) => t.title.length > 0);
};
