import { get, writable } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { uiPreferences } from '$lib/stores/preferences';
import { playUrl } from '$lib/sound/sound';
import { soundSettings } from '$lib/stores/settings';
import { streakQueue } from '$lib/data/streakQueue';
import { streakDrain, setReconciler, setHydrator } from '$lib/sync/streakDrain';
import * as streakOps from '$lib/service/streakOps';
import type { StreakState } from '$shared/types/settings';
import type { StreakOpResponse } from '$shared/types/streak';

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
	/** judgment image URL for the current event; null = no image */
	judgmentSrc: string | null;
	/** true = the day-complete celebration is active */
	isDayComplete: boolean;
	/** true = the combo-dropped celebration is active */
	isComboDropped: boolean;
}

const defaultState = (): StreakState => ({
	count: 0,
	countedTaskIds: [],
	lastResetDate: null,
	dayCompleteDate: null,
});

const stateStore = writable<StreakState>(defaultState());
const displayStore = writable<StreakDisplayState>({
	count: 0,
	visible: false,
	pulse: 0,
	breaking: false,
	judgmentSrc: null,
	isDayComplete: false,
	isComboDropped: false,
});

export const streakDisplay = { subscribe: displayStore.subscribe };

// ---------------------------------------------------------------------------
// Fade-out timer
// ---------------------------------------------------------------------------

let fadeTimer: ReturnType<typeof setTimeout> | null = null;
const DISPLAY_TIMEOUT_MS = 3000;

const scheduleHide = () => {
	if (fadeTimer) clearTimeout(fadeTimer);
	fadeTimer =
		typeof window !== 'undefined'
			? setTimeout(() => {
					fadeTimer = null;
					displayStore.update((d) => ({
						...d,
						visible: false,
						breaking: false,
						isDayComplete: false,
						isComboDropped: false,
					}));
				}, DISPLAY_TIMEOUT_MS)
			: null;
};

// ---------------------------------------------------------------------------
// localStorage persistence — streak state lives in the shared preferences blob
// ---------------------------------------------------------------------------

// Mirrors the key formula in preferences.ts storageKey()
const prefsKey = () => {
	const s = auth.get();
	if (s.status === 'authenticated' && s.user) {
		return `tasksync:ui-preferences:${s.user.space_id}:${s.user.user_id}`;
	}
	return 'tasksync:ui-preferences:anon';
};

// Old separate streak key — used only for one-time migration reads
const oldStreakKey = () => {
	const s = auth.get();
	if (s.status === 'authenticated' && s.user) {
		return `tasksync:streak-state:${s.user.space_id}:${s.user.user_id}`;
	}
	return 'tasksync:streak-state:anon';
};

const parseRawStreakState = (raw: Partial<StreakState>): StreakState => ({
	count: typeof raw.count === 'number' && raw.count >= 0 ? Math.floor(raw.count) : 0,
	countedTaskIds: Array.isArray(raw.countedTaskIds)
		? raw.countedTaskIds.filter((x): x is string => typeof x === 'string')
		: [],
	lastResetDate: typeof raw.lastResetDate === 'string' ? raw.lastResetDate : null,
	dayCompleteDate: typeof raw.dayCompleteDate === 'string' ? raw.dayCompleteDate : null,
});

const readStreakStateFromPrefsBlob = (): { state: StreakState; revision: number } | null => {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(prefsKey());
		if (raw) {
			const blob = JSON.parse(raw) as Record<string, unknown>;
			if (blob && typeof blob.streakState === 'object' && blob.streakState !== null) {
				const state = parseRawStreakState(blob.streakState as Partial<StreakState>);
				const revision =
					typeof blob.streakRevision === 'number' &&
					Number.isInteger(blob.streakRevision) &&
					blob.streakRevision >= 0
						? blob.streakRevision
						: 0;
				return { state, revision };
			}
		}
		// Migration fallback: read old separate keys and remove them
		const oldKey = oldStreakKey();
		const oldDayCompleteKey = `${oldKey}:day-complete-date`;
		const oldRaw = localStorage.getItem(oldKey);
		const oldDayCompleteRaw = localStorage.getItem(oldDayCompleteKey);
		localStorage.removeItem(oldKey);
		localStorage.removeItem(oldDayCompleteKey);
		if (!oldRaw) return null;
		const oldParsed = JSON.parse(oldRaw) as Partial<StreakState>;
		const state = {
			...parseRawStreakState(oldParsed),
			dayCompleteDate:
				typeof oldDayCompleteRaw === 'string' && oldDayCompleteRaw.length > 0
					? oldDayCompleteRaw
					: null,
		};
		return { state, revision: 0 };
	} catch (err) {
		console.warn('[streak] failed to read legacy streakState from localStorage', err);
		return null;
	}
};

