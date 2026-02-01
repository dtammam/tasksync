import { describe, expect, it, beforeEach, vi } from 'vitest';
import { syncFromServer, pushPendingToServer } from './sync';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import type { Task } from '$shared/types/task';

vi.mock('$lib/api/client', () => {
	return {
		api: {
			getLists: vi.fn(),
			getTasks: vi.fn(),
			createTask: vi.fn(),
			updateTaskStatus: vi.fn()
		}
	};
});

import { api } from '$lib/api/client';
const mockedApi = vi.mocked(api);

beforeEach(() => {
	tasks.setAll([]);
	lists.setAll([]);
	vi.clearAllMocks();
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
});
