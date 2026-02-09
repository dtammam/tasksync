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

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	static resumeModes: ('ok' | 'reject')[] = [];

	state: AudioContextState | 'interrupted' = 'suspended';
	onstatechange: (() => void) | null = null;
	currentTime = 0;
	destination = {} as AudioNode;
	resumeMode: 'ok' | 'reject';

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
		return new FakeOscillatorNode() as unknown as OscillatorNode;
	}

	createGain() {
		return new FakeGainNode() as unknown as GainNode;
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

	beforeEach(() => {
		vi.useRealTimers();
		vi.resetModules();
		FakeAudioContext.instances = [];
		FakeAudioContext.resumeModes = [];
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
});
