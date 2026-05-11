/**
 * Unit tests for streakDrain.ts — single-flight drainer + reconciler seam.
 *
 * Mocked dependencies:
 *  - $lib/data/streakQueue — in-memory FIFO array with enqueue/peekAll/remove/count
 *  - $lib/api/client      — api.applyStreakOp and the ApiError class
 *
 * Reconciler and hydrator are injected via setReconciler / setHydrator so
 * the real streak store is never touched here.
 *
 * Note on hoisting: vi.mock() factory functions are hoisted to the top of the
 * module by Vitest's transform. All values referenced inside a factory must
 * be created via vi.hoisted() so they are available before the mock is
 * registered. The in-memory queue array and mock functions are therefore
 * defined in vi.hoisted() blocks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory queue — hoisted so the streakQueue mock factory can reference it
// ---------------------------------------------------------------------------

const { inMemoryQueue, mockStreakQueue } = vi.hoisted(() => {
	const inMemoryQueue: {
		opKey: string;
		kind: string;
		occurredAt: number;
		cause?: string | null;
		enqueuedAt: number;
	}[] = [];

	const mockStreakQueue = {
		enqueue: vi.fn(async (op: (typeof inMemoryQueue)[number]) => {
			inMemoryQueue.push(op);
		}),
		peekAll: vi.fn(async () => [...inMemoryQueue]),
		remove: vi.fn(async (opKey: string) => {
			const idx = inMemoryQueue.findIndex((o) => o.opKey === opKey);
			if (idx !== -1) inMemoryQueue.splice(idx, 1);
		}),
		count: vi.fn(async () => inMemoryQueue.length),
	};

	return { inMemoryQueue, mockStreakQueue };
});

vi.mock('$lib/data/streakQueue', () => ({
	streakQueue: mockStreakQueue,
}));

// ---------------------------------------------------------------------------
// API client mock — ApiError class + api.applyStreakOp
// ---------------------------------------------------------------------------

/**
 * Both ApiError and the applyStreakOp spy are hoisted so the mock factory can
 * reference them. The drainer's `instanceof ApiError` checks must use the
 * SAME class that the tests construct errors from — returning it from the mock
 * factory ensures the class identity matches.
 */
const { ApiError, mockApplyStreakOp } = vi.hoisted(() => {
	class ApiError extends Error {
		status: number;
		statusText: string;
		detail?: string;

		constructor(status: number, statusText: string, detail?: string) {
			super(`API ${status} ${statusText}${detail ? ': ' + detail : ''}`);
			this.name = 'ApiError';
			this.status = status;
			this.statusText = statusText;
			this.detail = detail;
		}
	}

	const mockApplyStreakOp = vi.fn();
	return { ApiError, mockApplyStreakOp };
});

