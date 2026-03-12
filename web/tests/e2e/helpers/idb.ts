import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const waitForTaskInIdb = async (page: Page, title: string) => {
	await expect
		.poll(async () =>
			page.evaluate(async (taskTitle) => {
				const resolveScopedDbName = () => {
					const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
					const rawUser = localStorage.getItem('tasksync:auth-user');
					let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
					if (rawUser) {
						try {
							const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
							if (parsed.user_id && parsed.space_id) {
								scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
							}
						} catch {
							// Keep fallback scope.
						}
					}
					const sanitized =
						scope
							.toLowerCase()
							.replace(/[^a-z0-9_-]/g, '_')
							.slice(0, 80) || 'legacy';
					return `tasksync_${sanitized}`;
				};
				const dbName = resolveScopedDbName();
				const db = await new Promise<IDBDatabase | null>((resolve) => {
					const req = indexedDB.open(dbName);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => resolve(null);
				});
				if (!db) return false;
				const storeNames = Array.from(db.objectStoreNames);
				if (!storeNames.includes('tasks')) {
					db.close();
					return false;
				}
				const all = await new Promise<unknown[]>((resolve) => {
					try {
						const tx = db.transaction('tasks', 'readonly');
						const store = tx.objectStore('tasks');
						const allReq = store.getAll();
						allReq.onsuccess = () => resolve(allReq.result ?? []);
						allReq.onerror = () => resolve([]);
					} catch {
						resolve([]);
					}
				});
				db.close();
				return all.some((task) => {
					if (!task || typeof task !== 'object') return false;
					if (!('title' in task)) return false;
					return (task as { title?: unknown }).title === taskTitle;
				});
			}, title)
		)
		.toBe(true);
};

