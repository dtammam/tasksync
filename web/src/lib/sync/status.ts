import { writable } from 'svelte/store';
import type { SyncStatus, Phase } from './types';

const initial: SyncStatus = { pull: 'idle', push: 'idle' };

const store = writable<SyncStatus>(initial);

export const syncStatus = {
	subscribe: store.subscribe,
	setPull(state: Phase, err?: string) {
		store.update((s) => ({
			...s,
			pull: state,
			lastError: state === 'idle' || state === 'running' ? undefined : err ?? s.lastError
		}));
	},
	setPush(state: Phase, err?: string) {
		store.update((s) => ({
			...s,
			push: state,
			lastError: state === 'idle' || state === 'running' ? undefined : err ?? s.lastError
		}));
	},
	resetError() {
		store.update((s) => ({ ...s, lastError: undefined }));
	}
};
