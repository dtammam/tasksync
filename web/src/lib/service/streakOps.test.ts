import { describe, it, expect } from 'vitest';
import { buildIncrementOp, buildBreakOp, buildDayCompleteOp, buildResetOp } from './streakOps';
import type { StreakOp } from '$lib/data/streakQueue';

const MS = 1715300000000;
const DATE = '2026-05-10';
const TASK_ID = 'task-abc';

describe('buildIncrementOp', () => {
	it('returns kind increment with the correct opKey and field population', () => {
		const op = buildIncrementOp(TASK_ID, DATE, MS);
		expect(op.kind).toBe('increment');
		expect(op.opKey).toBe('inc:task-abc:2026-05-10');
		expect(op.taskId).toBe(TASK_ID);
		expect(op.cause).toBeUndefined();
		expect(op.occurredAt).toBe(MS);
		expect(op.enqueuedAt).toBe(MS);
	});

	it('produces the same opKey for the same (taskId, dateIso) regardless of occurredAtMs', () => {
		const op1 = buildIncrementOp(TASK_ID, DATE, MS);
		const op2 = buildIncrementOp(TASK_ID, DATE, MS + 999);
		expect(op1.opKey).toBe(op2.opKey);
	});

	it('produces a different opKey when dateIso changes — next-day re-counting works', () => {
		const op1 = buildIncrementOp(TASK_ID, '2026-05-10', MS);
		const op2 = buildIncrementOp(TASK_ID, '2026-05-11', MS);
		expect(op1.opKey).not.toBe(op2.opKey);
	});

	it('is assignable to StreakOp type — compile-time shape contract', () => {
		const op: StreakOp = buildIncrementOp(TASK_ID, DATE, MS);
		expect(op).toBeDefined();
	});
});

describe('buildBreakOp', () => {
	it('produces the correct brk key for cause punt', () => {
		const op = buildBreakOp('punt', MS);
		expect(op.kind).toBe('break');
		expect(op.opKey).toBe(`brk:punt:${MS}`);
		expect(op.cause).toBe('punt');
		expect(op.taskId).toBeUndefined();
		expect(op.occurredAt).toBe(MS);
		expect(op.enqueuedAt).toBe(MS);
	});

	it('produces the correct brk key for cause manual', () => {
		const op = buildBreakOp('manual', MS);
		expect(op.opKey).toBe(`brk:manual:${MS}`);
		expect(op.cause).toBe('manual');
	});

	it('produces the correct brk key for cause skip', () => {
		const op = buildBreakOp('skip', MS);
		expect(op.opKey).toBe(`brk:skip:${MS}`);
		expect(op.cause).toBe('skip');
	});

	it('produces the correct brk key for cause delete', () => {
		const op = buildBreakOp('delete', MS);
		expect(op.opKey).toBe(`brk:delete:${MS}`);
		expect(op.cause).toBe('delete');
	});

	it('two calls with the same cause but different occurredAtMs produce different opKeys', () => {
		const op1 = buildBreakOp('punt', MS);
		const op2 = buildBreakOp('punt', MS + 1);
		expect(op1.opKey).not.toBe(op2.opKey);
	});
});

describe('buildDayCompleteOp', () => {
	it('returns kind day_complete with the correct opKey', () => {
		const op = buildDayCompleteOp(DATE, MS);
		expect(op.kind).toBe('day_complete');
		expect(op.opKey).toBe(`dc:${DATE}`);
		expect(op.taskId).toBeUndefined();
		expect(op.cause).toBeUndefined();
		expect(op.occurredAt).toBe(MS);
		expect(op.enqueuedAt).toBe(MS);
	});

	it('opKey is independent of occurredAtMs — same date always collides', () => {
		const op1 = buildDayCompleteOp(DATE, MS);
		const op2 = buildDayCompleteOp(DATE, MS + 60_000);
		expect(op1.opKey).toBe(op2.opKey);
	});

	it('different dateIso produces different opKeys', () => {
		const op1 = buildDayCompleteOp('2026-05-10', MS);
		const op2 = buildDayCompleteOp('2026-05-11', MS);
		expect(op1.opKey).not.toBe(op2.opKey);
	});
});

describe('buildResetOp', () => {
	it('returns kind reset with the correct opKey', () => {
		const op = buildResetOp(MS);
		expect(op.kind).toBe('reset');
		expect(op.opKey).toBe(`rst:${MS}`);
		expect(op.taskId).toBeUndefined();
		expect(op.cause).toBeUndefined();
		expect(op.occurredAt).toBe(MS);
		expect(op.enqueuedAt).toBe(MS);
	});

	it('different occurredAtMs produces different opKeys', () => {
		const op1 = buildResetOp(MS);
		const op2 = buildResetOp(MS + 1);
		expect(op1.opKey).not.toBe(op2.opKey);
	});

	it('is assignable to StreakOp type — compile-time shape contract', () => {
		const op: StreakOp = buildResetOp(MS);
		expect(op).toBeDefined();
	});
});
