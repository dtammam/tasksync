// The live, owner-editable tag palette (D6 of the tag-palette-settings
// piece). Seeded with DEFAULT_TAG_PALETTE so the app never renders with an
// empty palette before hydration; hydrated from the server on space load.
// `null` from the server means "this space has never saved its own palette"
// and serves the default -- a server-returned empty array (`[]`) is a real,
// owner-chosen state and is honored as-is, not treated the same as null.
//
// Local cache (fix-regroup-on-load, 2026-11-15): the last palette the server
// confirmed is cached per space in localStorage and applied by
// hydrateFromLocal() during scoped-store hydration, before the first data
// render. Without it, a customized space rendered tag groups in default-palette
// order and regrouped once the (deliberately non-blocking) server fetch landed,
// and offline it never regrouped at all. "Never customized" (server `null`) is
// cached as the absence of the key; `[]` is cached as `[]`.

import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import { createHydrateGuard } from '$lib/stores/hydrateGuard';
import {
	DEFAULT_TAG_PALETTE,
	rankInPalette,
	labelInPalette,
	type TagPaletteSection,
} from '$lib/tags/palette';

const tagPaletteStore = writable<TagPaletteSection[]>(DEFAULT_TAG_PALETTE);
// Bumped by save() and clear() so an older in-flight server fetch can't
// overwrite (or persist over) a newer palette.
const hydrateGuard = createHydrateGuard();

const STORAGE_PREFIX = 'tasksync:tag-palette:';

// The palette belongs to the space, so the key is per space (not per user).
// No authenticated space → no cache.
const storageKey = (): string | null => {
	const state = auth.get();
	if (state.status === 'authenticated' && state.user?.space_id) {
		return `${STORAGE_PREFIX}${state.user.space_id}`;
	}
	return null;
};

const isEntry = (value: unknown): boolean =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as { emoji?: unknown }).emoji === 'string' &&
	typeof (value as { label?: unknown }).label === 'string';

const isSection = (value: unknown): boolean =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as { section?: unknown }).section === 'string' &&
	Array.isArray((value as { entries?: unknown }).entries) &&
	(value as { entries: unknown[] }).entries.every(isEntry);

const isPalette = (value: unknown): value is TagPaletteSection[] =>
	Array.isArray(value) && value.every(isSection);

// Returns the cached palette, or null when there is no (valid) cache.
const readLocal = (key: string): TagPaletteSection[] | null => {
	let raw: string | null;
	try {
		raw = localStorage.getItem(key);
	} catch (err) {
		console.warn('[tagPalette] localStorage unavailable, using default palette', err);
		return null;
	}
	if (raw === null) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (isPalette(parsed)) return parsed;
		console.warn(`[tagPalette] invalid cached palette in ${key}, using default`);
	} catch {
		console.warn(`[tagPalette] unparseable cached palette in ${key}, using default`);
	}
	return null;
};

// `null` = the space has never customized → drop the key (reads as default).
const writeLocal = (key: string, palette: TagPaletteSection[] | null) => {
	try {
		if (palette === null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, JSON.stringify(palette));
		}
	} catch (err) {
		console.warn('[tagPalette] could not persist palette cache', err);
	}
};

export const tagPalette = {
	subscribe: tagPaletteStore.subscribe,
	// Synchronous on purpose: runs inside hydrateScopedStores() so the cached
	// palette is in place before tasks render.
	hydrateFromLocal() {
		const key = typeof localStorage === 'undefined' ? null : storageKey();
		tagPaletteStore.set((key && readLocal(key)) || DEFAULT_TAG_PALETTE);
	},
	async hydrateFromServer() {
		if (!auth.isAuthenticated()) {
			tagPaletteStore.set(DEFAULT_TAG_PALETTE);
			return;
		}
		const key = storageKey();
		const snap = hydrateGuard.snapshot();
		try {
			const loaded = await api.getTagPalette();
			// Discard if the space changed (logout / switch) or a save/clear
			// happened while the fetch was in flight.
			if (!hydrateGuard.isCurrent(snap) || storageKey() !== key) return;
			tagPaletteStore.set(loaded ?? DEFAULT_TAG_PALETTE);
			if (key) writeLocal(key, loaded);
		} catch (err) {
			console.warn('[tagPalette] palette fetch failed, keeping current palette', err);
			// Leave the store as-is on a fetch error (the cached palette, the
			// default, or whatever was last successfully hydrated) rather than
			// clobbering it -- an empty palette is a meaningfully different (and
			// legitimate) state, so a transient error must not be mistaken for
			// "owner emptied it."
		}
	},
	async save(next: TagPaletteSection[]): Promise<TagPaletteSection[]> {
		const key = storageKey();
		hydrateGuard.bump();
		const saved = await api.updateTagPalette(next);
		// The server confirmed this palette for `key`'s space: cache it there
		// even if the user has since switched away, but only show it if that
		// space is still the current one.
		if (key) writeLocal(key, saved);
		if (storageKey() === key) tagPaletteStore.set(saved);
		return saved;
	},
	clear() {
		hydrateGuard.bump();
		tagPaletteStore.set(DEFAULT_TAG_PALETTE);
	},
};

export const currentTagPalette = (): TagPaletteSection[] => get(tagPaletteStore);

export const tagRank = (emoji: string | undefined | null): number =>
	rankInPalette(currentTagPalette(), emoji);

export const tagLabel = (emoji: string | undefined | null): string | undefined =>
	labelInPalette(currentTagPalette(), emoji);
