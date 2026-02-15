import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildHeaders: vi.fn()
}));

vi.mock('./headers', () => ({
	buildHeaders: mocks.buildHeaders
}));

const jsonResponse = (status: number, body = '{}') => ({
	ok: status >= 200 && status < 300,
	status,
	statusText: status === 500 ? 'Internal Server Error' : status === 204 ? 'No Content' : 'OK',
	text: vi.fn().mockResolvedValue(body)
});

const minimalBackup = () => ({
	schema: 'tasksync-space-backup-v1',
	exported_at_ts: 1,
	space: { id: 's1', name: 'Default' },
	users: [],
	memberships: [],
	lists: [],
	list_grants: [],
	tasks: []
});

describe('api client', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.buildHeaders.mockReturnValue({ 'x-test-auth': '1' });
		vi.stubGlobal('fetch', vi.fn());
		window.__TASKSYNC_RUNTIME_CONFIG__ = { apiUrl: 'https://runtime.example' };
	});

	afterEach(() => {
		delete window.__TASKSYNC_RUNTIME_CONFIG__;
		vi.unstubAllGlobals();
	});

	it('uses runtime api URL and merges default headers', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			jsonResponse(200, '{"user_id":"u-admin"}')
		);
		const { api } = await import('./client');

		await api.me();

		expect(fetch).toHaveBeenCalledWith(
			'https://runtime.example/auth/me',
			expect.objectContaining({
				headers: expect.objectContaining({
					'content-type': 'application/json',
					'x-test-auth': '1'
				})
			})
		);
	});

	it('falls back when runtime config value is empty', async () => {
		window.__TASKSYNC_RUNTIME_CONFIG__ = { apiUrl: '   ' };
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, '{}'));
		const { api } = await import('./client');

		await api.me();

		const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(String(url)).toMatch(/\/auth\/me$/);
		expect(String(url)).not.toContain('runtime.example');
	});

	it('returns undefined for 204 responses', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(204));
		const { api } = await import('./client');

		await expect(api.deleteList('l-1')).resolves.toBeUndefined();
	});

	it('returns undefined for empty successful payloads', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(200, '   '));
		const { api } = await import('./client');

		await expect(api.me()).resolves.toBeUndefined();
	});

	it('throws useful errors for non-ok responses', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse(500, '{}'));
		const { api } = await import('./client');

		await expect(api.me()).rejects.toThrow('API 500 Internal Server Error');
	});

	it('covers endpoint wrappers for auth, lists, tasks, sync, and backup', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
			async () => jsonResponse(200, '{}')
		);
		const { api } = await import('./client');

		await api.login({ email: 'admin@example.com', password: 'test-pass' });
		await api.updateMe({ display: 'Admin' });
		await api.getSoundSettings();
		await api.updateSoundSettings({ enabled: false });
		await api.getUiPreferences();
		await api.updateUiPreferences({ theme: 'default' });
		await api.getSpaceBackup();
		await api.restoreSpaceBackup(minimalBackup());
		await api.changePassword({ current_password: 'old-password', new_password: 'new-password' });
		await api.getMembers();
		await api.createMember({
			email: 'member@example.com',
			display: 'Member',
			role: 'contributor',
			password: 'secure-pass'
		});
		await api.deleteMember('u-member');
		await api.setMemberPassword('u-member', { password: 'new-member-pass' });
		await api.getListGrants();
		await api.setListGrant({ user_id: 'u-member', list_id: 'l-1', granted: true });
		await api.getLists();
		await api.createList({ name: 'New List' });
		await api.updateList('l-1', { name: 'Renamed List' });
		await api.deleteList('l-1');
		await api.getTasks();
		await api.syncPull({ since_ts: 10 });
		await api.syncPush({ changes: [] });
		await api.createTask({ title: 'Task', list_id: 'l-1' });
		await api.updateTaskMeta('t-1', { title: 'Task Updated' });
		await api.deleteTask('t-1');
		await api.updateTaskStatus('t-1', 'done');

		const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
			([url, options]) =>
				`${String(options?.method ?? 'GET')} ${String(url).replace('https://runtime.example', '')}`
		);

		expect(calls).toEqual(
			expect.arrayContaining([
				'POST /auth/login',
				'PATCH /auth/me',
				'GET /auth/sound',
				'PATCH /auth/sound',
				'GET /auth/preferences',
				'PATCH /auth/preferences',
				'GET /auth/backup',
				'POST /auth/backup',
				'PATCH /auth/password',
				'GET /auth/members',
				'POST /auth/members',
				'DELETE /auth/members/u-member',
				'PATCH /auth/members/u-member/password',
				'GET /auth/grants',
				'PUT /auth/grants',
				'GET /lists',
				'POST /lists',
				'PATCH /lists/l-1',
				'DELETE /lists/l-1',
				'GET /tasks',
				'POST /sync/pull',
				'POST /sync/push',
				'POST /tasks',
				'PATCH /tasks/t-1',
				'DELETE /tasks/t-1',
				'POST /tasks/t-1/status'
			])
		);
	});
});
