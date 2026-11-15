import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({
	api: {
		getTagPalette: vi.fn(),
		updateTagPalette: vi.fn(),
	},
}));

vi.mock('$lib/stores/auth', () => ({
	auth: {
		isAuthenticated: vi.fn(),
		get: vi.fn(),
	},
}));

import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { tagPalette, currentTagPalette, tagRank, tagLabel } from './tagPalette';
import { DEFAULT_TAG_PALETTE, type TagPaletteSection } from '$lib/tags/palette';

const mockedApi = vi.mocked(api);
const mockedAuth = vi.mocked(auth);

const CUSTOM = [{ section: 'Custom', entries: [{ emoji: '🚀', label: 'Launch' }] }];

const signedInTo = (spaceId: string) => {
	mockedAuth.isAuthenticated.mockReturnValue(true);
	mockedAuth.get.mockReturnValue({
		status: 'authenticated',
		source: 'token',
		user: {
			user_id: 'u1',
			email: 'u1@example.com',
			display: 'U1',
			space_id: spaceId,
			role: 'admin',
		},
		error: null,
	} as ReturnType<typeof auth.get>);
};

const signedOut = () => {
	mockedAuth.isAuthenticated.mockReturnValue(false);
	mockedAuth.get.mockReturnValue({
		status: 'anonymous',
		source: null,
		user: null,
		error: null,
	} as ReturnType<typeof auth.get>);
};

const KEY_S1 = 'tasksync:tag-palette:s1';
const KEY_S2 = 'tasksync:tag-palette:s2';

