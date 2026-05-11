/**
 * Repo layer for the outbound streak-op queue stored in IDB.
 *
 * This is the ONLY file in the codebase that may call the `streakOps` IDB
 * object store directly. All layers above (op-builders, drainer, store wiring)
 * must go through the four functions exported here.
 *
 * `StreakOp` is re-declared and re-exported from this module because the
 * interface in `idb.ts` is module-private (not exported). `idb.ts` is the
 * canonical schema owner; callers that need the type should import it from
 * here rather than from `$shared/types/streak` directly.
 */

import type { StreakOpKind, StreakBreakCause } from '$shared/types/streak';
import { getDb } from './idb';

/** Persisted record in the outbound streakOps queue.
 *  Mirrors the private `StreakOp` interface in idb.ts exactly. */
export interface StreakOp {
	opKey: string;
	kind: StreakOpKind;
	occurredAt: number;
	cause?: StreakBreakCause | null;
	enqueuedAt: number;
	taskId?: string;
}

export const streakQueue = {
	/** Insert or replace by opKey. The store is keyed on opKey, so an enqueue
	 *  with a duplicate opKey is a silent overwrite — same opKey means same op,
	 *  matching the server-side dedup contract. */
	async enqueue(op: StreakOp): Promise<void> {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		// Single put; no wrapping transaction needed — atomicity is per-record here.
		await $db.put('streakOps', op);
	},

	/** Return all queued ops in FIFO order via the by-enqueued index.
	 *  Returns an empty array when the store is empty or when IndexedDB is
	 *  unavailable (SSR / private-browsing / no-IDB environment), matching
	 *  repo.ts conventions. */
	async peekAll(): Promise<StreakOp[]> {
		const db = getDb();
		if (!db) return [];
		const $db = await db;
		// Must use the by-enqueued index rather than getAll('streakOps') —
		// unindexed getAll does not guarantee insertion order in IDB.
		return $db.transaction('streakOps').store.index('by-enqueued').getAll();
	},

	/** Remove a single op by opKey. Removing a missing key resolves successfully
	 *  without throwing — IDB delete() on a missing key is already a no-op, so
	 *  no existence check is needed. This is intentional: the drainer may
	 *  double-remove on retry and that must not be treated as an error. */
	async remove(opKey: string): Promise<void> {
		const db = getDb();
		if (!db) return;
		const $db = await db;
		await $db.delete('streakOps', opKey);
	},

	/** Number of queued ops. Returns 0 when IndexedDB is unavailable. */
	async count(): Promise<number> {
		const db = getDb();
		if (!db) return 0;
		const $db = await db;
		return $db.count('streakOps');
	}
} as const;
