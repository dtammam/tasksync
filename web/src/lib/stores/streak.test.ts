import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { StreakOp } from '$lib/data/streakQueue';

const mocks = vi.hoisted(() => ({
	api: {
		updateUiPreferences: vi.fn().mockResolvedValue({}),
		applyStreakOp: vi.fn().mockResolvedValue({
			revision: 1,
			count: 1,
			lastResetDate: new Date().toISOString().slice(0, 10),
			dayCompleteDate: null,
			appliedThisCall: true,
			dayCompleteFiredThisCall: false,
		}),
	},
	auth: {
		get: vi.fn(),
	},
	uiPreferences: {
		get: vi.fn(),
		hydrateFromServer: vi.fn().mockResolvedValue(null),
	},
	soundSettings: {
		get: vi.fn(),
	},
	playUrl: vi.fn().mockResolvedValue(undefined),
	streakQueue: {
		enqueue: vi.fn().mockResolvedValue(undefined),
		peekAll: vi.fn().mockResolvedValue([]),
		remove: vi.fn().mockResolvedValue(undefined),
		count: vi.fn().mockResolvedValue(0),
	},
	streakDrain: {
		drain: vi.fn().mockResolvedValue(undefined),
		__resetForTests: vi.fn(),
	},
	setReconciler: vi.fn(),
	setHydrator: vi.fn(),
}));

vi.mock('$lib/api/client', () => ({
	api: mocks.api,
	ApiError: class extends Error {
		status = 500;
		constructor(msg: string) {
			super(msg);
		}
	},
}));
vi.mock('$lib/stores/auth', () => ({ auth: mocks.auth }));
vi.mock('$lib/stores/preferences', () => ({ uiPreferences: mocks.uiPreferences }));
vi.mock('$lib/stores/settings', () => ({ soundSettings: mocks.soundSettings }));
vi.mock('$lib/sound/sound', () => ({ playUrl: mocks.playUrl }));
vi.mock('$lib/data/streakQueue', () => ({ streakQueue: mocks.streakQueue }));
vi.mock('$lib/sync/streakDrain', () => ({
	streakDrain: mocks.streakDrain,
	setReconciler: mocks.setReconciler,
	setHydrator: mocks.setHydrator,
}));

import { streak, streakDisplay, streakState } from './streak';

const enabledPrefs = (resetMode = 'daily') => ({
	streakSettings: { enabled: true, theme: 'ddr', resetMode },
});

const disabledPrefs = () => ({
	streakSettings: { enabled: false, theme: 'ddr', resetMode: 'daily' },
});

const defaultAuth = () => ({
	status: 'authenticated',
	user: { space_id: 's1', user_id: 'u1' },
});

// Helpers for the new prefs-blob storage format
const PREFS_KEY = 'tasksync:ui-preferences:s1:u1';

const setPrefsBlob = (partial: Record<string, unknown>) => {
	localStorage.setItem(PREFS_KEY, JSON.stringify(partial));
};

const getPrefsBlob = (): Record<string, unknown> => {
	const raw = localStorage.getItem(PREFS_KEY);
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
};

// Monotonically increasing revision counter across all tests.
// lastSeenRevision is module-level in streak.ts and never resets between tests,
// so every hydrateFromServer call that should actually apply state must use a
// strictly-increasing revision number.
let globalRevCounter = 0;
const nextRev = () => ++globalRevCounter;

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

	it('increment preserves dayCompleteDate already set', () => {
		const today = new Date().toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 0,
				countedTaskIds: [],
				lastResetDate: today,
				dayCompleteDate: today,
			}),
			nextRev()
		);
		streak.increment('task-1');
		expect(get(streakState).dayCompleteDate).toBe(today);
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

	it('break preserves dayCompleteDate', () => {
		const today = new Date().toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 3,
				countedTaskIds: ['t1'],
				lastResetDate: today,
				dayCompleteDate: today,
			}),
			nextRev()
		);
		streak.break();
		expect(get(streakState).dayCompleteDate).toBe(today);
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

	it('silently resets count after hydrateFromLocal + checkMissedTasksAndApplyDailyReset(0) on a new day', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		setPrefsBlob({
			streakState: { count: 42, countedTaskIds: ['task-1'], lastResetDate: yesterday },
		});

		streak.hydrateFromLocal();
		// Count is deferred until checkMissedTasksAndApplyDailyReset resolves the pending break
		streak.checkMissedTasksAndApplyDailyReset(0); // no missed tasks → silent zero

		expect(get(streakState).count).toBe(0);
		expect(get(streakState).countedTaskIds).toHaveLength(0);
	});

	it('preserves count when lastResetDate is today in DDR mode', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const today = new Date().toISOString().slice(0, 10);
		setPrefsBlob({ streakState: { count: 17, countedTaskIds: ['task-1'], lastResetDate: today } });

		streak.hydrateFromLocal();

		expect(get(streakState).count).toBe(17);
	});

	it('preserves count across days in endless mode', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		setPrefsBlob({
			streakState: { count: 99, countedTaskIds: ['task-1'], lastResetDate: yesterday },
		});

		streak.hydrateFromLocal();

		expect(get(streakState).count).toBe(99);
	});
});

