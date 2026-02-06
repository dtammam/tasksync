import { describe, expect, it, beforeEach, vi } from 'vitest';
import { syncFromServer, pushPendingToServer } from './sync';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import { syncStatus } from './status';
import type { Task } from '$shared/types/task';

vi.mock('$lib/api/client', () => {
	return {
		api: {
			getLists: vi.fn(),
			getTasks: vi.fn(),
			createTask: vi.fn(),
			updateTaskStatus: vi.fn(),
			updateTaskMeta: vi.fn()
		}
	};
});

import { api } from '$lib/api/client';
const mockedApi = vi.mocked(api);

beforeEach(() => {
	tasks.setAll([]);
	lists.setAll([]);
	vi.clearAllMocks();
	syncStatus.resetError();
});

describe('syncFromServer', () => {
	it('retains unsynced local tasks when server returns none', async () => {
		tasks.createLocal('offline', 'goal-management');
		mockedApi.getLists.mockResolvedValue([]);
		mockedApi.getTasks.mockResolvedValue([]);

		await syncFromServer();

		const all = tasks.getAll();
		expect(all.some((t: Task) => t.local)).toBe(true);
	});

	it('keeps local dirty status instead of remote pending copy', async () => {
		const local = tasks.createLocal('flip me', 'goal-management');
		if (local) {
			tasks.toggle(local.id); // mark done + dirty
		}
		mockedApi.getLists.mockResolvedValue([]);
		mockedApi.getTasks.mockResolvedValue([
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
		]);

		await syncFromServer();

		const saved = tasks.getAll().find((t) => t.id === local?.id);
		expect(saved?.status).toBe('done');
		expect(saved?.dirty).toBe(true);
	});

	it('keeps local tasks created while pull is in flight', async () => {
		mockedApi.getLists.mockResolvedValue([]);
		let resolveTasks: (value: ReturnType<typeof mockedApi.getTasks> extends Promise<infer T> ? T : never) =>
			void;
		const remoteTasks = new Promise<
			ReturnType<typeof mockedApi.getTasks> extends Promise<infer T> ? T : never
		>((resolve) => {
			resolveTasks = resolve;
		});
		mockedApi.getTasks.mockReturnValue(remoteTasks as ReturnType<typeof mockedApi.getTasks>);

		const pulling = syncFromServer();
		const created = tasks.createLocal('created during pull', 'goal-management');
		resolveTasks!([]);
		await pulling;

		const all = tasks.getAll();
		expect(all.find((t) => t.id === created?.id)).toBeTruthy();
	});
});

describe('pushPendingToServer', () => {
	it('creates local tasks remotely and clears dirty flag', async () => {
		const local = tasks.createLocal('offline', 'goal-management');
		mockedApi.createTask.mockResolvedValue({
			id: 'srv-1',
			space_id: 's1',
			title: 'offline',
			status: 'pending',
			list_id: 'goal-management',
			my_day: 0,
			order: 'z',
			created_ts: 1,
			updated_ts: 1
		});
		mockedApi.updateTaskStatus.mockResolvedValue({
			id: 'srv-1',
			space_id: 's1',
			title: 'offline',
			status: 'done',
			list_id: 'goal-management',
			my_day: 0,
			order: 'z',
			created_ts: 1,
			updated_ts: 2
		});

		const result = await pushPendingToServer();
		expect(result.created).toBe(1);
		const all = tasks.getAll();
		const saved = all.find((t) => t.id === 'srv-1');
		expect(saved?.dirty).toBe(false);
		expect(saved?.local).toBe(false);
		expect(all.find((t) => t.id === local?.id)).toBeUndefined();
	});

	it('keeps local edits made while create request is in flight', async () => {
		const local = tasks.createLocal('race task', 'goal-management');
		let resolveCreate: (
			value: ReturnType<typeof mockedApi.createTask> extends Promise<infer T> ? T : never
		) => void;
		const createResponse = new Promise<
			ReturnType<typeof mockedApi.createTask> extends Promise<infer T> ? T : never
		>((resolve) => {
			resolveCreate = resolve;
		});
		mockedApi.createTask.mockReturnValue(createResponse as ReturnType<typeof mockedApi.createTask>);

		const pushing = pushPendingToServer();
		if (local) {
			tasks.toggle(local.id);
		}
		resolveCreate!({
			id: 'srv-race-task',
			space_id: 's1',
			title: 'race task',
			status: 'pending',
			list_id: 'goal-management',
			my_day: 0,
			order: 'z',
			created_ts: 1,
			updated_ts: 1
		});
		await pushing;

		const saved = tasks.getAll().find((t) => t.id === 'srv-race-task');
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

		mockedApi.createTask.mockResolvedValue({
			id: 'srv-legacy-1',
			space_id: 's1',
			title: 'new',
			status: 'pending',
			list_id: 'goal-management',
			my_day: 0,
			order: 'z',
			created_ts: 1,
			updated_ts: 1
		});

		const result = await pushPendingToServer();
		expect(result.error).toBeUndefined();
		expect(result.created).toBe(1);
		const all = tasks.getAll();
		expect(all.find((t) => t.id === 't1')).toBeUndefined();
		expect(all.find((t) => t.id === 'srv-legacy-1')?.dirty).toBe(false);
	});

	it('removes tasks that return 404 on update and continues pushing others', async () => {
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

		mockedApi.updateTaskMeta.mockRejectedValueOnce(new Error('API 404 Not Found'));
		mockedApi.createTask.mockResolvedValue({
			id: 'srv-keep',
			space_id: 's1',
			title: 'keep me',
			status: 'pending',
			list_id: 'goal-management',
			my_day: 0,
			order: 'z',
			created_ts: 1,
			updated_ts: 1
		});

		const result = await pushPendingToServer();
		expect(result.error).toBeUndefined();
		expect(result.created).toBe(1);
		const all = tasks.getAll();
		expect(all.find((t) => t.id === orphan.id)).toBeUndefined();
		expect(all.find((t) => t.id === 'srv-keep')?.dirty).toBe(false);
	});
});
