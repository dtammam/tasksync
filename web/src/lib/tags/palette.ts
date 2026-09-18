// The curated tag palette (D8). Adding a tag here is the whole change —
// no other file needs to know about a new entry. Section order here is
// also the fixed group-order used by list/My Day grouping (D9).

export interface TagPaletteEntry {
	emoji: string;
	label: string;
}

export interface TagPaletteSection {
	section: string;
	entries: TagPaletteEntry[];
}

export const TAG_PALETTE: TagPaletteSection[] = [
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

// Flat lookup order, used to sort/group tagged items by fixed palette order.
export const TAG_ORDER: string[] = TAG_PALETTE.flatMap((s) => s.entries.map((e) => e.emoji));

// Known tags rank by palette position; an emoji outside the palette (set via
// direct IDB/API access, or one removed from a later palette edit while still
// in use) gets its own single bucket rank, after every known tag but before
// "untagged" -- distinct from any known tag's rank, so it never silently ties
// with (and inherits order-dependent placement from) the last palette entry.
// Untagged always ranks last. Note this returns a rank only -- when multiple
// *different* unrecognized emoji are present, callers must break ties on the
// emoji string itself (see groupTasksByTag) or their relative order is
// undefined here.
export const tagRank = (emoji: string | undefined | null): number => {
	if (!emoji) return TAG_ORDER.length + 1;
	const index = TAG_ORDER.indexOf(emoji);
	return index === -1 ? TAG_ORDER.length : index;
};

export const tagLabel = (emoji: string | undefined | null): string | undefined => {
	if (!emoji) return undefined;
	for (const section of TAG_PALETTE) {
		const found = section.entries.find((e) => e.emoji === emoji);
		if (found) return found.label;
	}
	return undefined;
};
