import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import type { SpaceMember } from '$shared/types/auth';

const membersStore = writable<SpaceMember[]>([]);

export const members = {
	subscribe: membersStore.subscribe,
	get() {
		return get(membersStore);
	},
	find(userId?: string) {
		if (!userId) return null;
		return get(membersStore).find((m) => m.user_id === userId) ?? null;
	},
	async hydrateFromServer() {
		if (!auth.isAuthenticated()) {
			membersStore.set([]);
			return;
		}
		try {
			const loaded = await api.getMembers();
			membersStore.set(loaded);
		} catch {
			membersStore.set([]);
		}
	},
	clear() {
		membersStore.set([]);
	}
};
