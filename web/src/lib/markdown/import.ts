import type { Task } from '$shared/types/task';

export interface ParsedTaskInput {
	title: string;
	status: Task['status'];
	list_id?: string;
	my_day?: boolean;
}

const checkboxLine = /^\s*[-*+]\s*\[(?<check>[ xX])\]\s+(?<title>.+)$/;
const bulletLine = /^\s*[-*+]\s+(?<title>.+)$/;
const numberedLine = /^\s*\d+[.)]\s+(?<title>.+)$/;

const isSkippableLine = (line: string) => {
	if (!line) return true;
	// Skip common non-task markdown structures from note exports.
	if (/^#{1,6}\s+/.test(line)) return true;
	if (/^```/.test(line)) return true;
	return false;
};

const parseLine = (rawLine: string): ParsedTaskInput | null => {
	const line = rawLine.trim();
	if (isSkippableLine(line)) return null;

	let status: Task['status'] = 'pending';
	let body = line;

	const checkboxMatch = line.match(checkboxLine);
	if (checkboxMatch?.groups) {
		status = checkboxMatch.groups.check.toLowerCase() === 'x' ? 'done' : 'pending';
		body = checkboxMatch.groups.title.trim();
	} else {
		const bulletMatch = line.match(bulletLine);
		const numberedMatch = line.match(numberedLine);
		if (bulletMatch?.groups) {
			body = bulletMatch.groups.title.trim();
		} else if (numberedMatch?.groups) {
			body = numberedMatch.groups.title.trim();
		}
	}

	const my_day = /@myday\b/i.test(body);
	const listMatch = body.match(/(?:^|\s)#([\w-]+)/);
	const list_id = listMatch ? listMatch[1] : undefined;
	const title = body
		.replace(/@myday\b/gi, '')
		.replace(/(?:^|\s)#([\w-]+)/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (!title) return null;
	return { title, status, list_id, my_day };
};

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
		.map(parseLine)
		.filter((task): task is ParsedTaskInput => !!task)
		.map((task) => ({
			...task,
			list_id: task.list_id ?? defaultListId,
			my_day: task.my_day ?? false
		}));
};