// Module-level monotonic revision cursor. Persisted alongside streak state so
// the client can ignore stale server responses after a page reload.
let lastSeenRevision = 0;

const writeStreakStateToPrefsBlob = (state: StreakState) => {
	if (typeof localStorage === 'undefined') return;
	try {
		const key = prefsKey();
		const existing = localStorage.getItem(key);
		let blob: Record<string, unknown> = {};
		if (existing) {
			try {
				blob = JSON.parse(existing) as Record<string, unknown>;
			} catch {
				/* start fresh */
			}
		}
		blob.streakState = state;
		blob.streakRevision = lastSeenRevision;
		localStorage.setItem(key, JSON.stringify(blob));
	} catch (err) {
		console.warn('[streak] failed to write streakState to localStorage (quota exceeded?)', err);
	}
};

// ---------------------------------------------------------------------------
// Day-complete — once-per-day tracking (reads/writes stateStore in memory)
// ---------------------------------------------------------------------------

const hasFiredDayCompleteToday = (): boolean => get(stateStore).dayCompleteDate === todayIso();

const markDayCompleteFired = (): void => {
	stateStore.update((current) => {
		const next: StreakState = { ...current, dayCompleteDate: todayIso() };
		writeStreakStateToPrefsBlob(next);
		return next;
	});
};

// ---------------------------------------------------------------------------
// DDR daily-reset check
// ---------------------------------------------------------------------------

/**
 * Set to true when a new calendar day is detected in daily reset mode.
 * The actual zero-out is deferred until checkMissedTasksAndApplyDailyReset() runs, so we can
 * decide whether to show the animated break (missed tasks present) or silently
 * reset (no missed tasks).
 */
let deferredDailyReset = false;

/**
 * Tracks the last date on which checkMissedTasksAndApplyDailyReset() ran, to prevent it from
 * firing more than once per day during repeated server-sync calls.
 */
let lastMissedCheckDate: string | null = null;

