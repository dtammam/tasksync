import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import type {
	ListSortDirection,
	ListSortMode,
	ListSortPreference,
	SidebarPanelState,
	UiPreferences,
	UiPreferencesWire,
	UiTheme
} from '$shared/types/settings';

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

const defaultPreferences = (): UiPreferences => ({
	theme: 'default',
	sidebarPanels: defaultPanels(),
	listSort: defaultListSort()
});

const normalizeTheme = (theme?: string): UiTheme =>
	theme === 'dark' || theme === 'light' || theme === 'default' ? theme : 'default';
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

const toWire = (prefs: UiPreferences): UiPreferencesWire => ({
	theme: prefs.theme,
	sidebarPanelsJson: JSON.stringify(prefs.sidebarPanels),
	listSortJson: JSON.stringify(prefs.listSort)
});

const fromWire = (wire: Partial<UiPreferencesWire>): UiPreferences => ({
	theme: normalizeTheme(wire.theme),
	sidebarPanels: parsePanelsJson(
		typeof wire.sidebarPanelsJson === 'string' ? wire.sidebarPanelsJson : undefined
	),
	listSort: parseListSortJson(typeof wire.listSortJson === 'string' ? wire.listSortJson : undefined)
});

const canSyncRemote = () => auth.get().status === 'authenticated' && !!auth.get().user;

const storageKey = () => {
	const state = auth.get();
	if (state.status === 'authenticated' && state.user) {
		return `tasksync:ui-preferences:${state.user.space_id}:${state.user.user_id}`;
	}
	return 'tasksync:ui-preferences:anon';
};

const readLocal = (): UiPreferences | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(storageKey());
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<UiPreferences>;
		return {
			theme: normalizeTheme(parsed.theme as string | undefined),
			sidebarPanels: normalizePanels(parsed.sidebarPanels),
			listSort: normalizeListSort(parsed.listSort as Partial<ListSortPreference> | undefined)
		};
	} catch {
		return null;
	}
};

const writeLocal = (prefs: UiPreferences) => {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(storageKey(), JSON.stringify(prefs));
};

const applyThemeToDocument = (theme: UiTheme) => {
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-ui-theme', theme);
};

const preferencesStore = writable<UiPreferences>(defaultPreferences());
preferencesStore.subscribe((prefs) => applyThemeToDocument(prefs.theme));

let prefsMutationVersion = 0;
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
		prefsMutationVersion += 1;
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
		prefsMutationVersion += 1;
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
		prefsMutationVersion += 1;
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
	setAll(next: Partial<UiPreferences>, options?: { queueRemote?: boolean }) {
		const normalized = {
			theme: normalizeTheme(next.theme as string | undefined),
			sidebarPanels: normalizePanels(next.sidebarPanels),
			listSort: normalizeListSort(next.listSort)
		};
		prefsMutationVersion += 1;
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
	async hydrateFromServer() {
		if (!canSyncRemote()) return;
		const hydrateStartVersion = prefsMutationVersion;
		try {
			const remote = await api.getUiPreferences();
			if (prefsMutationVersion !== hydrateStartVersion) return;
			const normalized = fromWire(remote);
			prefsMutationVersion += 1;
			preferencesStore.set(normalized);
			persist(normalized);
		} catch {
			// Keep local preferences when server is unavailable.
		}
	}
};
