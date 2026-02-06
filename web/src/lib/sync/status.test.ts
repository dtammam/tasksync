import { describe, expect, it } from 'vitest';
import { syncStatus } from './status';
import type { Writable } from 'svelte/store';
import type { SyncStatus } from './types';

const getVal = () => {
	let current: SyncStatus | undefined;
	const unsub = (syncStatus as unknown as Writable<SyncStatus>).subscribe((v) => (current = v));
	unsub();
	return current as SyncStatus;
};

describe('sync status store', () => {
	it('tracks pull/push and errors', () => {
		let val = getVal();
		expect(val.pull).toBe('idle');
		expect(val.queueDepth).toBe(0);
		syncStatus.setPull('running');
		val = getVal();
		expect(val.pull).toBe('running');
		syncStatus.setPull('error', 'boom');
		val = getVal();
		expect(val.pull).toBe('error');
		expect(val.lastError).toBe('boom');
		syncStatus.resetError();
		val = getVal();
		expect(val.lastError).toBeUndefined();
	});

	it('can replace status snapshot', () => {
		syncStatus.setSnapshot({
			pull: 'running',
			push: 'error',
			queueDepth: 3,
			lastReplayTs: 1234,
			lastError: 'sync failed'
		});
		const val = getVal();
		expect(val.pull).toBe('running');
		expect(val.push).toBe('error');
		expect(val.queueDepth).toBe(3);
		expect(val.lastReplayTs).toBe(1234);
		expect(val.lastError).toBe('sync failed');
	});

	it('tracks queue depth and replay timestamp', () => {
		syncStatus.setQueueDepth(6);
		syncStatus.markReplay(987654);
		const val = getVal();
		expect(val.queueDepth).toBe(6);
		expect(val.lastReplayTs).toBe(987654);
	});
});
