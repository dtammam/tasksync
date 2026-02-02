import { derived, get, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';
import { repo } from '$lib/data/repo';

const tasksStore = writable<Task[]>([]);

const addDays = (dateStr: string, days: number) => {
	const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
};

const nextDue = (current: string | undefined, recur?: string) => {
	if (!recur) return undefined;
	switch (recur) {
		case 'daily':
			return addDays(current ?? new Date().toISOString().slice(0, 10), 1);
		case 'weekly':
			return addDays(current ?? new Date().toISOString().slice(0, 10), 7);
		case 'biweekly':
			return addDays(current ?? new Date().toISOString().slice(0, 10), 14);
		case 'monthly': {
			const d = current ? new Date(current + 'T00:00:00') : new Date();
			d.setMonth(d.getMonth() + 1);
			return d.toISOString().slice(0, 10);
		}
		default:
			return undefined;
	}
};

const makeLocalTask = (
	title: string,
	list_id: string,
	opts?: {
		my_day?: boolean;
		status?: Task['status'];
		priority?: Task['priority'];
		due_date?: string;
		recurrence_id?: string;
		url?: string;
		notes?: string;
	}
) => {
	const nowTs = Date.now();
	const id = `local-${crypto.randomUUID ? crypto.randomUUID() : nowTs.toString(36)}`;
	const order = `local-${nowTs}`;
	const task: Task = {
		id,
		title,
		priority: opts?.priority ?? 0,
		status: opts?.status ?? 'pending',
		list_id,
		my_day: opts?.my_day ?? false,
		tags: [],
		checklist: [],
		order,
		attachments: [],
		due_date: opts?.due_date,
		recurrence_id: opts?.recurrence_id,
		url: opts?.url,
		notes: opts?.notes,
		occurrences_completed: 0,
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
		return tasks.createLocalWithOptions(title, list_id, opts);
	},
	createLocalWithOptions(
		title: string,
		list_id: string,
		opts?: { my_day?: boolean; status?: Task['status']; priority?: Task['priority'] }
	) {
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
					? (() => {
							const now = Date.now();
							if (task.recurrence_id && task.status !== 'done') {
								const next = nextDue(task.due_date, task.recurrence_id);
								return {
									...task,
									status: 'pending',
									due_date: next,
									occurrences_completed: (task.occurrences_completed ?? 0) + 1,
									updated_ts: now,
									dirty: true
								};
							}
							return {
								...task,
								status: task.status === 'done' ? 'pending' : 'done',
								updated_ts: now,
								dirty: true
							};
						})()
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
	moveToList(id: string, list_id: string) {
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							list_id,
							dirty: true,
							updated_ts: Date.now()
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	rename(id: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed) return;
		const now = Date.now();
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							title: trimmed,
							updated_ts: now,
							dirty: true
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	setMyDay(id: string, my_day: boolean) {
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							my_day,
							dirty: true,
							updated_ts: Date.now()
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	setDueDate(id: string, due_date?: string) {
		const now = Date.now();
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							due_date,
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	setPriority(id: string, priority: Task['priority']) {
		const now = Date.now();
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							priority,
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	skip(id: string) {
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							due_date: nextDue(t.due_date, t.recurrence_id),
							updated_ts: Date.now(),
							dirty: true
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	updateDetails(
		id: string,
		details: {
			url?: string;
			recurrence_id?: string;
			attachments?: Task['attachments'];
			due_date?: string;
			notes?: string;
			occurrences_completed?: number;
		}
	) {
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							url: details.url ?? t.url,
							recurrence_id: details.recurrence_id ?? t.recurrence_id,
							attachments: details.attachments ?? t.attachments,
							due_date: details.due_date ?? t.due_date,
							notes: details.notes ?? t.notes,
							occurrences_completed:
								details.occurrences_completed ?? t.occurrences_completed ?? 0,
							updated_ts: Date.now(),
							dirty: true
						}
					: t
			)
		);
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

const todayIso = () => new Date().toISOString().slice(0, 10);
const isToday = (date?: string) => date && date === todayIso();

const inMyDay = (task: Task) => {
	if (task.my_day) return true;
	return isToday(task.due_date);
};

export const myDayPending = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => inMyDay(task) && task.status === 'pending')
);

export const myDayCompleted = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => inMyDay(task) && task.status === 'done')
);

export const myDaySuggestions = derived(tasksStore, ($tasks) => {
	const today = todayIso();
	const tomorrow = (() => {
		const d = new Date();
		d.setDate(d.getDate() + 1);
		return d.toISOString().slice(0, 10);
	})();
	return $tasks
		.filter(
			(t) =>
				t.status === 'pending' &&
				!inMyDay(t) &&
				(t.due_date === today || t.due_date === tomorrow || (!t.due_date && t.priority > 0))
		)
		.sort((a, b) => {
			// Prioritize due today, then tomorrow, then priority
			const aScore = a.due_date === today ? 2 : a.due_date === tomorrow ? 1 : 0;
			const bScore = b.due_date === today ? 2 : b.due_date === tomorrow ? 1 : 0;
			if (aScore !== bScore) return bScore - aScore;
			if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
			return a.created_ts - b.created_ts;
		})
		.slice(0, 6);
});

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
