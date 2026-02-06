import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({
	api: {
		login: vi.fn(),
		me: vi.fn()
	}
}));

import { api } from '$lib/api/client';
import { getAuthMode, getAuthToken } from '$lib/api/headers';
import { auth } from './auth';

const mockedApi = vi.mocked(api);

const meUser = {
	user_id: 'admin',
	email: 'admin@example.com',
	display: 'Admin',
	space_id: 's1',
	role: 'admin' as const
};

describe('auth store', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.clearAllMocks();
	});

	it('hydrates via legacy mode by calling /auth/me', async () => {
		mockedApi.me.mockResolvedValue(meUser);

		await auth.hydrate();

		expect(auth.get().status).toBe('authenticated');
		expect(auth.get().source).toBe('legacy');
		expect(auth.get().user?.email).toBe('admin@example.com');
	});

	it('switches to token mode and stores token on login', async () => {
		mockedApi.login.mockResolvedValue({
			token: 'jwt-token',
			...meUser
		});

		await auth.login('admin@example.com', 'tasksync', 's1');

		expect(getAuthMode()).toBe('token');
		expect(getAuthToken()).toBe('jwt-token');
		expect(auth.get().status).toBe('authenticated');
		expect(auth.get().source).toBe('token');
	});

	it('becomes anonymous without calling /auth/me when token mode has no token', async () => {
		localStorage.setItem('tasksync:auth-mode', 'token');

		await auth.hydrate();

		expect(auth.get().status).toBe('anonymous');
		expect(auth.get().mode).toBe('token');
		expect(mockedApi.me).not.toHaveBeenCalled();
	});

	it('clears token on logout', async () => {
		mockedApi.login.mockResolvedValue({
			token: 'jwt-token',
			...meUser
		});
		await auth.login('admin@example.com', 'tasksync', 's1');

		auth.logout();

		expect(getAuthMode()).toBe('token');
		expect(getAuthToken()).toBeNull();
		expect(auth.get().status).toBe('anonymous');
	});
});
