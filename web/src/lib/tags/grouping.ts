import { tagLabel, tagRank } from './palette';

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
export const groupTasksByTag = <T extends { emoji?: string }>(items: T[]): TagGroup<T>[] => {
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
			label: key === UNTAGGED_KEY ? 'Untagged' : (tagLabel(key) ?? key),
			tasks
		}))
		.sort(
			(a, b) =>
				tagRank(a.key === UNTAGGED_KEY ? undefined : a.key) -
				tagRank(b.key === UNTAGGED_KEY ? undefined : b.key)
		);
};

export const isUntaggedGroupKey = (key: string): boolean => key === UNTAGGED_KEY;
