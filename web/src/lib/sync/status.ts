import { writable } from 'svelte/store';
import type { SyncStatus, Phase } from './types';

const initial: SyncStatus = { pull: 'idle', push: 'idle', queueDepth: 0 };

const store = writable<SyncStatus>(initial);

const setPhase = (field: 'pull' | 'push', state: Phase, err?: string) => {
	store.update((s) => ({
		...s,
		[field]: state,
		lastError: state === 'idle' || state === 'running' ? undefined : err ?? s.lastError
	}));
};

export const syncStatus = {
	subscribe: store.subscribe,
	setSnapshot(next: SyncStatus) {
		store.set({
			pull: next.pull,
			push: next.push,
			queueDepth: Math.max(0, next.queueDepth ?? 0),
			lastReplayTs: next.lastReplayTs,
			lastError: next.lastError
		});
	},
	setPull(state: Phase, err?: string) {
		setPhase('pull', state, err);
	},
	setPush(state: Phase, err?: string) {
		setPhase('push', state, err);
	},
	resetError() {
		store.update((s) => ({ ...s, lastError: undefined }));
	},
	setQueueDepth(depth: number) {
		const safeDepth = Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : 0;
		store.update((s) => ({ ...s, queueDepth: safeDepth }));
	},
	markReplay(ts = Date.now()) {
		store.update((s) => ({ ...s, lastReplayTs: ts }));
	}
};
