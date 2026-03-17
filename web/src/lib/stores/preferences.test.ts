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

describe('ui preferences — setters and hydration', () => {
	beforeEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue({
			status: 'authenticated',
			user: { space_id: 's1', user_id: 'u-admin' }
		});
		uiPreferences.setAll(
			{
				theme: 'default',
				font: 'sora',
				completionQuotes: [],
				sidebarPanels: defaultSidebarPanels,
				listSort: { mode: 'created', direction: 'asc' },
				streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' }
			},
			{ queueRemote: false }
		);
	});

	it('setTheme persists to localStorage', () => {
		uiPreferences.setTheme('dark');
		const raw = localStorage.getItem('tasksync:ui-preferences:s1:u-admin');
		const stored = JSON.parse(raw ?? '{}') as { theme?: string };
		expect(stored.theme).toBe('dark');
		expect(uiPreferences.get().theme).toBe('dark');
	});

	it('setFont persists to localStorage', () => {
		uiPreferences.setFont('sono');
		const raw = localStorage.getItem('tasksync:ui-preferences:s1:u-admin');
		const stored = JSON.parse(raw ?? '{}') as { font?: string };
		expect(stored.font).toBe('sono');
		expect(uiPreferences.get().font).toBe('sono');
	});

	it('setPanel opens a panel and persists', () => {
		uiPreferences.setPanel('lists', true);
		const raw = localStorage.getItem('tasksync:ui-preferences:s1:u-admin');
		const stored = JSON.parse(raw ?? '{}') as { sidebarPanels?: { lists?: boolean } };
		expect(stored.sidebarPanels?.lists).toBe(true);
		expect(uiPreferences.get().sidebarPanels.lists).toBe(true);
	});

	it('setStreakSettings merges partial update and normalizes', () => {
		uiPreferences.setStreakSettings({ enabled: true });
		const prefs = uiPreferences.get();
		expect(prefs.streakSettings.enabled).toBe(true);
		expect(prefs.streakSettings.theme).toBe('ddr');
		expect(prefs.streakSettings.resetMode).toBe('daily');
	});

	it('setCompletionQuotes stores string array', () => {
		uiPreferences.setCompletionQuotes(['hello', 'world']);
		expect(uiPreferences.get().completionQuotes).toEqual(['hello', 'world']);
	});

	it('hydrateFromLocal reads previously persisted theme and font', () => {
		localStorage.setItem(
			'tasksync:ui-preferences:s1:u-admin',
			JSON.stringify({
				theme: 'matrix',
				font: 'inter',
				completionQuotes: [],
				sidebarPanels: defaultSidebarPanels,
				listSort: { mode: 'created', direction: 'asc' },
				streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' }
			})
		);
		uiPreferences.hydrateFromLocal();
		expect(uiPreferences.get().theme).toBe('matrix');
		expect(uiPreferences.get().font).toBe('inter');
	});

	it('hydrateFromLocal falls back to defaults when no stored value', () => {
		uiPreferences.hydrateFromLocal();
		expect(uiPreferences.get().theme).toBe('default');
		expect(uiPreferences.get().font).toBe('sora');
	});

	it('hydrateFromServer race guard: ignores server response when local mutation occurred during fetch', async () => {
		let resolveRemote!: (value: { theme: string }) => void;
		const pendingRemote = new Promise<{ theme: string }>((resolve) => {
			resolveRemote = resolve;
		});
		mocks.api.getUiPreferences.mockReturnValue(pendingRemote);

		const fetching = uiPreferences.hydrateFromServer();
		// Mutate while fetch is in-flight
		uiPreferences.setTheme('dark');
		resolveRemote({ theme: 'shades-of-coffee' });
		await fetching;

		// Local mutation version incremented → server payload discarded
		expect(uiPreferences.get().theme).toBe('dark');
	});

	it('setAll normalizes unknown theme to default and unknown font to sora', () => {
		uiPreferences.setAll(
			{ theme: 'not-a-theme' as never, font: 'not-a-font' as never },
			{ queueRemote: false }
		);
		expect(uiPreferences.get().theme).toBe('default');
		expect(uiPreferences.get().font).toBe('sora');
	});
});

describe('ui preferences — showCompleted', () => {
	beforeEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue({
			status: 'authenticated',
			user: { space_id: 's1', user_id: 'u-admin' }
		});
		uiPreferences.setAll(
			{
				theme: 'default',
				font: 'sora',
				completionQuotes: [],
				sidebarPanels: defaultSidebarPanels,
				listSort: { mode: 'created', direction: 'asc' },
				streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' },
				showCompleted: true
			},
			{ queueRemote: false }
		);
	});

	it('defaults to true', () => {
		expect(uiPreferences.get().showCompleted).toBe(true);
	});

	it('setShowCompleted toggles to false and persists', () => {
		uiPreferences.setShowCompleted(false);
		expect(uiPreferences.get().showCompleted).toBe(false);

		const raw = localStorage.getItem('tasksync:ui-preferences:s1:u-admin');
		const stored = JSON.parse(raw ?? '{}') as { showCompleted?: boolean };
		expect(stored.showCompleted).toBe(false);
	});

	it('setShowCompleted toggles back to true', () => {
		uiPreferences.setShowCompleted(false);
		uiPreferences.setShowCompleted(true);
		expect(uiPreferences.get().showCompleted).toBe(true);
	});

	it('hydrateFromLocal preserves showCompleted: false', () => {
		localStorage.setItem(
			'tasksync:ui-preferences:s1:u-admin',
			JSON.stringify({
				theme: 'default',
				font: 'sora',
				completionQuotes: [],
				sidebarPanels: defaultSidebarPanels,
				listSort: { mode: 'created', direction: 'asc' },
				streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' },
				showCompleted: false
			})
		);
		uiPreferences.hydrateFromLocal();
		expect(uiPreferences.get().showCompleted).toBe(false);
	});

	it('hydrateFromLocal defaults to true when field is missing (backward compat)', () => {
		localStorage.setItem(
			'tasksync:ui-preferences:s1:u-admin',
			JSON.stringify({
				theme: 'default',
				font: 'sora',
				completionQuotes: [],
				sidebarPanels: defaultSidebarPanels,
				listSort: { mode: 'created', direction: 'asc' },
				streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' }
			})
		);
		uiPreferences.hydrateFromLocal();
		expect(uiPreferences.get().showCompleted).toBe(true);
	});

	it('hydrateFromServer reads showCompleted from wire format', async () => {
		mocks.api.getUiPreferences.mockResolvedValue({
			theme: 'dark',
			showCompleted: false
		});
		await uiPreferences.hydrateFromServer();
		expect(uiPreferences.get().showCompleted).toBe(false);
	});

	it('hydrateFromServer defaults to true when showCompleted missing from wire', async () => {
		mocks.api.getUiPreferences.mockResolvedValue({
			theme: 'dark'
		});
		await uiPreferences.hydrateFromServer();
		expect(uiPreferences.get().showCompleted).toBe(true);
	});

	it('setShowCompleted queues remote save', async () => {
		vi.useFakeTimers();
		mocks.api.updateUiPreferences.mockResolvedValue({
			theme: 'default',
			showCompleted: false
		});

		uiPreferences.setShowCompleted(false);
		vi.advanceTimersByTime(300);
		await Promise.resolve();

		expect(mocks.api.updateUiPreferences).toHaveBeenCalledTimes(1);
		expect(mocks.api.updateUiPreferences).toHaveBeenCalledWith(
			expect.objectContaining({ showCompleted: false })
		);
	});
});
