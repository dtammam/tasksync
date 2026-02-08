import { get, writable } from 'svelte/store';
import { repo } from '$lib/data/repo';
import type { SoundSettings, SoundTheme } from '$shared/types/settings';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';

export const soundThemes: SoundTheme[] = [
	'chime_soft',
	'click_pop',
	'sparkle_short',
	'wood_tick',
	'bell_crisp',
	'marimba_blip',
	'pulse_soft',
	'custom_file'
];

export const defaultSoundSettings: SoundSettings = {
	enabled: true,
	volume: 60,
	theme: 'chime_soft'
};

interface CustomSoundFileEntry {
	id?: string;
	name?: string;
	dataUrl: string;
}

const normalizeVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return defaultSoundSettings.volume;
	return Math.max(0, Math.min(100, Math.round(volume)));
};

const normalizeTheme = (theme?: string): SoundTheme =>
	theme && soundThemes.includes(theme as SoundTheme) ? (theme as SoundTheme) : defaultSoundSettings.theme;

const normalizeCustomSoundEntry = (entry: Partial<CustomSoundFileEntry>): CustomSoundFileEntry | null => {
	const dataUrl = typeof entry.dataUrl === 'string' ? entry.dataUrl.trim() : '';
	if (!dataUrl.startsWith('data:audio/')) return null;
	const id =
		typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim().slice(0, 180) : undefined;
	const name =
		typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 180) : undefined;
	return { id, name, dataUrl };
};

const parseCustomSoundEntries = (raw?: string): CustomSoundFileEntry[] => {
	if (!raw || typeof raw !== 'string') return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((entry) => {
				if (!entry || typeof entry !== 'object') return null;
				return normalizeCustomSoundEntry(entry as Partial<CustomSoundFileEntry>);
			})
			.filter((entry): entry is CustomSoundFileEntry => !!entry)
			.slice(0, 8);
	} catch {
		return [];
	}
};

const stringifyCustomSoundEntries = (entries: CustomSoundFileEntry[]) =>
	entries.length ? JSON.stringify(entries) : undefined;

const normalizeSettings = (settings: Partial<SoundSettings>): SoundSettings => {
	const parsedEntries = parseCustomSoundEntries(settings.customSoundFilesJson);
	const legacySingle =
		typeof settings.customSoundDataUrl === 'string' &&
		settings.customSoundDataUrl.trim().startsWith('data:audio/')
			? normalizeCustomSoundEntry({
					id: settings.customSoundFileId,
					name: settings.customSoundFileName,
					dataUrl: settings.customSoundDataUrl
				})
			: null;
	const customSoundEntries =
		parsedEntries.length > 0 ? parsedEntries : legacySingle ? [legacySingle] : [];
	const firstCustomSound = customSoundEntries[0];
	return {
		enabled: settings.enabled ?? defaultSoundSettings.enabled,
		volume: normalizeVolume(settings.volume ?? defaultSoundSettings.volume),
		theme: normalizeTheme(settings.theme),
		customSoundFileId: firstCustomSound?.id ?? settings.customSoundFileId,
		customSoundDataUrl: firstCustomSound?.dataUrl,
		customSoundFileName: firstCustomSound?.name ?? settings.customSoundFileName,
		customSoundFilesJson: stringifyCustomSoundEntries(customSoundEntries),
		profileAttachmentsJson:
			typeof settings.profileAttachmentsJson === 'string'
				? settings.profileAttachmentsJson
				: undefined
	};
};

const soundSettingsStore = writable<SoundSettings>(defaultSoundSettings);
let settingsMutationVersion = 0;
let remoteSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRemotePayload: { settings: SoundSettings; clearCustomSound: boolean } | null = null;

const canSyncRemote = () => auth.get().status === 'authenticated' && !!auth.get().user;

const saveLocal = (settings: SoundSettings) => {
	void repo.saveSoundSettings(settings);
};

