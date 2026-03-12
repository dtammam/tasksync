import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({
	api: {
		login: vi.fn(),
		me: vi.fn(),
		updateMe: vi.fn()
	},
	apiErrorStatus: (err: unknown) => {
		const message = err instanceof Error ? err.message : String(err);
		const match = /^API\s+(\d{3})\b/.exec(message);
		if (!match) return null;
		const parsed = Number.parseInt(match[1], 10);
		return Number.isFinite(parsed) ? parsed : null;
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
		localStorage.setItem('tasksync:auth-mode', 'legacy');
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

	it('becomes anonymous without calling /auth/me when mode has no token', async () => {

		await auth.hydrate();

		expect(auth.get().status).toBe('anonymous');
		expect(auth.get().mode).toBe('token');
		expect(mockedApi.me).not.toHaveBeenCalled();
	});

	it('keeps token auth session when /auth/me fails due to network', async () => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.setItem('tasksync:auth-token', 'jwt-token');
		localStorage.setItem('tasksync:auth-user', JSON.stringify(meUser));
		mockedApi.me.mockRejectedValue(new Error('TypeError: Failed to fetch'));

		await auth.hydrate();

		expect(getAuthToken()).toBe('jwt-token');
		expect(auth.get().status).toBe('authenticated');
		expect(auth.get().source).toBe('token');
		expect(auth.get().user?.user_id).toBe('admin');
		expect(auth.get().error).toBe(
			'Cannot reach the server right now. You can continue local use and retry sign-in later.'
		);
	});

	it('clears token auth session when /auth/me returns unauthorized', async () => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.setItem('tasksync:auth-token', 'jwt-token');
		localStorage.setItem('tasksync:auth-user', JSON.stringify(meUser));
		mockedApi.me.mockRejectedValue(new Error('API 401 Unauthorized'));

		await auth.hydrate();

		expect(getAuthToken()).toBeNull();
		expect(auth.get().status).toBe('anonymous');
		expect(auth.get().source).toBeNull();
		expect(auth.get().user).toBeNull();
	});

	it('maps login 404 to actionable sign-in error', async () => {
		mockedApi.login.mockRejectedValue(new Error('API 404 Not Found'));

		await expect(auth.login('admin@example.com', 'tasksync', 's1')).rejects.toThrow();

		expect(auth.get().status).toBe('anonymous');
		expect(auth.get().error).toBe(
			'Sign in endpoint was not found (404). Check the API URL and server version.'
		);
	});

	it('maps login unauthorized to credential guidance', async () => {
		mockedApi.login.mockRejectedValue(new Error('API 401 Unauthorized'));

		await expect(auth.login('admin@example.com', 'wrong', 's1')).rejects.toThrow();

		expect(auth.get().status).toBe('anonymous');
		expect(auth.get().error).toBe('Sign in failed. Check your email, password, and space ID.');
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

	it('isAuthenticated returns true when authenticated and false otherwise', async () => {
		mockedApi.me.mockResolvedValue(meUser);
		await auth.hydrate();
		// Still 'loading' after hydrate? No — with token mode and no token set, it's anonymous.
		// Test after login instead.
		mockedApi.login.mockResolvedValue({ token: 'jwt-token', ...meUser });
		await auth.login('admin@example.com', 'tasksync', 's1');
		expect(auth.isAuthenticated()).toBe(true);

		auth.logout();
		expect(auth.isAuthenticated()).toBe(false);
	});

	it('updateProfile updates the stored user on success', async () => {
		mockedApi.login.mockResolvedValue({ token: 'jwt-token', ...meUser });
		await auth.login('admin@example.com', 'tasksync', 's1');

		const updated = { ...meUser, display: 'Admin Updated' };
		mockedApi.updateMe.mockResolvedValue(updated);

		const result = await auth.updateProfile({ display: 'Admin Updated' });

		expect(result.display).toBe('Admin Updated');
		expect(auth.get().user?.display).toBe('Admin Updated');
	});

	it('updateProfile throws when not authenticated', async () => {
		auth.logout();
		await expect(auth.updateProfile({ display: 'anything' })).rejects.toThrow('Not authenticated');
	});
});
