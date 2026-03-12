import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { createHydrateGuard } from '$lib/stores/hydrateGuard';
import type {
	ListSortDirection,
	ListSortMode,
	ListSortPreference,
	SidebarPanelState,
	StreakResetMode,
	StreakSettings,
	StreakTheme,
	UiFont,
	UiPreferences,
	UiPreferencesWire,
	UiTheme
} from '$shared/types/settings';

export const DEFAULT_COMPLETION_QUOTES: string[] = [
	"You're clear.",
	'Nothing left.',
	'Clean slate.',
];

const defaultPanels = (): SidebarPanelState => ({
	lists: false,
	members: false,
	sound: false,
	backups: false,
	account: true
});

const defaultListSort = (): ListSortPreference => ({
	mode: 'created',
	direction: 'asc'
});

const validFonts: UiFont[] = [
	'sora', 'sono', 'inter', 'inter-tight', 'jetbrains-mono',
	'atkinson-hyperlegible', 'atkinson-hyperlegible-next',
	'ibm-plex-sans', 'ibm-plex-mono', 'ibm-plex-serif',
	'roboto', 'roboto-slab', 'roboto-mono',
	'dm-mono', 'comfortaa', 'poppins', 'victor-mono',
	'pt-sans', 'pt-serif', 'pt-mono',
	'georgia', 'sf-pro', 'system'
];

const defaultPreferences = (): UiPreferences => ({
	theme: 'default',
	font: 'sora',
	completionQuotes: [],
	sidebarPanels: defaultPanels(),
	listSort: defaultListSort(),
	streakSettings: defaultStreakSettings()
});

const validThemes: UiTheme[] = [
	'default',
	'dark',
	'light',
	'shades-of-coffee',
	'miami-beach',
	'simple-dark',
	'matrix',
	'black-gold',
	'okabe-ito',
	'theme-from-1970',
	'shades-of-gray-light',
	'catppuccin-latte',
	'catppuccin-frappe',
	'catppuccin-macchiato',
	'catppuccin-mocha',
	'you-need-a-dark-mode',
	'butterfly'
];

const normalizeTheme = (theme?: string): UiTheme =>
	validThemes.includes(theme as UiTheme) ? (theme as UiTheme) : 'default';
const normalizeFont = (font?: string): UiFont =>
	validFonts.includes(font as UiFont) ? (font as UiFont) : 'sora';
const normalizeCompletionQuotes = (raw?: string[]): string[] =>
	Array.isArray(raw) ? raw.filter((q): q is string => typeof q === 'string') : [];
const normalizeListSortMode = (mode?: string): ListSortMode =>
	mode === 'alpha' || mode === 'due_date' || mode === 'created' ? mode : 'created';
const normalizeListSortDirection = (direction?: string): ListSortDirection =>
	direction === 'desc' || direction === 'asc' ? direction : 'asc';

const normalizePanels = (candidate?: Partial<SidebarPanelState>): SidebarPanelState => {
	const defaults = defaultPanels();
	return {
		lists: typeof candidate?.lists === 'boolean' ? candidate.lists : defaults.lists,
		members: typeof candidate?.members === 'boolean' ? candidate.members : defaults.members,
		sound: typeof candidate?.sound === 'boolean' ? candidate.sound : defaults.sound,
		backups: typeof candidate?.backups === 'boolean' ? candidate.backups : defaults.backups,
		account: typeof candidate?.account === 'boolean' ? candidate.account : defaults.account
	};
};

const normalizeListSort = (candidate?: Partial<ListSortPreference>): ListSortPreference => ({
	mode: normalizeListSortMode(candidate?.mode),
	direction: normalizeListSortDirection(candidate?.direction)
});

const validStreakThemes: StreakTheme[] = ['ddr', 'thps'];
const validStreakResetModes: StreakResetMode[] = ['daily', 'endless'];

const defaultStreakSettings = (): StreakSettings => ({
	enabled: false,
	theme: 'ddr',
	resetMode: 'daily'
});

const normalizeStreakTheme = (theme?: string): StreakTheme =>
	validStreakThemes.includes(theme as StreakTheme) ? (theme as StreakTheme) : 'ddr';
const normalizeStreakResetMode = (mode?: string): StreakResetMode =>
	validStreakResetModes.includes(mode as StreakResetMode) ? (mode as StreakResetMode) : 'daily';

const normalizeStreakSettings = (candidate?: Partial<StreakSettings>): StreakSettings => ({
	enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : false,
	theme: normalizeStreakTheme(candidate?.theme as string | undefined),
	resetMode: normalizeStreakResetMode(candidate?.resetMode as string | undefined)
});

