import type { List } from '$shared/types/list';
import type { Task } from '$shared/types/task';
import { getDb } from './idb';

export const repo = {
	async loadAll(): Promise<{ lists: List[]; tasks: Task[] }> {
		const db = getDb();
		if (!db) return { lists: [], tasks: [] };
		const $db = await db;
		const [lists, tasks] = await Promise.all([$db.getAll('lists'), $db.getAll('tasks')]);
		return { lists, tasks };
	},
	async saveLists(lists: List[]) {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		const tx = $db.transaction('lists', 'readwrite');
		for (const list of lists) await tx.store.put(list);
		await tx.done;
	},
	async saveTasks(tasks: Task[]) {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		const tx = $db.transaction('tasks', 'readwrite');
		for (const task of tasks) await tx.store.put(task);
		await tx.done;
	}
};
