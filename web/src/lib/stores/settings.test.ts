import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';

vi.mock('$lib/api/client', () => ({
	api: {
		getSoundSettings: vi.fn(),
		updateSoundSettings: vi.fn()
	}
}));

vi.mock('$lib/stores/auth', () => ({
	auth: {
		get: vi.fn().mockReturnValue({ status: 'anonymous', user: null })
	}
}));

import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
const mockedApi = vi.mocked(api);
const mockedAuth = vi.mocked(auth);

import type { SoundSettings } from '$shared/types/settings';
import { defaultSoundSettings, soundSettings } from './settings';

const waitForWrites = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('sound settings store', () => {
	beforeEach(async () => {
		await repo.saveSoundSettings(defaultSoundSettings);
		await soundSettings.hydrateFromDb();
	});

	it('hydrates saved values from IndexedDB', async () => {
		await repo.saveSoundSettings({
			enabled: false,
			volume: 22,
			theme: 'wood_tick'
		});

		await soundSettings.hydrateFromDb();

		expect(get(soundSettings)).toMatchObject({
			enabled: false,
			volume: 22,
			theme: 'wood_tick'
		});
	});

	it('clamps and persists volume changes', async () => {
		soundSettings.setVolume(180);
		await waitForWrites();

		expect(get(soundSettings).volume).toBe(100);
		expect((await repo.loadSoundSettings())?.volume).toBe(100);
	});

	it('persists enable/disable updates', async () => {
		soundSettings.setEnabled(false);
		await waitForWrites();

		expect(get(soundSettings).enabled).toBe(false);
		expect((await repo.loadSoundSettings())?.enabled).toBe(false);
	});

	it('accepts and persists newer theme options', async () => {
		soundSettings.setTheme('bell_crisp');
		await waitForWrites();

		expect(get(soundSettings).theme).toBe('bell_crisp');
		expect((await repo.loadSoundSettings())?.theme).toBe('bell_crisp');
	});

	it('stores and clears custom sound payloads', async () => {
		soundSettings.setCustomSound('data:audio/wav;base64,AAAA', 'ding.wav');
		await waitForWrites();

		expect(get(soundSettings)).toMatchObject({
			theme: 'custom_file',
			customSoundFileName: 'ding.wav',
			customSoundDataUrl: 'data:audio/wav;base64,AAAA'
		});
		expect(get(soundSettings).customSoundFilesJson).toContain('data:audio/wav;base64,AAAA');

		soundSettings.clearCustomSound();
		await waitForWrites();

		expect(get(soundSettings).theme).toBe(defaultSoundSettings.theme);
		expect(get(soundSettings).customSoundDataUrl).toBeUndefined();
		expect(get(soundSettings).customSoundFilesJson).toBeUndefined();
	});

	it('stores multiple custom sounds and keeps first entry as legacy-compatible default', async () => {
		soundSettings.setCustomSounds([
			{ dataUrl: 'data:audio/wav;base64,AAAA', fileName: 'ding.wav', fileId: 'snd-1' },
			{ dataUrl: 'data:audio/wav;base64,BBBB', fileName: 'tap.wav', fileId: 'snd-2' }
		]);
		await waitForWrites();

		const current = get(soundSettings);
		expect(current.theme).toBe('custom_file');
		expect(current.customSoundFileId).toBe('snd-1');
		expect(current.customSoundFileName).toBe('ding.wav');
		expect(current.customSoundDataUrl).toBe('data:audio/wav;base64,AAAA');
		expect(current.customSoundFilesJson).toContain('tap.wav');
	});
});

const anonState = {
	status: 'anonymous' as const,
	mode: 'token' as const,
	source: null,
	user: null,
	error: null
};
const authedState = {
	status: 'authenticated' as const,
	mode: 'token' as const,
	source: 'token' as const,
	user: {
		user_id: 'u1',
		space_id: 's1',
		email: 'u1@example.com',
		display: 'User One',
		role: 'admin' as const
	},
	error: null
};

describe('sound settings — setAll and server sync', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		mockedAuth.get.mockReturnValue(anonState);
		await repo.saveSoundSettings(defaultSoundSettings);
		await soundSettings.hydrateFromDb();
	});

	it('setAll normalizes and persists all fields', async () => {
		soundSettings.setAll({
			enabled: false,
			volume: 50,
			theme: 'bell_crisp'
		});
		await waitForWrites();

		expect(get(soundSettings).enabled).toBe(false);
		expect(get(soundSettings).volume).toBe(50);
		expect(get(soundSettings).theme).toBe('bell_crisp');
		expect((await repo.loadSoundSettings())?.theme).toBe('bell_crisp');
	});

	it('setAll clamps volume to 0–100 range', async () => {
		soundSettings.setAll({ enabled: true, volume: 150, theme: 'chime_soft' });
		await waitForWrites();

		expect(get(soundSettings).volume).toBe(100);
	});

	it('hydrateFromServer sets store from remote and persists locally', async () => {
		mockedAuth.get.mockReturnValue(authedState);
		mockedApi.getSoundSettings.mockResolvedValue({
			enabled: false,
			volume: 40,
			theme: 'sparkle_short'
		});

		await soundSettings.hydrateFromServer();

		expect(get(soundSettings).theme).toBe('sparkle_short');
		expect(get(soundSettings).volume).toBe(40);
		expect((await repo.loadSoundSettings())?.theme).toBe('sparkle_short');
	});

	it('hydrateFromServer is a no-op when not authenticated', async () => {
		mockedAuth.get.mockReturnValue(anonState);
		mockedApi.getSoundSettings.mockResolvedValue({ enabled: false, volume: 10, theme: 'click_pop' });

		await soundSettings.hydrateFromServer();

		expect(mockedApi.getSoundSettings).not.toHaveBeenCalled();
		expect(get(soundSettings).theme).toBe(defaultSoundSettings.theme);
	});

	it('hydrateGuardVersion race guard: ignores server response when local mutation occurred during fetch', async () => {
		mockedAuth.get.mockReturnValue(authedState);

		let resolveRemote!: (value: SoundSettings) => void;
		const pendingRemote = new Promise<SoundSettings>((resolve) => {
			resolveRemote = resolve;
		});
		mockedApi.getSoundSettings.mockReturnValue(pendingRemote);

		const fetching = soundSettings.hydrateFromServer();
		// Local mutation bumps hydrateGuardVersion while server fetch is in-flight
		soundSettings.setTheme('bell_crisp');
		resolveRemote({ enabled: true, volume: 80, theme: 'wood_tick' } as SoundSettings);
		await fetching;

		// Local mutation wins — stale server value discarded
		expect(get(soundSettings).theme).toBe('bell_crisp');
	});
});
