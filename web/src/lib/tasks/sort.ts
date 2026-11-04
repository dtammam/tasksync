import type { Task } from '$shared/types/task';

const compareAlpha = (left: string | undefined, right: string | undefined): number => {
	const a = (left ?? '').trim().toLowerCase();
	const b = (right ?? '').trim().toLowerCase();
	if (a === b) return 0;
	return a < b ? -1 : 1;
};

/**
 * Sort tasks purely by the chosen mode (`created` | `alpha` | `due_date`) and
 * direction. Since retire-starred (2026-11-04) there is no starred-first tier:
 * `priority` is inert. Returns a new array.
 */
export const sortTasks = (arr: Task[], mode = 'created', direction = 'asc'): Task[] => {
	const copy = [...arr];
	const isAscending = direction !== 'desc';
	copy.sort((a, b) => {
		if (mode === 'due_date') {
			const dueA = typeof a.due_date === 'string' ? a.due_date : '';
			const dueB = typeof b.due_date === 'string' ? b.due_date : '';
			const hasDueA = !!dueA;
			const hasDueB = !!dueB;
			if (hasDueA && hasDueB && dueA !== dueB) {
				return isAscending ? (dueA < dueB ? -1 : 1) : dueA > dueB ? -1 : 1;
			}
			if (hasDueA !== hasDueB) {
				// Keep undated tasks at the bottom for both ascending and descending due-date sort.
				return hasDueA ? -1 : 1;
			}
			return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
		}

		if (mode === 'alpha') {
			const byTitle = compareAlpha(a.title, b.title);
			if (byTitle === 0) {
				return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
			}
			return isAscending ? byTitle : byTitle * -1;
		}

		return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
	});
	return copy;
};
