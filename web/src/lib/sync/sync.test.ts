import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pushPendingToServer, resetSyncCursor, syncFromServer } from './sync';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import { syncStatus } from './status';
import type { Task } from '$shared/types/task';
import type { SyncStatus } from './types';
import type { Writable } from 'svelte/store';

vi.mock('$lib/api/client', () => {
	return {
		api: {
			syncPull: vi.fn(),
			syncPush: vi.fn()
		}
	};
});

import { api } from '$lib/api/client';
const mockedApi = vi.mocked(api);

const readStatus = () => {
	let current: SyncStatus | undefined;
	const unsub = (syncStatus as unknown as Writable<SyncStatus>).subscribe((v) => (current = v));
	unsub();
	return current as SyncStatus;
};

beforeEach(() => {
	tasks.setAll([]);
	lists.setAll([]);
	vi.clearAllMocks();
	syncStatus.setSnapshot({ pull: 'idle', push: 'idle', queueDepth: 0 });
	syncStatus.resetError();
	resetSyncCursor();
	mockedApi.syncPull.mockResolvedValue({
		protocol: 'delta-v1',
		cursor_ts: 0,
		lists: [],
		tasks: []
	});
	mockedApi.syncPush.mockResolvedValue({
		protocol: 'delta-v1',
		cursor_ts: 0,
		applied: [],
		rejected: []
	});
});

describe('syncFromServer', () => {
	it('retains unsynced local tasks when server returns none', async () => {
		tasks.createLocal('offline', 'goal-management');

		await syncFromServer();

		const all = tasks.getAll();
		expect(all.some((t: Task) => t.local)).toBe(true);
	});

	it('keeps local dirty status instead of remote pending copy', async () => {
		const local = tasks.createLocal('flip me', 'goal-management');
		if (local) {
			tasks.toggle(local.id);
		}
		mockedApi.syncPull.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 1,
			lists: [],
			tasks: [
				{
					id: local?.id ?? 'missing',
					space_id: 's1',
					title: 'flip me',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 1
				}
			]
		});

		await syncFromServer();

		const saved = tasks.getAll().find((task) => task.id === local?.id);
		expect(saved?.status).toBe('done');
		expect(saved?.dirty).toBe(true);
	});

	it('keeps local tasks created while pull is in flight', async () => {
		let resolvePull: (
			value: ReturnType<typeof mockedApi.syncPull> extends Promise<infer T> ? T : never
		) => void;
		const remotePull = new Promise<
			ReturnType<typeof mockedApi.syncPull> extends Promise<infer T> ? T : never
		>((resolve) => {
			resolvePull = resolve;
		});
		mockedApi.syncPull.mockReturnValue(remotePull as ReturnType<typeof mockedApi.syncPull>);

		const pulling = syncFromServer();
		const created = tasks.createLocal('created during pull', 'goal-management');
		resolvePull!({ protocol: 'delta-v1', cursor_ts: 0, lists: [], tasks: [] });
		await pulling;

		const all = tasks.getAll();
		expect(all.find((task) => task.id === created?.id)).toBeTruthy();
	});

	it('uses incremental cursor across pulls and resets when requested', async () => {
		mockedApi.syncPull
			.mockResolvedValueOnce({
				protocol: 'delta-v1',
				cursor_ts: 11,
				lists: [],
				tasks: []
			})
			.mockResolvedValueOnce({
				protocol: 'delta-v1',
				cursor_ts: 22,
				lists: [],
				tasks: []
			})
			.mockResolvedValueOnce({
				protocol: 'delta-v1',
				cursor_ts: 33,
				lists: [],
				tasks: []
			});

		await syncFromServer();
		await syncFromServer();
		expect(mockedApi.syncPull).toHaveBeenNthCalledWith(1, { since_ts: undefined });
		expect(mockedApi.syncPull).toHaveBeenNthCalledWith(2, { since_ts: 11 });

		resetSyncCursor();
		await syncFromServer();
		expect(mockedApi.syncPull).toHaveBeenNthCalledWith(3, { since_ts: undefined });
	});

	it('reports pull error when sync endpoint fails', async () => {
		mockedApi.syncPull.mockRejectedValue(new Error('API 500 Internal Server Error'));

		const result = await syncFromServer();

		expect(result.error).toBe(true);
		expect(readStatus().pull).toBe('error');
	});
});

