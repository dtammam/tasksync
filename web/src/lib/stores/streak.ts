import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { uiPreferences } from '$lib/stores/preferences';
import { playUrl } from '$lib/sound/sound';
import { soundSettings } from '$lib/stores/settings';
import type { StreakState } from '$shared/types/settings';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Always fire at count=5. After that, fire randomly every 10–20 completions.
const FIRST_ANNOUNCER_AT = 5;

const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// State + display stores
// ---------------------------------------------------------------------------

interface StreakDisplayState {
	count: number;
	/** true when the overlay should be visible */
	visible: boolean;
	/** bumped on each increment so the component can react */
	pulse: number;
	/** true = break animation (flash then hide), false = normal */
	breaking: boolean;
}

const defaultState = (): StreakState => ({
	count: 0,
	countedTaskIds: [],
	lastResetDate: null
});

const stateStore = writable<StreakState>(defaultState());
const displayStore = writable<StreakDisplayState>({
	count: 0,
	visible: false,
	pulse: 0,
	breaking: false
});

export const streakDisplay = { subscribe: displayStore.subscribe };

// ---------------------------------------------------------------------------
// Fade-out timer
// ---------------------------------------------------------------------------

let fadeTimer: ReturnType<typeof setTimeout> | null = null;
const DISPLAY_TIMEOUT_MS = 5000;

const scheduleHide = () => {
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimer = typeof window !== 'undefined'
		? window.setTimeout(() => {
				fadeTimer = null;
				displayStore.update((d) => ({ ...d, visible: false, breaking: false }));
			}, DISPLAY_TIMEOUT_MS)
		: null;
};

// ---------------------------------------------------------------------------
// Server sync (debounced)
// ---------------------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSyncPayload: StreakState | null = null;

const canSyncRemote = () => auth.get().status === 'authenticated' && !!auth.get().user;

const pushStateRemote = async (state: StreakState) => {
	if (!canSyncRemote()) return;
	try {
		await api.updateUiPreferences({ streakStateJson: JSON.stringify(state) });
	} catch {
		// best-effort; local state is source of truth
	}
};

const queueStateSync = (state: StreakState) => {
	if (typeof window === 'undefined') return;
	pendingSyncPayload = state;
	if (syncTimer) clearTimeout(syncTimer);
	syncTimer = window.setTimeout(() => {
		syncTimer = null;
		const payload = pendingSyncPayload;
		pendingSyncPayload = null;
		if (!payload) return;
		void pushStateRemote(payload);
	}, 250);
};

// ---------------------------------------------------------------------------
// localStorage persistence (per-user key, fast path to avoid IDB round-trip)
// ---------------------------------------------------------------------------

const localKey = () => {
	const s = auth.get();
	if (s.status === 'authenticated' && s.user) {
		return `tasksync:streak-state:${s.user.space_id}:${s.user.user_id}`;
	}
	return 'tasksync:streak-state:anon';
};

const readLocalState = (): StreakState | null => {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(localKey());
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StreakState>;
		return {
			count: typeof parsed.count === 'number' && parsed.count >= 0 ? Math.floor(parsed.count) : 0,
			countedTaskIds: Array.isArray(parsed.countedTaskIds)
				? parsed.countedTaskIds.filter((x): x is string => typeof x === 'string')
				: [],
			lastResetDate: typeof parsed.lastResetDate === 'string' ? parsed.lastResetDate : null
		};
	} catch {
		return null;
	}
};

const writeLocalState = (state: StreakState) => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(localKey(), JSON.stringify(state));
	} catch {
		// storage quota exceeded — ignore
	}
};

// ---------------------------------------------------------------------------
// DDR daily-reset check
// ---------------------------------------------------------------------------

/**
 * Set to true when a new calendar day is detected in daily reset mode.
 * The actual zero-out is deferred until checkMissedTasks() runs, so we can
 * decide whether to show the animated break (missed tasks present) or silently
 * reset (no missed tasks).
 */
