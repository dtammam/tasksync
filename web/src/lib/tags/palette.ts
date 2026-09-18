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

export const tagRank = (emoji: string | undefined | null): number => {
	if (!emoji) return TAG_ORDER.length; // untagged sorts last
	const index = TAG_ORDER.indexOf(emoji);
	return index === -1 ? TAG_ORDER.length - 1 : index; // unknown tag: sort with the last known group, not after "untagged"
};

export const tagLabel = (emoji: string | undefined | null): string | undefined => {
	if (!emoji) return undefined;
	for (const section of TAG_PALETTE) {
		const found = section.entries.find((e) => e.emoji === emoji);
		if (found) return found.label;
	}
	return undefined;
};
