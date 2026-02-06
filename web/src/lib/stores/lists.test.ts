import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$lib/api/client', () => ({
	api: {
		getLists: vi.fn(),
		createList: vi.fn(),
		updateList: vi.fn(),
		deleteList: vi.fn()
	}
}));

import { repo } from '$lib/data/repo';
import { lists } from './lists';

describe('lists store', () => {
	it('hydrates default seed lists when storage is empty', async () => {
		const loadSpy = vi.spyOn(repo, 'loadAll').mockResolvedValueOnce({ lists: [], tasks: [] });
		const saveSpy = vi.spyOn(repo, 'saveLists').mockResolvedValueOnce();

		await lists.hydrateFromDb();

		const current = get(lists);
		expect(loadSpy).toHaveBeenCalledTimes(1);
		expect(saveSpy).toHaveBeenCalled();
		expect(current.find((l) => l.id === 'my-day')).toBeTruthy();

		loadSpy.mockRestore();
		saveSpy.mockRestore();
	});
});
