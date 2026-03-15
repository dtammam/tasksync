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
	onended: (() => void) | null = null;
	start = vi.fn().mockImplementation(() => {
		// Simulate immediate playback end so onended fires synchronously in tests
		queueMicrotask(() => this.onended?.());
	});
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	static resumeModes: ('ok' | 'reject')[] = [];
	static decodeShouldFail = false;

	state: AudioContextState | 'interrupted' = 'suspended';
	currentTime = 0;
	destination = {} as AudioNode;
	resumeMode: 'ok' | 'reject';
	oscillatorCount = 0;
	bufferSourceCount = 0;
	closed = false;

	constructor() {
		this.resumeMode = FakeAudioContext.resumeModes.shift() ?? 'ok';
		FakeAudioContext.instances.push(this);
	}

	async resume() {
		if (this.resumeMode === 'reject') {
			throw new Error('resume failed');
		}
		this.state = 'running';
	}

	async close() {
		this.state = 'closed';
		this.closed = true;
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

describe('playCompletion — fresh context per play', () => {
	let htmlAudioConstructed = 0;

	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
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

	it('creates a fresh AudioContext for each playCompletion call', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);
		await playCompletion(settings);
		await playCompletion(settings);

		expect(FakeAudioContext.instances).toHaveLength(3);
	});

	it('closes the context after playback completes', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);
		await vi.runAllTimersAsync();

		expect(FakeAudioContext.instances).toHaveLength(1);
		expect(FakeAudioContext.instances[0].closed).toBe(true);
	});

	it('rebuilds when first resume fails', async () => {
		FakeAudioContext.resumeModes = ['reject', 'ok'];
		const { playCompletion } = await import('./sound');
		await playCompletion(settings);

		await vi.runAllTimersAsync();
		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[1].state).toBe('closed');
		expect(FakeAudioContext.instances[1].oscillatorCount).toBeGreaterThan(0);
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
			await playCompletion({ ...settings, theme });
		}

		await vi.runAllTimersAsync();
		expect(FakeAudioContext.instances).toHaveLength(7);
		for (const ctx of FakeAudioContext.instances) {
			expect(ctx.oscillatorCount).toBeGreaterThan(0);
			expect(ctx.closed).toBe(true);
		}
	});

	it('decodes custom file and plays via WebAudio', async () => {
		const { playCompletion } = await import('./sound');
		const customSettings: SoundSettings = {
			...settings,
			theme: 'custom_file',
			customSoundFilesJson: JSON.stringify([{ dataUrl: 'data:audio/wav;base64,AAAA' }])
		};

		await playCompletion(customSettings);

		await vi.runAllTimersAsync();
		expect(FakeAudioContext.instances).toHaveLength(1);
		expect(FakeAudioContext.instances[0].bufferSourceCount).toBe(1);
		expect(FakeAudioContext.instances[0].closed).toBe(true);
	});

	it('re-decodes custom file on each play (no cross-context cache)', async () => {
		const { playCompletion } = await import('./sound');
		const customSettings: SoundSettings = {
			...settings,
			theme: 'custom_file',
			customSoundFilesJson: JSON.stringify([{ dataUrl: 'data:audio/wav;base64,AAAA' }])
		};

		await playCompletion(customSettings);
		await playCompletion(customSettings);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(FakeAudioContext.instances).toHaveLength(2);
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

		await vi.runAllTimersAsync();
		expect(FakeAudioContext.instances[0].oscillatorCount).toBe(2);
		expect(FakeAudioContext.instances[0].closed).toBe(true);
	});

	it('does nothing when disabled or effectively muted', async () => {
		const { playCompletion } = await import('./sound');
		await playCompletion({ ...settings, enabled: false });
		await playCompletion({ ...settings, volume: 0 });

		expect(FakeAudioContext.instances).toHaveLength(0);
	});
});

describe('playUrl — fresh context per play', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useFakeTimers();
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
		Object.defineProperty(window, 'Audio', {
			configurable: true,
			value: class {
				preload = '';
				volume = 0;
				async play() {
					return;
				}
			}
		});
	});

	it('creates and closes a fresh context for each playUrl call', async () => {
		const { playUrl } = await import('./sound');
		await playUrl('/streak/ddr/announcer/clip.mp3', 60);
		await playUrl('/streak/ddr/drop/clip.mp3', 60);
		await vi.runAllTimersAsync();

		expect(FakeAudioContext.instances).toHaveLength(2);
		expect(FakeAudioContext.instances[0].closed).toBe(true);
		expect(FakeAudioContext.instances[1].closed).toBe(true);
	});

	it('falls back to HTML Audio when WebAudio decode fails', async () => {
		FakeAudioContext.decodeShouldFail = true;
		let htmlPlayed = false;
		Object.defineProperty(window, 'Audio', {
			configurable: true,
			value: class {
				preload = '';
				volume = 0;
				async play() {
					htmlPlayed = true;
				}
			}
		});

		const { playUrl } = await import('./sound');
		await playUrl('/streak/ddr/announcer/clip.mp3', 60);

		expect(htmlPlayed).toBe(true);
	});

	it('does nothing when volume is zero', async () => {
		const { playUrl } = await import('./sound');
		await playUrl('/streak/ddr/announcer/clip.mp3', 0);

		expect(FakeAudioContext.instances).toHaveLength(0);
	});
});
