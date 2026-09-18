// The live, owner-editable tag palette (D6 of the tag-palette-settings
// piece). Seeded with DEFAULT_TAG_PALETTE so the app never renders with an
// empty palette before hydration (cold offline boot); hydrated from the
// server on space load. `null` from the server means "this space has never
// saved its own palette" and serves the default -- a server-returned empty
// array (`[]`) is a real, owner-chosen state and is honored as-is, not
// treated the same as null.

import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { auth } from '$lib/stores/auth';
import {
	DEFAULT_TAG_PALETTE,
	rankInPalette,
	labelInPalette,
	type TagPaletteSection
} from '$lib/tags/palette';

const tagPaletteStore = writable<TagPaletteSection[]>(DEFAULT_TAG_PALETTE);

export const tagPalette = {
	subscribe: tagPaletteStore.subscribe,
	async hydrateFromServer() {
		if (!auth.isAuthenticated()) {
			tagPaletteStore.set(DEFAULT_TAG_PALETTE);
			return;
		}
		try {
			const loaded = await api.getTagPalette();
			tagPaletteStore.set(loaded ?? DEFAULT_TAG_PALETTE);
		} catch {
			// Leave the store as-is on a fetch error (still the default, or
			// whatever was last successfully hydrated) rather than clobbering
			// it -- unlike an empty list of members, an empty palette is a
			// meaningfully different (and now legitimate) state, so a
			// transient error must not be mistaken for "owner emptied it."
		}
	},
	async save(next: TagPaletteSection[]): Promise<TagPaletteSection[]> {
		const saved = await api.updateTagPalette(next);
		tagPaletteStore.set(saved);
		return saved;
	},
	clear() {
		tagPaletteStore.set(DEFAULT_TAG_PALETTE);
	}
};

export const currentTagPalette = (): TagPaletteSection[] => get(tagPaletteStore);

export const tagRank = (emoji: string | undefined | null): number =>
	rankInPalette(currentTagPalette(), emoji);

export const tagLabel = (emoji: string | undefined | null): string | undefined =>
	labelInPalette(currentTagPalette(), emoji);
