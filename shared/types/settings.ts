export type SoundTheme =
	| 'chime_soft'
	| 'click_pop'
	| 'sparkle_short'
	| 'wood_tick'
	| 'bell_crisp'
	| 'marimba_blip'
	| 'pulse_soft'
	| 'custom_file';

export interface SoundSettings {
	enabled: boolean;
	volume: number; // 0..100
	theme: SoundTheme;
	customSoundFileId?: string;
	customSoundDataUrl?: string;
	customSoundFileName?: string;
}
