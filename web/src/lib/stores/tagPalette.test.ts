import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/client', () => ({
	api: {
		getTagPalette: vi.fn(),
		updateTagPalette: vi.fn()
	}
}));

vi.mock('$lib/stores/auth', () => ({
	auth: {
		isAuthenticated: vi.fn()
	}
}));

import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { tagPalette, currentTagPalette, tagRank, tagLabel } from './tagPalette';
import { DEFAULT_TAG_PALETTE } from '$lib/tags/palette';

const mockedApi = vi.mocked(api);
const mockedAuth = vi.mocked(auth);

const CUSTOM = [{ section: 'Custom', entries: [{ emoji: '🚀', label: 'Launch' }] }];

describe('tagPalette store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});
