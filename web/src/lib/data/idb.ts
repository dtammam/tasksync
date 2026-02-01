import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { List } from '$shared/types/list';
import type { Task } from '$shared/types/task';

interface TaskSyncDB extends DBSchema {
	lists: {
		key: string;
		value: List;
	};
	tasks: {
		key: string;
		value: Task;
		indexes: { 'by-list': string };
	};
}

let dbPromise: Promise<IDBPDatabase<TaskSyncDB>> | null = null;

export const getDb = () => {
	if (typeof indexedDB === 'undefined') {
		return null;
	}
	if (!dbPromise) {
		dbPromise = openDB<TaskSyncDB>('tasksync', 1, {
			upgrade(db) {
				db.createObjectStore('lists', { keyPath: 'id' });
				const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
				tasks.createIndex('by-list', 'list_id');
			}
		});
	}
	return dbPromise;
};