vi.mock('$lib/api/client', () => ({
	api: {
		applyStreakOp: (...args: unknown[]) => mockApplyStreakOp(...args),
	},
	ApiError,
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import { streakDrain, setReconciler, setHydrator } from './streakDrain';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Seed the in-memory queue with N sequential increment ops. */
function seedQueue(count: number) {
	for (let i = 0; i < count; i++) {
		inMemoryQueue.push({
			opKey: `inc:task-${i}:2026-05-10`,
			kind: 'increment',
			occurredAt: 1000 + i,
			enqueuedAt: 2000 + i,
		});
	}
}

/** Build a minimal successful StreakOpResponse. */
function makeResponse(revision: number) {
	return {
		revision,
		count: revision,
		lastResetDate: '2026-05-10',
		dayCompleteDate: null,
		appliedThisCall: true,
		dayCompleteFiredThisCall: false,
	};
}

// ---------------------------------------------------------------------------
// Test lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
	// Clear the in-memory queue.
	inMemoryQueue.length = 0;

	// Reset module-level draining state and default no-op stubs.
	streakDrain.__resetForTests();

	// Reset all mocks: clears call histories AND any queued return values /
	// implementations. We must restore the streakQueue mock implementations
	// after reset because they close over the shared inMemoryQueue array.
	vi.resetAllMocks();

	mockStreakQueue.enqueue.mockImplementation(async (op: (typeof inMemoryQueue)[number]) => {
		inMemoryQueue.push(op);
	});
	mockStreakQueue.peekAll.mockImplementation(async () => [...inMemoryQueue]);
	mockStreakQueue.remove.mockImplementation(async (opKey: string) => {
		const idx = inMemoryQueue.findIndex((o) => o.opKey === opKey);
		if (idx !== -1) inMemoryQueue.splice(idx, 1);
	});
	mockStreakQueue.count.mockImplementation(async () => inMemoryQueue.length);

	// Restore real timers (individual tests opt into fake timers as needed).
	vi.useRealTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Test 1: Happy path — drains all queued ops in FIFO order
// ---------------------------------------------------------------------------

describe('happy path: drains all queued ops in FIFO order', () => {
	it('calls applyStreakOp 3 times in queue order, removes each op, calls reconciler and hydrator once each', async () => {
		seedQueue(3);

		const reconcilerSpy = vi.fn();
		const hydratorSpy = vi.fn().mockResolvedValue(undefined);
		setReconciler(reconcilerSpy);
		setHydrator(hydratorSpy);

		mockApplyStreakOp
			.mockResolvedValueOnce(makeResponse(1))
			.mockResolvedValueOnce(makeResponse(2))
			.mockResolvedValueOnce(makeResponse(3));

		await streakDrain.drain();

		// applyStreakOp called 3 times, in queue order.
		expect(mockApplyStreakOp).toHaveBeenCalledTimes(3);
		expect(mockApplyStreakOp).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ opKey: 'inc:task-0:2026-05-10' })
		);
		expect(mockApplyStreakOp).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ opKey: 'inc:task-1:2026-05-10' })
		);
		expect(mockApplyStreakOp).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ opKey: 'inc:task-2:2026-05-10' })
		);

		// All ops removed from the queue.
		expect(inMemoryQueue).toHaveLength(0);

		// Reconciler called 3 times with the matching server responses.
		expect(reconcilerSpy).toHaveBeenCalledTimes(3);
		expect(reconcilerSpy).toHaveBeenNthCalledWith(1, makeResponse(1));
		expect(reconcilerSpy).toHaveBeenNthCalledWith(2, makeResponse(2));
		expect(reconcilerSpy).toHaveBeenNthCalledWith(3, makeResponse(3));

		// Hydrator called exactly once at the end.
		expect(hydratorSpy).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Test 2: Single-flight guard prevents concurrent drains
// ---------------------------------------------------------------------------