export const readTaskFromIdb = async (page: Page, title: string) =>
	page.evaluate(async (taskTitle) => {
		const resolveScopedDbName = () => {
			const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
			const rawUser = localStorage.getItem('tasksync:auth-user');
			let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
			if (rawUser) {
				try {
					const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
					if (parsed.user_id && parsed.space_id) {
						scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
					}
				} catch {
					// Keep fallback scope.
				}
			}
			const sanitized =
				scope
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, '_')
					.slice(0, 80) || 'legacy';
			return `tasksync_${sanitized}`;
		};
		const dbName = resolveScopedDbName();
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open(dbName);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		if (!db) return null;
		const storeNames = Array.from(db.objectStoreNames);
		if (!storeNames.includes('tasks')) {
			db.close();
			return null;
		}
		const all = await new Promise<unknown[]>((resolve) => {
			try {
				const tx = db.transaction('tasks', 'readonly');
				const store = tx.objectStore('tasks');
				const allReq = store.getAll();
				allReq.onsuccess = () => resolve(allReq.result ?? []);
				allReq.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
		db.close();
		const matched = all.find((task) => {
			if (!task || typeof task !== 'object') return false;
			if (!('title' in task)) return false;
			return (task as { title?: unknown }).title === taskTitle;
		});
		if (!matched || typeof matched !== 'object') return null;
		return matched as {
			title?: string;
			due_date?: string;
			recurrence_id?: string;
			my_day?: boolean;
			notes?: string;
			punted_from_due_date?: string;
			punted_on_date?: string;
			occurrences_completed?: number;
			status?: string;
		};
	}, title);

export const updateTaskInIdb = async (
	page: Page,
	title: string,
	patch: Record<string, unknown>
) =>
	page.evaluate(
		async ({
			taskTitle,
			taskPatch
		}: {
			taskTitle: string;
			taskPatch: Record<string, unknown>;
		}) => {
			const resolveScopedDbName = () => {
				const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
				const rawUser = localStorage.getItem('tasksync:auth-user');
				let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
				if (rawUser) {
					try {
						const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
						if (parsed.user_id && parsed.space_id) {
							scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
						}
					} catch {
						// Keep fallback scope.
					}
				}
				const sanitized =
					scope
						.toLowerCase()
						.replace(/[^a-z0-9_-]/g, '_')
						.slice(0, 80) || 'legacy';
				return `tasksync_${sanitized}`;
			};
			const dbName = resolveScopedDbName();
			const db = await new Promise<IDBDatabase | null>((resolve) => {
				const req = indexedDB.open(dbName);
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
			});
			if (!db) return false;
			const storeNames = Array.from(db.objectStoreNames);
			if (!storeNames.includes('tasks')) {
				db.close();
				return false;
			}
			try {
				const all = await new Promise<unknown[]>((resolve) => {
					const tx = db.transaction('tasks', 'readonly');
					const store = tx.objectStore('tasks');
					const allReq = store.getAll();
					allReq.onsuccess = () => resolve(allReq.result ?? []);
					allReq.onerror = () => resolve([]);
				});
				const matched = all.find((task) => {
					if (!task || typeof task !== 'object') return false;
					if (!('title' in task)) return false;
					return (task as { title?: unknown }).title === taskTitle;
				});
				if (!matched || typeof matched !== 'object') {
					db.close();
					return false;
				}
				const updated = {
					...matched,
					...taskPatch,
					dirty: true,
					updated_ts: Date.now()
				};
				await new Promise<boolean>((resolve) => {
					const tx = db.transaction('tasks', 'readwrite');
					const store = tx.objectStore('tasks');
					const putReq = store.put(updated);
					putReq.onsuccess = () => resolve(true);
					putReq.onerror = () => resolve(false);
				});
				db.close();
				return true;
			} catch {
				db.close();
				return false;
			}
		},
		{ taskTitle: title, taskPatch: patch }
	);

export const readTasksFromIdbByTitle = async (page: Page, title: string) =>
	page.evaluate(async (taskTitle) => {
		const resolveScopedDbName = () => {
			const authMode = localStorage.getItem('tasksync:auth-mode') ?? 'legacy';
			const rawUser = localStorage.getItem('tasksync:auth-user');
			let scope = authMode === 'token' ? 'token-anonymous' : 'legacy-default';
			if (rawUser) {
				try {
					const parsed = JSON.parse(rawUser) as { user_id?: string; space_id?: string };
					if (parsed.user_id && parsed.space_id) {
						scope = `space:${parsed.space_id}:user:${parsed.user_id}`;
					}
				} catch {
					// Keep fallback scope.
				}
			}
			const sanitized =
				scope
					.toLowerCase()
					.replace(/[^a-z0-9_-]/g, '_')
					.slice(0, 80) || 'legacy';
			return `tasksync_${sanitized}`;
		};

		const dbName = resolveScopedDbName();
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open(dbName);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		});
		if (!db) return [];
		if (!Array.from(db.objectStoreNames).includes('tasks')) {
			db.close();
			return [];
		}

		const all = await new Promise<unknown[]>((resolve) => {
			try {
				const tx = db.transaction('tasks', 'readonly');
				const store = tx.objectStore('tasks');
				const allReq = store.getAll();
				allReq.onsuccess = () => resolve(allReq.result ?? []);
				allReq.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
		db.close();

		return all
			.filter(
				(task) =>
					!!task &&
					typeof task === 'object' &&
					(task as { title?: unknown }).title === taskTitle
			)
			.map((task) => {
				const candidate = task as {
					id?: unknown;
					title?: unknown;
					list_id?: unknown;
					status?: unknown;
					dirty?: unknown;
					local?: unknown;
				};
				return {
					id: typeof candidate.id === 'string' ? candidate.id : '',
					title: typeof candidate.title === 'string' ? candidate.title : '',
					list_id: typeof candidate.list_id === 'string' ? candidate.list_id : '',
					status: typeof candidate.status === 'string' ? candidate.status : '',
					dirty: !!candidate.dirty,
					local: !!candidate.local
				};
			});
	}, title);
