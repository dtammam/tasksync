/**
 * Tests for streakQueue.ts — IDB CRUD over the streakOps store.
 *
 * fake-indexeddb/auto is imported globally via web/src/test/setup.ts so
 * `indexedDB` is available in every test without additional imports.
 *
 * Each test uses a unique scope via setDbScope to prevent cross-test
 * contamination of the module-level IDB promise cache.
 */

import { describe, expect, it } from 'vitest';
import { getDb, setDbScope } from './idb';
import { streakQueue, type StreakOp } from './streakQueue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid StreakOp for test use. */
function makeOp(opKey: string, enqueuedAt: number, extra?: Partial<StreakOp>): StreakOp {
	return {
		opKey,
		kind: 'increment',
		occurredAt: enqueuedAt - 1,
		enqueuedAt,
		...extra
	};
}

// ---------------------------------------------------------------------------
// Scenario 1: Empty store
// ---------------------------------------------------------------------------

describe('empty store', () => {
	it('count() returns 0 and peekAll() returns [] on a fresh store', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-empty`);

		expect(await streakQueue.count()).toBe(0);
		expect(await streakQueue.peekAll()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Scenario 2: Enqueue then peekAll — FIFO order and count
// ---------------------------------------------------------------------------

describe('enqueue then peekAll', () => {
	it('returns ops in enqueuedAt ascending order and count matches', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-fifo`);

		const opA = makeOp('inc:task-a:2026-05-10', 1000);
		const opB = makeOp('inc:task-b:2026-05-10', 2000);
		const opC = makeOp('brk:manual:3000', 3000, { kind: 'break', cause: 'manual' });

		// Enqueue in order.
		await streakQueue.enqueue(opA);
		await streakQueue.enqueue(opB);
		await streakQueue.enqueue(opC);

		expect(await streakQueue.count()).toBe(3);

		const all = await streakQueue.peekAll();
		expect(all).toHaveLength(3);
		expect(all[0].opKey).toBe(opA.opKey);
		expect(all[1].opKey).toBe(opB.opKey);
		expect(all[2].opKey).toBe(opC.opKey);
	});
});

// ---------------------------------------------------------------------------
// Scenario 3: FIFO across enqueue/remove cycles
// ---------------------------------------------------------------------------

describe('FIFO across enqueue/remove cycles', () => {
	it('removes the specified op and preserves order of remaining ops', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-remove`);

		const opA = makeOp('inc:task-a:2026-05-11', 1000);
		const opB = makeOp('inc:task-b:2026-05-11', 2000);
		const opC = makeOp('inc:task-c:2026-05-11', 3000);

		await streakQueue.enqueue(opA);
		await streakQueue.enqueue(opB);
		await streakQueue.enqueue(opC);

		await streakQueue.remove(opB.opKey);

		expect(await streakQueue.count()).toBe(2);

		const all = await streakQueue.peekAll();
		expect(all).toHaveLength(2);
		expect(all[0].opKey).toBe(opA.opKey);
		expect(all[1].opKey).toBe(opC.opKey);
	});
});

// ---------------------------------------------------------------------------
// Scenario 4: Remove of missing key is a silent no-op
// ---------------------------------------------------------------------------

describe('remove of missing key', () => {
	it('resolves without throwing against an empty store', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-missing-empty`);

		await expect(streakQueue.remove('does-not-exist')).resolves.toBeUndefined();
		expect(await streakQueue.count()).toBe(0);
	});

	it('resolves without throwing against a populated store and leaves count unchanged', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-missing-populated`);

		const op = makeOp('inc:task-x:2026-05-12', 1000);
		await streakQueue.enqueue(op);

		await expect(streakQueue.remove('does-not-exist')).resolves.toBeUndefined();
		expect(await streakQueue.count()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Scenario 5: Duplicate-opKey enqueue overwrites the previous record
// ---------------------------------------------------------------------------

describe('duplicate-opKey enqueue', () => {
	it('count stays 1 and peekAll reflects the second op fields', async () => {
		setDbScope(`test-streakqueue-${Date.now()}-dedup`);

		const op1 = makeOp('inc:task-dup:2026-05-13', 1000);
		const op2: StreakOp = {
			...op1,
			occurredAt: 9000,
			enqueuedAt: 9999
		};

		await streakQueue.enqueue(op1);
		await streakQueue.enqueue(op2);

		expect(await streakQueue.count()).toBe(1);

		const all = await streakQueue.peekAll();
		expect(all).toHaveLength(1);
		expect(all[0].enqueuedAt).toBe(op2.enqueuedAt);
		expect(all[0].occurredAt).toBe(op2.occurredAt);
	});
});

// ---------------------------------------------------------------------------
// Scenario 6: Round-trip persistence across a simulated reload
// ---------------------------------------------------------------------------

describe('round-trip persistence across simulated reload', () => {
	it('op survives a DB close + reopen', async () => {
		const scope = `test-streakqueue-${Date.now()}-reload`;
		setDbScope(scope);

		const op = makeOp('rst:1715299500000', 1715299501000, { kind: 'reset' });
		await streakQueue.enqueue(op);

		// Close the underlying DB connection.
		const db = await getDb();
		db!.close();

		// Bounce through a throw-away scope so the module clears its cached
		// dbPromise (the same technique used in idb.test.ts), then re-point at
		// the original scope so getDb() reopens the same physical DB.
		setDbScope(`__bounce__${Date.now()}`);
		setDbScope(scope);

		// The op must still be present after reopen.
		expect(await streakQueue.count()).toBe(1);

		const all = await streakQueue.peekAll();
		expect(all).toHaveLength(1);
		expect(all[0].opKey).toBe(op.opKey);
		expect(all[0].kind).toBe('reset');
	});
});
