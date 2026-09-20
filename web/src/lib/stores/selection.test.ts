import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { selection, selectionMode, selectedIds, selectedCount } from './selection';

describe('selection store (bulk multi-select)', () => {
	beforeEach(() => {
		selection.exit();
	});

	it('starts empty and inactive', () => {
		expect(get(selectionMode)).toBe(false);
		expect(get(selectedCount)).toBe(0);
		expect([...get(selectedIds)]).toEqual([]);
	});

	it('enter activates selection mode without picking anything', () => {
		selection.enter();
		expect(get(selectionMode)).toBe(true);
		expect(get(selectedCount)).toBe(0);
	});

	it('toggle adds then removes an id', () => {
		selection.enter();
		selection.toggle('a');
		expect(get(selectedCount)).toBe(1);
		expect(selection.has('a')).toBe(true);
		selection.toggle('a');
		expect(get(selectedCount)).toBe(0);
		expect(selection.has('a')).toBe(false);
	});

	it('setMany replaces the picked set; snapshot reads it back', () => {
		selection.enter();
		selection.toggle('x');
		selection.setMany(['a', 'b', 'c']);
		expect(get(selectedCount)).toBe(3);
		expect(selection.snapshot().sort()).toEqual(['a', 'b', 'c']);
	});

	it('clear drops picks but stays in selection mode', () => {
		selection.enter();
		selection.setMany(['a', 'b']);
		selection.clear();
		expect(get(selectedCount)).toBe(0);
		expect(get(selectionMode)).toBe(true);
	});

	it('exit leaves selection mode and clears picks', () => {
		selection.enter();
		selection.setMany(['a', 'b']);
		selection.exit();
		expect(get(selectionMode)).toBe(false);
		expect(get(selectedCount)).toBe(0);
	});
});
