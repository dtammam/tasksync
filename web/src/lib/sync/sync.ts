import { api } from '$lib/api/client';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import type { Task } from '$shared/types/task';
import type { List } from '$shared/types/list';

const mapApiTask = (t: Awaited<ReturnType<typeof api.getTasks>>[number]): Task => ({
	id: t.id,
	title: t.title,
	status: t.status as Task['status'],
	list_id: t.list_id,
	my_day: t.my_day === 1,
	dirty: false,
	local: false,
	priority: 0,
	tags: [],
	checklist: [],
	order: t.order,
	attachments: [],
	created_ts: t.created_ts,
	updated_ts: t.updated_ts
});

export const syncFromServer = async () => {
	try {
		const [remoteLists, remoteTasks] = await Promise.all([api.getLists(), api.getTasks()]);
		const toTasks: Task[] = remoteTasks.map(mapApiTask);

		const toLists: List[] = remoteLists.map((l) => ({
			id: l.id,
			name: l.name,
			icon: l.icon ?? undefined,
			color: l.color ?? undefined,
			order: l.order
		}));

		const current = tasks.getAll();
		const unsynced = current.filter((t) => t.dirty);

		lists.setAll(toLists);
		const merged = [
			...toTasks,
			...unsynced.filter((t) => !toTasks.some((remote) => remote.id === t.id))
		];
		tasks.setAll(merged);
		return { lists: toLists.length, tasks: toTasks.length };
	} catch (err) {
		console.warn('sync failed', err);
		return { lists: 0, tasks: 0, error: true };
	}
};

export const pushPendingToServer = async () => {
	const dirty = tasks.getAll().filter((t) => t.dirty);
	if (!dirty.length) return { pushed: 0 };
	let pushed = 0;
	let created = 0;
	for (const t of dirty) {
		try {
			if (t.local) {
				const createdTask = await api.createTask({
					title: t.title,
					list_id: t.list_id,
					order: t.order,
					my_day: t.my_day ?? false
				});
				tasks.replaceWithRemote(t.id, mapApiTask(createdTask));
				created += 1;
				pushed += 1;
			} else {
				await api.updateTaskStatus(t.id, t.status);
				tasks.clearDirty(t.id);
				pushed += 1;
			}
		} catch (err) {
			console.warn('push failed', t.id, err);
		}
	}
	return { pushed, created };
};
