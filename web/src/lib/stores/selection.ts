import { derived, get, writable } from 'svelte/store';

/**
 * selection — ephemeral multi-select state for bulk task operations (Piece 4).
 *
 * Not persisted and not synced: it's transient UI state that lives only while a
 * user is picking tasks to act on. Entering selection mode on one view and the
 * set of picked ids are shared across the list view and My Day so a single store
 * (not per-view state) is the source of truth. Leaving selection mode clears the
 * set. The store holds ids only; each view decides which tasks are *eligible*
 * (e.g. contributor scoping) before staging them into an operation.
 */
const _mode = writable<boolean>(false);
const _ids = writable<Set<string>>(new Set());

/** True while the user is picking tasks (checkboxes shown, row taps select). */
export const selectionMode = { subscribe: _mode.subscribe };

/** The set of currently-picked task ids. */
export const selectedIds = { subscribe: _ids.subscribe };

/** How many tasks are currently picked. */
export const selectedCount = derived(_ids, ($ids) => $ids.size);

export const selection = {
	/** Enter selection mode (idempotent). */
	enter(): void {
		_mode.set(true);
	},
	/** Leave selection mode and drop every pick. */
	exit(): void {
		_mode.set(false);
		_ids.set(new Set());
	},
	/** Add or remove one id from the picked set. */
	toggle(id: string): void {
		_ids.update((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	},
	/** Replace the picked set (e.g. a view's "select all eligible"). */
	setMany(ids: string[]): void {
		_ids.set(new Set(ids));
	},
	/** Drop every pick but stay in selection mode. */
	clear(): void {
		_ids.set(new Set());
	},
	/** Whether an id is currently picked (non-reactive read). */
	has(id: string): boolean {
		return get(_ids).has(id);
	},
	/** The picked ids as an array (non-reactive read). */
	snapshot(): string[] {
		return [...get(_ids)];
	}
};