const parseStreakSettingsJson = (raw?: string): StreakSettings => {
	if (!raw) return defaultStreakSettings();
	try {
		const parsed = JSON.parse(raw) as Partial<StreakSettings>;
		return normalizeStreakSettings(parsed);
	} catch {
		return defaultStreakSettings();
	}
};

const parsePanelsJson = (raw?: string): SidebarPanelState => {
	if (!raw) return defaultPanels();
	try {
		const parsed = JSON.parse(raw) as Partial<SidebarPanelState>;
		return normalizePanels(parsed);
	} catch {
		return defaultPanels();
	}
};

const parseListSortJson = (raw?: string): ListSortPreference => {
	if (!raw) return defaultListSort();
	try {
		const parsed = JSON.parse(raw) as Partial<ListSortPreference>;
		return normalizeListSort(parsed);
	} catch {
		return defaultListSort();
	}
};

const parseCompletionQuotesJson = (raw?: string): string[] => {
	if (!raw?.trim()) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((q): q is string => typeof q === 'string')
			: [];
	} catch {
		return [];
	}
};

const toWire = (prefs: UiPreferences): UiPreferencesWire => ({
	theme: prefs.theme,
	font: prefs.font,
	completionQuotesJson: JSON.stringify(prefs.completionQuotes),
	sidebarPanelsJson: JSON.stringify(prefs.sidebarPanels),
	listSortJson: JSON.stringify(prefs.listSort),
	streakSettingsJson: JSON.stringify(prefs.streakSettings)
});

const fromWire = (wire: Partial<UiPreferencesWire>): UiPreferences => ({
	theme: normalizeTheme(wire.theme),
	font: normalizeFont(wire.font),
	completionQuotes: parseCompletionQuotesJson(
		typeof wire.completionQuotesJson === 'string' ? wire.completionQuotesJson : undefined
	),
	sidebarPanels: parsePanelsJson(
		typeof wire.sidebarPanelsJson === 'string' ? wire.sidebarPanelsJson : undefined
	),
	listSort: parseListSortJson(typeof wire.listSortJson === 'string' ? wire.listSortJson : undefined),
	streakSettings: parseStreakSettingsJson(
		typeof wire.streakSettingsJson === 'string' ? wire.streakSettingsJson : undefined
	)
});

const canSyncRemote = () => auth.get().status === 'authenticated' && !!auth.get().user;

const storageKey = () => {
	const state = auth.get();
	if (state.status === 'authenticated' && state.user) {
		return `tasksync:ui-preferences:${state.user.space_id}:${state.user.user_id}`;
	}
	return 'tasksync:ui-preferences:anon';
};

const warnInvalidField = (field: string, value: unknown, source: string) => {
	console.warn(`[preferences] invalid ${field} in ${source}: ${JSON.stringify(value)}, using default`);
};

const readLocal = (): UiPreferences | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(storageKey());
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<UiPreferences>;
		if (parsed.theme !== undefined && !validThemes.includes(parsed.theme as UiTheme)) {
			warnInvalidField('theme', parsed.theme, 'localStorage');
		}
		if (parsed.font !== undefined && !validFonts.includes(parsed.font as UiFont)) {
			warnInvalidField('font', parsed.font, 'localStorage');
		}
		return {
			theme: normalizeTheme(parsed.theme as string | undefined),
			font: normalizeFont(parsed.font as string | undefined),
			completionQuotes: normalizeCompletionQuotes(parsed.completionQuotes),
			sidebarPanels: normalizePanels(parsed.sidebarPanels),
			listSort: normalizeListSort(parsed.listSort as Partial<ListSortPreference> | undefined),
			streakSettings: normalizeStreakSettings(parsed.streakSettings)
		};
	} catch {
		return null;
	}
};

const writeLocal = (prefs: UiPreferences) => {
	if (typeof localStorage === 'undefined') return;
	const key = storageKey();
	// Preserve the streakState field owned by the streak store so it is not clobbered.
	const existing = localStorage.getItem(key);
	let streakState: unknown;
	if (existing) {
		try {
			const parsed = JSON.parse(existing) as Record<string, unknown>;
			streakState = parsed.streakState;
		} catch { /* ignore */ }
	}
	const blob = streakState !== undefined ? { ...prefs, streakState } : { ...prefs };
	localStorage.setItem(key, JSON.stringify(blob));
};

const applyThemeToDocument = (theme: UiTheme) => {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-ui-theme', theme);
};