let pendingDailyBreak = false;

/**
 * Tracks the last date on which checkMissedTasks() ran, to prevent it from
 * firing more than once per day during repeated server-sync calls.
 */
let lastMissedCheckDate: string | null = null;

const applyResetRuleIfNeeded = (state: StreakState): StreakState => {
	const prefs = uiPreferences.get();
	if (prefs.streakSettings.resetMode !== 'daily') return state;
	const today = todayIso();
	if (state.lastResetDate !== null && state.lastResetDate !== today) {
		// New day detected. Defer the actual reset so checkMissedTasks() can
		// decide whether to animate the break or silently zero out.
		pendingDailyBreak = true;
		return state; // keep count intact until checkMissedTasks() runs
	}
	return state;
};

// ---------------------------------------------------------------------------
// Announcer — probabilistic trigger
// ---------------------------------------------------------------------------

// Next count at which the announcer fires. Starts at FIRST_ANNOUNCER_AT,
// then jumps randomly 10–20 completions after each firing.
let nextAnnouncerAt = FIRST_ANNOUNCER_AT;

const randomInterval = () => 10 + Math.floor(Math.random() * 11); // 10–20

/**
 * Synchronously determine whether the announcer should fire at this count,
 * and advance the next-trigger pointer if so. Returns true when it should fire.
 */
const checkAndAdvanceAnnouncer = (count: number): boolean => {
	if (count < nextAnnouncerAt) return false;
	nextAnnouncerAt = count + randomInterval();
	return true;
};

const playAnnouncer = (theme: string) => {
	const list = announcerFileLists[theme] ?? [];
	if (!list.length) return;
	const src = list[Math.floor(Math.random() * list.length)];
	const vol = soundSettings.get().volume;
	void playUrl(src, vol);
};

// ---------------------------------------------------------------------------
// Theme manifest (replaces file probing)
// ---------------------------------------------------------------------------

interface ThemeManifest {
	streakWord: string;
	announcer: string[];
	judgment: string[];
	drop: string[];
}

const manifestCache: Record<string, ThemeManifest> = {};
const announcerFileLists: Record<string, string[]> = {};
const judgmentFileLists: Record<string, string[]> = {};
const dropFileLists: Record<string, string[]> = {};

// Writable store so the component can reactively get the streak word URL.
const streakWordUrlStore = writable<string>('');

const loadManifest = async (theme: string): Promise<ThemeManifest> => {
	if (manifestCache[theme]) return manifestCache[theme];
	try {
		const res = await fetch(`/streak/${theme}/manifest.json`);
		if (!res.ok) throw new Error('manifest not found');
		const data = await res.json() as ThemeManifest;
		manifestCache[theme] = data;
		return data;
	} catch {
		// Fallback: empty lists, best-guess streak word path
		const fallback: ThemeManifest = {
			streakWord: `/streak/${theme}/streak/streak-word.png`,
			announcer: [],
			judgment: [],
			drop: []
		};
		manifestCache[theme] = fallback;
		return fallback;
	}
};

// Track last judgment shown per theme to avoid consecutive repeats
const lastJudgmentByTheme: Record<string, string> = {};

export const getRandomJudgmentImage = (theme: string): string | null => {
	const list = judgmentFileLists[theme] ?? [];
	if (!list.length) return null;
	if (list.length === 1) return list[0];
	const last = lastJudgmentByTheme[theme];
	const candidates = last ? list.filter((url) => url !== last) : list;
	const pick = candidates[Math.floor(Math.random() * candidates.length)];
	lastJudgmentByTheme[theme] = pick;
	return pick;
};

