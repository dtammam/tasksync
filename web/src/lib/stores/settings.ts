import { get, writable } from 'svelte/store';
import { repo } from '$lib/data/repo';
import type { CustomSoundOption, SoundSettings, SoundTheme } from '$shared/types/settings';

export const soundThemes: SoundTheme[] = [
	'chime_soft',
	'click_pop',
	'sparkle_short',
	'wood_tick',
	'custom_file'
];

export const defaultSoundSettings: SoundSettings = {
	enabled: true,
	volume: 60,
	theme: 'chime_soft'
};

const normalizeVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return defaultSoundSettings.volume;
	return Math.max(0, Math.min(100, Math.round(volume)));
};

const normalizeTheme = (theme?: string): SoundTheme =>
	theme && soundThemes.includes(theme as SoundTheme) ? (theme as SoundTheme) : defaultSoundSettings.theme;

const normalizeCustomSounds = (sounds?: CustomSoundOption[]): CustomSoundOption[] => {
	if (!Array.isArray(sounds)) return [];
	return sounds
		.filter((sound) =>
			sound &&
			typeof sound.id === 'string' &&
			typeof sound.name === 'string' &&
			typeof sound.data_url === 'string'
		)
		.map((sound) => ({
			id: sound.id.trim(),
			name: sound.name.trim(),
			data_url: sound.data_url
		}))
		.filter((sound) => sound.id && sound.name && sound.data_url.startsWith('data:'))
		.slice(0, 25);
};

const normalizeSettings = (settings: Partial<SoundSettings>): SoundSettings => ({
	enabled: settings.enabled ?? defaultSoundSettings.enabled,
	volume: normalizeVolume(settings.volume ?? defaultSoundSettings.volume),
	theme: normalizeTheme(settings.theme),
	customSoundFileId:
		typeof settings.customSoundFileId === 'string' ? settings.customSoundFileId : undefined,
	customSounds: normalizeCustomSounds(settings.customSounds)
});

const soundSettingsStore = writable<SoundSettings>(defaultSoundSettings);
let settingsMutationVersion = 0;

export const soundSettings = {
	subscribe: soundSettingsStore.subscribe,
	get() {
		return get(soundSettingsStore);
	},
	setEnabled(enabled: boolean) {
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, enabled };
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	setVolume(volume: number) {
		const nextVolume = normalizeVolume(volume);
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, volume: nextVolume };
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	setTheme(theme: SoundTheme) {
		const nextTheme = normalizeTheme(theme);
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = { ...current, theme: nextTheme };
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	addCustomSound(name: string, dataUrl: string) {
		const trimmedName = name.trim();
		if (!trimmedName || !dataUrl.startsWith('data:')) return;
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const currentSounds = normalizeCustomSounds(current.customSounds);
			const deduped = currentSounds.filter((sound) => sound.data_url !== dataUrl);
			const nextSounds = [{ id, name: trimmedName, data_url: dataUrl }, ...deduped].slice(0, 25);
			const next: SoundSettings = {
				...current,
				theme: 'custom_file',
				customSoundFileId: id,
				customSounds: nextSounds
			};
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	selectCustomSound(id: string) {
		const target = id.trim();
		if (!target) return;
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const sounds = normalizeCustomSounds(current.customSounds);
			if (!sounds.some((sound) => sound.id === target)) return current;
			const next: SoundSettings = {
				...current,
				theme: 'custom_file',
				customSoundFileId: target,
				customSounds: sounds
			};
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	deleteCustomSound(id: string) {
		const target = id.trim();
		if (!target) return;
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const sounds = normalizeCustomSounds(current.customSounds).filter((sound) => sound.id !== target);
			const activeId = current.customSoundFileId === target ? sounds[0]?.id : current.customSoundFileId;
			const nextTheme =
				current.theme === 'custom_file' && !activeId ? defaultSoundSettings.theme : current.theme;
			const next: SoundSettings = {
				...current,
				theme: nextTheme,
				customSoundFileId: activeId,
				customSounds: sounds
			};
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	resetDefaultSounds() {
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next: SoundSettings = {
				...current,
				theme: defaultSoundSettings.theme,
				customSoundFileId: undefined,
				customSounds: []
			};
			void repo.saveSoundSettings(next);
			return next;
		});
	},
	setAll(settings: Partial<SoundSettings>) {
		const normalized = normalizeSettings(settings);
		settingsMutationVersion += 1;
		soundSettingsStore.set(normalized);
		void repo.saveSoundSettings(normalized);
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
	}
};
