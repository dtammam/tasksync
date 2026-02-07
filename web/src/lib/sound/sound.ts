import type { SoundSettings, SoundTheme } from '$shared/types/settings';

let audioContext: AudioContext | null = null;
const decodedSoundCache = new Map<string, Promise<AudioBuffer>>();

const clampVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return 0;
	return Math.max(0, Math.min(100, volume)) / 100;
};

const getAudioContext = () => {
	if (typeof window === 'undefined') return null;
	if (audioContext) return audioContext;
	const Ctor = window.AudioContext;
	if (!Ctor) return null;
	audioContext = new Ctor({ latencyHint: 'interactive' });
	return audioContext;
};

const scheduleTone = (
	ctx: AudioContext,
	{
		frequency,
		type,
		startAt,
		duration,
		peak
	}: { frequency: number; type: OscillatorType; startAt: number; duration: number; peak: number }
) => {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(frequency, startAt);
	gain.gain.setValueAtTime(0.0001, startAt);
	gain.gain.linearRampToValueAtTime(peak, startAt + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(startAt);
	osc.stop(startAt + duration + 0.02);
};

const playTheme = (ctx: AudioContext, theme: SoundTheme, volume: number) => {
	const start = ctx.currentTime + 0.005;
	switch (theme) {
		case 'click_pop':
			scheduleTone(ctx, {
				frequency: 520,
				type: 'square',
				startAt: start,
				duration: 0.05,
				peak: 0.22 * volume
			});
			return;
		case 'sparkle_short':
			scheduleTone(ctx, {
				frequency: 840,
				type: 'triangle',
				startAt: start,
				duration: 0.09,
				peak: 0.18 * volume
			});
			scheduleTone(ctx, {
				frequency: 1260,
				type: 'sine',
				startAt: start + 0.06,
				duration: 0.1,
				peak: 0.14 * volume
			});
			return;
		case 'wood_tick':
			scheduleTone(ctx, {
				frequency: 220,
				type: 'triangle',
				startAt: start,
				duration: 0.06,
				peak: 0.2 * volume
			});
			return;
		case 'custom_file':
			return;
		case 'chime_soft':
		default:
			scheduleTone(ctx, {
				frequency: 660,
				type: 'sine',
				startAt: start,
				duration: 0.11,
				peak: 0.15 * volume
			});
			scheduleTone(ctx, {
				frequency: 990,
				type: 'sine',
				startAt: start + 0.045,
				duration: 0.14,
				peak: 0.1 * volume
			});
	}
};

export const playCustomDataUrl = async (dataUrl: string, volumePercent: number) => {
	const source = dataUrl?.trim();
	if (!source.startsWith('data:')) return false;
	const volume = clampVolume(volumePercent);
	if (volume <= 0) return false;
	const ctx = getAudioContext();
	if (!ctx) return false;
	if (ctx.state === 'suspended') {
		try {
			await ctx.resume();
		} catch {
			return false;
		}
	}
	try {
		let bufferPromise = decodedSoundCache.get(source);
		if (!bufferPromise) {
			bufferPromise = fetch(source)
				.then((res) => res.arrayBuffer())
				.then((arr) => ctx.decodeAudioData(arr.slice(0)));
			decodedSoundCache.set(source, bufferPromise);
		}
		const buffer = await bufferPromise;
		const gain = ctx.createGain();
		gain.gain.value = volume;
		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.connect(gain);
		gain.connect(ctx.destination);
		node.start();
		return true;
	} catch {
		decodedSoundCache.delete(source);
		return false;
	}
};

export const playCompletion = async (settings: SoundSettings) => {
	if (!settings.enabled) return;
	const volume = clampVolume(settings.volume);
	if (volume <= 0) return;
	if (settings.theme === 'custom_file') {
		const selected =
			settings.customSounds?.find((sound) => sound.id === settings.customSoundFileId)?.data_url ?? '';
		const played = await playCustomDataUrl(selected, settings.volume);
		if (played) return;
	}
	const ctx = getAudioContext();
	if (!ctx) return;
	if (ctx.state === 'suspended') {
		try {
			await ctx.resume();
		} catch {
			return;
		}
	}
	playTheme(ctx, settings.theme, volume);
};
