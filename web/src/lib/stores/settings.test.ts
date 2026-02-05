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
			customSoundFileId: undefined
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
});
