import type { SyncStatus } from './types';

type CoordinatorMessage =
	| { type: 'register'; tabId: string }
	| { type: 'unregister'; tabId: string }
	| { type: 'set-auth'; tabId: string; authenticated: boolean }
	| { type: 'request-sync'; reason?: string }
	| {
			type: 'status';
			tabId: string;
			status: SyncStatus;
	  };

type CoordinatorBroadcast =
	| { type: 'leader'; tabId: string | null }
	| { type: 'run-sync'; reason: string }
	| {
			type: 'status';
			sourceTabId: string | null;
			status: SyncStatus;
	  };

interface TabConnection {
	port: MessagePort;
	authenticated: boolean;
}

const tabs = new Map<string, TabConnection>();
let leaderTabId: string | null = null;
let leaderStatus: SyncStatus = {
	pull: 'idle',
	push: 'idle',
	queueDepth: 0
};

const postMessageSafe = (port: MessagePort, message: CoordinatorBroadcast) => {
	try {
		port.postMessage(message);
	} catch {
		// Ignore dead ports; the owning tab is expected to unregister.
	}
};

const broadcastLeader = () => {
	for (const tab of tabs.values()) {
		postMessageSafe(tab.port, { type: 'leader', tabId: leaderTabId });
	}
};

const broadcastStatus = () => {
	for (const tab of tabs.values()) {
		postMessageSafe(tab.port, { type: 'status', sourceTabId: leaderTabId, status: leaderStatus });
	}
};

const electLeader = () => {
	const previousLeader = leaderTabId;
	let nextLeader: string | null = null;
	for (const [tabId, tab] of tabs) {
		if (tab.authenticated) {
			nextLeader = tabId;
			break;
		}
	}
	if (!nextLeader) {
		const first = tabs.keys().next();
		nextLeader = first.done ? null : first.value;
	}
	leaderTabId = nextLeader;
	if (previousLeader !== leaderTabId) {
		leaderStatus = { pull: 'idle', push: 'idle', queueDepth: 0 };
	}
	broadcastLeader();
	broadcastStatus();
};

const handleMessage = (port: MessagePort, data: CoordinatorMessage) => {
	if (!data || typeof data !== 'object' || !('type' in data)) return;

	if (data.type === 'register') {
		tabs.set(data.tabId, { port, authenticated: false });
		electLeader();
		return;
	}

	if (data.type === 'unregister') {
		tabs.delete(data.tabId);
		if (leaderTabId === data.tabId) {
			leaderTabId = null;
		}
		electLeader();
		return;
	}

	if (data.type === 'set-auth') {
		const tab = tabs.get(data.tabId);
		if (!tab) return;
		tab.authenticated = !!data.authenticated;
		electLeader();
		return;
	}

	if (data.type === 'request-sync') {
		if (!leaderTabId) return;
		const leader = tabs.get(leaderTabId);
		if (!leader) return;
		postMessageSafe(leader.port, { type: 'run-sync', reason: data.reason ?? 'manual' });
		return;
	}

	if (data.type === 'status') {
		if (!leaderTabId || data.tabId !== leaderTabId) return;
		leaderStatus = {
			pull: data.status.pull,
			push: data.status.push,
			queueDepth: Math.max(0, data.status.queueDepth ?? 0),
			lastReplayTs: data.status.lastReplayTs,
			lastError: data.status.lastError
		};
		broadcastStatus();
	}
};

const globalScope = self as unknown as { onconnect: ((event: MessageEvent) => void) | null };
globalScope.onconnect = (event: MessageEvent) => {
	const [port] = event.ports;
	if (!port) return;
	port.onmessage = (msgEvent) => handleMessage(port, msgEvent.data as CoordinatorMessage);
	port.start();
};