describe('streak store — checkMissedTasksAndApplyDailyReset', () => {
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

		streak.checkMissedTasksAndApplyDailyReset(3); // 3 missed tasks from prior day

		expect(get(streakState).count).toBe(0);
	});

	it('does nothing when count is 0, even with missed tasks (endless mode)', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		// count stays at 0

		streak.checkMissedTasksAndApplyDailyReset(5);

		expect(get(streakState).count).toBe(0); // no-op, nothing to break
	});

	it('does nothing when there are no missed tasks (endless mode)', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		streak.increment('task-1');

		streak.checkMissedTasksAndApplyDailyReset(0);

		expect(get(streakState).count).toBe(1); // unchanged
	});

	it('only fires once per day — second call with missed tasks is a no-op', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		streak.increment('task-1');
		streak.checkMissedTasksAndApplyDailyReset(2); // breaks
		expect(get(streakState).count).toBe(0);

		// Complete more tasks and call again — should not break again today
		streak.increment('task-2');
		streak.increment('task-3');
		streak.checkMissedTasksAndApplyDailyReset(2); // same day, second call → no-op

		expect(get(streakState).count).toBe(2);
	});

	it('in DDR mode new day: breaks with animation when there are missed tasks', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		setPrefsBlob({
			streakState: { count: 10, countedTaskIds: ['task-1'], lastResetDate: yesterday },
		});

		streak.hydrateFromLocal(); // sets pendingDailyBreak
		streak.checkMissedTasksAndApplyDailyReset(2); // new day + missed → animated break

		expect(get(streakState).count).toBe(0);
	});

	it('in DDR mode new day: silently zeros when no missed tasks', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('daily'));
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		setPrefsBlob({
			streakState: { count: 7, countedTaskIds: ['task-1'], lastResetDate: yesterday },
		});

		streak.hydrateFromLocal();
		streak.checkMissedTasksAndApplyDailyReset(0); // new day, no missed → silent zero

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
			if (i === 4)
				announced = result; // 5th completion = count 5
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
		const serverState = JSON.stringify({
			count: 55,
			countedTaskIds: ['a', 'b'],
			lastResetDate: new Date().toISOString().slice(0, 10),
		});
		streak.hydrateFromServer(serverState, nextRev());
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

	it('hydrateFromServer populates dayCompleteDate from server blob', () => {
		const today = new Date().toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 5,
				countedTaskIds: [],
				lastResetDate: today,
				dayCompleteDate: today,
			}),
			nextRev()
		);
		expect(get(streakState).dayCompleteDate).toBe(today);
	});

	it('hydrateFromServer with yesterday dayCompleteDate leaves guard inactive', () => {
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 3,
				countedTaskIds: [],
				lastResetDate: yesterday,
				dayCompleteDate: yesterday,
			}),
			nextRev()
		);
		// Guard should be inactive — yesterday is not today
		const today = new Date().toISOString().slice(0, 10);
		expect(get(streakState).dayCompleteDate).toBe(yesterday);
		expect(get(streakState).dayCompleteDate).not.toBe(today);
	});

	it('hydrateFromServer writes streak state into prefs blob', () => {
		const today = new Date().toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 7,
				countedTaskIds: ['x'],
				lastResetDate: today,
				dayCompleteDate: today,
			}),
			nextRev()
		);
		const blob = getPrefsBlob();
		expect(blob.streakState).toBeDefined();
		expect((blob.streakState as { count: number }).count).toBe(7);
	});
});

describe('streak store — settings normalization', () => {
	it('settingsMenu includes streak section for non-admin users', async () => {
		const { getSettingsSections } = await import('$lib/components/settingsMenu');
		const ids = getSettingsSections(false).map((s) => s.id);
		expect(ids).toContain('streak');
	});
});

