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
	}

	async close() {
		this.state = 'closed';
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
	beforeEach(() => {
		vi.resetModules();
		FakeAudioContext.instances = [];
		FakeAudioContext.resumeModes = [];
		Object.defineProperty(window, 'AudioContext', {
			configurable: true,
			value: FakeAudioContext
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
});
