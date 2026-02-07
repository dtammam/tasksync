export type SoundTheme = 'chime_soft' | 'click_pop' | 'sparkle_short' | 'wood_tick' | 'custom_file';

export interface CustomSoundOption {
	id: string;
	name: string;
	data_url: string;
}

export interface SoundSettings {
	enabled: boolean;
	volume: number; // 0..100
	theme: SoundTheme;
	customSoundFileId?: string;
	customSounds?: CustomSoundOption[];
}
