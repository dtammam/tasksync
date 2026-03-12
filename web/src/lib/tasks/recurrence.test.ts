import { describe, expect, it } from 'vitest';
import { nextDueForRecurrence, prevDueForRecurrence } from './recurrence';

describe('nextDueForRecurrence', () => {
	it('returns undefined for an invalid recurrence rule', () => {
		expect(nextDueForRecurrence('2026-03-10', 'invalid')).toBeUndefined();
	});

	it('returns undefined when recurrence is undefined', () => {
		expect(nextDueForRecurrence('2026-03-10', undefined)).toBeUndefined();
	});

	it('adds one day for daily', () => {
		expect(nextDueForRecurrence('2026-03-10', 'daily')).toBe('2026-03-11');
	});

	it('adds seven days for weekly', () => {
		expect(nextDueForRecurrence('2026-03-10', 'weekly')).toBe('2026-03-17');
	});

	it('adds fourteen days for biweekly', () => {
		expect(nextDueForRecurrence('2026-03-10', 'biweekly')).toBe('2026-03-24');
	});

	it('adds one month for monthly', () => {
		expect(nextDueForRecurrence('2026-03-10', 'monthly')).toBe('2026-04-10');
	});

	it('adds three months for quarterly', () => {
		expect(nextDueForRecurrence('2026-03-10', 'quarterly')).toBe('2026-06-10');
	});

	it('adds six months for biannual', () => {
		expect(nextDueForRecurrence('2026-03-10', 'biannual')).toBe('2026-09-10');
	});

	it('adds twelve months for annual', () => {
		expect(nextDueForRecurrence('2026-03-10', 'annual')).toBe('2027-03-10');
	});

	it('advances past weekend to Monday for weekdays (Friday anchor)', () => {
		// 2026-03-13 is a Friday — next weekday skips Sat/Sun to land on Monday
		expect(nextDueForRecurrence('2026-03-13', 'weekdays')).toBe('2026-03-16');
	});

	it('advances by one weekday when anchor is mid-week', () => {
		// 2026-03-10 is a Tuesday → next weekday is Wednesday
		expect(nextDueForRecurrence('2026-03-10', 'weekdays')).toBe('2026-03-11');
	});

	it('handles month boundary for daily (end of January)', () => {
		expect(nextDueForRecurrence('2026-01-31', 'daily')).toBe('2026-02-01');
	});

	it('handles leap year daily boundary (Feb 28 in 2024)', () => {
		expect(nextDueForRecurrence('2024-02-28', 'daily')).toBe('2024-02-29');
	});
});

describe('prevDueForRecurrence', () => {
	it('returns undefined when current is undefined', () => {
		expect(prevDueForRecurrence(undefined, 'daily')).toBeUndefined();
	});

	it('returns current unchanged for an invalid recurrence rule', () => {
		expect(prevDueForRecurrence('2026-03-10', 'invalid')).toBe('2026-03-10');
	});

	it('subtracts one day for daily', () => {
		expect(prevDueForRecurrence('2026-03-11', 'daily')).toBe('2026-03-10');
	});

	it('subtracts seven days for weekly', () => {
		expect(prevDueForRecurrence('2026-03-17', 'weekly')).toBe('2026-03-10');
	});

	it('subtracts fourteen days for biweekly', () => {
		expect(prevDueForRecurrence('2026-03-24', 'biweekly')).toBe('2026-03-10');
	});

	it('subtracts one month for monthly', () => {
		expect(prevDueForRecurrence('2026-04-10', 'monthly')).toBe('2026-03-10');
	});

	it('subtracts three months for quarterly', () => {
		expect(prevDueForRecurrence('2026-06-10', 'quarterly')).toBe('2026-03-10');
	});

	it('subtracts six months for biannual', () => {
		expect(prevDueForRecurrence('2026-09-10', 'biannual')).toBe('2026-03-10');
	});

	it('subtracts twelve months for annual', () => {
		expect(prevDueForRecurrence('2027-03-10', 'annual')).toBe('2026-03-10');
	});

	it('skips weekend going backward from Monday', () => {
		// 2026-03-16 is Monday — previous weekday is Friday 2026-03-13
		expect(prevDueForRecurrence('2026-03-16', 'weekdays')).toBe('2026-03-13');
	});

	it('subtracts one weekday when anchor is mid-week', () => {
		// 2026-03-11 is Wednesday → previous weekday is Tuesday 2026-03-10
		expect(prevDueForRecurrence('2026-03-11', 'weekdays')).toBe('2026-03-10');
	});
});
