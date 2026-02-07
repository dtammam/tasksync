import { get, writable } from 'svelte/store';
import { repo } from '$lib/data/repo';
import type { SoundSettings, SoundTheme } from '$shared/types/settings';

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

const normalizeVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return defaultSoundSettings.volume;
	return Math.max(0, Math.min(100, Math.round(volume)));
};

const normalizeTheme = (theme?: string): SoundTheme =>
	theme && soundThemes.includes(theme as SoundTheme) ? (theme as SoundTheme) : defaultSoundSettings.theme;

const normalizeSettings = (settings: Partial<SoundSettings>): SoundSettings => ({
	enabled: settings.enabled ?? defaultSoundSettings.enabled,
	volume: normalizeVolume(settings.volume ?? defaultSoundSettings.volume),
	theme: normalizeTheme(settings.theme),
	customSoundFileId: settings.customSoundFileId,
	customSoundDataUrl:
		typeof settings.customSoundDataUrl === 'string' ? settings.customSoundDataUrl : undefined,
	customSoundFileName:
		typeof settings.customSoundFileName === 'string' ? settings.customSoundFileName : undefined
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
	setCustomSound(dataUrl: string, fileName?: string) {
		settingsMutationVersion += 1;
		soundSettingsStore.update((current) => {
			const next = {
				...current,
				theme: 'custom_file' as SoundTheme,
				customSoundDataUrl: dataUrl,
				customSoundFileName: fileName?.trim() || current.customSoundFileName,
				customSoundFileId: undefined
			};
			void repo.saveSoundSettings(next);
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
				customSoundFileId: undefined
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