const pushRemote = async (settings: SoundSettings, clearCustomSound: boolean) => {
	if (!canSyncRemote()) return;
	try {
		const remote = await api.updateSoundSettings({
			enabled: settings.enabled,
			volume: settings.volume,
			theme: settings.theme,
			customSoundFileId: settings.customSoundFileId,
			customSoundDataUrl: settings.customSoundDataUrl,
			customSoundFileName: settings.customSoundFileName,
			customSoundFilesJson: settings.customSoundFilesJson,
			profileAttachmentsJson: settings.profileAttachmentsJson,
			clearCustomSound
		});
		const normalized = normalizeSettings(remote);
		soundSettingsStore.set(normalized);
		saveLocal(normalized);
	} catch {
		// Keep local settings as source of truth while server sync is best-effort.
	}
};

const queueRemoteSave = (settings: SoundSettings, options?: { clearCustomSound?: boolean }) => {
	if (!canSyncRemote() || typeof window === 'undefined') return;
	pendingRemotePayload = {
		settings,
		clearCustomSound: options?.clearCustomSound ?? false
	};
	if (remoteSaveTimer) {
		window.clearTimeout(remoteSaveTimer);
	}
	remoteSaveTimer = window.setTimeout(() => {
		remoteSaveTimer = null;
		const payload = pendingRemotePayload;
		pendingRemotePayload = null;
		if (!payload) return;
		void pushRemote(payload.settings, payload.clearCustomSound);
	}, 250);
};

export const soundSettings = {
	subscribe: soundSettingsStore.subscribe,
	get() {
		return get(soundSettingsStore);
	},
	setEnabled(enabled: boolean) {
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, enabled };
			saveLocal(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setVolume(volume: number) {
		const nextVolume = normalizeVolume(volume);
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, volume: nextVolume };
			saveLocal(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setTheme(theme: SoundTheme) {
		const nextTheme = normalizeTheme(theme);
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, theme: nextTheme };
			saveLocal(next);
			queueRemoteSave(next);
			return next;
		});
	},
	setCustomSound(dataUrl: string, fileName?: string) {
		soundSettings.setCustomSounds([{ dataUrl, fileName }]);
	},
	setCustomSounds(files: { dataUrl: string; fileName?: string; fileId?: string }[]) {
		const entries = files
			.map((file) =>
				normalizeCustomSoundEntry({
					id: file.fileId,
					name: file.fileName,
					dataUrl: file.dataUrl
				})
			)
			.filter((entry): entry is CustomSoundFileEntry => !!entry)
			.slice(0, 8);
		if (!entries.length) return;
		const serialized = stringifyCustomSoundEntries(entries);
		const firstEntry = entries[0];
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = {
				...current,
				theme: 'custom_file' as SoundTheme,
				customSoundDataUrl: firstEntry.dataUrl,
				customSoundFileName: firstEntry.name ?? current.customSoundFileName,
				customSoundFileId: firstEntry.id,
				customSoundFilesJson: serialized
			};
			saveLocal(next);
			queueRemoteSave(next);
			return next;
		});
	},
	clearCustomSound() {
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const nextTheme =
				current.theme === 'custom_file' ? defaultSoundSettings.theme : current.theme;
			const next = {
				...current,
				theme: nextTheme,
				customSoundDataUrl: undefined,
				customSoundFileName: undefined,
				customSoundFileId: undefined,
				customSoundFilesJson: undefined
			};
			saveLocal(next);
			queueRemoteSave(next, { clearCustomSound: true });
			return next;
		});
	},
	setAll(settings: Partial<SoundSettings>) {
		const normalized = normalizeSettings(settings);
		settingsMutationVersion += 1;
		soundSettingsStore.set(normalized);
		saveLocal(normalized);
		queueRemoteSave(normalized);
	},
	async hydrateFromDb() {
		const hydrateStartVersion = settingsMutationVersion;
		const stored = await repo.loadSoundSettings();
		if (settingsMutationVersion !== hydrateStartVersion) {
			return;
		}
		if (!stored) {
			soundSettingsStore.set(defaultSoundSettings);
			return;
		}
		soundSettingsStore.set(normalizeSettings(stored));
	},
	async hydrateFromServer() {
		if (!canSyncRemote()) return;
		try {
			const remote = await api.getSoundSettings();
			const normalized = normalizeSettings(remote);
			settingsMutationVersion += 1;
			soundSettingsStore.set(normalized);
			saveLocal(normalized);
		} catch {
			// Keep local settings when server is unavailable.
		}
	}
};
