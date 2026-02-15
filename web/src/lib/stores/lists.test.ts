import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	api: {
		getLists: vi.fn(),
		createList: vi.fn(),
		updateList: vi.fn(),
		deleteList: vi.fn()
	},
	repo: {
		loadAll: vi.fn(),
		saveLists: vi.fn()
	}
}));

vi.mock('$lib/api/client', () => ({ api: mocks.api }));
vi.mock('$lib/data/repo', () => ({ repo: mocks.repo }));

import { repo } from '$lib/data/repo';
import { findListName, lists } from './lists';

const baseList = { id: 'seed-1', name: 'Seed', icon: 'S', order: 'a' };

describe('lists store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.repo.saveLists.mockResolvedValue(undefined);
		mocks.repo.loadAll.mockResolvedValue({ lists: [], tasks: [] });
		lists.setAll([baseList]);
		vi.clearAllMocks();
	});

	it('hydrates default seed lists when storage is empty', async () => {
		mocks.repo.loadAll.mockResolvedValueOnce({ lists: [], tasks: [] });

		await lists.hydrateFromDb();

		const current = get(lists);
		expect(repo.loadAll).toHaveBeenCalledTimes(1);
		expect(repo.saveLists).toHaveBeenCalledTimes(1);
		expect(current.find((l) => l.id === 'my-day')).toBeTruthy();
	});

	it('hydrates stored lists when database has values', async () => {
		const stored = [{ id: 'stored-1', name: 'Stored', icon: '📦', color: '#123456', order: 'z' }];
		mocks.repo.loadAll.mockResolvedValueOnce({ lists: stored, tasks: [] });

		await lists.hydrateFromDb();

		expect(get(lists)).toEqual(stored);
		expect(repo.saveLists).not.toHaveBeenCalled();
	});

	it('adds local lists and persists them', async () => {
		lists.add({ id: 'local-1', name: 'Local', icon: 'L', order: 'b' });

		const current = get(lists);
		expect(current.map((list) => list.id)).toEqual(['seed-1', 'local-1']);
		expect(repo.saveLists).toHaveBeenCalledWith(current);
	});

	it('creates lists remotely, maps payload, and persists', async () => {
		mocks.api.createList.mockResolvedValueOnce({
			id: 'remote-1',
			space_id: 's1',
			name: 'Remote',
			icon: 'R',
			color: '#abcdef',
			order: '99'
		});

		const created = await lists.createRemote('Remote', 'R', '#abcdef');

		expect(mocks.api.createList).toHaveBeenCalledWith({
			name: 'Remote',
			icon: 'R',
			color: '#abcdef',
			order: expect.any(String)
		});
		expect(created).toEqual({
			id: 'remote-1',
			name: 'Remote',
			icon: 'R',
			color: '#abcdef',
			order: '99'
		});
		expect(get(lists).some((list) => list.id === 'remote-1')).toBe(true);
		expect(repo.saveLists).toHaveBeenCalled();
	});

	it('updates lists remotely, maps payload, and persists', async () => {
		lists.setAll([
			baseList,
			{ id: 'remote-1', name: 'Before', icon: 'B', color: '#111111', order: 'b' }
		]);
		vi.clearAllMocks();
		mocks.api.updateList.mockResolvedValueOnce({
			id: 'remote-1',
			space_id: 's1',
			name: 'After',
			icon: 'A',
			color: '#222222',
			order: 'b'
		});

		const updated = await lists.updateRemote('remote-1', {
			name: 'After',
			icon: 'A',
			color: '#222222'
		});

		expect(mocks.api.updateList).toHaveBeenCalledWith('remote-1', {
			name: 'After',
			icon: 'A',
			color: '#222222'
		});
		expect(updated).toEqual({
			id: 'remote-1',
			name: 'After',
			icon: 'A',
			color: '#222222',
			order: 'b'
		});
		expect(get(lists).find((list) => list.id === 'remote-1')?.name).toBe('After');
		expect(repo.saveLists).toHaveBeenCalled();
	});

	it('deletes lists remotely and persists', async () => {
		lists.setAll([
			baseList,
			{ id: 'remote-1', name: 'To Delete', icon: 'D', order: 'b' }
		]);
		vi.clearAllMocks();

		await lists.deleteRemote('remote-1');

		expect(mocks.api.deleteList).toHaveBeenCalledWith('remote-1');
		expect(get(lists).some((list) => list.id === 'remote-1')).toBe(false);
		expect(repo.saveLists).toHaveBeenCalled();
	});

	it('returns fallback when list id cannot be found', () => {
		expect(findListName('seed-1')).toBe('Seed');
		expect(findListName('missing')).toBe('List');
	});
});
