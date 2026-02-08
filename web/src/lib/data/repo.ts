import type { List } from '$shared/types/list';
import type { Task } from '$shared/types/task';
import type { SoundSettings } from '$shared/types/settings';
import { getDb } from './idb';

const SOUND_SETTINGS_KEY = 'sound';
const SOUND_SETTINGS_LS_KEY = 'tasksync:sound-settings';

const readSoundSettingsFromLocalStorage = (): SoundSettings | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(SOUND_SETTINGS_LS_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<SoundSettings>;
		if (
			typeof parsed.enabled !== 'boolean' ||
			typeof parsed.volume !== 'number' ||
			typeof parsed.theme !== 'string'
		) {
			return null;
		}
		return {
			enabled: parsed.enabled,
			volume: parsed.volume,
			theme: parsed.theme,
			customSoundFileId: parsed.customSoundFileId,
			customSoundDataUrl: parsed.customSoundDataUrl,
			customSoundFileName: parsed.customSoundFileName,
			profileAttachmentsJson:
				typeof parsed.profileAttachmentsJson === 'string'
					? parsed.profileAttachmentsJson
					: undefined
		};
	} catch {
		return null;
	}
};

const writeSoundSettingsToLocalStorage = (settings: SoundSettings) => {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(SOUND_SETTINGS_LS_KEY, JSON.stringify(settings));
};

export const repo = {
	async loadAll(): Promise<{ lists: List[]; tasks: Task[] }> {
		const db = getDb();
		if (!db) return { lists: [], tasks: [] };
		const $db = await db;
		const [lists, tasks] = await Promise.all([$db.getAll('lists'), $db.getAll('tasks')]);
		return { lists, tasks };
	},
	async saveLists(lists: List[]) {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		const tx = $db.transaction('lists', 'readwrite');
		await tx.store.clear();
		for (const list of lists) await tx.store.put(list);
		await tx.done;
	},
	async saveTasks(tasks: Task[]) {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		const tx = $db.transaction('tasks', 'readwrite');
		await tx.store.clear();
		for (const task of tasks) await tx.store.put(task);
		await tx.done;
	},
	async loadSoundSettings(): Promise<SoundSettings | null> {
		const local = readSoundSettingsFromLocalStorage();
		if (local) return local;
		const db = getDb();
		if (!db) return null;
		const $db = await db;
		const stored = await $db.get('settings', SOUND_SETTINGS_KEY);
		if (!stored) return null;
		const parsed = {
			enabled: stored.enabled,
			volume: stored.volume,
			theme: stored.theme,
			customSoundFileId: stored.customSoundFileId,
			customSoundDataUrl: stored.customSoundDataUrl,
			customSoundFileName: stored.customSoundFileName,
			profileAttachmentsJson:
				typeof stored.profileAttachmentsJson === 'string'
					? stored.profileAttachmentsJson
					: undefined
		};
		writeSoundSettingsToLocalStorage(parsed);
		return parsed;
	},
	async saveSoundSettings(settings: SoundSettings) {
		writeSoundSettingsToLocalStorage(settings);
		const db = getDb();
		if (!db) return;
		const $db = await db;
		try {
			await $db.put('settings', {
				id: SOUND_SETTINGS_KEY,
				...settings
			});
		} catch {
			// localStorage is the immediate source of truth for settings; keep IDB best-effort.
		}
	}
};