describe('single-flight guard prevents concurrent drains', () => {
	it('two concurrent drain() calls result in exactly one pass over the queue', async () => {
		inMemoryQueue.push({
			opKey: 'inc:task-concurrent:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		// Use a deferred promise so the first drain stays in flight long enough
		// for the second drain() call to see `draining = true`.
		let resolveOp!: (v: ReturnType<typeof makeResponse>) => void;
		const deferredOp = new Promise<ReturnType<typeof makeResponse>>((res) => (resolveOp = res));

		mockApplyStreakOp.mockReturnValueOnce(deferredOp);

		// Start two drains without awaiting.
		const p1 = streakDrain.drain();
		const p2 = streakDrain.drain(); // should return immediately (draining=true)

		// At this point the first drain is suspended on applyStreakOp.
		// The second should have returned already. Verify only one peekAll happened.
		expect(mockStreakQueue.peekAll).toHaveBeenCalledTimes(1);

		// Resolve the deferred op.
		resolveOp(makeResponse(1));

		await Promise.all([p1, p2]);

		// applyStreakOp must have been called exactly once — no double-processing.
		expect(mockApplyStreakOp).toHaveBeenCalledTimes(1);

		// Queue should be empty.
		expect(inMemoryQueue).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Test 3: 4xx (422) drops the op and continues to the next
// ---------------------------------------------------------------------------

describe('4xx drops the op and continues', () => {
	it('removes the bad op with console.warn, continues to next op, calls reconciler and hydrator once', async () => {
		seedQueue(2);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

		const reconcilerSpy = vi.fn();
		const hydratorSpy = vi.fn().mockResolvedValue(undefined);
		setReconciler(reconcilerSpy);
		setHydrator(hydratorSpy);

		mockApplyStreakOp
			.mockRejectedValueOnce(new ApiError(422, 'Unprocessable Entity', 'bad op'))
			.mockResolvedValueOnce(makeResponse(1));

		await streakDrain.drain();

		// Queue is empty — both ops removed.
		expect(inMemoryQueue).toHaveLength(0);

		// console.warn called once for the dropped op.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toBe('[streakDrain] dropping malformed op');
		expect(warnSpy.mock.calls[0][1]).toBe('inc:task-0:2026-05-10');

		// Reconciler called once — only for the successful second op.
		expect(reconcilerSpy).toHaveBeenCalledTimes(1);
		expect(reconcilerSpy).toHaveBeenCalledWith(makeResponse(1));

		// Hydrator called once at end.
		expect(hydratorSpy).toHaveBeenCalledTimes(1);

		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Test 4: 5xx leaves op in queue and schedules a retry
// ---------------------------------------------------------------------------

describe('5xx leaves op in queue and schedules a retry', () => {
	it('queue still has 1 op, reconciler not called, setTimeout scheduled, drain completes on retry', async () => {
		vi.useFakeTimers();

		inMemoryQueue.push({
			opKey: 'inc:task-retry:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const reconcilerSpy = vi.fn();
		const hydratorSpy = vi.fn().mockResolvedValue(undefined);
		setReconciler(reconcilerSpy);
		setHydrator(hydratorSpy);

		// First attempt: 503
		mockApplyStreakOp
			.mockRejectedValueOnce(new ApiError(503, 'Service Unavailable'))
			// Second attempt (after timer fires): success
			.mockResolvedValueOnce(makeResponse(1));

		await streakDrain.drain();

		// Op still in queue.
		expect(inMemoryQueue).toHaveLength(1);

		// Reconciler and hydrator not called yet.
		expect(reconcilerSpy).not.toHaveBeenCalled();
		expect(hydratorSpy).not.toHaveBeenCalled();

		// setTimeout should have been scheduled.
		expect(vi.getTimerCount()).toBe(1);

		// Advance timers past the 30s retry window.
		await vi.runAllTimersAsync();

		// After retry the queue should drain.
		expect(inMemoryQueue).toHaveLength(0);
		expect(reconcilerSpy).toHaveBeenCalledTimes(1);
		expect(hydratorSpy).toHaveBeenCalledTimes(1);

		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Test 5: 401 leaves op in queue and schedules a retry (auth lost)
// ---------------------------------------------------------------------------

describe('401 leaves op in queue and schedules a retry', () => {
	it('queue retains the op, logs auth-lost warning (not generic transient), retry scheduled', async () => {
		vi.useFakeTimers();

		inMemoryQueue.push({
			opKey: 'inc:task-auth:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const reconcilerSpy = vi.fn();
		setReconciler(reconcilerSpy);

		mockApplyStreakOp
			.mockRejectedValueOnce(new ApiError(401, 'Unauthorized'))
			.mockResolvedValueOnce(makeResponse(1));

		await streakDrain.drain();

		// Op still in queue.
		expect(inMemoryQueue).toHaveLength(1);

		// Reconciler not called.
		expect(reconcilerSpy).not.toHaveBeenCalled();

		// console.warn should mention auth lost, not "transient error".
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toBe('[streakDrain] auth lost; pausing drain');

		// Retry timer scheduled.
		expect(vi.getTimerCount()).toBe(1);

		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Test 6: Network error (TypeError from fetch) leaves op in queue
// ---------------------------------------------------------------------------

describe('network error leaves op in queue', () => {
	it('TypeError from fetch retains the op and schedules a retry', async () => {
		vi.useFakeTimers();

		inMemoryQueue.push({
			opKey: 'inc:task-network:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const reconcilerSpy = vi.fn();
		setReconciler(reconcilerSpy);

		mockApplyStreakOp.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		await streakDrain.drain();

		// Op still in queue.
		expect(inMemoryQueue).toHaveLength(1);

		// Reconciler not called.
		expect(reconcilerSpy).not.toHaveBeenCalled();

		// console.warn logged the transient error.
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toBe('[streakDrain] transient error; will retry');

		// Retry timer scheduled.
		expect(vi.getTimerCount()).toBe(1);

		warnSpy.mockRestore();
	});
});

// ---------------------------------------------------------------------------
// Test 7: Revision gate is the reconciler's responsibility — drainer always calls it
// ---------------------------------------------------------------------------

describe('revision gate: drainer always calls reconciler regardless of revision number', () => {
	it('server returns revision:0 — drainer still calls reconciler, removes op, continues', async () => {
		inMemoryQueue.push({
			opKey: 'inc:task-stale:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		const reconcilerSpy = vi.fn();
		const hydratorSpy = vi.fn().mockResolvedValue(undefined);
		setReconciler(reconcilerSpy);
		setHydrator(hydratorSpy);

		const staleResponse = makeResponse(0); // revision=0 is "stale" from server perspective
		mockApplyStreakOp.mockResolvedValueOnce(staleResponse);

		await streakDrain.drain();

		// Drainer MUST call reconciler — revision gating is the reconciler's job.
		expect(reconcilerSpy).toHaveBeenCalledTimes(1);
		expect(reconcilerSpy).toHaveBeenCalledWith(staleResponse);

		// Op must be removed.
		expect(inMemoryQueue).toHaveLength(0);

		// Hydrator called once (queue fully drained).
		expect(hydratorSpy).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Test 8: Drain twice in a row produces no double-count
// ---------------------------------------------------------------------------

describe('drain twice in a row produces no double-count', () => {
	it('second drain sees empty queue — no applyStreakOp calls, no reconciler calls', async () => {
		seedQueue(3);

		const reconcilerSpy = vi.fn();
		const hydratorSpy = vi.fn().mockResolvedValue(undefined);
		setReconciler(reconcilerSpy);
		setHydrator(hydratorSpy);

		mockApplyStreakOp
			.mockResolvedValueOnce(makeResponse(1))
			.mockResolvedValueOnce(makeResponse(2))
			.mockResolvedValueOnce(makeResponse(3));

		// First drain processes all 3 ops.
		await streakDrain.drain();

		expect(inMemoryQueue).toHaveLength(0);
		expect(mockApplyStreakOp).toHaveBeenCalledTimes(3);
		expect(reconcilerSpy).toHaveBeenCalledTimes(3);
		expect(hydratorSpy).toHaveBeenCalledTimes(1);

		// Reset call counts for the second pass.
		mockApplyStreakOp.mockClear();
		reconcilerSpy.mockClear();
		hydratorSpy.mockClear();

		// Second drain — queue is already empty.
		await streakDrain.drain();

		// peekAll was called once (to check queue), found nothing.
		expect(mockApplyStreakOp).not.toHaveBeenCalled();
		expect(reconcilerSpy).not.toHaveBeenCalled();

		// Hydrator is still called once — queue emptied cleanly (was already empty).
		expect(hydratorSpy).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Test 9: drain() is safe before reconciler/hydrator are wired
// ---------------------------------------------------------------------------

describe('drain() is safe before reconciler/hydrator are wired', () => {
	it('default no-op stubs run cleanly — queue empties, no throws, no unexpected errors', async () => {
		// Do NOT call setReconciler or setHydrator — test the defaults.

		inMemoryQueue.push({
			opKey: 'inc:task-nowire:2026-05-10',
			kind: 'increment',
			occurredAt: 1000,
			enqueuedAt: 2000,
		});

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		mockApplyStreakOp.mockResolvedValueOnce(makeResponse(1));

		// Should resolve without throwing.
		await expect(streakDrain.drain()).resolves.toBeUndefined();

		// Queue empties.
		expect(inMemoryQueue).toHaveLength(0);

		// No unexpected console.error calls.
		expect(errorSpy).not.toHaveBeenCalled();

		errorSpy.mockRestore();
	});
});