const applyFontToDocument = (font: UiFont) => {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-ui-font', font);
};

const preferencesStore = writable<UiPreferences>(defaultPreferences());
preferencesStore.subscribe((prefs) => {
	applyThemeToDocument(prefs.theme);
	applyFontToDocument(prefs.font);
});

const hydrateGuard = createHydrateGuard();
let remoteSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRemotePayload: UiPreferences | null = null;

const persist = (prefs: UiPreferences) => {
	writeLocal(prefs);
};

const pushRemote = async (prefs: UiPreferences) => {
	if (!canSyncRemote()) return;
	try {
		const updated = await api.updateUiPreferences(toWire(prefs));
		const normalized = fromWire(updated);
		preferencesStore.set(normalized);
		persist(normalized);
	} catch {
		// Keep local preferences as source of truth when server sync is unavailable.
	}
};

const queueRemoteSave = (prefs: UiPreferences) => {
	if (!canSyncRemote() || typeof window === 'undefined') return;
	pendingRemotePayload = prefs;
	if (remoteSaveTimer) {
		window.clearTimeout(remoteSaveTimer);
	}
	remoteSaveTimer = window.setTimeout(() => {
		remoteSaveTimer = null;
		const payload = pendingRemotePayload;
		pendingRemotePayload = null;
		if (!payload) return;
		void pushRemote(payload);
	}, 250);
};

export const uiPreferences = {
	subscribe: preferencesStore.subscribe,
	get() {
		return get(preferencesStore);
	},
	setTheme(theme: UiTheme) {
		const nextTheme = normalizeTheme(theme);
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const next = {
				...current,
				theme: nextTheme
			};
			persist(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setPanel(panel: keyof SidebarPanelState, open: boolean) {
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const next = {
				...current,
				sidebarPanels: {
					...current.sidebarPanels,
					[panel]: open
				}
			};
			persist(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setListSort(nextSort: Partial<ListSortPreference>) {
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const next = {
				...current,
				listSort: normalizeListSort({
					mode: nextSort.mode ?? current.listSort.mode,
					direction: nextSort.direction ?? current.listSort.direction
				})
			};
			persist(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setFont(font: UiFont) {
		const nextFont = normalizeFont(font);
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const next = { ...current, font: nextFont };
			persist(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setStreakSettings(next: Partial<StreakSettings>) {
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const merged = normalizeStreakSettings({ ...current.streakSettings, ...next });
			const updated = { ...current, streakSettings: merged };
			persist(updated);
			queueRemoteSave(updated);
			return updated;
		});
	},
	setCompletionQuotes(quotes: string[]) {
		hydrateGuard.bump();
		preferencesStore.update((current) => {
			const next = { ...current, completionQuotes: normalizeCompletionQuotes(quotes) };
			persist(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setAll(next: Partial<UiPreferences>, options?: { queueRemote?: boolean }) {
		const normalized = {
			theme: normalizeTheme(next.theme as string | undefined),
			font: normalizeFont(next.font as string | undefined),
			completionQuotes: normalizeCompletionQuotes(next.completionQuotes),
			sidebarPanels: normalizePanels(next.sidebarPanels),
			listSort: normalizeListSort(next.listSort),
			streakSettings: normalizeStreakSettings(next.streakSettings)
		};
		hydrateGuard.bump();
		preferencesStore.set(normalized);
		persist(normalized);
		if (options?.queueRemote !== false) {
			queueRemoteSave(normalized);
		}
	},
	async hydrateFromLocal() {
		const stored = readLocal();
		if (!stored) {
			preferencesStore.set(defaultPreferences());
			return;
		}
		preferencesStore.set(stored);
	},
	async hydrateFromServer(): Promise<UiPreferencesWire | null> {
		if (!canSyncRemote()) return null;
		const snap = hydrateGuard.snapshot();
		try {
			const remote = await api.getUiPreferences();
			if (!hydrateGuard.isCurrent(snap)) return null;
			if (remote.theme !== undefined && !validThemes.includes(remote.theme as UiTheme)) {
				warnInvalidField('theme', remote.theme, 'server');
			}
			if (remote.font !== undefined && !validFonts.includes(remote.font as UiFont)) {
				warnInvalidField('font', remote.font, 'server');
			}
			const normalized = fromWire(remote);
			hydrateGuard.bump();
			preferencesStore.set(normalized);
			persist(normalized);
			return remote;
		} catch {
			// Keep local preferences when server is unavailable.
			return null;
		}
	}
};
