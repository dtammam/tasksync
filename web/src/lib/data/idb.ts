import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { List } from '$shared/types/list';
import type { Task } from '$shared/types/task';
import type { SoundSettings } from '$shared/types/settings';
import type { StreakOpKind, StreakBreakCause } from '$shared/types/streak';

/** Persisted record in the outbound streakOps queue. */
interface StreakOp {
	opKey: string; // primary key (matches StreakOpRequest.opKey)
	kind: StreakOpKind; // imported from $shared/types/streak
	occurredAt: number; // ms epoch (matches StreakOpRequest.occurredAt)
	cause?: StreakBreakCause | null; // only when kind === 'break'
	enqueuedAt: number; // ms epoch — drives by-enqueued FIFO order
	taskId?: string; // present when kind === 'increment'; carried for diagnostics
}

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
	streakOps: {
		key: string; // opKey (string)
		value: StreakOp;
		indexes: { 'by-enqueued': number };
	};
}

let dbPromise: Promise<IDBPDatabase<TaskSyncDB>> | null = null;
let dbScope = 'legacy';

const sanitizeScope = (scope: string) =>
	scope
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, '_')
		.slice(0, 80) || 'legacy';

const dbNameForScope = (scope: string) => `tasksync_${scope}`;

export const setDbScope = (scope: string) => {
	const next = sanitizeScope(scope);
	if (next === dbScope) return;
	if (dbPromise) {
		void dbPromise
			.then((db) => db.close())
			.catch(() => undefined);
	}
	dbPromise = null;
	dbScope = next;
};

export const getDb = () => {
	if (typeof indexedDB === 'undefined') {
		return null;
	}
	if (!dbPromise) {
		dbPromise = openDB<TaskSyncDB>(dbNameForScope(dbScope), 3, {
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
				if (!db.objectStoreNames.contains('streakOps')) {
					const streakOps = db.createObjectStore('streakOps', { keyPath: 'opKey' });
					streakOps.createIndex('by-enqueued', 'enqueuedAt');
				}
			}
		});
	}
	return dbPromise;
};
