import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	api: {
		getUiPreferences: vi.fn(),
		updateUiPreferences: vi.fn()
	},
	auth: {
		get: vi.fn()
	}
}));

vi.mock('$lib/api/client', () => ({
	api: mocks.api
}));

vi.mock('$lib/stores/auth', () => ({
	auth: mocks.auth
}));

import { uiPreferences } from './preferences';

const defaultSidebarPanels = {
	lists: false,
	members: false,
	sound: false,
	backups: false,
	account: true
};

describe('ui preferences store list sort', () => {
	beforeEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue({
			status: 'authenticated',
			user: {
				space_id: 's1',
				user_id: 'u-admin'
			}
		});
		uiPreferences.setAll(
			{
				theme: 'default',
				sidebarPanels: defaultSidebarPanels,
				listSort: {
					mode: 'created',
					direction: 'asc'
				}
			},
			{ queueRemote: false }
		);
	});

	it('hydrates list sort from server payload', async () => {
		mocks.api.getUiPreferences.mockResolvedValue({
			theme: 'dark',
			sidebarPanelsJson:
				'{"lists":true,"members":false,"sound":true,"backups":false,"account":true}',
			listSortJson: '{"mode":"due_date","direction":"desc"}'
		});

		await uiPreferences.hydrateFromServer();

		expect(get(uiPreferences).theme).toBe('dark');
		expect(get(uiPreferences).listSort).toEqual({
			mode: 'due_date',
			direction: 'desc'
		});
	});

	it('persists list sort locally and batches remote updates', async () => {
		vi.useFakeTimers();
		mocks.api.updateUiPreferences.mockResolvedValue({
			theme: 'default',
			sidebarPanelsJson:
				'{"lists":false,"members":false,"sound":false,"backups":false,"account":true}',
			listSortJson: '{"mode":"due_date","direction":"desc"}'
		});

		uiPreferences.setListSort({ mode: 'due_date' });
		uiPreferences.setListSort({ direction: 'desc' });

		const storedRaw = localStorage.getItem('tasksync:ui-preferences:s1:u-admin');
		expect(storedRaw).toBeTruthy();
		const stored = JSON.parse(storedRaw ?? '{}') as {
			listSort?: { mode?: string; direction?: string };
		};
		expect(stored.listSort).toEqual({
			mode: 'due_date',
			direction: 'desc'
		});

		vi.advanceTimersByTime(300);
		await Promise.resolve();

		expect(mocks.api.updateUiPreferences).toHaveBeenCalledTimes(1);
		expect(mocks.api.updateUiPreferences).toHaveBeenCalledWith(
			expect.objectContaining({
				listSortJson: '{"mode":"due_date","direction":"desc"}'
			})
		);
	});
});
