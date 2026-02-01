import { derived, get, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';

const now = Date.now();

const seedTasks: Task[] = [
	{
		id: 't1',
		title: 'Process daily considerations',
		priority: 1,
		status: 'pending',
		list_id: 'goal-management',
		my_day: true,
		tags: ['mindful'],
		checklist: [],
		order: 'a',
		attachments: [],
		created_ts: now - 1000 * 60 * 60,
		updated_ts: now - 1000 * 60 * 60
	},
	{
		id: 't2',
		title: 'Review calendar before sleep',
		priority: 0,
		status: 'pending',
		list_id: 'goal-management',
		my_day: true,
		tags: [],
		checklist: [],
		order: 'b',
		attachments: [],
		created_ts: now - 1000 * 60 * 120,
		updated_ts: now - 1000 * 60 * 120
	},
	{
		id: 't3',
		title: 'Finish DDR session #2',
		priority: 2,
		status: 'pending',
		list_id: 'goal-management',
		my_day: false,
		tags: ['fitness'],
		checklist: [],
		order: 'c',
		attachments: [],
		created_ts: now - 1000 * 60 * 200,
		updated_ts: now - 1000 * 60 * 200
	},
	{
		id: 't4',
		title: 'Call Luis',
		priority: 0,
		status: 'pending',
		list_id: 'tasks',
		my_day: false,
		tags: [],
		checklist: [],
		order: 'd',
		attachments: [],
		created_ts: now - 1000 * 60 * 300,
		updated_ts: now - 1000 * 60 * 300
	},
	{
		id: 't5',
		title: 'Health | floss before bed',
		priority: 0,
		status: 'done',
		list_id: 'daily-management',
		my_day: true,
		tags: ['health'],
		checklist: [],
		order: 'e',
		attachments: [],
		created_ts: now - 1000 * 60 * 400,
		updated_ts: now - 1000 * 60 * 100
	},
	{
		id: 't6',
		title: 'Maintenance | lubricate treadmill',
		priority: 1,
		status: 'pending',
		list_id: 'goal-management',
		my_day: false,
		tags: ['maintenance'],
		checklist: [],
		order: 'f',
		attachments: [],
		created_ts: now - 1000 * 60 * 500,
		updated_ts: now - 1000 * 60 * 500
	}
];

const tasksStore = writable<Task[]>(seedTasks);

export const tasks = {
	subscribe: tasksStore.subscribe,
	add(task: Task) {
		tasksStore.update((list) => [...list, task]);
	},
	setAll(next: Task[]) {
		tasksStore.set(next);
	},
	toggle(id: string) {
		tasksStore.update((list) =>
			list.map((task) =>
				task.id === id
					? {
							...task,
							status: task.status === 'done' ? 'pending' : 'done',
							updated_ts: Date.now()
						}
					: task
			)
		);
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
