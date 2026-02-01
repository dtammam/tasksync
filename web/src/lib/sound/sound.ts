export type SoundTheme = 'chime_soft' | 'click_pop' | 'sparkle_short' | 'wood_tick';

export interface SoundSettings {
	enabled: boolean;
	volume: number; // 0..100
	theme: SoundTheme;
	customSoundFileId?: string;
}

// Placeholder: actual implementation will live in a SharedWorker and pre-decode buffers.
export const playCompletion = async (_settings: SoundSettings) => {
	if (!_settings.enabled) return;
	// TODO: load AudioBuffer from OPFS/cache and play with low latency (<20 ms).
};
