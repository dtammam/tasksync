import { describe, expect, it } from 'vitest';
import { groupTasksByTag, isUntaggedGroupKey } from './grouping';
import { DEFAULT_TAG_PALETTE } from './palette';

interface Fixture {
	id: string;
	emoji?: string;
}

const item = (id: string, emoji?: string): Fixture => ({ id, emoji });

describe('groupTasksByTag', () => {
	it('returns a single unlabeled group when no item carries a tag', () => {
		const groups = groupTasksByTag([item('a'), item('b')], DEFAULT_TAG_PALETTE);
		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('__all__');
		expect(groups[0].label).toBe('');
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'b']);
	});

	it('groups tagged items in fixed palette order, not insertion order', () => {
		// 🥛 (dairy) is defined after ⭐ (time/priority) in the palette, so even
		// though a dairy item appears first here, its group must sort after.
		const groups = groupTasksByTag([item('a', '🥛'), item('b', '⭐')], DEFAULT_TAG_PALETTE);
		expect(groups.map((g) => g.key)).toEqual(['⭐', '🥛']);
	});

	it('places untagged items in their own group, at the bottom', () => {
		const groups = groupTasksByTag([item('a'), item('b', '⭐')], DEFAULT_TAG_PALETTE);
		expect(groups.map((g) => g.key)).toEqual(['⭐', '__untagged__']);
		expect(isUntaggedGroupKey(groups[1].key)).toBe(true);
		expect(groups[1].tasks.map((t) => t.id)).toEqual(['a']);
	});

	it('preserves the incoming (already-sorted) order of items within a group', () => {
		const groups = groupTasksByTag([item('c', '⭐'), item('a', '⭐'), item('b', '⭐')], DEFAULT_TAG_PALETTE);
		expect(groups).toHaveLength(1);
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['c', 'a', 'b']);
	});

	it('sorts a single unrecognized emoji after every known palette group, ahead of untagged', () => {
		const groups = groupTasksByTag([item('a'), item('b', '🛸')], DEFAULT_TAG_PALETTE);
		expect(groups.map((g) => g.key)).toEqual(['🛸', '__untagged__']);
	});

	it('orders multiple unrecognized emoji deterministically, independent of input order', () => {
		// Both 🛸 and 🦄 are off-palette, so they'd tie on tagRank alone -- the
		// tie-break must produce the same order regardless of which appeared
		// first in the source array (a plain stable sort would not).
		const forward = groupTasksByTag([item('a', '🦄'), item('b', '🛸')], DEFAULT_TAG_PALETTE);
		const reversed = groupTasksByTag([item('a', '🛸'), item('b', '🦄')], DEFAULT_TAG_PALETTE);
		expect(forward.map((g) => g.key)).toEqual(reversed.map((g) => g.key));
		expect(forward.map((g) => g.key)).toEqual(['🛸', '🦄']);
	});

	it('places unrecognized emoji after all known palette groups, still ahead of untagged', () => {
		const groups = groupTasksByTag([item('a'), item('b', '🔁'), item('c', '🛸')], DEFAULT_TAG_PALETTE);
		expect(groups.map((g) => g.key)).toEqual(['🔁', '🛸', '__untagged__']);
	});

	it('takes the palette as an argument -- the same emoji labels/sorts differently under a different palette', () => {
		// This is the fix for a real reactivity bug: a Svelte $: block calling
		// this function can only track dependencies it can see, so the palette
		// must be a plain, visible argument -- never read from a store inside
		// this function -- or a caller's group headers can freeze at a stale
		// palette snapshot after the real one hydrates asynchronously.
		const customPalette = [
			{ section: 'Custom', entries: [{ emoji: '🌙', label: 'Night' }] }
		];
		const withDefault = groupTasksByTag([item('a', '🌙')], DEFAULT_TAG_PALETTE);
		const withCustom = groupTasksByTag([item('a', '🌙')], customPalette);
		expect(withDefault[0].label).toBe('🌙'); // unrecognized against the default -> falls back to the key
		expect(withCustom[0].label).toBe('Night');
	});
});
