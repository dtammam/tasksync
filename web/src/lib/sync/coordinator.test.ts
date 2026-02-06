import { describe, expect, it, vi } from 'vitest';
import { createSyncCoordinator } from './coordinator';

class MockPort {
	messages: unknown[] = [];
	onmessage: ((event: MessageEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	start = vi.fn();
	close = vi.fn();

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	emit(message: unknown) {
		this.onmessage?.({ data: message } as MessageEvent);
	}
}

class MockWorker {
	constructor(public readonly port: MockPort) {}
}

describe('createSyncCoordinator', () => {
	it('falls back to local leader mode without SharedWorker', async () => {
		const onLeaderChange = vi.fn();
		const onRunSync = vi.fn();
		const coordinator = createSyncCoordinator({
			onLeaderChange,
			onRunSync,
			workerFactory: undefined
		});

		await Promise.resolve();
		expect(coordinator.isLeader()).toBe(true);
		expect(onLeaderChange).toHaveBeenCalledWith(true);

		coordinator.requestSync('manual');
		expect(onRunSync).toHaveBeenCalledWith('manual');
	});

	it('registers and posts auth/request messages through worker port', () => {
		const port = new MockPort();
		const coordinator = createSyncCoordinator({
			tabId: 'tab-a',
			workerFactory: () => new MockWorker(port) as never
		});

		expect(port.start).toHaveBeenCalledOnce();
		expect(port.messages[0]).toEqual({ type: 'register', tabId: 'tab-a' });

		coordinator.setAuthenticated(true);
		expect(port.messages[1]).toEqual({ type: 'set-auth', tabId: 'tab-a', authenticated: true });

		coordinator.requestSync('manual');
		expect(port.messages[2]).toEqual({ type: 'request-sync', reason: 'manual' });

		port.emit({ type: 'leader', tabId: 'tab-a' });
		coordinator.publishStatus({ pull: 'running', push: 'idle' });
		expect(port.messages[3]).toEqual({
			type: 'status',
			tabId: 'tab-a',
			status: { pull: 'running', push: 'idle' }
		});
	});

	it('runs sync locally when leader and forwards when follower', () => {
		const port = new MockPort();
		const onRunSync = vi.fn();
		const onLeaderChange = vi.fn();
		const coordinator = createSyncCoordinator({
			tabId: 'tab-a',
			onRunSync,
			onLeaderChange,
			workerFactory: () => new MockWorker(port) as never
		});

		port.emit({ type: 'leader', tabId: 'tab-a' });
		expect(coordinator.isLeader()).toBe(true);
		expect(onLeaderChange).toHaveBeenCalledWith(true);

		coordinator.requestSync('manual');
		expect(onRunSync).toHaveBeenCalledWith('manual');

		port.emit({ type: 'leader', tabId: 'tab-b' });
		expect(coordinator.isLeader()).toBe(false);
		expect(onLeaderChange).toHaveBeenCalledWith(false);

		coordinator.requestSync('retry');
		expect(port.messages.at(-1)).toEqual({ type: 'request-sync', reason: 'retry' });
	});

	it('forwards leader status snapshots to callback', () => {
		const port = new MockPort();
		const onStatus = vi.fn();
		createSyncCoordinator({
			tabId: 'tab-a',
			onStatus,
			workerFactory: () => new MockWorker(port) as never
		});

		port.emit({
			type: 'status',
			sourceTabId: 'tab-b',
			status: { pull: 'running', push: 'idle', lastError: 'x' }
		});
		expect(onStatus).toHaveBeenCalledWith(
			{ pull: 'running', push: 'idle', lastError: 'x' },
			'tab-b'
		);
	});

	it('applies run-sync messages only when current tab is leader', () => {
		const port = new MockPort();
		const onRunSync = vi.fn();
		const coordinator = createSyncCoordinator({
			tabId: 'tab-a',
			onRunSync,
			workerFactory: () => new MockWorker(port) as never
		});

		port.emit({ type: 'leader', tabId: 'tab-b' });
		port.emit({ type: 'run-sync', reason: 'manual' });
		expect(onRunSync).not.toHaveBeenCalled();

		port.emit({ type: 'leader', tabId: 'tab-a' });
		port.emit({ type: 'run-sync', reason: 'manual' });
		expect(onRunSync).toHaveBeenCalledWith('manual');

		coordinator.destroy();
		expect(port.messages.at(-1)).toEqual({ type: 'unregister', tabId: 'tab-a' });
		expect(port.close).toHaveBeenCalledOnce();
	});
});
