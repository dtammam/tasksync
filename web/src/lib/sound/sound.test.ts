import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundSettings } from '$shared/types/settings';

class FakeGainNode {
	gain = {
		value: 0,
		setValueAtTime: vi.fn(),
		linearRampToValueAtTime: vi.fn(),
		exponentialRampToValueAtTime: vi.fn()
	};
	connect = vi.fn();
}

class FakeOscillatorNode {
	type: OscillatorType = 'sine';
	frequency = {
		setValueAtTime: vi.fn()
	};
	connect = vi.fn();
	start = vi.fn();
	stop = vi.fn();
}

class FakeBufferSourceNode {
	buffer: AudioBuffer | null = null;
	connect = vi.fn();
	start = vi.fn();
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	static resumeModes: ('ok' | 'reject')[] = [];
	static decodeShouldFail = false;

	state: AudioContextState | 'interrupted' = 'suspended';
	onstatechange: (() => void) | null = null;
	currentTime = 0;
	destination = {} as AudioNode;
	resumeMode: 'ok' | 'reject';
	oscillatorCount = 0;
	bufferSourceCount = 0;

	constructor() {
		this.resumeMode = FakeAudioContext.resumeModes.shift() ?? 'ok';
		FakeAudioContext.instances.push(this);
	}

	async resume() {
		if (this.resumeMode === 'reject') {
			throw new Error('resume failed');
		}
		this.state = 'running';
		this.onstatechange?.();
	}

	async close() {
		this.state = 'closed';
		this.onstatechange?.();
	}

	createOscillator() {
		this.oscillatorCount += 1;
		return new FakeOscillatorNode() as unknown as OscillatorNode;
	}

	createGain() {
		return new FakeGainNode() as unknown as GainNode;
	}

	createBufferSource() {
		this.bufferSourceCount += 1;
		return new FakeBufferSourceNode() as unknown as AudioBufferSourceNode;
	}

	async decodeAudioData(buffer: ArrayBuffer) {
		if (FakeAudioContext.decodeShouldFail) {
			throw new Error('decode failed');
		}
		return { byteLength: buffer.byteLength } as unknown as AudioBuffer;
	}
}

const settings: SoundSettings = {
	enabled: true,
	volume: 60,
	theme: 'chime_soft'
};

describe('playCompletion audio-context resilience', () => {
	let visibilityState: DocumentVisibilityState = 'visible';
	let standaloneMode = false;
	let htmlAudioConstructed = 0;

	beforeEach(() => {
		vi.useRealTimers();
		vi.resetModules();
		FakeAudioContext.instances = [];
		FakeAudioContext.resumeModes = [];
		FakeAudioContext.decodeShouldFail = false;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(16))
			})
		);
		Object.defineProperty(window, 'AudioContext', {
			configurable: true,
			value: FakeAudioContext
		});
		visibilityState = 'visible';
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => visibilityState
		});
		standaloneMode = false;
		Object.defineProperty(window.navigator, 'standalone', {
			configurable: true,
			get: () => standaloneMode
		});
		htmlAudioConstructed = 0;
		Object.defineProperty(window, 'Audio', {
			configurable: true,
			value: class {
				preload = '';
				volume = 0;

				constructor(src: string) {
					void src;
					htmlAudioConstructed += 1;
				}

				async play() {
					return;
				}
			}
		});
	});

	it('rebuilds the WebAudio context when prior context was closed', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);
		expect(FakeAudioContext.instances).toHaveLength(1);

		FakeAudioContext.instances[0].state = 'closed';
		await playCompletion(settings);

		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[1].state).toBe('running');
	});

	it('rebuilds the context when resume fails on stale state', async () => {
		FakeAudioContext.resumeModes = ['reject', 'ok'];
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);

		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[1].state).toBe('running');
	});

	it('rebuilds a running context after app backgrounding', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);
		expect(FakeAudioContext.instances).toHaveLength(1);

		visibilityState = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		visibilityState = 'visible';

		await playCompletion(settings);
		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[1].state).toBe('running');
	});

	it('recycles long-lived contexts in iOS standalone mode', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-02-09T00:00:00Z'));
		standaloneMode = true;
		const { playCompletion } = await import('./sound');

		await playCompletion(settings);
		expect(FakeAudioContext.instances).toHaveLength(1);

		vi.advanceTimersByTime(120001);
		await playCompletion(settings);
		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[1].state).toBe('running');
	});

	it('plays each built-in theme without custom file flow', async () => {
		const { playCompletion } = await import('./sound');
		const themes: SoundSettings['theme'][] = [
			'chime_soft',
			'click_pop',
			'sparkle_short',
			'wood_tick',
			'bell_crisp',
			'marimba_blip',
			'pulse_soft'
		];

		for (const theme of themes) {
			await playCompletion({
				...settings,
				theme
			});
		}

		expect(FakeAudioContext.instances).toHaveLength(1);
		expect(FakeAudioContext.instances[0].oscillatorCount).toBeGreaterThan(0);
	});

	it('uses custom file via WebAudio and caches decoded buffers', async () => {
		const { playCompletion } = await import('./sound');
		const customSettings: SoundSettings = {
			...settings,
			theme: 'custom_file',
			customSoundFilesJson: JSON.stringify([{ dataUrl: 'data:audio/wav;base64,AAAA' }])
		};

		await playCompletion(customSettings);
		await playCompletion(customSettings);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(FakeAudioContext.instances[0].bufferSourceCount).toBe(2);
	});

	it('falls back to HTML audio when custom WebAudio decode fails', async () => {
		FakeAudioContext.decodeShouldFail = true;
		const { playCompletion } = await import('./sound');
		const customSettings: SoundSettings = {
			...settings,
			theme: 'custom_file',
			customSoundDataUrl: 'data:audio/wav;base64,AAAA',
			customSoundFileName: 'ding.wav'
		};

		await playCompletion(customSettings);

		expect(htmlAudioConstructed).toBe(1);
	});

	it('falls back to chime when custom payload is invalid or unavailable', async () => {
		const { playCompletion } = await import('./sound');
		const invalidCustom: SoundSettings = {
			...settings,
			theme: 'custom_file',
			customSoundFilesJson: '{not-valid-json'
		};

		await playCompletion(invalidCustom);

		expect(FakeAudioContext.instances[0].oscillatorCount).toBe(2);
	});

	it('does nothing when disabled or effectively muted', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion({
			...settings,
			enabled: false
		});
		await playCompletion({
			...settings,
			volume: 0
		});

		expect(FakeAudioContext.instances).toHaveLength(0);
	});
});
