// The built-in default tag palette (originally Piece 3's D8). Owner-editable
// via the Tags settings panel as of the tag-palette-settings piece -- this
// array is now only the fallback used when a space has never saved its own
// palette (server column is null) or before the client has hydrated one
// (cold offline boot). See `$lib/stores/tagPalette` for the live, editable
// palette and the `tagRank`/`tagLabel` lookups callers should actually use.

import type { TagPaletteSection } from '$shared/types/tags';

export type { TagPaletteEntry, TagPaletteSection } from '$shared/types/tags';

export const DEFAULT_TAG_PALETTE: TagPaletteSection[] = [
	{
		section: 'Time / priority',
		entries: [
			{ emoji: '⭐', label: 'Starred' },
			{ emoji: '⏰', label: 'Time-sensitive' },
			{ emoji: '🎯', label: 'Goal-focused' }
		]
	},
	{
		section: 'Grocery aisles',
		entries: [
			{ emoji: '🥦', label: 'Produce' },
			{ emoji: '🥛', label: 'Dairy' },
			{ emoji: '🥩', label: 'Meat' },
			{ emoji: '🍞', label: 'Bakery' },
			{ emoji: '🧊', label: 'Frozen' },
			{ emoji: '🧺', label: 'Household / other' }
		]
	},
	{
		section: 'Household & chores',
		entries: [
			{ emoji: '🧹', label: 'Cleaning' },
			{ emoji: '🔧', label: 'Maintenance' },
			{ emoji: '🐾', label: 'Pets' }
		]
	},
	{
		section: 'Money',
		entries: [{ emoji: '💰', label: 'Financial' }]
	},
	{
		section: 'Health',
		entries: [{ emoji: '💊', label: 'Health / medical' }]
	},
	{
		section: 'Family',
		entries: [{ emoji: '👨‍👩‍👧', label: 'Family' }]
	},
	{
		section: 'Recurring',
		entries: [{ emoji: '🔁', label: 'Recurring' }]
	}
];

// Pure, palette-parameterized lookups -- no hidden global state, so they work
// the same whether called with DEFAULT_TAG_PALETTE or a space's saved one.
// `$lib/stores/tagPalette` wraps these against the live palette; callers that
// need the *current* (possibly owner-edited) palette should use that module's
// `tagRank`/`tagLabel`, not these, directly.

export const paletteOrder = (palette: TagPaletteSection[]): string[] =>
	palette.flatMap((s) => s.entries.map((e) => e.emoji));

// Known tags rank by palette position; an emoji outside the palette (set via
// direct IDB/API access, or removed from the palette while still in use on a
// task) gets its own single bucket rank, after every known tag but before
// "untagged" -- distinct from any known tag's rank, so it never silently ties
// with (and inherits order-dependent placement from) the last palette entry.
// Untagged always ranks last. Note this returns a rank only -- when multiple
// *different* unrecognized emoji are present, callers must break ties on the
// emoji string itself (see groupTasksByTag) or their relative order is
// undefined here.
export const rankInPalette = (
	palette: TagPaletteSection[],
	emoji: string | undefined | null
): number => {
	const order = paletteOrder(palette);
	if (!emoji) return order.length + 1;
	const index = order.indexOf(emoji);
	return index === -1 ? order.length : index;
};

export const labelInPalette = (
	palette: TagPaletteSection[],
	emoji: string | undefined | null
): string | undefined => {
	if (!emoji) return undefined;
	for (const section of palette) {
		const found = section.entries.find((e) => e.emoji === emoji);
		if (found) return found.label;
	}
	return undefined;
};
