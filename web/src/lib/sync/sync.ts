import { api } from '$lib/api/client';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import { repo } from '$lib/data/repo';
import { syncStatus } from './status';
import type { Task } from '$shared/types/task';
import type { List } from '$shared/types/list';

const isServerId = (id: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const requestIdForLocalTask = (id: string): string | undefined => {
	if (isServerId(id)) return id;
	const localPrefix = 'local-';
	if (id.startsWith(localPrefix)) {
		const maybeUuid = id.slice(localPrefix.length);
		if (isServerId(maybeUuid)) return maybeUuid;
	}
	return undefined;
};

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
	attachments: t.attachments ? JSON.parse(t.attachments) : [],
	url: t.url ?? undefined,
	recurrence_id: t.recur_rule ?? undefined,
	due_date: t.due_date ?? undefined,
	occurrences_completed: t.occurrences_completed ?? 0,
	notes: t.notes ?? undefined,
	assignee_user_id: t.assignee_user_id ?? undefined,
	created_by_user_id: t.created_by_user_id ?? undefined,
	created_ts: t.created_ts,
	updated_ts: t.updated_ts
});

export const syncFromServer = async () => {
	syncStatus.setPull('running');
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

		lists.setAll(toLists);
		tasks.mergeRemote(toTasks);
		await repo.saveTasks(tasks.getAll());
		syncStatus.setQueueDepth(tasks.getAll().filter((t) => t.dirty).length);
		syncStatus.setPull('idle');
		return { lists: toLists.length, tasks: toTasks.length };
	} catch (err) {
		console.warn('sync failed', err);
		syncStatus.setPull('error', err instanceof Error ? err.message : String(err));
		return { lists: 0, tasks: 0, error: true };
	}
};

export const pushPendingToServer = async () => {
	syncStatus.setPush('running');
	const dirty = tasks.getAll().filter((t) => t.dirty);
	syncStatus.setQueueDepth(dirty.length);
	if (!dirty.length) {
		syncStatus.setPush('idle');
		return { pushed: 0 };
	}
	let pushed = 0;
	let created = 0;
	let processed = 0;
	for (const t of dirty) {
		if (!t.local && !isServerId(t.id)) {
			// Drop legacy seed IDs that were never created on the server.
			tasks.remove(t.id);
			await repo.saveTasks(tasks.getAll());
			processed += 1;
			syncStatus.setQueueDepth(Math.max(dirty.length - processed, 0));
			continue;
		}
		try {
			if (t.local) {
				const createdTask = await api.createTask({
					id: requestIdForLocalTask(t.id),
					title: t.title,
					list_id: t.list_id,
					order: t.order,
					my_day: t.my_day ?? false,
					url: t.url,
					recur_rule: t.recurrence_id,
					attachments: t.attachments ? JSON.stringify(t.attachments) : undefined,
					due_date: t.due_date,
					notes: t.notes,
					assignee_user_id: t.assignee_user_id
				});
				tasks.replaceWithRemote(t.id, mapApiTask(createdTask), t);
				created += 1;
				pushed += 1;
			} else {
				await api.updateTaskMeta(t.id, {
					title: t.title,
					status: t.status,
					list_id: t.list_id,
					my_day: t.my_day ?? false,
					url: t.url,
					recur_rule: t.recurrence_id,
					attachments: t.attachments ? JSON.stringify(t.attachments) : undefined,
					due_date: t.due_date,
					notes: t.notes,
					occurrences_completed: t.occurrences_completed,
					assignee_user_id: t.assignee_user_id
				});
				tasks.clearDirty(t.id);
				pushed += 1;
			}
			// Persist each mutation to minimize duplicate creates if the page reloads mid-push.
			await repo.saveTasks(tasks.getAll());
			processed += 1;
			syncStatus.setQueueDepth(Math.max(dirty.length - processed, 0));
		} catch (err) {
			console.warn('push failed', t.id, err);
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('404')) {
				tasks.remove(t.id);
				await repo.saveTasks(tasks.getAll());
				processed += 1;
				syncStatus.setQueueDepth(Math.max(dirty.length - processed, 0));
				continue;
			}
			syncStatus.setPush('error', msg);
			syncStatus.setQueueDepth(Math.max(dirty.length - processed, 0));
			return { pushed, created, error: true };
		}
	}
	syncStatus.setPush('idle');
	syncStatus.setQueueDepth(0);
	syncStatus.markReplay();
	// Keep a final save to coalesce any remaining in-memory updates.
	await repo.saveTasks(tasks.getAll());
	return { pushed, created };
};
