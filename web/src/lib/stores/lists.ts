import { get, writable } from 'svelte/store';
import type { List } from '$shared/types/list';
import { repo } from '$lib/data/repo';
import { api } from '$lib/api/client';

const seedLists: List[] = [
	{ id: 'my-day', name: 'My Day', icon: '🌅', order: 'a' },
	{ id: 'goal-management', name: 'Goal Management', icon: '🎯', order: 'b' },
	{ id: 'daily-management', name: 'Daily Management', icon: '📅', order: 'c' },
	{ id: 'tasks', name: 'Tasks', icon: '🗒', order: 'd' },
	{ id: 'health', name: 'Health', icon: '💪', order: 'e' },
	{ id: 'tech', name: 'Tech Ideas', icon: '💻', order: 'f' }
];

const listStore = writable<List[]>(seedLists);

const mapApiList = (l: Awaited<ReturnType<typeof api.getLists>>[number]): List => ({
	id: l.id,
	name: l.name,
	icon: l.icon ?? undefined,
	color: l.color ?? undefined,
	order: l.order
});

const nextOrder = () => Date.now().toString();

export const lists = {
	subscribe: listStore.subscribe,
	add(list: List) {
		listStore.update((prev) => [...prev, list]);
		void repo.saveLists(get(listStore));
	},
	async createRemote(name: string, icon?: string) {
		const created = await api.createList({
			name,
			icon,
			order: nextOrder()
		});
		const mapped = mapApiList(created);
		listStore.update((prev) => [...prev, mapped]);
		void repo.saveLists(get(listStore));
		return mapped;
	},
	async updateRemote(id: string, body: { name?: string; icon?: string; color?: string }) {
		const updated = await api.updateList(id, body);
		const mapped = mapApiList(updated);
		listStore.update((prev) => prev.map((l) => (l.id === id ? mapped : l)));
		void repo.saveLists(get(listStore));
		return mapped;
	},
	async deleteRemote(id: string) {
		await api.deleteList(id);
		listStore.update((prev) => prev.filter((l) => l.id !== id));
		void repo.saveLists(get(listStore));
	},
	setAll(next: List[]) {
		listStore.set(next);
		void repo.saveLists(next);
	},
	async hydrateFromDb() {
		const { lists: stored } = await repo.loadAll();
		if (stored.length) {
			listStore.set(stored);
		} else {
			listStore.set(seedLists);
			await repo.saveLists(seedLists);
		}
	}
};

export const findListName = (id: string) => {
	const current = get(listStore);
	return current.find((l) => l.id === id)?.name ?? 'List';
};