describe('tagPalette store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.restoreAllMocks();
		localStorage.clear();
		signedOut();
		tagPalette.clear();
	});

	it('seeds the default palette before any hydration', () => {
		expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
	});

	it('serves the default palette when the server has none saved (null)', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getTagPalette.mockResolvedValue(null);

		await tagPalette.hydrateFromServer();

		expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
	});

	it('adopts the saved palette when the server has one', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getTagPalette.mockResolvedValue(CUSTOM);

		await tagPalette.hydrateFromServer();

		expect(currentTagPalette()).toEqual(CUSTOM);
	});

	it('honors a server-saved empty palette as-is, not as the default', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getTagPalette.mockResolvedValue([]);

		await tagPalette.hydrateFromServer();

		expect(currentTagPalette()).toEqual([]);
	});

	it('clears to the default palette when not authenticated', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(false);
		await tagPalette.hydrateFromServer();
		expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
		expect(mockedApi.getTagPalette).not.toHaveBeenCalled();
	});

	it('leaves the current palette untouched when the fetch fails', async () => {
		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getTagPalette.mockResolvedValue(CUSTOM);
		await tagPalette.hydrateFromServer();
		expect(currentTagPalette()).toEqual(CUSTOM);

		mockedApi.getTagPalette.mockRejectedValue(new Error('network error'));
		await tagPalette.hydrateFromServer();

		expect(currentTagPalette()).toEqual(CUSTOM);
	});

	it('save() updates the store from the server response', async () => {
		mockedApi.updateTagPalette.mockResolvedValue(CUSTOM);

		const saved = await tagPalette.save(CUSTOM);

		expect(saved).toEqual(CUSTOM);
		expect(currentTagPalette()).toEqual(CUSTOM);
	});

	it('tagRank/tagLabel resolve against the current (hydrated) palette, not the default', async () => {
		expect(tagLabel('🚀')).toBeUndefined();

		mockedAuth.isAuthenticated.mockReturnValue(true);
		mockedApi.getTagPalette.mockResolvedValue(CUSTOM);
		await tagPalette.hydrateFromServer();

		expect(tagLabel('🚀')).toBe('Launch');
		expect(tagRank('🚀')).toBe(0);
		expect(tagLabel('⭐')).toBeUndefined();
	});

	describe('local cache', () => {
		it('round-trips: a server palette is cached and restored by hydrateFromLocal()', async () => {
			signedInTo('s1');
			mockedApi.getTagPalette.mockResolvedValue(CUSTOM);
			await tagPalette.hydrateFromServer();
			expect(JSON.parse(localStorage.getItem(KEY_S1) ?? 'null')).toEqual(CUSTOM);

			tagPalette.clear();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);

			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual(CUSTOM);
			expect(tagRank('🚀')).toBe(0);
		});

		it('serves the default with no cache, without warning', () => {
			signedInTo('s1');
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(warn).not.toHaveBeenCalled();
		});

		it.each([
			['unparseable JSON', '{not json'],
			['a non-array', JSON.stringify({ section: 'x', entries: [] })],
			['a section without entries', JSON.stringify([{ section: 'x' }])],
			['a non-string section name', JSON.stringify([{ section: 1, entries: [] }])],
			[
				'an entry missing its label',
				JSON.stringify([{ section: 'x', entries: [{ emoji: '🚀' }] }]),
			],
			['a null element', JSON.stringify([null])],
			['JSON null', 'null'],
		])('invalid cache (%s) → default palette + console.warn, never throws', (_name, raw) => {
			signedInTo('s1');
			// Start from a non-default palette to prove the store is reset, not left as-is.
			localStorage.setItem(KEY_S1, JSON.stringify(CUSTOM));
			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual(CUSTOM);
			localStorage.setItem(KEY_S1, raw);
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			expect(() => tagPalette.hydrateFromLocal()).not.toThrow();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(warn).toHaveBeenCalledTimes(1);
		});

		it('a server null ("never customized") removes the cache key, so local reads the default', async () => {
			signedInTo('s1');
			localStorage.setItem(KEY_S1, JSON.stringify(CUSTOM));
			mockedApi.getTagPalette.mockResolvedValue(null);

			await tagPalette.hydrateFromServer();

			expect(localStorage.getItem(KEY_S1)).toBeNull();
			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
		});

		it('a server [] is cached as [] and restored as [], not as the default', async () => {
			signedInTo('s1');
			mockedApi.getTagPalette.mockResolvedValue([]);

			await tagPalette.hydrateFromServer();

			expect(localStorage.getItem(KEY_S1)).toBe('[]');
			tagPalette.clear();
			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual([]);
		});

		it('save() persists the server-confirmed palette', async () => {
			signedInTo('s1');
			mockedApi.updateTagPalette.mockResolvedValue(CUSTOM);

			await tagPalette.save(CUSTOM);

			expect(JSON.parse(localStorage.getItem(KEY_S1) ?? 'null')).toEqual(CUSTOM);
		});

		it('a failed save() leaves the cache untouched', async () => {
			signedInTo('s1');
			localStorage.setItem(KEY_S1, JSON.stringify([]));
			mockedApi.updateTagPalette.mockRejectedValue(new Error('500'));

			await expect(tagPalette.save(CUSTOM)).rejects.toThrow('500');

			expect(localStorage.getItem(KEY_S1)).toBe('[]');
		});

		it('a failed fetch keeps the cached palette (store and storage)', async () => {
			signedInTo('s1');
			localStorage.setItem(KEY_S1, JSON.stringify(CUSTOM));
			tagPalette.hydrateFromLocal();
			mockedApi.getTagPalette.mockRejectedValue(new Error('offline'));

			await tagPalette.hydrateFromServer();

			expect(currentTagPalette()).toEqual(CUSTOM);
			expect(JSON.parse(localStorage.getItem(KEY_S1) ?? 'null')).toEqual(CUSTOM);
		});

		it("is isolated per space: another space never sees this space's cache", async () => {
			signedInTo('s1');
			mockedApi.getTagPalette.mockResolvedValue(CUSTOM);
			await tagPalette.hydrateFromServer();

			signedInTo('s2');
			tagPalette.hydrateFromLocal();

			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(localStorage.getItem(KEY_S2)).toBeNull();
		});

		it('signed out: hydrateFromLocal() serves the default even when a space cache exists', () => {
			localStorage.setItem(KEY_S1, JSON.stringify(CUSTOM));
			signedOut();
			tagPalette.hydrateFromLocal();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
		});

		it('a fetch that resolves after a space switch is discarded (not shown, not cached under the new space)', async () => {
			signedInTo('s1');
			let resolveFetch: (value: typeof CUSTOM) => void = () => undefined;
			mockedApi.getTagPalette.mockReturnValue(
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
			);
			const inFlight = tagPalette.hydrateFromServer();

			signedInTo('s2');
			tagPalette.hydrateFromLocal();
			resolveFetch(CUSTOM);
			await inFlight;

			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(localStorage.getItem(KEY_S2)).toBeNull();
			expect(localStorage.getItem(KEY_S1)).toBeNull();
		});

		it('a fetch that resolves after a logout clear() is discarded', async () => {
			signedInTo('s1');
			let resolveFetch: (value: typeof CUSTOM) => void = () => undefined;
			mockedApi.getTagPalette.mockReturnValue(
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
			);
			const inFlight = tagPalette.hydrateFromServer();

			signedOut();
			tagPalette.clear();
			resolveFetch(CUSTOM);
			await inFlight;

			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(localStorage.getItem(KEY_S1)).toBeNull();
		});

		it('a stale fetch that resolves after save() does not overwrite the saved palette', async () => {
			signedInTo('s1');
			let resolveFetch: (value: TagPaletteSection[] | null) => void = () => undefined;
			mockedApi.getTagPalette.mockReturnValue(
				new Promise<TagPaletteSection[] | null>((resolve) => {
					resolveFetch = resolve;
				})
			);
			const inFlight = tagPalette.hydrateFromServer();

			mockedApi.updateTagPalette.mockResolvedValue(CUSTOM);
			await tagPalette.save(CUSTOM);
			resolveFetch(null);
			await inFlight;

			expect(currentTagPalette()).toEqual(CUSTOM);
			expect(JSON.parse(localStorage.getItem(KEY_S1) ?? 'null')).toEqual(CUSTOM);
		});

		it('a localStorage that throws on access → default + console.warn, never throws', () => {
			signedInTo('s1');
			vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
				throw new Error('SecurityError');
			});
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			expect(() => tagPalette.hydrateFromLocal()).not.toThrow();
			expect(currentTagPalette()).toEqual(DEFAULT_TAG_PALETTE);
			expect(warn).toHaveBeenCalledTimes(1);
		});
	});
});
