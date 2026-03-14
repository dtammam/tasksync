import type { SoundSettings, SoundTheme } from '$shared/types/settings';

interface CustomSoundFileEntry {
	id?: string;
	name?: string;
	dataUrl: string;
}

/** Read AudioContext.state as a plain string to avoid TS narrowing issues. */
const contextState = (ctx: AudioContext): string =>
	String((ctx as AudioContext & { state?: string }).state ?? '');

/**
 * Create a fresh AudioContext and ensure it is running.
 *
 * A new context is created for every playback request so that we never hold a
 * stale singleton.  iOS (and other platforms) can silently invalidate the
 * underlying audio session without updating AudioContext.state — the only
 * reliable defence is to never reuse a context across user interactions.
 *
 * The caller is responsible for calling `closeContext()` when playback is done.
 */
const createRunningContext = async (): Promise<AudioContext | null> => {
	if (typeof window === 'undefined') return null;
	const Ctor = window.AudioContext;
	if (!Ctor) return null;

	const ctx = new Ctor({ latencyHint: 'interactive' });
	if (contextState(ctx) === 'running') return ctx;

	try {
		await ctx.resume();
		if (contextState(ctx) === 'running') return ctx;
	} catch {
		// resume failed — try closing and rebuilding once.
	}

	// WebKit can leave a brand-new context suspended; rebuild once.
	try {
		await ctx.close();
	} catch {
		/* ignore */
	}
	const ctx2 = new Ctor({ latencyHint: 'interactive' });
	try {
		await ctx2.resume();
	} catch {
		return null;
	}
	return contextState(ctx2) === 'running' ? ctx2 : null;
};

/** Fire-and-forget context cleanup. */
const closeContext = (ctx: AudioContext) => {
	try {
		void ctx.close();
	} catch {
		/* ignore */
	}
};

const clampVolume = (volume: number) => {
	if (!Number.isFinite(volume)) return 0;
	return Math.max(0, Math.min(100, volume)) / 100;
};

const toPerceptualGain = (linearVolume: number) => Math.pow(linearVolume, 1.35);

const normalizeCustomSoundEntry = (entry: Partial<CustomSoundFileEntry>): CustomSoundFileEntry | null => {
	const dataUrl = typeof entry.dataUrl === 'string' ? entry.dataUrl.trim() : '';
	if (!dataUrl.startsWith('data:audio/')) return null;
	const id =
		typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim().slice(0, 180) : undefined;
	const name =
		typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 180) : undefined;
	return { id, name, dataUrl };
};

const parseCustomSoundEntries = (settings: SoundSettings) => {
	const raw = settings.customSoundFilesJson;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				const normalized = parsed
					.map((entry) => {
						if (!entry || typeof entry !== 'object') return null;
						return normalizeCustomSoundEntry(entry as Partial<CustomSoundFileEntry>);
					})
					.filter((entry): entry is CustomSoundFileEntry => !!entry)
					.slice(0, 8);
				if (normalized.length) return normalized;
			}
		} catch {
			// Fall through to legacy single-field path.
		}
	}
	if (typeof settings.customSoundDataUrl === 'string') {
		const legacy = normalizeCustomSoundEntry({
			id: settings.customSoundFileId,
			name: settings.customSoundFileName,
			dataUrl: settings.customSoundDataUrl
		});
		return legacy ? [legacy] : [];
	}
	return [];
};

const pickRandomCustomSoundEntry = (settings: SoundSettings): CustomSoundFileEntry | null => {
	const entries = parseCustomSoundEntries(settings);
	if (!entries.length) return null;
	if (entries.length === 1) return entries[0];
	const index = Math.floor(Math.random() * entries.length);
	return entries[index] ?? entries[0];
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

const playCustomFileWithWebAudio = async (
	ctx: AudioContext,
	src: string,
	volume: number
) => {
	try {
		const response = await fetch(src);
		const arrayBuffer = await response.arrayBuffer();
		const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
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

const playCustomFileWithHtmlAudio = async (src: string, volume: number) => {
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

/**
 * Play an audio file at a given URL (e.g. a static asset path) using a fresh
 * WebAudio context, with HTML Audio fallback. Used by the streak announcer.
 */
export const playUrl = async (src: string, volume: number) => {
	if (volume <= 0.0001) return;
	const gain = toPerceptualGain(clampVolume(volume));
	if (gain <= 0.0001) return;
	const ctx = await createRunningContext();
	if (ctx) {
		const played = await playCustomFileWithWebAudio(ctx, src, gain);
		if (played) {
			closeContext(ctx);
			return;
		}
		closeContext(ctx);
	}
	await playCustomFileWithHtmlAudio(src, gain);
};

export const playCompletion = async (settings: SoundSettings) => {
	if (!settings.enabled) return;
	const volume = toPerceptualGain(clampVolume(settings.volume));
	if (volume <= 0.0001) return;
	const ctx = await createRunningContext();
	const customSound = settings.theme === 'custom_file' ? pickRandomCustomSoundEntry(settings) : null;
	if (settings.theme === 'custom_file') {
		const playedWithContext =
			ctx && customSound
				? await playCustomFileWithWebAudio(ctx, customSound.dataUrl, volume)
				: false;
		if (playedWithContext) {
			closeContext(ctx!);
			return;
		}
		if (ctx) closeContext(ctx);
		const playedWithHtmlAudio =
			customSound ? await playCustomFileWithHtmlAudio(customSound.dataUrl, volume) : false;
		if (playedWithHtmlAudio) return;
	}
	if (!ctx) return;
	const fallbackTheme = settings.theme === 'custom_file' ? 'chime_soft' : settings.theme;
	playTheme(ctx, fallbackTheme, volume);
	closeContext(ctx);
};
