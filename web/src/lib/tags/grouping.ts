import { rankInPalette, labelInPalette, type TagPaletteSection } from '$lib/tags/palette';

export interface TagGroup<T> {
	key: string;
	label: string;
	tasks: T[];
}

const UNTAGGED_KEY = '__untagged__';

// D9: group into tag-headed sections in fixed palette order, existing sort
// preserved within each section, untagged tasks in their own section at the
// bottom. A collection with no tags in use returns a single unlabeled group,
// so callers render identically to the pre-tag behavior.
//
// `palette` is a required, explicit argument -- not read from a store
// internally -- specifically so a Svelte `$:` block calling this can see the
// dependency and knows to recompute when the live palette changes. A hidden
// internal store read here previously meant list/My Day group headers froze
// at whatever the palette looked like on first render (usually the built-in
// default, since the real palette hydrates from the server after first
// paint by design) and never updated once hydration completed.
export const groupTasksByTag = <T extends { emoji?: string }>(
	items: T[],
	palette: TagPaletteSection[]
): TagGroup<T>[] => {
	if (!items.some((item) => !!item.emoji)) {
		return [{ key: '__all__', label: '', tasks: items }];
	}
	const byTag = new Map<string, T[]>();
	for (const item of items) {
		const key = item.emoji ?? UNTAGGED_KEY;
		const bucket = byTag.get(key);
		if (bucket) {
			bucket.push(item);
		} else {
			byTag.set(key, [item]);
		}
	}
	return Array.from(byTag.entries())
		.map(([key, tasks]) => ({
			key,
			label: key === UNTAGGED_KEY ? 'Untagged' : (labelInPalette(palette, key) ?? key),
			tasks
		}))
		.sort((a, b) => {
			const rankA = rankInPalette(palette, a.key === UNTAGGED_KEY ? undefined : a.key);
			const rankB = rankInPalette(palette, b.key === UNTAGGED_KEY ? undefined : b.key);
			if (rankA !== rankB) return rankA - rankB;
			// rankInPalette alone can't distinguish multiple different unrecognized
			// emoji (they share one "unknown" bucket rank) -- break ties on the
			// emoji string itself so their relative order is deterministic
			// regardless of task array iteration order, not just "stable sort
			// happens to preserve insertion order this time."
			return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
		});
};

export const isUntaggedGroupKey = (key: string): boolean => key === UNTAGGED_KEY;
