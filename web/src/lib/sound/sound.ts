import type { SoundSettings, SoundTheme } from '$shared/types/settings';

let audioContext: AudioContext | null = null;
let customBufferCache: { src: string; buffer: AudioBuffer } | null = null;

const clampVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return 0;
	return Math.max(0, Math.min(100, volume)) / 100;
};

const toPerceptualGain = (linearVolume: number) => Math.pow(linearVolume, 1.35);

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
		peak,
		output
	}: {
		frequency: number;
		type: OscillatorType;
		startAt: number;
		duration: number;
		peak: number;
		output: AudioNode;
	}
) => {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(frequency, startAt);
	gain.gain.setValueAtTime(0.0001, startAt);
	gain.gain.linearRampToValueAtTime(peak, startAt + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
	osc.connect(gain);
	gain.connect(output);
	osc.start(startAt);
	osc.stop(startAt + duration + 0.02);
};

const playTheme = (ctx: AudioContext, theme: SoundTheme, volume: number) => {
	const start = ctx.currentTime + 0.005;
	const output = ctx.createGain();
	output.gain.value = Math.max(0.0001, volume);
	output.connect(ctx.destination);

	switch (theme) {
		case 'click_pop':
			scheduleTone(ctx, {
				frequency: 640,
				type: 'triangle',
				startAt: start,
				duration: 0.09,
				peak: 0.2,
				output
			});
			scheduleTone(ctx, {
				frequency: 480,
				type: 'sine',
				startAt: start + 0.05,
				duration: 0.08,
				peak: 0.16,
				output
			});
			return;
		case 'sparkle_short':
			scheduleTone(ctx, {
				frequency: 840,
				type: 'triangle',
				startAt: start,
				duration: 0.09,
				peak: 0.18,
				output
			});
			scheduleTone(ctx, {
				frequency: 1260,
				type: 'sine',
				startAt: start + 0.06,
				duration: 0.1,
				peak: 0.14,
				output
			});
			return;
		case 'wood_tick':
			scheduleTone(ctx, {
				frequency: 220,
				type: 'triangle',
				startAt: start,
				duration: 0.06,
				peak: 0.2,
				output
			});
			return;
		case 'bell_crisp':
			scheduleTone(ctx, {
				frequency: 784,
				type: 'sine',
				startAt: start,
				duration: 0.12,
				peak: 0.18,
				output
			});
			scheduleTone(ctx, {
				frequency: 1175,
				type: 'triangle',
				startAt: start + 0.03,
				duration: 0.15,
				peak: 0.1,
				output
			});
			return;
		case 'marimba_blip':
			scheduleTone(ctx, {
				frequency: 392,
				type: 'triangle',
				startAt: start,
				duration: 0.08,
				peak: 0.2,
				output
			});
			scheduleTone(ctx, {
				frequency: 523,
				type: 'triangle',
				startAt: start + 0.05,
				duration: 0.09,
				peak: 0.13,
				output
			});
			return;
		case 'pulse_soft':
			scheduleTone(ctx, {
				frequency: 294,
				type: 'sine',
				startAt: start,
				duration: 0.1,
				peak: 0.14,
				output
			});
			scheduleTone(ctx, {
				frequency: 330,
				type: 'sine',
				startAt: start + 0.11,
				duration: 0.1,
				peak: 0.12,
				output
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
				peak: 0.15,
				output
			});
			scheduleTone(ctx, {
				frequency: 990,
				type: 'sine',
				startAt: start + 0.045,
				duration: 0.14,
				peak: 0.1,
				output
			});
	}
};

const decodeCustomBuffer = async (ctx: AudioContext, src: string) => {
	if (customBufferCache?.src === src) return customBufferCache.buffer;
	const response = await fetch(src);
	const arrayBuffer = await response.arrayBuffer();
	const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
	customBufferCache = { src, buffer: decoded };
	return decoded;
};

const playCustomFileWithWebAudio = async (
	ctx: AudioContext,
	settings: SoundSettings,
	volume: number
) => {
	const src = settings.customSoundDataUrl?.trim();
	if (!src || !src.startsWith('data:audio/')) return false;
	try {
		const buffer = await decodeCustomBuffer(ctx, src);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const gain = ctx.createGain();
		gain.gain.value = Math.max(0.0001, volume);
		source.connect(gain);
		gain.connect(ctx.destination);
		source.start(ctx.currentTime + 0.002);
		return true;
	} catch {
		return false;
	}
};

const playCustomFileWithHtmlAudio = async (settings: SoundSettings, volume: number) => {
	const src = settings.customSoundDataUrl?.trim();
	if (!src) return false;
	if (typeof Audio === 'undefined') return false;
	try {
		const audio = new Audio(src);
		audio.preload = 'auto';
		audio.volume = volume;
		await audio.play();
		return true;
	} catch {
		return false;
	}
};

export const playCompletion = async (settings: SoundSettings) => {
	if (!settings.enabled) return;
	const volume = toPerceptualGain(clampVolume(settings.volume));
	if (volume <= 0.0001) return;
	const ctx = getAudioContext();
	if (ctx?.state === 'suspended') {
		try {
			await ctx.resume();
		} catch {
			return;
		}
	}
	if (settings.theme === 'custom_file') {
		const playedWithContext = ctx ? await playCustomFileWithWebAudio(ctx, settings, volume) : false;
		if (playedWithContext) return;
		const playedWithHtmlAudio = await playCustomFileWithHtmlAudio(settings, volume);
		if (playedWithHtmlAudio) return;
	}
	if (!ctx) return;
	const fallbackTheme = settings.theme === 'custom_file' ? 'chime_soft' : settings.theme;
	playTheme(ctx, fallbackTheme, volume);
};
