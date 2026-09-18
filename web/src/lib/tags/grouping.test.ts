import { describe, expect, it } from 'vitest';
import { groupTasksByTag, isUntaggedGroupKey } from './grouping';

interface Fixture {
	id: string;
	emoji?: string;
}

const item = (id: string, emoji?: string): Fixture => ({ id, emoji });

describe('groupTasksByTag', () => {
	it('returns a single unlabeled group when no item carries a tag', () => {
		const groups = groupTasksByTag([item('a'), item('b')]);
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('__all__');
		expect(groups[0].label).toBe('');
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
	});

	it('groups tagged items in fixed palette order, not insertion order', () => {
		// 🥛 (dairy) is defined after ⭐ (time/priority) in the palette, so even
		// though a dairy item appears first here, its group must sort after.
		const groups = groupTasksByTag([item('a', '🥛'), item('b', '⭐')]);
		expect(groups.map((g) => g.key)).toEqual(['⭐', '🥛']);
	});

	it('places untagged items in their own group, at the bottom', () => {
		const groups = groupTasksByTag([item('a'), item('b', '⭐')]);
		expect(groups.map((g) => g.key)).toEqual(['⭐', '__untagged__']);
		expect(isUntaggedGroupKey(groups[1].key)).toBe(true);
		expect(groups[1].tasks.map((t) => t.id)).toEqual(['a']);
	});

	it('preserves the incoming (already-sorted) order of items within a group', () => {
		const groups = groupTasksByTag([item('c', '⭐'), item('a', '⭐'), item('b', '⭐')]);
		expect(groups).toHaveLength(1);
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['c', 'a', 'b']);
	});

	it('sorts a single unrecognized emoji after every known palette group, ahead of untagged', () => {
		const groups = groupTasksByTag([item('a'), item('b', '🛸')]);
		expect(groups.map((g) => g.key)).toEqual(['🛸', '__untagged__']);
	});

	it('orders multiple unrecognized emoji deterministically, independent of input order', () => {
		// Both 🛸 and 🦄 are off-palette, so they'd tie on tagRank alone -- the
		// tie-break must produce the same order regardless of which appeared
		// first in the source array (a plain stable sort would not).
		const forward = groupTasksByTag([item('a', '🦄'), item('b', '🛸')]);
		const reversed = groupTasksByTag([item('a', '🛸'), item('b', '🦄')]);
		expect(forward.map((g) => g.key)).toEqual(reversed.map((g) => g.key));
		expect(forward.map((g) => g.key)).toEqual(['🛸', '🦄']);
	});

	it('places unrecognized emoji after all known palette groups, still ahead of untagged', () => {
		const groups = groupTasksByTag([item('a'), item('b', '🔁'), item('c', '🛸')]);
		expect(groups.map((g) => g.key)).toEqual(['🔁', '🛸', '__untagged__']);
	});
});
