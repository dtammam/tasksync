import { api } from '$lib/api/client';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import type { Task } from '$shared/types/task';
import type { List } from '$shared/types/list';

export const syncFromServer = async () => {
	try {
		const [remoteLists, remoteTasks] = await Promise.all([api.getLists(), api.getTasks()]);
		const toTasks: Task[] = remoteTasks.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status as Task['status'],
			list_id: t.list_id,
			my_day: t.my_day === 1,
			priority: 0,
			tags: [],
			checklist: [],
			order: t.order,
			attachments: [],
			created_ts: t.created_ts,
			updated_ts: t.updated_ts
		}));

		const toLists: List[] = remoteLists.map((l) => ({
			id: l.id,
			name: l.name,
			icon: l.icon ?? undefined,
			color: l.color ?? undefined,
			order: l.order
		}));

		lists.setAll(toLists);
		tasks.setAll(toTasks);
		return { lists: toLists.length, tasks: toTasks.length };
	} catch (err) {
		console.warn('sync failed', err);
		return { lists: 0, tasks: 0, error: true };
	}
};
