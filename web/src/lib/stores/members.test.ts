import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({
	api: {
		getMembers: vi.fn()
	}
}));

vi.mock('$lib/stores/auth', () => ({
	auth: {
		isAuthenticated: vi.fn()
	}
}));

import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { members } from './members';

const mockedApi = vi.mocked(api);
const mockedAuth = vi.mocked(auth);

describe('members store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		members.clear();
	});

	it('loads members when authenticated', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getMembers.mockResolvedValue([
			{
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: 's1',
				role: 'admin'
			}
		]);

		await members.hydrateFromServer();

		expect(members.get()).toHaveLength(1);
		expect(members.find('admin')?.email).toBe('admin@example.com');
	});

	it('clears members when not authenticated', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(false);
		await members.hydrateFromServer();
		expect(members.get()).toEqual([]);
		expect(mockedApi.getMembers).not.toHaveBeenCalled();
	});
});
