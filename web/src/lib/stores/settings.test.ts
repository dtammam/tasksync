import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { repo } from '$lib/data/repo';
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

		expect(get(soundSettings)).toEqual({
			enabled: false,
			volume: 22,
			theme: 'wood_tick',
			customSoundFileId: undefined,
			customSounds: []
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

	it('stores, selects, and removes custom sounds', async () => {
		soundSettings.addCustomSound('bell.mp3', 'data:audio/mpeg;base64,AAAA');
		await waitForWrites();
		soundSettings.addCustomSound('chime.wav', 'data:audio/wav;base64,BBBB');
		await waitForWrites();

		const withCustom = get(soundSettings);
		expect(withCustom.theme).toBe('custom_file');
		expect(withCustom.customSounds?.length).toBe(2);
		expect(withCustom.customSoundFileId).toBe(withCustom.customSounds?.[0]?.id);

		const secondId = withCustom.customSounds?.[1]?.id ?? '';
		soundSettings.selectCustomSound(secondId);
		await waitForWrites();
		expect(get(soundSettings).customSoundFileId).toBe(secondId);

		soundSettings.deleteCustomSound(secondId);
		await waitForWrites();
		expect(get(soundSettings).customSounds?.length).toBe(1);
	});

	it('resets custom sound library to defaults', async () => {
		soundSettings.addCustomSound('bell.mp3', 'data:audio/mpeg;base64,AAAA');
		await waitForWrites();
		soundSettings.resetDefaultSounds();
		await waitForWrites();

		expect(get(soundSettings).theme).toBe(defaultSoundSettings.theme);
		expect(get(soundSettings).customSoundFileId).toBeUndefined();
		expect(get(soundSettings).customSounds).toEqual([]);
	});
});