const applyResetRuleIfNeeded = (state: StreakState): StreakState => {
	const today = todayIso();
	const prefs = uiPreferences.get();
	if (prefs.streakSettings.resetMode !== 'daily') return state;
	if (state.lastResetDate !== null && state.lastResetDate !== today) {
		// New day detected. Defer the actual reset so checkMissedTasksAndApplyDailyReset() can
		// decide whether to animate the break or silently zero out.
		deferredDailyReset = true;
		return state; // keep count intact until checkMissedTasksAndApplyDailyReset() runs
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
	streakWord: string | null;
	/** Sub-folder name for digit images (0–9). Defaults to "digits" if absent. */
	digitsPath?: string;
	announcer: string[];
	judgment: string[];
	drop: string[];
	/** Optional images shown when a combo is dropped. If absent or empty, no image is shown on break. */
	missed?: string[];
	/** Optional sounds for the day-complete celebration (final My Day task). */
	dayCompleteSound?: string[];
	/** Optional images for the day-complete celebration (final My Day task). */
	dayCompleteImages?: string[];
}

const manifestCache: Record<string, ThemeManifest> = {};
const announcerFileLists: Record<string, string[]> = {};
const judgmentFileLists: Record<string, string[]> = {};
const dropFileLists: Record<string, string[]> = {};
const missedFileLists: Record<string, string[]> = {};
const dayCompleteSoundLists: Record<string, string[]> = {};
const dayCompleteImageLists: Record<string, string[]> = {};

// Writable stores so the component can reactively get theme-specific paths.
const streakWordUrlStore = writable<string>('');
// Per-theme record so each theme's digits folder is independent and never
// clobbered by a concurrent loadThemeAssets call for a different theme.
const digitsPathStore = writable<Record<string, string>>({});

const loadManifest = async (theme: string): Promise<ThemeManifest> => {
	if (manifestCache[theme]) return manifestCache[theme];
	try {
		const res = await fetch(`/streak/${theme}/manifest.json`, { cache: 'no-store' });
		if (!res.ok) throw new Error('manifest not found');
		const data = (await res.json()) as ThemeManifest;
		manifestCache[theme] = data;
		return data;
	} catch (err) {
		console.warn(`[streak] failed to fetch theme manifest for "${theme}", using fallback`, err);
		// Fallback: empty lists, best-guess streak word path
		const fallback: ThemeManifest = {
			streakWord: `/streak/${theme}/streak/streak-word.png`,
			announcer: [],
			judgment: [],
			drop: [],
		};
		manifestCache[theme] = fallback;
		return fallback;
	}
};

// Track last image shown per theme to avoid consecutive repeats
const lastJudgmentByTheme: Record<string, string> = {};
const lastMissedByTheme: Record<string, string> = {};

const pickWithoutRepeat = (list: string[], lastPick: string | undefined): string | null => {
	if (!list.length) return null;
	if (list.length === 1) return list[0];
	const candidates = lastPick ? list.filter((url) => url !== lastPick) : list;
	return candidates[Math.floor(Math.random() * candidates.length)];
};

export const getRandomJudgmentImage = (theme: string): string | null => {
	const pick = pickWithoutRepeat(judgmentFileLists[theme] ?? [], lastJudgmentByTheme[theme]);
	if (pick) lastJudgmentByTheme[theme] = pick;
	return pick;
};

export const getRandomMissedImage = (theme: string): string | null => {
	const pick = pickWithoutRepeat(missedFileLists[theme] ?? [], lastMissedByTheme[theme]);
	if (pick) lastMissedByTheme[theme] = pick;
	return pick;
};

export const streakWordUrl = { subscribe: streakWordUrlStore.subscribe };
/** Per-theme map of digits folder names. Look up by current theme; default to "digits". */
export const streakDigitsPaths = { subscribe: digitsPathStore.subscribe };

// ---------------------------------------------------------------------------
// Server-canonical reconciler — silent swap (no animation, no sound)
// ---------------------------------------------------------------------------

const applyServerCanonical = (canonical: StreakOpResponse): void => {
	// Wire-format validation per project standard
	if (!Number.isInteger(canonical.revision) || canonical.revision < 0) {
		console.warn('[streak] dropping canonical with invalid revision', canonical);
		return;
	}
	if (!Number.isInteger(canonical.count) || canonical.count < 0) {
		console.warn('[streak] dropping canonical with invalid count', canonical);
		return;
	}
	// Validate date strings: null is OK, otherwise must look like YYYY-MM-DD
	const isIsoDateOrNull = (v: unknown): v is string | null =>
		v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
	if (!isIsoDateOrNull(canonical.lastResetDate)) {
		console.warn('[streak] dropping canonical with invalid lastResetDate', canonical);
		return;
	}
	if (!isIsoDateOrNull(canonical.dayCompleteDate)) {
		console.warn('[streak] dropping canonical with invalid dayCompleteDate', canonical);
		return;
	}

	// Revision gate: ignore stale or equal revisions silently
	if (canonical.revision <= lastSeenRevision) return;
	lastSeenRevision = canonical.revision;

	stateStore.update((current) => {
		const next: StreakState = {
			count: canonical.count,
			countedTaskIds: current.countedTaskIds, // local short-circuit set is owned by client
			lastResetDate: canonical.lastResetDate,
			dayCompleteDate: canonical.dayCompleteDate,
		};
		writeStreakStateToPrefsBlob(next); // also persists lastSeenRevision
		return next;
	});

	// Reposition next-announcer threshold so we do not re-fire on a swap
	if (canonical.count > 0) {
		nextAnnouncerAt = canonical.count + randomInterval();
	} else {
		nextAnnouncerAt = FIRST_ANNOUNCER_AT;
	}

	// Per design: silent swap. Do NOT touch displayStore.pulse / visible /
	// judgmentSrc / breaking / isDayComplete / isComboDropped. The component
	// re-renders the count number from $streakState reactively; the overlay
	// (if visible) fades on its own timer.
};

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
		const now = Date.now();
		const dateIso = todayIso();
		const prefs = uiPreferences.get();
		if (!prefs.streakSettings.enabled) return false;

		let newCount = 0;
		let alreadyCounted = false;
		stateStore.update((current) => {
			if (current.countedTaskIds.includes(taskId)) {
				alreadyCounted = true;
				return current; // already counted
			}
			newCount = current.count + 1;
			const next: StreakState = {
				...current,
				count: newCount,
				countedTaskIds: [...current.countedTaskIds, taskId],
				lastResetDate: dateIso,
			};
			writeStreakStateToPrefsBlob(next);
			return next;
		});

		// Special case 1: already counted — no enqueue, no drain, no display
		if (alreadyCounted) return false;
		if (newCount === 0) return false;

		// Pick a fresh judgment image on every completion (not just when overlay first appears)
		const judgmentSrc = getRandomJudgmentImage(prefs.streakSettings.theme);
		displayStore.update((d) => ({
			count: newCount,
			visible: true,
			pulse: d.pulse + 1,
			breaking: false,
			judgmentSrc,
			isDayComplete: false,
			isComboDropped: false,
		}));
		scheduleHide();

		const willAnnounce = soundSettings.get().enabled && checkAndAdvanceAnnouncer(newCount);
		if (willAnnounce) {
			playAnnouncer(prefs.streakSettings.theme);
		}

		const op = streakOps.buildIncrementOp(taskId, dateIso, now);
		void streakQueue
			.enqueue(op)
			.catch((err) => console.error('[streak] enqueue failed', op.opKey, err));
		void streakDrain.drain().catch((err) => console.error('[streak] drain failed', err));

		return willAnnounce;
	},

	/**
	 * Call when a task is un-completed (done → pending). Removes the task from
	 * the counted set so a re-completion will count. Does NOT change the streak count.
	 *
	 * No op is enqueued: there is no "undo" op type on the server. The next
	 * streak.increment(taskId) call will enqueue an op with the same opKey
	 * (inc:<taskId>:<date>); server-side dedup will then correctly handle whether
	 * the task was already counted for today.
	 */
	undoCompletion(taskId: string) {
		stateStore.update((current) => {
			const next: StreakState = {
				...current,
				countedTaskIds: current.countedTaskIds.filter((id) => id !== taskId),
			};
			writeStreakStateToPrefsBlob(next);
			return next;
		});
	},

	/**
	 * Break the streak (punt, cancel, delete, skip, missed tasks). Resets count
	 * to 0. If the count was > 0, shows the break graphic for DISPLAY_TIMEOUT_MS
	 * (same duration as a normal combo increment). Shows a random image from the
	 * theme's missed/ folder if available; no image if that folder is empty.
	 */
	break() {
		const now = Date.now();
		const current = get(stateStore);
		const hadCount = current.count > 0;
		// Preserve dayCompleteDate — a combo break does not reset the day-complete guard
		const next: StreakState = {
			count: 0,
			countedTaskIds: [],
			lastResetDate: todayIso(),
			dayCompleteDate: current.dayCompleteDate ?? null,
		};
		stateStore.set(next);
		writeStreakStateToPrefsBlob(next);
		nextAnnouncerAt = FIRST_ANNOUNCER_AT;

		if (hadCount) {
			const theme = uiPreferences.get().streakSettings.theme;

			// Play a random combo-drop sound
			if (soundSettings.get().enabled) {
				const drops = dropFileLists[theme] ?? [];
				if (drops.length) {
					void playUrl(drops[Math.floor(Math.random() * drops.length)], soundSettings.get().volume);
				}
			}

			// Show break overlay. Keep the pre-break count visible so the combo number
			// stays on screen with the break animation (DDR style: count freezes, then clears).
			// This also ensures something is visible even when no missed image is configured.
			const judgmentSrc = getRandomMissedImage(theme);
			displayStore.update((d) => ({
				...d,
				count: current.count,
				visible: true,
				breaking: true,
				isDayComplete: false,
				isComboDropped: true,
				judgmentSrc,
			}));

			// Remove the red CSS class after a short flash, but keep the overlay visible.
			if (typeof window !== 'undefined') {
				window.setTimeout(() => {
					displayStore.update((d) => ({ ...d, breaking: false }));
				}, 400);
			}

			// Hide after the same duration as a normal combo increment.
			scheduleHide();
		}

		// TODO(streak-cause): pass the actual break cause from each caller instead of 'manual'
		const op = streakOps.buildBreakOp('manual', now);
		void streakQueue
			.enqueue(op)
			.catch((err) => console.error('[streak] enqueue failed', op.opKey, err));
		void streakDrain.drain().catch((err) => console.error('[streak] drain failed', err));
	},

	/** Reset manually (from settings). Equivalent to break but without animation. */
	reset() {
		const now = Date.now();
		const next: StreakState = {
			count: 0,
			countedTaskIds: [],
			lastResetDate: todayIso(),
			dayCompleteDate: null,
		};
		stateStore.set(next);
		writeStreakStateToPrefsBlob(next);
		nextAnnouncerAt = FIRST_ANNOUNCER_AT;
		deferredDailyReset = false;
		lastMissedCheckDate = null;
		displayStore.update((d) => ({
			...d,
			count: 0,
			visible: false,
			breaking: false,
			isDayComplete: false,
			isComboDropped: false,
			judgmentSrc: null,
		}));

		const op = streakOps.buildResetOp(now);
		void streakQueue
			.enqueue(op)
			.catch((err) => console.error('[streak] enqueue failed', op.opKey, err));
		void streakDrain.drain().catch((err) => console.error('[streak] drain failed', err));
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
	checkMissedTasksAndApplyDailyReset(missedCount: number) {
		const today = todayIso();
		// Skip if we've already acted today and there's no pending daily break.
		if (!deferredDailyReset && lastMissedCheckDate === today) return;

		const current = get(stateStore);
		const hasMissed = missedCount > 0;

		if (deferredDailyReset) {
			deferredDailyReset = false;
			lastMissedCheckDate = today;
			if (hasMissed && current.count > 0) {
				// New day + missed tasks → animated break (streak.break() enqueues a break op)
				streak.break();
			} else {
				// New day, no missed tasks → silent local state-cleanup; preserve dayCompleteDate guard.
				// Do NOT enqueue a reset op: the server's daily reset is its own decision based on
				// last_reset_date being older than today. The next inc:<taskId>:<today> op will arrive,
				// the server will apply its own reset rule, and the canonical state will flow back via
				// applyServerCanonical on the next drain.
				const next: StreakState = {
					count: 0,
					countedTaskIds: [],
					lastResetDate: today,
					dayCompleteDate: current.dayCompleteDate ?? null,
				};
				stateStore.set(next);
				writeStreakStateToPrefsBlob(next);
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
		const local = readStreakStateFromPrefsBlob();
		if (!local) return;

		// Restore the persisted revision so we can correctly gate subsequent server responses
		if (local.revision > lastSeenRevision) {
			lastSeenRevision = local.revision;
		}

		const checked = applyResetRuleIfNeeded(local.state);
		stateStore.set(checked);
		if (checked.count !== local.state.count) {
			// Reset fired — persist updated state (lastSeenRevision unchanged)
			writeStreakStateToPrefsBlob(checked);
			// Do NOT enqueue a reset op: the local hydrate is read-only from the server's
			// perspective. The server's own daily reset rule fires on the next inc op.
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
	 * Funnels through applyServerCanonical for revision-gated silent swap.
	 * Server value wins if the revision is strictly higher than lastSeenRevision.
	 */
	hydrateFromServer(streakStateJson: string | undefined | null, streakRevision?: number) {
		if (!streakStateJson) {
			if (streakRevision !== undefined && streakRevision > 0) {
				console.warn('[streak] server sent a revision but no streakStateJson', streakRevision);
			}
			return;
		}
		try {
			const parsed = JSON.parse(streakStateJson) as Partial<StreakState>;
			const remote: StreakState = parseRawStreakState(parsed);
			// Run the daily-reset deferral check before handing to the reconciler
			const checked = applyResetRuleIfNeeded(remote);
			// Synthesize a StreakOpResponse-shaped object so that applyServerCanonical
			// handles all revision-gating and wire-format validation in one place.
			const canonical: StreakOpResponse = {
				revision: streakRevision ?? 0,
				count: checked.count,
				lastResetDate: checked.lastResetDate ?? new Date().toISOString().slice(0, 10),
				dayCompleteDate: checked.dayCompleteDate ?? null,
				appliedThisCall: true,
				dayCompleteFiredThisCall: false,
			};
			applyServerCanonical(canonical);
		} catch (err) {
			console.warn('[streak] malformed streakStateJson from server, keeping local state', err);
		}
	},

	/**
	 * Fire the day-complete celebration: plays a special sound and shows a
	 * special image. Only fires once per calendar day. Returns true if it fired
	 * (caller can use this to suppress the regular completion sound).
	 *
	 * Safe to call when streak is disabled — will return false immediately.
	 */
	triggerDayComplete(): boolean {
		const now = Date.now();
		const dateIso = todayIso();
		const prefs = uiPreferences.get();
		if (!prefs.streakSettings.enabled) return false;
		if (hasFiredDayCompleteToday()) return false;

		markDayCompleteFired();

		const theme = prefs.streakSettings.theme;
		const images = dayCompleteImageLists[theme] ?? [];
		const sounds = dayCompleteSoundLists[theme] ?? [];

		const imageSrc = images.length ? images[Math.floor(Math.random() * images.length)] : null;

		// Override the current display with the day-complete state.
		displayStore.update((d) => ({
			...d,
			visible: true,
			isDayComplete: true,
			// Use day-complete image if available; keep the existing judgment image otherwise
			// so a normal combo image is still shown when no day-complete imagery is configured.
			judgmentSrc: imageSrc ?? d.judgmentSrc,
		}));
		scheduleHide();

		if (soundSettings.get().enabled && sounds.length) {
			void playUrl(sounds[Math.floor(Math.random() * sounds.length)], soundSettings.get().volume);
		}

		const op = streakOps.buildDayCompleteOp(dateIso, now);
		void streakQueue
			.enqueue(op)
			.catch((err) => console.error('[streak] enqueue failed', op.opKey, err));
		void streakDrain.drain().catch((err) => console.error('[streak] drain failed', err));

		return true;
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
		missedFileLists[theme] = (manifest.missed ?? []).map(encodeSpaces);
		dayCompleteSoundLists[theme] = (manifest.dayCompleteSound ?? []).map(encodeSpaces);
		dayCompleteImageLists[theme] = (manifest.dayCompleteImages ?? []).map(encodeSpaces);
		const wordUrl = manifest.streakWord ? encodeSpaces(manifest.streakWord) : '';
		streakWordUrlStore.set(wordUrl);
		const dp = manifest.digitsPath ?? 'digits';
		digitsPathStore.update((rec) => ({ ...rec, [theme]: dp }));

		// Preload images into browser cache so the first streak renders instantly.
		const preload = (src: string) => {
			new Image().src = src;
		};
		for (let d = 0; d <= 9; d++) preload(`/streak/${theme}/${encodeSpaces(dp)}/${d}.png`);
		if (wordUrl) preload(wordUrl);
		for (const src of judgmentFileLists[theme]) preload(src);
		for (const src of (manifest.missed ?? []).map(encodeSpaces)) preload(src);
		for (const src of (manifest.dayCompleteImages ?? []).map(encodeSpaces)) preload(src);
	},
};

// Re-export state for reactivity (read-only count)
export const streakState = { subscribe: stateStore.subscribe };

// ---------------------------------------------------------------------------
// Module-init: wire reconciler + hydrator into streakDrain
// ---------------------------------------------------------------------------

setReconciler(applyServerCanonical);
setHydrator(async () => {
	const wire = await uiPreferences.hydrateFromServer();
	if (wire) streak.hydrateFromServer(wire.streakStateJson, wire.streakRevision);
});
