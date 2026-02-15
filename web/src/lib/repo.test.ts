import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoundSettings } from '$shared/types/settings';

const mocks = vi.hoisted(() => ({
	getDb: vi.fn()
}));

vi.mock('./data/idb', () => ({
	getDb: mocks.getDb
}));

import { repo } from './data/repo';

const soundKey = 'tasksync:sound-settings';

const baseSettings: SoundSettings = {
	enabled: true,
	volume: 60,
	theme: 'chime_soft'
};

describe('repo', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it('returns empty collections when IndexedDB is unavailable', async () => {
		mocks.getDb.mockReturnValueOnce(null);

		await expect(repo.loadAll()).resolves.toEqual({ lists: [], tasks: [] });
	});

	it('loads lists and tasks from IndexedDB', async () => {
		const db = {
			getAll: vi
				.fn()
				.mockResolvedValueOnce([{ id: 'l1', name: 'List', order: 'a' }])
				.mockResolvedValueOnce([{ id: 't1', title: 'Task', list_id: 'l1' }])
		};
		mocks.getDb.mockReturnValueOnce(Promise.resolve(db));

		const loaded = await repo.loadAll();

		expect(db.getAll).toHaveBeenNthCalledWith(1, 'lists');
		expect(db.getAll).toHaveBeenNthCalledWith(2, 'tasks');
		expect(loaded.lists).toHaveLength(1);
		expect(loaded.tasks).toHaveLength(1);
	});

	it('saves lists and tasks through readwrite transactions', async () => {
		const txStore = {
			clear: vi.fn().mockResolvedValue(undefined),
			put: vi.fn().mockResolvedValue(undefined)
		};
		const tx = { store: txStore, done: Promise.resolve() };
		const db = {
			transaction: vi.fn().mockReturnValue(tx)
		};
		mocks.getDb.mockReturnValue(Promise.resolve(db));

		await repo.saveLists([{ id: 'l1', name: 'List', order: 'a' }]);
		await repo.saveTasks([{ id: 't1', title: 'Task', list_id: 'l1' } as never]);

		expect(db.transaction).toHaveBeenNthCalledWith(1, 'lists', 'readwrite');
		expect(db.transaction).toHaveBeenNthCalledWith(2, 'tasks', 'readwrite');
		expect(txStore.clear).toHaveBeenCalledTimes(2);
		expect(txStore.put).toHaveBeenCalledTimes(2);
	});

	it('prefers valid localStorage sound settings over IndexedDB', async () => {
		localStorage.setItem(
			soundKey,
			JSON.stringify({
				enabled: false,
				volume: 22,
				theme: 'wood_tick',
				customSoundFilesJson: '[{"dataUrl":"data:audio/wav;base64,AAAA"}]'
			})
		);

		const loaded = await repo.loadSoundSettings();

		expect(loaded).toMatchObject({
			enabled: false,
			volume: 22,
			theme: 'wood_tick'
		});
		expect(mocks.getDb).not.toHaveBeenCalled();
	});

	it('falls back to IndexedDB sound settings and persists normalized localStorage copy', async () => {
		const db = {
			get: vi.fn().mockResolvedValue({
				enabled: true,
				volume: 48,
				theme: 'click_pop',
				customSoundFileId: 'snd-1',
				customSoundDataUrl: 'data:audio/wav;base64,AAAA',
				customSoundFileName: 'ding.wav',
				customSoundFilesJson: '{"invalid":"shape"}',
				profileAttachmentsJson: '{"also":"invalid"}'
			})
		};
		mocks.getDb.mockReturnValueOnce(Promise.resolve(db));

		const loaded = await repo.loadSoundSettings();

		expect(db.get).toHaveBeenCalledWith('settings', 'sound');
		expect(loaded).toEqual({
			enabled: true,
			volume: 48,
			theme: 'click_pop',
			customSoundFileId: 'snd-1',
			customSoundDataUrl: 'data:audio/wav;base64,AAAA',
			customSoundFileName: 'ding.wav',
			customSoundFilesJson: '{"invalid":"shape"}',
			profileAttachmentsJson: '{"also":"invalid"}'
		});
		expect(JSON.parse(localStorage.getItem(soundKey) ?? '{}')).toMatchObject({
			enabled: true,
			volume: 48,
			theme: 'click_pop'
		});
	});

	it('returns null when localStorage is malformed and IndexedDB has no settings', async () => {
		localStorage.setItem(soundKey, '{bad json');
		const db = { get: vi.fn().mockResolvedValue(undefined) };
		mocks.getDb.mockReturnValueOnce(Promise.resolve(db));

		await expect(repo.loadSoundSettings()).resolves.toBeNull();
	});

	it('writes to localStorage even when IndexedDB put fails', async () => {
		const db = {
			put: vi.fn().mockRejectedValue(new Error('write failed'))
		};
		mocks.getDb.mockReturnValueOnce(Promise.resolve(db));

		await expect(repo.saveSoundSettings(baseSettings)).resolves.toBeUndefined();
		expect(db.put).toHaveBeenCalledTimes(1);
		expect(JSON.parse(localStorage.getItem(soundKey) ?? '{}')).toEqual(baseSettings);
	});
});
