import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const mocks = vi.hoisted(() => ({
	api: {
		updateUiPreferences: vi.fn().mockResolvedValue({})
	},
	auth: {
		get: vi.fn()
	},
	uiPreferences: {
		get: vi.fn()
	},
	soundSettings: {
		get: vi.fn()
	},
	playUrl: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$lib/api/client', () => ({ api: mocks.api }));
vi.mock('$lib/stores/auth', () => ({ auth: mocks.auth }));
vi.mock('$lib/stores/preferences', () => ({ uiPreferences: mocks.uiPreferences }));
vi.mock('$lib/stores/settings', () => ({ soundSettings: mocks.soundSettings }));
vi.mock('$lib/sound/sound', () => ({ playUrl: mocks.playUrl }));

import { streak, streakState } from './streak';

const enabledPrefs = (resetMode = 'daily') => ({
	streakSettings: { enabled: true, theme: 'ddr', resetMode }
});

const disabledPrefs = () => ({
	streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' }
});

const defaultAuth = () => ({
	status: 'authenticated',
	user: { space_id: 's1', user_id: 'u1' }
});

describe('streak store — increment', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('increments count on first completion', () => {
		streak.increment('task-1');
		expect(get(streakState).count).toBe(1);
	});

	it('does not double-count the same task ID', () => {
		streak.increment('task-1');
		streak.increment('task-1');
		expect(get(streakState).count).toBe(1);
	});

	it('counts different task IDs independently', () => {
		streak.increment('task-1');
		streak.increment('task-2');
		streak.increment('task-3');
		expect(get(streakState).count).toBe(3);
	});

	it('does nothing when streak is disabled', () => {
		mocks.uiPreferences.get.mockReturnValue(disabledPrefs());
		streak.increment('task-1');
		expect(get(streakState).count).toBe(0);
	});

	it('records the task ID in countedTaskIds', () => {
		streak.increment('task-1');
		streak.increment('task-2');
		expect(get(streakState).countedTaskIds).toContain('task-1');
		expect(get(streakState).countedTaskIds).toContain('task-2');
	});
});

describe('streak store — undoCompletion', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('allows re-counting a task after undoCompletion', () => {
		streak.increment('task-1');
		expect(get(streakState).count).toBe(1);

		streak.undoCompletion('task-1');
		// Count unchanged — undo does not decrement
		expect(get(streakState).count).toBe(1);
		// But the task is no longer in the counted set
		expect(get(streakState).countedTaskIds).not.toContain('task-1');

		// Re-completing should now count
		streak.increment('task-1');
		expect(get(streakState).count).toBe(2);
	});

	it('does not affect count of other tasks', () => {
		streak.increment('task-1');
		streak.increment('task-2');
		streak.undoCompletion('task-1');
		expect(get(streakState).count).toBe(2);
		expect(get(streakState).countedTaskIds).toContain('task-2');
	});
});

describe('streak store — break', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('resets count to 0', () => {
		streak.increment('task-1');
		streak.increment('task-2');
		expect(get(streakState).count).toBe(2);

		streak.break();
		expect(get(streakState).count).toBe(0);
	});

	it('clears countedTaskIds', () => {
		streak.increment('task-1');
		streak.break();
		expect(get(streakState).countedTaskIds).toHaveLength(0);
	});

	it('allows re-counting previously counted tasks after a break', () => {
		streak.increment('task-1');
		streak.break();
		streak.increment('task-1');
		expect(get(streakState).count).toBe(1);
	});
});

describe('streak store — DDR daily reset', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('silently resets count after hydrateFromLocal + checkMissedTasks(0) on a new day', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		const staleState = JSON.stringify({ count: 42, countedTaskIds: ['task-1'], lastResetDate: yesterday });
		localStorage.setItem('tasksync:streak-state:s1:u1', staleState);

		streak.hydrateFromLocal();
		// Count is deferred until checkMissedTasks resolves the pending break
		streak.checkMissedTasks(0); // no missed tasks → silent zero

		expect(get(streakState).count).toBe(0);
		expect(get(streakState).countedTaskIds).toHaveLength(0);
	});

	it('preserves count when lastResetDate is today in DDR mode', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const today = new Date().toISOString().slice(0, 10);
		const freshState = JSON.stringify({ count: 17, countedTaskIds: ['task-1'], lastResetDate: today });
		localStorage.setItem('tasksync:streak-state:s1:u1', freshState);

		streak.hydrateFromLocal();

		expect(get(streakState).count).toBe(17);
	});

	it('preserves count across days in endless mode', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		const oldState = JSON.stringify({ count: 99, countedTaskIds: ['task-1'], lastResetDate: yesterday });
		localStorage.setItem('tasksync:streak-state:s1:u1', oldState);

		streak.hydrateFromLocal();

		expect(get(streakState).count).toBe(99);
	});
});

