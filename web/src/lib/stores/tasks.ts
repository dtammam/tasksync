import { derived, get, readable, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';
import { repo } from '$lib/data/repo';
import { playCompletion } from '$lib/sound/sound';
import { soundSettings } from '$lib/stores/settings';
import { auth } from '$lib/stores/auth';
import { api } from '$lib/api/client';
import {
	nextDueForRecurrence,
	prevDueForRecurrence,
	toLocalIsoDate
} from '$lib/tasks/recurrence';

const tasksStore = writable<Task[]>([]);
const isServerId = (id: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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
		assignee_user_id?: string;
	}
) => {
	const nowTs = Date.now();
	const id = `local-${crypto.randomUUID ? crypto.randomUUID() : nowTs.toString(36)}`;
	const order = `local-${nowTs}`;
	const currentUserId = auth.get().user?.user_id;
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
		assignee_user_id: opts?.assignee_user_id ?? currentUserId,
		created_by_user_id: currentUserId,
		occurrences_completed: 0,
		completed_ts: undefined,
		created_ts: nowTs,
		updated_ts: nowTs,
		dirty: true,
		local: true
	};
	return task;
};

const hasChangesSinceCreate = (current: Task, sent: Task) =>
	current.title !== sent.title ||
	current.status !== sent.status ||
	current.list_id !== sent.list_id ||
	current.my_day !== sent.my_day ||
	current.order !== sent.order ||
	current.url !== sent.url ||
	current.recurrence_id !== sent.recurrence_id ||
	current.due_date !== sent.due_date ||
	(current.completed_ts ?? 0) !== (sent.completed_ts ?? 0) ||
	current.notes !== sent.notes ||
	current.assignee_user_id !== sent.assignee_user_id ||
	(current.occurrences_completed ?? 0) !== (sent.occurrences_completed ?? 0) ||
	JSON.stringify(current.attachments ?? []) !== JSON.stringify(sent.attachments ?? []);

