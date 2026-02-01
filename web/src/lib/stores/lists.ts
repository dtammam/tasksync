import { get, writable } from 'svelte/store';
import type { List } from '$shared/types/list';
import { repo } from '$lib/data/repo';

const seedLists: List[] = [
	{ id: 'my-day', name: 'My Day', icon: '🌅', order: 'a' },
	{ id: 'goal-management', name: 'Goal Management', icon: '🎯', order: 'b' },
	{ id: 'daily-management', name: 'Daily Management', icon: '📅', order: 'c' },
	{ id: 'tasks', name: 'Tasks', icon: '🗒', order: 'd' },
	{ id: 'health', name: 'Health', icon: '💪', order: 'e' },
	{ id: 'tech', name: 'Tech Ideas', icon: '💻', order: 'f' }
];

const listStore = writable<List[]>(seedLists);

export const lists = {
	subscribe: listStore.subscribe,
	add(list: List) {
		listStore.update((prev) => [...prev, list]);
		void repo.saveLists(get(listStore));
	},
	async hydrateFromDb() {
		const { lists: stored } = await repo.loadAll();
		if (stored.length) {
			listStore.set(stored);
		} else {
			await repo.saveLists(seedLists);
		}
	}
};

export const findListName = (id: string) => {
	const current = get(listStore);
	return current.find((l) => l.id === id)?.name ?? 'List';
};
