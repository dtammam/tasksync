import { afterAll, describe, expect, it } from 'vitest';
import cases from '$shared/fixtures/recurrence-cases.json';
import { nextDueAfterCurrent, nextDueForRecurrence, prevDueForRecurrence } from './recurrence';

// Parity with server/src/routes/recurrence.rs: both suites run this exact table.
// The TS side does date math on local-midnight Dates, so it is run under zones
// whose DST transitions (including Santiago's midnight transition) could shift a
// date if the arithmetic were done in milliseconds.
const zones = ['UTC', 'America/New_York', 'America/Santiago', 'Pacific/Auckland'];
const originalTz = process.env.TZ;

afterAll(() => {
	process.env.TZ = originalTz;
});

describe.each(zones)('recurrence parity table (TZ=%s)', (zone) => {
	it('next', () => {
		process.env.TZ = zone;
		for (const c of cases.next) {
			expect(nextDueForRecurrence(c.date, c.rule) ?? null, `${c.rule} ${c.date}`).toBe(
				c.expected
			);
		}
	});

	it('prev', () => {
		process.env.TZ = zone;
		for (const c of cases.prev) {
			expect(prevDueForRecurrence(c.date, c.rule) ?? null, `${c.rule} ${c.date}`).toBe(
				c.expected
			);
		}
	});

	it('after current', () => {
		process.env.TZ = zone;
		for (const c of cases.after_current) {
			const got = nextDueAfterCurrent(c.due, c.punted_from ?? undefined, c.rule);
			expect(got ?? null, `${c.rule} due=${c.due} punted_from=${c.punted_from}`).toBe(c.expected);
		}
	});
});
