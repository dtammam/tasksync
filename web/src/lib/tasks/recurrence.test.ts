import { describe, expect, it } from 'vitest';
import { isRecurrenceRule, nextDueForRecurrence, prevDueForRecurrence } from './recurrence';

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

describe('isRecurrenceRule', () => {
	it('recognises lastDayOfMonth as a valid recurrence rule', () => {
		expect(isRecurrenceRule('lastDayOfMonth')).toBe(true);
	});
});

describe('nextDueForRecurrence - lastDayOfMonth', () => {
	it('advances Jan 31 to Feb 28 in non-leap year', () => {
		expect(nextDueForRecurrence('2026-01-31', 'lastDayOfMonth')).toBe('2026-02-28');
	});

	it('advances Jan 31 to Feb 29 in leap year 2024', () => {
		expect(nextDueForRecurrence('2024-01-31', 'lastDayOfMonth')).toBe('2024-02-29');
	});

	it('advances Feb 28 to Mar 31', () => {
		expect(nextDueForRecurrence('2026-02-28', 'lastDayOfMonth')).toBe('2026-03-31');
	});

	it('advances Mar 31 to Apr 30', () => {
		expect(nextDueForRecurrence('2026-03-31', 'lastDayOfMonth')).toBe('2026-04-30');
	});

	it('advances Apr 30 to May 31', () => {
		expect(nextDueForRecurrence('2026-04-30', 'lastDayOfMonth')).toBe('2026-05-31');
	});

	it('advances May 31 to Jun 30', () => {
		expect(nextDueForRecurrence('2026-05-31', 'lastDayOfMonth')).toBe('2026-06-30');
	});

	it('advances Jun 30 to Jul 31', () => {
		expect(nextDueForRecurrence('2026-06-30', 'lastDayOfMonth')).toBe('2026-07-31');
	});

	it('advances Jul 31 to Aug 31', () => {
		expect(nextDueForRecurrence('2026-07-31', 'lastDayOfMonth')).toBe('2026-08-31');
	});

	it('advances Aug 31 to Sep 30', () => {
		expect(nextDueForRecurrence('2026-08-31', 'lastDayOfMonth')).toBe('2026-09-30');
	});

	it('advances Sep 30 to Oct 31', () => {
		expect(nextDueForRecurrence('2026-09-30', 'lastDayOfMonth')).toBe('2026-10-31');
	});

	it('advances Oct 31 to Nov 30', () => {
		expect(nextDueForRecurrence('2026-10-31', 'lastDayOfMonth')).toBe('2026-11-30');
	});

	it('advances Nov 30 to Dec 31', () => {
		expect(nextDueForRecurrence('2026-11-30', 'lastDayOfMonth')).toBe('2026-12-31');
	});

	it('advances Dec 31 to Jan 31 of next year (year boundary)', () => {
		expect(nextDueForRecurrence('2026-12-31', 'lastDayOfMonth')).toBe('2027-01-31');
	});
});

describe('prevDueForRecurrence - lastDayOfMonth', () => {
	it('goes back from Feb 28 to Jan 31 in non-leap year', () => {
		expect(prevDueForRecurrence('2026-02-28', 'lastDayOfMonth')).toBe('2026-01-31');
	});

	it('goes back from Feb 29 to Jan 31 in leap year 2024', () => {
		expect(prevDueForRecurrence('2024-02-29', 'lastDayOfMonth')).toBe('2024-01-31');
	});

	it('goes back from Mar 31 to Feb 28 in non-leap year', () => {
		expect(prevDueForRecurrence('2026-03-31', 'lastDayOfMonth')).toBe('2026-02-28');
	});

	it('goes back from Mar 31 to Feb 29 in leap year 2024', () => {
		expect(prevDueForRecurrence('2024-03-31', 'lastDayOfMonth')).toBe('2024-02-29');
	});

	it('goes back from Apr 30 to Mar 31', () => {
		expect(prevDueForRecurrence('2026-04-30', 'lastDayOfMonth')).toBe('2026-03-31');
	});

	it('goes back from May 31 to Apr 30', () => {
		expect(prevDueForRecurrence('2026-05-31', 'lastDayOfMonth')).toBe('2026-04-30');
	});

	it('goes back from Jun 30 to May 31', () => {
		expect(prevDueForRecurrence('2026-06-30', 'lastDayOfMonth')).toBe('2026-05-31');
	});

	it('goes back from Jul 31 to Jun 30', () => {
		expect(prevDueForRecurrence('2026-07-31', 'lastDayOfMonth')).toBe('2026-06-30');
	});

	it('goes back from Aug 31 to Jul 31', () => {
		expect(prevDueForRecurrence('2026-08-31', 'lastDayOfMonth')).toBe('2026-07-31');
	});

	it('goes back from Sep 30 to Aug 31', () => {
		expect(prevDueForRecurrence('2026-09-30', 'lastDayOfMonth')).toBe('2026-08-31');
	});

	it('goes back from Oct 31 to Sep 30', () => {
		expect(prevDueForRecurrence('2026-10-31', 'lastDayOfMonth')).toBe('2026-09-30');
	});

	it('goes back from Nov 30 to Oct 31', () => {
		expect(prevDueForRecurrence('2026-11-30', 'lastDayOfMonth')).toBe('2026-10-31');
	});

	it('goes back from Dec 31 to Nov 30', () => {
		expect(prevDueForRecurrence('2026-12-31', 'lastDayOfMonth')).toBe('2026-11-30');
	});

	it('goes back from Jan 31 to Dec 31 of prior year (year boundary)', () => {
		expect(prevDueForRecurrence('2026-01-31', 'lastDayOfMonth')).toBe('2025-12-31');
	});
});
