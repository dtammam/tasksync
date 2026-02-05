export type SoundTheme = 'chime_soft' | 'click_pop' | 'sparkle_short' | 'wood_tick';

export interface SoundSettings {
	enabled: boolean;
	volume: number; // 0..100
	theme: SoundTheme;
	customSoundFileId?: string;
}