describe('pushPendingToServer', () => {
	it('creates local tasks remotely and clears dirty flag', async () => {
		const local = tasks.createLocal('offline', 'goal-management');
		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 12,
			applied: [
				{
					id: 'srv-1',
					space_id: 's1',
					title: 'offline',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 12
				}
			],
			rejected: []
		});

		const result = await pushPendingToServer();

		expect(result).toMatchObject({ pushed: 1, created: 1, rejected: 0 });
		expect(mockedApi.syncPush).toHaveBeenCalledOnce();
		expect(mockedApi.syncPush.mock.calls[0]?.[0]?.changes).toHaveLength(1);
		expect(mockedApi.syncPush.mock.calls[0]?.[0]?.changes?.[0]).toMatchObject({
			kind: 'create_task',
			body: { title: 'offline', list_id: 'goal-management' }
		});
		const all = tasks.getAll();
		const saved = all.find((task) => task.id === 'srv-1');
		expect(saved?.dirty).toBe(false);
		expect(saved?.local).toBe(false);
		expect(all.find((task) => task.id === local?.id)).toBeUndefined();
	});

	it('keeps local edits made while push request is in flight', async () => {
		const local = tasks.createLocal('race task', 'goal-management');
		let resolvePush: (
			value: ReturnType<typeof mockedApi.syncPush> extends Promise<infer T> ? T : never
		) => void;
		const pendingPush = new Promise<
			ReturnType<typeof mockedApi.syncPush> extends Promise<infer T> ? T : never
		>((resolve) => {
			resolvePush = resolve;
		});
		mockedApi.syncPush.mockReturnValue(pendingPush as ReturnType<typeof mockedApi.syncPush>);

		const pushing = pushPendingToServer();
		if (local) {
			tasks.toggle(local.id);
		}
		resolvePush!({
			protocol: 'delta-v1',
			cursor_ts: 9,
			applied: [
				{
					id: 'srv-race-task',
					space_id: 's1',
					title: 'race task',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 9
				}
			],
			rejected: []
		});
		await pushing;

		const saved = tasks.getAll().find((task) => task.id === 'srv-race-task');
		expect(saved?.local).toBe(false);
		expect(saved?.status).toBe('done');
		expect(saved?.dirty).toBe(true);
	});

	it('drops legacy dirty tasks with non-server ids before pushing', async () => {
		const legacy: Task = {
			id: 't1',
			title: 'legacy seed',
			status: 'done',
			list_id: 'goal-management',
			my_day: false,
			priority: 0,
			tags: [],
			checklist: [],
			order: 'a',
			attachments: [],
			created_ts: 1,
			updated_ts: 1,
			dirty: true
		};
		const local = tasks.createLocal('new', 'goal-management');
		if (local) {
			tasks.setAll([legacy, local]);
		}

		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 7,
			applied: [
				{
					id: 'srv-legacy-1',
					space_id: 's1',
					title: 'new',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 7
				}
			],
			rejected: []
		});

		const result = await pushPendingToServer();

		expect(result.error).toBeUndefined();
		expect(result.created).toBe(1);
		expect(mockedApi.syncPush.mock.calls[0]?.[0]?.changes).toHaveLength(1);
		expect(mockedApi.syncPush.mock.calls[0]?.[0]?.changes?.[0]).toMatchObject({ kind: 'create_task' });
		const all = tasks.getAll();
		expect(all.find((task) => task.id === 't1')).toBeUndefined();
		expect(all.find((task) => task.id === 'srv-legacy-1')?.dirty).toBe(false);
	});

	it('removes tasks rejected with 404 and continues applying others', async () => {
		const orphan: Task = {
			id: '123e4567-e89b-12d3-a456-426614174000',
			title: 'orphaned',
			status: 'done',
			list_id: 'goal-management',
			my_day: false,
			priority: 0,
			tags: [],
			checklist: [],
			order: 'a',
			attachments: [],
			created_ts: 1,
			updated_ts: 1,
			dirty: true
		};
		const local = tasks.createLocal('keep me', 'goal-management');
		if (local) {
			tasks.setAll([orphan, local]);
		}

		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 3,
			applied: [
				{
					id: 'srv-keep',
					space_id: 's1',
					title: 'keep me',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 3
				}
			],
			rejected: [{ op_id: 'update-0', status: 404, error: 'Not Found' }]
		});

		const result = await pushPendingToServer();

		expect(result.error).toBeUndefined();
		expect(result.created).toBe(1);
		expect(result.rejected).toBe(1);
		const all = tasks.getAll();
		expect(all.find((task) => task.id === orphan.id)).toBeUndefined();
		expect(all.find((task) => task.id === 'srv-keep')?.dirty).toBe(false);
	});

	it('marks forbidden update rejections as error and clears dirty updates', async () => {
		const task: Task = {
			id: '123e4567-e89b-12d3-a456-426614174111',
			title: 'forbidden update',
			status: 'done',
			list_id: 'goal-management',
			my_day: false,
			priority: 0,
			tags: [],
			checklist: [],
			order: 'a',
			attachments: [],
			created_ts: 1,
			updated_ts: 1,
			dirty: true
		};
		tasks.setAll([task]);
		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 8,
			applied: [],
			rejected: [{ op_id: 'update-0', status: 403, error: 'Forbidden' }]
		});

		const result = await pushPendingToServer();

		expect(result.error).toBe(true);
		expect(result.rejected).toBe(1);
		expect(tasks.getAll().find((item) => item.id === task.id)?.dirty).toBe(false);
		expect(readStatus().push).toBe('error');
	});

	it('uses sync push cursor as next pull boundary', async () => {
		mockedApi.syncPull
			.mockResolvedValueOnce({
				protocol: 'delta-v1',
				cursor_ts: 11,
				lists: [],
				tasks: []
			})
			.mockResolvedValueOnce({
				protocol: 'delta-v1',
				cursor_ts: 60,
				lists: [],
				tasks: []
			});

		await syncFromServer();
		tasks.createLocal('cursor check', 'goal-management');
		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 50,
			applied: [
				{
					id: 'srv-cursor',
					space_id: 's1',
					title: 'cursor check',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 50
				}
			],
			rejected: []
		});

		await pushPendingToServer();
		await syncFromServer();

		expect(mockedApi.syncPull).toHaveBeenNthCalledWith(1, { since_ts: undefined });
		expect(mockedApi.syncPull).toHaveBeenNthCalledWith(2, { since_ts: 50 });
	});

	it('resets queue depth and records replay timestamp after successful push', async () => {
		tasks.createLocal('telemetry', 'goal-management');
		mockedApi.syncPush.mockResolvedValue({
			protocol: 'delta-v1',
			cursor_ts: 4,
			applied: [
				{
					id: 'srv-telemetry',
					space_id: 's1',
					title: 'telemetry',
					status: 'pending',
					list_id: 'goal-management',
					my_day: 0,
					order: 'z',
					created_ts: 1,
					updated_ts: 4
				}
			],
			rejected: []
		});
		const before = Date.now();

		await pushPendingToServer();

		const status = readStatus();
		expect(status.queueDepth).toBe(0);
		expect(status.lastReplayTs).toBeDefined();
		expect(status.lastReplayTs).toBeGreaterThanOrEqual(before);
	});
});
