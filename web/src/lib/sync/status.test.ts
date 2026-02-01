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
});