export const streakWordUrl = { subscribe: streakWordUrlStore.subscribe };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const streak = {
	/**
	 * Call when a task is marked done. Returns true if the announcer will fire
	 * for this increment (so the caller can suppress the regular completion sound).
	 * If the task was already counted in this combo run, this is a no-op and
	 * returns false.
	 */
	increment(taskId: string): boolean {
		const prefs = uiPreferences.get();
		if (!prefs.streakSettings.enabled) return false;

		let newCount = 0;
		stateStore.update((current) => {
			if (current.countedTaskIds.includes(taskId)) return current; // already counted
			newCount = current.count + 1;
			const next: StreakState = {
				count: newCount,
				countedTaskIds: [...current.countedTaskIds, taskId],
				lastResetDate: todayIso()
			};
			writeLocalState(next);
			queueStateSync(next);
			return next;
		});

		if (newCount === 0) return false;

		displayStore.update((d) => ({
			count: newCount,
			visible: true,
			pulse: d.pulse + 1,
			breaking: false
		}));
		scheduleHide();

		const willAnnounce = soundSettings.get().enabled && checkAndAdvanceAnnouncer(newCount);
		if (willAnnounce) {
			playAnnouncer(prefs.streakSettings.theme);
		}
		return willAnnounce;
	},

	/**
	 * Call when a task is un-completed (done → pending). Removes the task from
	 * the counted set so a re-completion will count. Does NOT change the streak count.
	 */
	undoCompletion(taskId: string) {
		stateStore.update((current) => {
			const next: StreakState = {
				...current,
				countedTaskIds: current.countedTaskIds.filter((id) => id !== taskId)
			};
			writeLocalState(next);
			queueStateSync(next);
			return next;
		});
	},

	/**
	 * Break the streak (punt, cancel, delete). Resets count to 0 and plays the
	 * break animation if the count was > 0.
	 */
	break() {
		const current = get(stateStore);
		const hadCount = current.count > 0;
		const next: StreakState = { count: 0, countedTaskIds: [], lastResetDate: todayIso() };
		stateStore.set(next);
		writeLocalState(next);
		queueStateSync(next);
		nextAnnouncerAt = FIRST_ANNOUNCER_AT;

		if (hadCount) {
			// Play a random combo-drop sound if any are loaded for this theme
			if (soundSettings.get().enabled) {
				const theme = uiPreferences.get().streakSettings.theme;
				const drops = dropFileLists[theme] ?? [];
				if (drops.length) {
					void playUrl(drops[Math.floor(Math.random() * drops.length)], soundSettings.get().volume);
				}
			}
			if (fadeTimer) {
				clearTimeout(fadeTimer);
				fadeTimer = null;
			}
			displayStore.update((d) => ({ ...d, count: 0, visible: true, breaking: true }));
			// Auto-hide after break animation
			if (typeof window !== 'undefined') {
				window.setTimeout(() => {
					displayStore.update((d) => ({ ...d, visible: false, breaking: false }));
				}, 400);
			}
		}
	},

	/** Reset manually (from settings). Equivalent to break but without animation. */
	reset() {
		const next: StreakState = { count: 0, countedTaskIds: [], lastResetDate: todayIso() };
		stateStore.set(next);
		writeLocalState(next);
		queueStateSync(next);
		nextAnnouncerAt = FIRST_ANNOUNCER_AT;
		pendingDailyBreak = false;
		lastMissedCheckDate = null;
		displayStore.update((d) => ({ ...d, count: 0, visible: false, breaking: false }));
	},

	/**
	 * Call after tasks are loaded (local DB or server sync) to break the combo
	 * when past-due tasks are visible — the DDR equivalent of a MISS judgment.
	 *
	 * - In daily reset mode: deferred zeroing from applyResetRuleIfNeeded runs
	 *   here; shows the animated break if there are missed tasks, silently zeros
	 *   otherwise.
	 * - In endless mode: breaks with animation whenever missed tasks exist and
	 *   the combo count is > 0.
	 *
	 * Safe to call multiple times per session; only acts once per calendar day.
	 */
	checkMissedTasks(missedCount: number) {
		const today = todayIso();
		// Skip if we've already acted today and there's no pending daily break.
		if (!pendingDailyBreak && lastMissedCheckDate === today) return;

		const current = get(stateStore);
		const hasMissed = missedCount > 0;

		if (pendingDailyBreak) {
			pendingDailyBreak = false;
			lastMissedCheckDate = today;
			if (hasMissed && current.count > 0) {
				// New day + missed tasks → animated break
				streak.break();
			} else {
				// New day, no missed tasks → silent reset (same as previous behavior)
				const next: StreakState = { count: 0, countedTaskIds: [], lastResetDate: today };
				stateStore.set(next);
				writeLocalState(next);
				queueStateSync(next);
				nextAnnouncerAt = FIRST_ANNOUNCER_AT;
				displayStore.update((d) => ({ ...d, count: 0, visible: false, breaking: false }));
			}
			return;
		}

		// Endless mode (or same-day check): break if there are missed tasks and
		// the combo count is still live.
		lastMissedCheckDate = today;
		if (hasMissed && current.count > 0) {
			streak.break();
		}
	},

	/** Return the current count for display in settings. */
	getCount(): number {
		return get(stateStore).count;
	},

	/**
	 * Hydrate from local storage (fast, synchronous). Called on app boot before
	 * the server response arrives.
	 */
	hydrateFromLocal() {
		const local = readLocalState();
		if (!local) return;
		const checked = applyResetRuleIfNeeded(local);
		stateStore.set(checked);
		if (checked.count !== local.count) {
			// Reset fired — persist updated state
			writeLocalState(checked);
			queueStateSync(checked);
		}
		// Position the next announcer trigger past the already-achieved count
		// so we don't fire immediately on load.
		if (checked.count > 0) {
			nextAnnouncerAt = checked.count + randomInterval();
		} else {
			nextAnnouncerAt = FIRST_ANNOUNCER_AT;
		}
	},

	/**
	 * Hydrate from server response. Called after preferences are fetched.
	 * Server value wins if it differs from local (cross-device sync).
	 */
	hydrateFromServer(streakStateJson: string | undefined | null) {
		if (!streakStateJson) return;
		try {
			const parsed = JSON.parse(streakStateJson) as Partial<StreakState>;
			const remote: StreakState = {
				count: typeof parsed.count === 'number' && parsed.count >= 0 ? Math.floor(parsed.count) : 0,
				countedTaskIds: Array.isArray(parsed.countedTaskIds)
					? parsed.countedTaskIds.filter((x): x is string => typeof x === 'string')
					: [],
				lastResetDate: typeof parsed.lastResetDate === 'string' ? parsed.lastResetDate : null
			};
			const checked = applyResetRuleIfNeeded(remote);
			stateStore.set(checked);
			writeLocalState(checked);
			if (checked.count > 0) {
				nextAnnouncerAt = checked.count + randomInterval();
			} else {
				nextAnnouncerAt = FIRST_ANNOUNCER_AT;
			}
		} catch {
			// malformed — keep local state
		}
	},

	/**
	 * Load theme assets from the manifest. Called when streak is enabled or
	 * theme changes. Non-blocking. Subsequent calls for the same theme are no-ops.
	 */
	async loadThemeAssets(theme: string) {
		const manifest = await loadManifest(theme);
		// Encode spaces in paths so fetch() doesn't receive bare spaces in URLs.
		const encodeSpaces = (url: string) => url.replace(/ /g, '%20');
		announcerFileLists[theme] = manifest.announcer.map(encodeSpaces);
		judgmentFileLists[theme] = manifest.judgment.map(encodeSpaces);
		dropFileLists[theme] = (manifest.drop ?? []).map(encodeSpaces);
		streakWordUrlStore.set(encodeSpaces(manifest.streakWord));
	}
};

// Re-export state for reactivity (read-only count)
export const streakState = { subscribe: stateStore.subscribe };
