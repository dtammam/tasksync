import { derived, get, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';
import { repo } from '$lib/data/repo';

const tasksStore = writable<Task[]>([]);

const makeLocalTask = (title: string, list_id: string, opts?: { my_day?: boolean }) => {
	const nowTs = Date.now();
	const id = `local-${crypto.randomUUID ? crypto.randomUUID() : nowTs.toString(36)}`;
	const order = `local-${nowTs}`;
	const task: Task = {
		id,
		title,
		priority: 0,
		status: 'pending',
		list_id,
		my_day: opts?.my_day ?? false,
		tags: [],
		checklist: [],
		order,
		attachments: [],
		created_ts: nowTs,
		updated_ts: nowTs,
		dirty: true,
		local: true
	};
	return task;
};

export const tasks = {
	subscribe: tasksStore.subscribe,
	add(task: Task) {
		tasksStore.update((list) => [...list, task]);
		void repo.saveTasks(get(tasksStore));
	},
	createLocal(title: string, list_id: string, opts?: { my_day?: boolean }) {
		const trimmed = title.trim();
		if (!trimmed) return;
		const task = makeLocalTask(trimmed, list_id, opts);
		tasksStore.update((list) => [...list, task]);
		void repo.saveTasks(get(tasksStore));
		return task;
	},
	setAll(next: Task[]) {
		tasksStore.set(next);
		void repo.saveTasks(next);
	},
	toggle(id: string) {
		tasksStore.update((list) =>
			list.map((task) =>
				task.id === id
					? {
							...task,
							status: task.status === 'done' ? 'pending' : 'done',
							updated_ts: Date.now(),
							dirty: true
						}
					: task
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	getAll() {
		return get(tasksStore);
	},
	clearDirty(id: string) {
		tasksStore.update((list) =>
			list.map((task) => (task.id === id ? { ...task, dirty: false } : task))
		);
		void repo.saveTasks(get(tasksStore));
	},
	remove(id: string) {
		tasksStore.update((list) => list.filter((t) => t.id !== id));
		void repo.saveTasks(get(tasksStore));
	},
	replaceWithRemote(localId: string, remote: Task) {
		tasksStore.update((list) =>
			list.map((task) =>
				task.id === localId
					? { ...remote, dirty: false, local: false }
					: task.id === remote.id
						? task
						: task
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	async hydrateFromDb() {
		const { tasks: stored } = await repo.loadAll();
		if (stored.length) {
			tasksStore.set(stored);
		}
	}
};

export const pendingCount = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => task.status === 'pending').length
);

export const myDayPending = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => task.my_day && task.status === 'pending')
);

export const myDayCompleted = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => task.my_day && task.status === 'done')
);

export const tasksByList = (listId: string) =>
	derived(tasksStore, ($tasks) => $tasks.filter((task) => task.list_id === listId));

export const listCounts = derived(tasksStore, ($tasks) => {
	return $tasks.reduce<Record<string, { pending: number; total: number }>>((acc, task) => {
		const entry = acc[task.list_id] ?? { pending: 0, total: 0 };
		entry.total += 1;
		if (task.status === 'pending') entry.pending += 1;
		acc[task.list_id] = entry;
		return acc;
	}, {});
});

export const getTask = (id: string) => {
	return get(tasksStore).find((t) => t.id === id);
};