describe('streak store — checkMissedTasks', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('breaks combo with animation when missed tasks exist and combo is live (endless mode)', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		streak.increment('task-1');
		streak.increment('task-2');
		expect(get(streakState).count).toBe(2);

		streak.checkMissedTasks(3); // 3 missed tasks from prior day

		expect(get(streakState).count).toBe(0);
	});

	it('does nothing when count is 0, even with missed tasks (endless mode)', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		// count stays at 0

		streak.checkMissedTasks(5);

		expect(get(streakState).count).toBe(0); // no-op, nothing to break
	});

	it('does nothing when there are no missed tasks (endless mode)', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		streak.increment('task-1');

		streak.checkMissedTasks(0);

		expect(get(streakState).count).toBe(1); // unchanged
	});

	it('only fires once per day — second call with missed tasks is a no-op', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		streak.increment('task-1');
		streak.checkMissedTasks(2); // breaks
		expect(get(streakState).count).toBe(0);

		// Complete more tasks and call again — should not break again today
		streak.increment('task-2');
		streak.increment('task-3');
		streak.checkMissedTasks(2); // same day, second call → no-op

		expect(get(streakState).count).toBe(2);
	});

	it('in DDR mode new day: breaks with animation when there are missed tasks', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		const staleState = JSON.stringify({ count: 10, countedTaskIds: ['task-1'], lastResetDate: yesterday });
		localStorage.setItem('tasksync:streak-state:s1:u1', staleState);

		streak.hydrateFromLocal(); // sets pendingDailyBreak
		streak.checkMissedTasks(2); // new day + missed → animated break

		expect(get(streakState).count).toBe(0);
	});

	it('in DDR mode new day: silently zeros when no missed tasks', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		const staleState = JSON.stringify({ count: 7, countedTaskIds: ['task-1'], lastResetDate: yesterday });
		localStorage.setItem('tasksync:streak-state:s1:u1', staleState);

		streak.hydrateFromLocal();
		streak.checkMissedTasks(0); // new day, no missed → silent zero

		expect(get(streakState).count).toBe(0);
	});
});

describe('streak store — announcer trigger', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: true, volume: 60 });
		streak.reset();
	});

	it('increment() returns true (will announce) exactly at count 5', () => {
		let announced = false;
		for (let i = 0; i < 5; i++) {
			const result = streak.increment(`task-${i}`);
			if (i === 4) announced = result; // 5th completion = count 5
			else expect(result).toBe(false);
		}
		expect(announced).toBe(true);
		expect(get(streakState).count).toBe(5);
	});

	it('increment() returns false when sound is disabled, even at trigger count', () => {
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		for (let i = 0; i < 4; i++) streak.increment(`task-${i}`);
		const result = streak.increment('task-4'); // count=5, would normally announce
		expect(result).toBe(false);
	});

	it('next trigger is at least 10 away after first trigger', () => {
		// Complete 5 tasks to fire the first announcer
		for (let i = 0; i < 5; i++) streak.increment(`task-${i}`);
		// The 6th completion should NOT trigger again (next trigger is 10–20 away)
		const result = streak.increment('task-5');
		expect(result).toBe(false);
	});

	it('count increments correctly across many completions without throwing', () => {
		for (let i = 0; i < 50; i++) {
			streak.increment(`task-${i}`);
		}
		expect(get(streakState).count).toBe(50);
	});
});

describe('streak store — recurring task re-count pattern', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('increment then undoCompletion (recurring pattern) allows the same ID to count again', () => {
		// Simulate: recurring task completes, then same ID becomes available again
		streak.increment('recurring-task-1');
		streak.undoCompletion('recurring-task-1'); // mimic what tasks.ts does for recurring
		expect(get(streakState).count).toBe(1);
		// Same ID should count again on next occurrence
		streak.increment('recurring-task-1');
		expect(get(streakState).count).toBe(2);
	});

	it('same recurring task can count on every occurrence', () => {
		for (let i = 0; i < 4; i++) {
			streak.increment('daily-task');
			streak.undoCompletion('daily-task'); // recurring pattern
		}
		expect(get(streakState).count).toBe(4);
	});
});

describe('streak store — server hydration', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('applies server state from valid streakStateJson', () => {
		const serverState = JSON.stringify({ count: 55, countedTaskIds: ['a', 'b'], lastResetDate: new Date().toISOString().slice(0, 10) });
		streak.hydrateFromServer(serverState);
		expect(get(streakState).count).toBe(55);
	});

	it('ignores malformed streakStateJson', () => {
		streak.increment('task-1');
		streak.hydrateFromServer('not json at all {{{');
		// State should be unchanged (local wins on parse error)
		expect(get(streakState).count).toBe(1);
	});

	it('handles null/undefined streakStateJson gracefully', () => {
		streak.increment('task-1');
		streak.hydrateFromServer(null);
		streak.hydrateFromServer(undefined);
		expect(get(streakState).count).toBe(1);
	});
});

describe('streak store — settings normalization', () => {
	it('settingsMenu includes streak section for non-admin users', async () => {
		const { getSettingsSections } = await import('$lib/components/settingsMenu');
		const ids = getSettingsSections(false).map((s) => s.id);
		expect(ids).toContain('streak');
	});
});
