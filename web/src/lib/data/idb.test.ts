/**
 * Tests for idb.ts — IDB schema v3.
 *
 * fake-indexeddb/auto is imported globally via web/src/test/setup.ts so
 * `indexedDB` is available in every test without additional imports.
 */

import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { getDb, setDbScope } from './idb';

// ---------------------------------------------------------------------------
// Scenario 1: Fresh install at v3 has all four stores plus the index
// ---------------------------------------------------------------------------

describe('fresh install at v3', () => {
	it('has all four object stores and the by-enqueued index', async () => {
		// Use a unique scope to avoid colliding with other test instances.
		const scope = `test-fresh-${Date.now()}-a`;
		setDbScope(scope);

		const db = await getDb();
		expect(db).not.toBeNull();

		const storeNames = Array.from(db!.objectStoreNames);
		expect(storeNames).toContain('lists');
		expect(storeNames).toContain('tasks');
		expect(storeNames).toContain('settings');
		expect(storeNames).toContain('streakOps');

		const indexNames = Array.from(db!.transaction('streakOps').store.indexNames);
		expect(indexNames).toContain('by-enqueued');

		db!.close();
	});

	it('round-trips an op through the streakOps store and by-enqueued index', async () => {
		const scope = `test-fresh-${Date.now()}-b`;
		setDbScope(scope);

		const db = await getDb();
		expect(db).not.toBeNull();

		const op = {
			opKey: 'inc:task-abc:2026-05-10',
			kind: 'increment' as const,
			occurredAt: 1715299200000,
			enqueuedAt: 1715299201000,
			taskId: 'task-abc'
		};

		await db!.put('streakOps', op);

		// Read back directly by primary key.
		const fetched = await db!.get('streakOps', op.opKey);
		expect(fetched).toEqual(op);

		// Read back via the by-enqueued index.
		const byIndex = await db!
			.transaction('streakOps')
			.store.index('by-enqueued')
			.get(op.enqueuedAt);
		expect(byIndex).not.toBeUndefined();
		expect(byIndex!.opKey).toBe(op.opKey);

		db!.close();
	});
});

// ---------------------------------------------------------------------------
// Scenario 2: v2 -> v3 upgrade preserves existing data and adds streakOps
// ---------------------------------------------------------------------------

describe('v2 -> v3 upgrade', () => {
	it('preserves seeded rows from v2 and adds an empty streakOps store', async () => {
		// Pick a unique scope/DB name so it does not collide with other tests.
		const scopeName = `test-upgrade-${Date.now()}`;
		const dbName = `tasksync_${scopeName}`;

		// -----------------------------------------------------------------------
		// Step A: Open a raw DB at version 2, recreating the legacy v2 schema
		// inline (lists keyed on id, tasks keyed on id with by-list index on
		// list_id, settings keyed on id). Seed one row in each store, then close.
		// -----------------------------------------------------------------------
		const v2db = await openDB(dbName, 2, {
			upgrade(db) {
				if (!db.objectStoreNames.contains('lists')) {
					db.createObjectStore('lists', { keyPath: 'id' });
				}
				if (!db.objectStoreNames.contains('tasks')) {
					const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
					tasks.createIndex('by-list', 'list_id');
				}
				if (!db.objectStoreNames.contains('settings')) {
					db.createObjectStore('settings', { keyPath: 'id' });
				}
			}
		});

		await v2db.put('lists', { id: 'list-1', name: 'Inbox', order: 'a' });
		await v2db.put('tasks', { id: 'task-1', title: 'Buy milk', list_id: 'list-1' });
		await v2db.put('settings', { id: 'sound', enabled: true, volume: 80, theme: 'chime_soft' });

		v2db.close();

		// -----------------------------------------------------------------------
		// Step B: Point the production helper at the same scope and call getDb().
		//
		// setDbScope has an early-return guard: if the next sanitized scope equals
		// the current module-level `dbScope`, the cached `dbPromise` is NOT
		// cleared. To ensure the production module opens a fresh connection (and
		// triggers the v2->v3 upgrade callback), we first bounce through a throw-
		// away scope to reset the cached promise, then set the real target scope.
		// -----------------------------------------------------------------------
		setDbScope(`__bounce__${Date.now()}`);
		setDbScope(scopeName);

		const db = await getDb();
		expect(db).not.toBeNull();

		// -----------------------------------------------------------------------
		// Step C: Assert the seeded v2 rows survived the upgrade.
		// -----------------------------------------------------------------------
		const lists = await db!.getAll('lists');
		expect(lists).toHaveLength(1);
		expect(lists[0].id).toBe('list-1');

		const tasks = await db!.getAll('tasks');
		expect(tasks).toHaveLength(1);
		expect(tasks[0].id).toBe('task-1');

		const settings = await db!.getAll('settings');
		expect(settings).toHaveLength(1);
		expect(settings[0].id).toBe('sound');

		// -----------------------------------------------------------------------
		// Step D: Assert the new streakOps store exists and is empty.
		// -----------------------------------------------------------------------
		const storeNames = Array.from(db!.objectStoreNames);
		expect(storeNames).toContain('streakOps');

		const ops = await db!.getAll('streakOps');
		expect(ops).toHaveLength(0);

		// -----------------------------------------------------------------------
		// Step E: Round-trip an op to confirm the index works after the upgrade.
		// -----------------------------------------------------------------------
		const op = {
			opKey: 'brk:manual:1715299300000',
			kind: 'break' as const,
			occurredAt: 1715299300000,
			cause: 'manual' as const,
			enqueuedAt: 1715299301000
		};

		await db!.put('streakOps', op);

		const byIndex = await db!
			.transaction('streakOps')
			.store.index('by-enqueued')
			.get(op.enqueuedAt);
		expect(byIndex).not.toBeUndefined();
		expect(byIndex!.opKey).toBe(op.opKey);

		db!.close();
	});
});

// ---------------------------------------------------------------------------
// Scenario 3 (optional): Re-opening at v3 a second time is a no-op
// ---------------------------------------------------------------------------

describe('re-open at v3', () => {
	it('does not reset stored data on a second open', async () => {
		const scope = `test-reopen-${Date.now()}`;

		// First open.
		setDbScope(scope);
		const db1 = await getDb();
		expect(db1).not.toBeNull();

		await db1!.put('streakOps', {
			opKey: 'rst:1715299400000',
			kind: 'reset' as const,
			occurredAt: 1715299400000,
			enqueuedAt: 1715299401000
		});
		db1!.close();

		// Bounce to a throw-away scope so the module resets its cached promise,
		// then re-open the same DB at v3. There should be no re-upgrade and the
		// previously written op must still be present.
		setDbScope(`__bounce__${Date.now()}`);
		setDbScope(scope);

		const db2 = await getDb();
		expect(db2).not.toBeNull();

		const ops = await db2!.getAll('streakOps');
		expect(ops).toHaveLength(1);
		expect(ops[0].opKey).toBe('rst:1715299400000');

		db2!.close();
	});
});
