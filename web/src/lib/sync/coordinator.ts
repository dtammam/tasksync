import type { SyncStatus } from './types';
export type SyncReason = 'manual' | 'startup' | 'retry' | 'scope-change' | string;

type CoordinatorInbound =
	| { type: 'leader'; tabId: string | null }
	| { type: 'run-sync'; reason?: string }
	| { type: 'status'; sourceTabId: string | null; status: SyncStatus };

type CoordinatorOutbound =
	| { type: 'register'; tabId: string }
	| { type: 'unregister'; tabId: string }
	| { type: 'set-auth'; tabId: string; authenticated: boolean }
	| { type: 'request-sync'; reason: string }
	| { type: 'status'; tabId: string; status: SyncStatus };

interface SharedWorkerLike {
	port: MessagePort;
}

interface CoordinatorOptions {
	tabId?: string;
	onLeaderChange?: (isLeader: boolean) => void;
	onRunSync?: (reason: SyncReason) => void;
	onStatus?: (status: SyncStatus, sourceTabId: string | null) => void;
	workerFactory?: () => SharedWorkerLike;
}

export interface SyncCoordinator {
	isLeader(): boolean;
	setAuthenticated(authenticated: boolean): void;
	requestSync(reason?: SyncReason): void;
	publishStatus(status: SyncStatus): void;
	destroy(): void;
}

const buildTabId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const canUseSharedWorker = () => typeof SharedWorker !== 'undefined';

export const createSyncCoordinator = ({
	tabId = buildTabId(),
	onLeaderChange,
	onRunSync,
	onStatus,
	workerFactory
}: CoordinatorOptions = {}): SyncCoordinator => {
	let leader = false;
	let port: MessagePort | null = null;

	const setLeader = (next: boolean) => {
		if (leader === next) return;
		leader = next;
		onLeaderChange?.(leader);
	};

	const runSyncLocally = (reason: SyncReason) => onRunSync?.(reason);

	const fallback: SyncCoordinator = {
		isLeader: () => true,
		setAuthenticated: () => {
			return;
		},
		requestSync: (reason = 'manual') => runSyncLocally(reason),
		publishStatus: () => {
			return;
		},
		destroy: () => {
			return;
		}
	};

	const createWorker =
		workerFactory ??
		(() =>
			new SharedWorker(new URL('./coordinator.worker.ts', import.meta.url), {
				type: 'module',
				name: 'tasksync-sync-coordinator'
			}));

	if (!workerFactory && !canUseSharedWorker()) {
		queueMicrotask(() => onLeaderChange?.(true));
		return fallback;
	}

	try {
		const worker = createWorker();
		port = worker.port;
		port.onmessage = (event: MessageEvent<CoordinatorInbound>) => {
			const msg = event.data;
			if (!msg || typeof msg !== 'object') return;
			if (msg.type === 'leader') {
				setLeader(msg.tabId === tabId);
				return;
			}
			if (msg.type === 'run-sync' && leader) {
				runSyncLocally(msg.reason ?? 'manual');
				return;
			}
			if (msg.type === 'status') {
				onStatus?.(msg.status, msg.sourceTabId);
			}
		};
		port.start();
		const registerMessage: CoordinatorOutbound = { type: 'register', tabId };
		port.postMessage(registerMessage);
	} catch {
		queueMicrotask(() => onLeaderChange?.(true));
		return fallback;
	}

	return {
		isLeader: () => leader,
		setAuthenticated(authenticated: boolean) {
			if (!port) return;
			const message: CoordinatorOutbound = { type: 'set-auth', tabId, authenticated };
			port.postMessage(message);
		},
		requestSync(reason: SyncReason = 'manual') {
			if (!port) {
				runSyncLocally(reason);
				return;
			}
			if (leader) {
				runSyncLocally(reason);
				return;
			}
			const message: CoordinatorOutbound = { type: 'request-sync', reason };
			port.postMessage(message);
		},
		publishStatus(status: SyncStatus) {
			if (!port || !leader) return;
			const message: CoordinatorOutbound = { type: 'status', tabId, status };
			port.postMessage(message);
		},
		destroy() {
			if (!port) return;
			const message: CoordinatorOutbound = { type: 'unregister', tabId };
			port.postMessage(message);
			port.close();
			port = null;
		}
	};
};
