import type { SoundSettings, SoundTheme } from '$shared/types/settings';

let audioContext: AudioContext | null = null;
let audioContextCreatedAt = 0;
let needsContextReset = false;
let lifecycleWatchersBound = false;
const customBufferCache = new Map<string, AudioBuffer>();
const IOS_STANDALONE_CONTEXT_MAX_AGE_MS = 120000;

interface CustomSoundFileEntry {
	id?: string;
	name?: string;
	dataUrl: string;
}

const contextState = (ctx: AudioContext | null) =>
	ctx ? String((ctx as AudioContext & { state?: string }).state ?? '') : 'closed';

const isIosDevice = () => {
	if (typeof window === 'undefined') return false;
	const nav = window.navigator;
	const ua = nav.userAgent ?? '';
	if (/\b(iPad|iPhone|iPod)\b/i.test(ua)) return true;
	return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
};

const isStandaloneDisplayMode = () => {
	if (typeof window === 'undefined') return false;
	const nav = window.navigator as Navigator & { standalone?: boolean };
	if (typeof nav.standalone === 'boolean') return nav.standalone;
	if (typeof window.matchMedia !== 'function') return false;
	try {
		return window.matchMedia('(display-mode: standalone)').matches;
	} catch {
		return false;
	}
};

const shouldAggressivelyRecycleContext = () => {
	if (typeof window === 'undefined') return false;
	const nav = window.navigator as Navigator & { standalone?: boolean };
	if (typeof nav.standalone === 'boolean') return nav.standalone;
	return isIosDevice() && isStandaloneDisplayMode();
};

const markContextStale = () => {
	needsContextReset = true;
};

const bindLifecycleWatchers = () => {
	if (lifecycleWatchersBound || typeof window === 'undefined' || typeof document === 'undefined') return;
	lifecycleWatchersBound = true;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible') {
			markContextStale();
		}
	});
	window.addEventListener('pagehide', markContextStale);
	window.addEventListener('pageshow', markContextStale);
};

const shouldRecycleLiveContext = () => {
	if (needsContextReset) return true;
	if (!audioContextCreatedAt || !shouldAggressivelyRecycleContext()) return false;
	return Date.now() - audioContextCreatedAt >= IOS_STANDALONE_CONTEXT_MAX_AGE_MS;
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

const getAudioContext = () => {
	if (typeof window === 'undefined') return null;
	if (audioContext && contextState(audioContext) !== 'closed') return audioContext;
	audioContext = null;
	const Ctor = window.AudioContext;
	if (!Ctor) return null;
	audioContext = new Ctor({ latencyHint: 'interactive' });
	audioContextCreatedAt = Date.now();
	audioContext.onstatechange = () => {
		if (audioContext && contextState(audioContext) !== 'running') {
			needsContextReset = true;
		}
	};
	return audioContext;
};

const dropAudioContext = async () => {
	const stale = audioContext;
	audioContext = null;
	audioContextCreatedAt = 0;
	customBufferCache.clear();
	if (!stale) return;
	if (contextState(stale) === 'closed') return;
	try {
		await stale.close();
	} catch {
		// Ignore close errors and rebuild on next playback request.
	}
};

const ensureRunningContext = async () => {
	bindLifecycleWatchers();
	let ctx = getAudioContext();
	if (!ctx) return null;

	if (shouldRecycleLiveContext()) {
		await dropAudioContext();
		ctx = getAudioContext();
		if (!ctx) return null;
	}

	if (contextState(ctx) === 'running') {
		needsContextReset = false;
		return ctx;
	}
	try {
		await ctx.resume();
	} catch {
		// Continue into rebuild path below.
	}
	if (contextState(ctx) === 'running') {
		needsContextReset = false;
		return ctx;
	}

	// WebKit can leave a context suspended/interrupted until fully rebuilt.
	await dropAudioContext();
	ctx = getAudioContext();
	if (!ctx) return null;
	try {
		await ctx.resume();
	} catch {
		return null;
	}
	if (contextState(ctx) !== 'running') return null;
	needsContextReset = false;
	return ctx;
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
	const cached = customBufferCache.get(src);
	if (cached) return cached;
	const response = await fetch(src);
	const arrayBuffer = await response.arrayBuffer();
	const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
	customBufferCache.set(src, decoded);
	if (customBufferCache.size > 12) {
		const oldest = customBufferCache.keys().next().value;
		if (oldest) {
			customBufferCache.delete(oldest);
		}
	}
	return decoded;
};

const playCustomFileWithWebAudio = async (
	ctx: AudioContext,
	src: string,
	volume: number
) => {
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

export const playCompletion = async (settings: SoundSettings) => {
	if (!settings.enabled) return;
	const volume = toPerceptualGain(clampVolume(settings.volume));
	if (volume <= 0.0001) return;
	const ctx = await ensureRunningContext();
	const customSound = settings.theme === 'custom_file' ? pickRandomCustomSoundEntry(settings) : null;
	if (settings.theme === 'custom_file') {
		const playedWithContext =
			ctx && customSound
				? await playCustomFileWithWebAudio(ctx, customSound.dataUrl, volume)
				: false;
		if (playedWithContext) return;
		const playedWithHtmlAudio =
			customSound ? await playCustomFileWithHtmlAudio(customSound.dataUrl, volume) : false;
		if (playedWithHtmlAudio) return;
	}
	if (!ctx) return;
	const fallbackTheme = settings.theme === 'custom_file' ? 'chime_soft' : settings.theme;
	playTheme(ctx, fallbackTheme, volume);
};
