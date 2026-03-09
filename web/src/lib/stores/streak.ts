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

const ANNOUNCER_MILESTONES = [5, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300];

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

const applyResetRuleIfNeeded = (state: StreakState): StreakState => {
	const prefs = uiPreferences.get();
	if (prefs.streakSettings.resetMode !== 'daily') return state;
	const today = todayIso();
	if (state.lastResetDate !== null && state.lastResetDate !== today) {
		return { count: 0, countedTaskIds: [], lastResetDate: today };
	}
	return state;
};

// ---------------------------------------------------------------------------
// Announcer
// ---------------------------------------------------------------------------

let lastAnnouncedMilestone = -1;

const maybePlayAnnouncer = async (newCount: number) => {
	const prefs = uiPreferences.get();
	if (!prefs.streakSettings.enabled) return;
	const theme = prefs.streakSettings.theme;

	// Find if we just crossed a milestone
	const crossed = ANNOUNCER_MILESTONES.filter(
		(m) => newCount >= m && m > lastAnnouncedMilestone
	);
	if (!crossed.length) return;
	lastAnnouncedMilestone = crossed[crossed.length - 1];

	// Pick a random announcer file from /streak/{theme}/announcer/
	// We don't know how many files exist at runtime; we rely on a manifest or try numbered files.
	// Strategy: attempt up to MAX_ANNOUNCER_FILES numbered files; the caller pre-loads the count.
	// For simplicity, we use the preloaded list if available, otherwise derive from theme manifest.
	const list = announcerFileLists[theme] ?? [];
	if (!list.length) return;
	const src = list[Math.floor(Math.random() * list.length)];
	const vol = soundSettings.get().volume;
	// Only play if sound is enabled globally
	if (soundSettings.get().enabled) {
		void playUrl(src, vol);
	}
};

// ---------------------------------------------------------------------------
// Theme manifest (replaces file probing)
// ---------------------------------------------------------------------------

interface ThemeManifest {
	streakWord: string;
	announcer: string[];
	judgment: string[];
}

const manifestCache: Record<string, ThemeManifest> = {};
const announcerFileLists: Record<string, string[]> = {};
const judgmentFileLists: Record<string, string[]> = {};

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
			judgment: []
		};
		manifestCache[theme] = fallback;
		return fallback;
	}
};

export const getRandomJudgmentImage = (theme: string): string | null => {
	const list = judgmentFileLists[theme] ?? [];
	if (!list.length) return null;
	return list[Math.floor(Math.random() * list.length)];
};

export const streakWordUrl = { subscribe: streakWordUrlStore.subscribe };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const streak = {
	/**
	 * Call when a task is marked done. If the task was already counted in this
	 * combo run, the call is a no-op (prevents double-counting).
	 */
	increment(taskId: string) {
		const prefs = uiPreferences.get();
		if (!prefs.streakSettings.enabled) return;

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

		if (newCount > 0) {
			displayStore.update((d) => ({
				count: newCount,
				visible: true,
				pulse: d.pulse + 1,
				breaking: false
			}));
			scheduleHide();
			void maybePlayAnnouncer(newCount);
		}
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
		lastAnnouncedMilestone = -1;

		if (hadCount) {
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
		lastAnnouncedMilestone = -1;
		displayStore.update((d) => ({ ...d, count: 0, visible: false, breaking: false }));
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
		lastAnnouncedMilestone = checked.count > 0
			? (ANNOUNCER_MILESTONES.filter((m) => m <= checked.count).pop() ?? -1)
			: -1;
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
			lastAnnouncedMilestone = checked.count > 0
				? (ANNOUNCER_MILESTONES.filter((m) => m <= checked.count).pop() ?? -1)
				: -1;
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
		announcerFileLists[theme] = manifest.announcer;
		judgmentFileLists[theme] = manifest.judgment;
		streakWordUrlStore.set(manifest.streakWord);
	}
};

// Re-export state for reactivity (read-only count)
export const streakState = { subscribe: stateStore.subscribe };
