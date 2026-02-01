import { derived, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';

const initialTasks: Task[] = [];

const tasksStore = writable<Task[]>(initialTasks);

export const tasks = {
	subscribe: tasksStore.subscribe,
	add(task: Task) {
		tasksStore.update((list) => [...list, task]);
	},
	setAll(tasks: Task[]) {
		tasksStore.set(tasks);
	}
};

export const pendingCount = derived(tasksStore, ($tasks) =>
	$tasks.filter((task) => task.status === 'pending').length
);
