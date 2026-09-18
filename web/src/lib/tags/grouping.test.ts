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

	it('sorts an unrecognized emoji with the last known palette group, ahead of untagged', () => {
		const groups = groupTasksByTag([item('a'), item('b', '🛸')]);
		expect(groups.map((g) => g.key)).toEqual(['🛸', '__untagged__']);
	});
});