export const tasks = {
	subscribe: tasksStore.subscribe,
	add(task: Task) {
		tasksStore.update((list) => [...list, task]);
		void repo.saveTasks(get(tasksStore));
	},
	createLocal(title: string, list_id: string, opts?: { my_day?: boolean; assignee_user_id?: string }) {
		return tasks.createLocalWithOptions(title, list_id, opts);
	},
	createLocalWithOptions(
		title: string,
		list_id: string,
		opts?: {
			my_day?: boolean;
			status?: Task['status'];
			priority?: Task['priority'];
			assignee_user_id?: string;
		}
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
	mergeRemote(remote: Task[]) {
		tasksStore.update((current) => {
			// Sync pull is incremental, so start with local cache and layer remote deltas on top.
			const merged = new Map<string, Task>();
			for (const task of current) {
				merged.set(task.id, task);
			}
			for (const task of remote) {
				const existing = merged.get(task.id);
				if (existing?.dirty) continue;
				merged.set(task.id, task);
			}
			return Array.from(merged.values());
		});
		void repo.saveTasks(get(tasksStore));
	},
	toggle(id: string) {
		let shouldPlayCompletion = false;
		tasksStore.update((list) =>
			list.map((task) =>
				task.id === id
					? (() => {
							const now = Date.now();
							if (task.recurrence_id && task.status !== 'done') {
								shouldPlayCompletion = true;
								const next = nextDueForRecurrence(task.due_date, task.recurrence_id);
								return {
									...task,
									status: 'pending',
									due_date: next,
									occurrences_completed: (task.occurrences_completed ?? 0) + 1,
									completed_ts: now,
									updated_ts: now,
									dirty: true
								};
							}
							const nextStatus = task.status === 'done' ? 'pending' : 'done';
							if (nextStatus === 'done') {
								shouldPlayCompletion = true;
							}
							return {
								...task,
								status: nextStatus,
								completed_ts: nextStatus === 'done' ? now : undefined,
								updated_ts: now,
								dirty: true
							};
						})()
					: task
			)
		);
		void repo.saveTasks(get(tasksStore));
		if (shouldPlayCompletion) {
			void playCompletion(soundSettings.get());
		}
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
	async deleteRemote(id: string) {
		const existing = tasks.getAll().find((task) => task.id === id);
		if (!existing) return;
		if (existing.local || !isServerId(existing.id)) {
			tasks.remove(id);
			return;
		}
		await api.deleteTask(existing.id);
		tasks.remove(id);
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
	setAssignee(id: string, assignee_user_id?: string) {
		const now = Date.now();
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							assignee_user_id,
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
							due_date: nextDueForRecurrence(t.due_date, t.recurrence_id),
							updated_ts: Date.now(),
							dirty: true
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	undoRecurringCompletion(id: string) {
		const now = Date.now();
		const isCompletionFromToday = (ts?: number) =>
			typeof ts === 'number' && Number.isFinite(ts) && toLocalIsoDate(new Date(ts)) === todayIso();
		tasksStore.update((list) =>
			list.map((t) =>
				t.id === id &&
				!!t.recurrence_id &&
				t.status === 'pending' &&
				isCompletionFromToday(t.completed_ts)
					? {
							...t,
							due_date: prevDueForRecurrence(t.due_date, t.recurrence_id),
							occurrences_completed: Math.max(0, (t.occurrences_completed ?? 0) - 1),
							completed_ts: undefined,
							updated_ts: now,
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
			completed_ts?: number;
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
							completed_ts: details.completed_ts ?? t.completed_ts,
							updated_ts: Date.now(),
							dirty: true
						}
					: t
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	replaceWithRemote(localId: string, remote: Task, sent?: Task) {
		tasksStore.update((list) =>
			list.map((task) =>
				task.id === localId
					? sent && hasChangesSinceCreate(task, sent)
						? {
								...task,
								id: remote.id,
								local: false,
								dirty: true
							}
						: { ...remote, dirty: false, local: false }
					: task.id === remote.id
						? task
						: task
			)
		);
		void repo.saveTasks(get(tasksStore));
	},
	async hydrateFromDb() {
		const { tasks: stored } = await repo.loadAll();
		tasksStore.set(stored);
	}
};

export const pendingCount = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => task.status === 'pending').length
);

const todayIso = () => toLocalIsoDate(new Date());
const isToday = (date?: string) => date && date === todayIso();
const isBeforeToday = (date?: string) => !!date && date < todayIso();
const isTodayTs = (ts?: number) =>
	typeof ts === 'number' && Number.isFinite(ts) && toLocalIsoDate(new Date(ts)) === todayIso();
const myDayDateKey = readable(todayIso(), (set) => {
	if (typeof window === 'undefined') return;
	let lastSeenDay = todayIso();
	const tick = () => {
		const nextDay = todayIso();
		if (nextDay === lastSeenDay) return;
		lastSeenDay = nextDay;
		set(nextDay);
	};
	const intervalId = window.setInterval(tick, 60 * 1000);
	return () => {
		window.clearInterval(intervalId);
	};
});
const canSeeTask = (task: Task, userId?: string | null, role?: string | null) => {
	void task;
	void userId;
	void role;
	return true;
};
const isAssignedToUser = (task: Task, userId?: string | null) => {
	if (!userId) return true;
	return (task.assignee_user_id ?? task.created_by_user_id) === userId;
};

const inMyDay = (task: Task) => {
	if (task.my_day) return true;
	return isToday(task.due_date);
};

const isMissedTask = (task: Task) => task.status === 'pending' && isBeforeToday(task.due_date);
const wasRecurringCompletedToday = (task: Task) =>
	!!task.recurrence_id && task.status === 'pending' && isTodayTs(task.completed_ts);

const wasCompletedToday = (task: Task) => {
	if (task.status !== 'done') return false;
	return isTodayTs(task.completed_ts ?? task.updated_ts);
};

export const myDayPending = derived(
	[tasksStore, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		return $tasks.filter(
			(task) =>
				canSeeTask(task, $auth.user?.user_id, $auth.user?.role) &&
				isAssignedToUser(task, $auth.user?.user_id) &&
				inMyDay(task) &&
				!isMissedTask(task) &&
				task.status === 'pending'
		);
	}
);

export const myDayMissed = derived([tasksStore, auth, myDayDateKey], ([$tasks, $auth, _myDayDateKey]) => {
	void _myDayDateKey;
	return $tasks
		.filter(
			(task) =>
				canSeeTask(task, $auth.user?.user_id, $auth.user?.role) &&
				isAssignedToUser(task, $auth.user?.user_id) &&
				isMissedTask(task)
		)
		.sort((a, b) => {
			const dueA = a.due_date ?? '';
			const dueB = b.due_date ?? '';
			if (dueA !== dueB) return dueA < dueB ? -1 : 1;
			if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
			return a.created_ts - b.created_ts;
		});
});

export const myDayCompleted = derived(
	[tasksStore, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		return $tasks.filter(
			(task) =>
				canSeeTask(task, $auth.user?.user_id, $auth.user?.role) &&
				isAssignedToUser(task, $auth.user?.user_id) &&
				((inMyDay(task) && wasCompletedToday(task)) || wasRecurringCompletedToday(task))
		);
	}
);

export const myDaySuggestions = derived(
	[tasksStore, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		const today = todayIso();
		const tomorrow = nextDueForRecurrence(today, 'daily') ?? today;
		return $tasks
			.filter(
				(t) =>
					canSeeTask(t, $auth.user?.user_id, $auth.user?.role) &&
					isAssignedToUser(t, $auth.user?.user_id) &&
					t.status === 'pending' &&
					!t.recurrence_id &&
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
	}
);

export const tasksByList = (listId: string) =>
	derived([tasksStore, auth], ([$tasks, $auth]) =>
		$tasks.filter(
			(task) => task.list_id === listId && canSeeTask(task, $auth.user?.user_id, $auth.user?.role)
		)
	);

export const listCounts = derived([tasksStore, auth], ([$tasks, $auth]) => {
	return $tasks.reduce<Record<string, { pending: number; total: number }>>((acc, task) => {
		if (!canSeeTask(task, $auth.user?.user_id, $auth.user?.role)) return acc;
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
