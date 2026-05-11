import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildHeaders: vi.fn(),
}));

vi.mock('./headers', () => ({
	buildHeaders: mocks.buildHeaders,
}));

const jsonResponse = (status: number, body = '{}', statusText?: string) => ({
	ok: status >= 200 && status < 300,
	status,
	statusText:
		statusText ?? (status === 500 ? 'Internal Server Error' : status === 204 ? 'No Content' : 'OK'),
	text: vi.fn().mockResolvedValue(body),
});

const minimalBackup = () => ({
	schema: 'tasksync-space-backup-v1',
	exported_at_ts: 1,
	space: { id: 's1', name: 'Default' },
	users: [],
	memberships: [],
	lists: [],
	list_grants: [],
	tasks: [],
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
					'x-test-auth': '1',
				}),
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

	it('re-reads runtime config URL between calls without re-importing', async () => {
		window.__TASKSYNC_RUNTIME_CONFIG__ = { apiUrl: 'https://server-one.example' };
		(fetch as unknown as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(jsonResponse(200, '{"user_id":"u1"}'))
			.mockResolvedValueOnce(jsonResponse(200, '{"user_id":"u2"}'));

		const { api } = await import('./client');

		await api.me();

		window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl = 'https://server-two.example';

		await api.me();

		const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
		expect(String(calls[0][0])).toBe('https://server-one.example/auth/me');
		expect(String(calls[1][0])).toBe('https://server-two.example/auth/me');
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

	it('includes parsed API error detail text when provided', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			jsonResponse(400, '{"message":"Password is required"}', 'Bad Request')
		);
		const { api } = await import('./client');

		await expect(api.login({ email: 'admin@example.com', password: '' })).rejects.toThrow(
			'API 400 Bad Request: Password is required'
		);
	});

	describe('applyStreakOp', () => {
		it('happy path — returns the parsed StreakOpResponse from the server', async () => {
			const serverResponse = {
				revision: 5,
				count: 3,
				lastResetDate: '2026-01-01',
				dayCompleteDate: '2026-05-10',
				appliedThisCall: false,
				dayCompleteFiredThisCall: true,
			};
			(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				jsonResponse(200, JSON.stringify(serverResponse))
			);
			const { api } = await import('./client');

			const result = await api.applyStreakOp({
				opKey: 'inc:task-1:2026-05-10',
				kind: 'increment',
				occurredAt: 1715385600000,
			});

			expect(result).toEqual(serverResponse);
		});

		it('request shape — URL, method, body, and headers are correct', async () => {
			(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				jsonResponse(
					200,
					JSON.stringify({
						revision: 1,
						count: 0,
						lastResetDate: '2026-05-10',
						dayCompleteDate: null,
						appliedThisCall: true,
						dayCompleteFiredThisCall: false,
					})
				)
			);
			const { api } = await import('./client');

			const input = {
				opKey: 'brk:manual:1715385600000',
				kind: 'break' as const,
				occurredAt: 1715385600000,
				cause: 'manual' as const,
			};
			await api.applyStreakOp(input);

			expect(fetch).toHaveBeenCalledWith(
				'https://runtime.example/auth/streak/op',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify(input),
					headers: expect.objectContaining({
						'content-type': 'application/json',
						'x-test-auth': '1',
					}),
				})
			);
		});

		it('error path — 4xx response surfaces as ApiError with parsed detail', async () => {
			(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
				jsonResponse(400, '{"message":"Invalid op key"}', 'Bad Request')
			);
			const { api, ApiError } = await import('./client');

			let caught: unknown;
			try {
				await api.applyStreakOp({
					opKey: '',
					kind: 'increment',
					occurredAt: 1715385600000,
				});
			} catch (err) {
				caught = err;
			}

			expect(caught).toBeInstanceOf(ApiError);
			expect((caught as InstanceType<typeof ApiError>).status).toBe(400);
			expect((caught as InstanceType<typeof ApiError>).detail).toBe('Invalid op key');
		});
	});

	it('covers endpoint wrappers for auth, lists, tasks, sync, and backup', async () => {
		(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
			jsonResponse(200, '{}')
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
			password: 'secure-pass',
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
				'POST /tasks/t-1/status',
			])
		);
	});
});
