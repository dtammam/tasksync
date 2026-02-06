import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { List } from '$shared/types/list';
import type { Task } from '$shared/types/task';
import type { SoundSettings } from '$shared/types/settings';

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
	settings: {
		key: string;
		value: SoundSettings & { id: string };
	};
}

let dbPromise: Promise<IDBPDatabase<TaskSyncDB>> | null = null;

export const getDb = () => {
	if (typeof indexedDB === 'undefined') {
		return null;
	}
	if (!dbPromise) {
		dbPromise = openDB<TaskSyncDB>('tasksync', 2, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('lists')) {
					db.createObjectStore('lists', { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains('tasks')) {
					const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
					tasks.createIndex('by-list', 'list_id');
				}
				if (!db.objectStoreNames.contains('settings')) {
					db.createObjectStore('settings', { keyPath: 'id' });
				}
			}
		});
	}
	return dbPromise;
};