describe('streak store — day complete', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: true, volume: 60 });
		streak.reset();
	});

	it('triggerDayComplete returns true on first call today', () => {
		const result = streak.triggerDayComplete();
		expect(result).toBe(true);
	});

	it('triggerDayComplete returns false on second call same day (once-per-day guard)', () => {
		streak.triggerDayComplete();
		const result = streak.triggerDayComplete();
		expect(result).toBe(false);
	});

	it('triggerDayComplete returns false when streak is disabled', () => {
		mocks.uiPreferences.get.mockReturnValue(disabledPrefs());
		const result = streak.triggerDayComplete();
		expect(result).toBe(false);
	});

	it('triggerDayComplete sets isDayComplete on the display store', () => {
		streak.increment('task-1');
		streak.triggerDayComplete();
		expect(get(streakDisplay).isDayComplete).toBe(true);
	});

	it('isDayComplete is reset to false after the hide timer fires', () => {
		streak.increment('task-1');
		streak.triggerDayComplete();
		expect(get(streakDisplay).isDayComplete).toBe(true);
		vi.advanceTimersByTime(3001);
		expect(get(streakDisplay).isDayComplete).toBe(false);
	});

	it('triggerDayComplete does not play sound when sound is disabled', () => {
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.triggerDayComplete();
		expect(mocks.playUrl).not.toHaveBeenCalled();
	});

	it('isDayComplete resets to false after streak.reset()', () => {
		streak.increment('task-1');
		streak.triggerDayComplete();
		streak.reset();
		expect(get(streakDisplay).isDayComplete).toBe(false);
	});

	it('streak.reset() clears dayCompleteDate', () => {
		streak.triggerDayComplete();
		expect(get(streakState).dayCompleteDate).not.toBeNull();
		streak.reset();
		expect(get(streakState).dayCompleteDate).toBeNull();
	});

	it('triggerDayComplete fires again the next day', () => {
		streak.triggerDayComplete(); // fires today
		expect(streak.triggerDayComplete()).toBe(false); // blocked same day

		// Simulate next day: hydrate with yesterday's dayCompleteDate
		const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 0,
				countedTaskIds: [],
				lastResetDate: yesterday,
				dayCompleteDate: yesterday,
			}),
			nextRev()
		);

		expect(streak.triggerDayComplete()).toBe(true); // new day → fires again
	});

	it('triggerDayComplete writes dayCompleteDate into stateStore', () => {
		streak.triggerDayComplete();
		const today = new Date().toISOString().slice(0, 10);
		expect(get(streakState).dayCompleteDate).toBe(today);
	});

	it('triggerDayComplete writes dayCompleteDate into prefs blob', () => {
		streak.triggerDayComplete();
		const today = new Date().toISOString().slice(0, 10);
		const blob = getPrefsBlob();
		expect((blob.streakState as { dayCompleteDate: string }).dayCompleteDate).toBe(today);
	});

	it('hydrating with today dayCompleteDate prevents triggerDayComplete from firing', () => {
		const today = new Date().toISOString().slice(0, 10);
		streak.hydrateFromServer(
			JSON.stringify({
				count: 3,
				countedTaskIds: [],
				lastResetDate: today,
				dayCompleteDate: today,
			}),
			nextRev()
		);
		expect(streak.triggerDayComplete()).toBe(false);
	});
});

describe('streak store — localStorage collapse (prefs blob)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		streak.reset();
	});

	it('writeStreakStateToPrefsBlob does not clobber other prefs fields', () => {
		setPrefsBlob({ theme: 'dark', font: 'sora' });
		streak.increment('task-1'); // triggers writeStreakStateToPrefsBlob
		const blob = getPrefsBlob();
		expect(blob.theme).toBe('dark');
		expect(blob.font).toBe('sora');
	});

	it('hydrateFromLocal reads streak state from prefs blob', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		const today = new Date().toISOString().slice(0, 10);
		setPrefsBlob({ streakState: { count: 12, countedTaskIds: ['x'], lastResetDate: today } });
		streak.hydrateFromLocal();
		expect(get(streakState).count).toBe(12);
	});

	it('migration: reads old streak key, removes it, stores in prefs blob', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		const today = new Date().toISOString().slice(0, 10);
		// Simulate pre-migration boot: no streakState in prefs blob, only old separate key
		localStorage.clear();
		localStorage.setItem(
			'tasksync:streak-state:s1:u1',
			JSON.stringify({ count: 8, countedTaskIds: ['old'], lastResetDate: today })
		);

		streak.hydrateFromLocal();

		expect(get(streakState).count).toBe(8);
		// Old key should be cleaned up
		expect(localStorage.getItem('tasksync:streak-state:s1:u1')).toBeNull();
	});

	it('migration: reads old day-complete key, removes it', () => {
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs('endless'));
		const today = new Date().toISOString().slice(0, 10);
		// Simulate pre-migration boot: no streakState in prefs blob, both old keys present
		localStorage.clear();
		localStorage.setItem(
			'tasksync:streak-state:s1:u1',
			JSON.stringify({ count: 1, countedTaskIds: [], lastResetDate: today })
		);
		localStorage.setItem('tasksync:streak-state:s1:u1:day-complete-date', today);

		streak.hydrateFromLocal();

		expect(get(streakState).dayCompleteDate).toBe(today);
		expect(localStorage.getItem('tasksync:streak-state:s1:u1:day-complete-date')).toBeNull();
	});
});

