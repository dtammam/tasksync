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

		soundSettings.clearCustomSound();
		await waitForWrites();

		expect(get(soundSettings).theme).toBe(defaultSoundSettings.theme);
		expect(get(soundSettings).customSoundDataUrl).toBeUndefined();
	});
});