describe('streak store — enqueue + drain wiring', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.clearAllMocks();
		mocks.auth.get.mockReturnValue(defaultAuth());
		mocks.uiPreferences.get.mockReturnValue(enabledPrefs());
		mocks.soundSettings.get.mockReturnValue({ enabled: false, volume: 60 });
		mocks.streakQueue.enqueue.mockResolvedValue(undefined);
		mocks.streakDrain.drain.mockResolvedValue(undefined);
		streak.reset();
		vi.clearAllMocks();
	});

	it('increment enqueues exactly one op with the expected key', () => {
		const before = Date.now();
		streak.increment('task-1');

		// exactly one enqueue
		expect(mocks.streakQueue.enqueue).toHaveBeenCalledTimes(1);
		const op = mocks.streakQueue.enqueue.mock.calls[0][0] as StreakOp;
		expect(op.kind).toBe('increment');
		expect(op.taskId).toBe('task-1');

		// opKey shape: inc:<taskId>:<YYYY-MM-DD>
		const today = new Date().toISOString().slice(0, 10);
		expect(op.opKey).toBe(`inc:task-1:${today}`);

		// occurredAt is a sane recent timestamp
		expect(op.occurredAt).toBeGreaterThanOrEqual(before);
		expect(op.occurredAt).toBeLessThanOrEqual(Date.now());

		// exactly one drain kick
		expect(mocks.streakDrain.drain).toHaveBeenCalledTimes(1);
	});

	it('hydrate with higher revision silently swaps count', () => {
		// arrange: local state at count 3 with persisted revision 5
		setPrefsBlob({
			streakState: {
				count: 3,
				countedTaskIds: [],
				lastResetDate: '2026-05-11',
				dayCompleteDate: null,
			},
			streakRevision: 5,
		});
		streak.hydrateFromLocal();
		expect(get(streakState).count).toBe(3);

		const pulseBefore = get(streakDisplay).pulse;
		const visibleBefore = get(streakDisplay).visible;

		// act: server hydrate with revision higher than current lastSeenRevision
		const rev = nextRev();
		streak.hydrateFromServer(
			JSON.stringify({
				count: 7,
				countedTaskIds: [],
				lastResetDate: '2026-05-11',
				dayCompleteDate: null,
			}),
			rev
		);

		// assert: count swapped silently — pulse and visible are unchanged (silent swap contract)
		expect(get(streakState).count).toBe(7);
		expect(get(streakDisplay).pulse).toBe(pulseBefore);
		expect(get(streakDisplay).visible).toBe(visibleBefore);
	});

	it('hydrate with lower-or-equal revision is a no-op', () => {
		// arrange: hydrate from server to establish a known lastSeenRevision
		const establishedRev = nextRev();
		streak.hydrateFromServer(
			JSON.stringify({
				count: 3,
				countedTaskIds: [],
				lastResetDate: '2026-05-11',
				dayCompleteDate: null,
			}),
			establishedRev
		);
		expect(get(streakState).count).toBe(3);

		// act 1: server hydrate with EQUAL revision + different count (99)
		streak.hydrateFromServer(
			JSON.stringify({
				count: 99,
				countedTaskIds: [],
				lastResetDate: '2026-05-11',
				dayCompleteDate: null,
			}),
			establishedRev
		);
		expect(get(streakState).count).toBe(3); // unchanged

		// act 2: server hydrate with LOWER revision + different count (88)
		streak.hydrateFromServer(
			JSON.stringify({
				count: 88,
				countedTaskIds: [],
				lastResetDate: '2026-05-11',
				dayCompleteDate: null,
			}),
			establishedRev - 1
		);
		expect(get(streakState).count).toBe(3); // unchanged
	});
});
