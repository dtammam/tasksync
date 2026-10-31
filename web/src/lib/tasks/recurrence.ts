export const recurrenceRules = [
	'daily',
	'weekdays',
	'weekly',
	'biweekly',
	'monthly',
	'quarterly',
	'biannual',
	'annual',
	'lastDayOfMonth'
] as const;

export type RecurrenceRule = (typeof recurrenceRules)[number];

export const recurrenceRuleLabels: Record<RecurrenceRule, string> = {
	daily: 'Daily',
	weekdays: 'Weekdays',
	weekly: 'Weekly',
	biweekly: 'Every 2 weeks',
	monthly: 'Monthly',
	quarterly: 'Quarterly',
	biannual: 'Twice yearly',
	annual: 'Annually',
	lastDayOfMonth: 'Last day of month'
};

export const toLocalIsoDate = (date: Date) => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export const parseIsoDate = (value?: string) => {
	if (!value) return new Date();
	const [year, month, day] = value.split('-').map(Number);
	if (!year || !month || !day) return new Date(value);
	return new Date(year, month - 1, day);
};

const addDays = (dateStr: string, days: number) => {
	const d = parseIsoDate(dateStr);
	d.setDate(d.getDate() + days);
	return toLocalIsoDate(d);
};

const addWeekdays = (dateStr: string, weekdays: number) => {
	const d = parseIsoDate(dateStr);
	let remaining = weekdays;
	while (remaining > 0) {
		d.setDate(d.getDate() + 1);
		const day = d.getDay();
		if (day !== 0 && day !== 6) {
			remaining -= 1;
		}
	}
	return toLocalIsoDate(d);
};

const subtractWeekdays = (dateStr: string, weekdays: number) => {
	const d = parseIsoDate(dateStr);
	let remaining = weekdays;
	while (remaining > 0) {
		d.setDate(d.getDate() - 1);
		const day = d.getDay();
		if (day !== 0 && day !== 6) {
			remaining -= 1;
		}
	}
	return toLocalIsoDate(d);
};

// Clamps to the last day of the target month (Jan 31 + 1 month = Feb 28/29),
// matching chrono's `checked_add_months` on the server. A bare `setMonth` would
// overflow into the following month (Jan 31 → Mar 3).
const addMonths = (dateStr: string, months: number) => {
	const d = parseIsoDate(dateStr);
	const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
	const daysInTarget = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(d.getDate(), daysInTarget));
	return toLocalIsoDate(target);
};

const lastDayOfMonth = (dateStr: string, monthOffset: number): string => {
	const d = parseIsoDate(dateStr);
	const snapped = new Date(d.getFullYear(), d.getMonth() + monthOffset + 1, 0);
	return toLocalIsoDate(snapped);
};

export const isRecurrenceRule = (rule?: string): rule is RecurrenceRule =>
	typeof rule === 'string' && recurrenceRules.includes(rule as RecurrenceRule);

export const nextDueForRecurrence = (current: string | undefined, recur?: string) => {
	if (!isRecurrenceRule(recur)) return undefined;
	const today = toLocalIsoDate(new Date());
	const anchor = current ?? today;
	switch (recur) {
		case 'daily':
			return addDays(anchor, 1);
		case 'weekdays':
			return addWeekdays(anchor, 1);
		case 'weekly':
			return addDays(anchor, 7);
		case 'biweekly':
			return addDays(anchor, 14);
		case 'monthly':
			return addMonths(anchor, 1);
		case 'quarterly':
			return addMonths(anchor, 3);
		case 'biannual':
			return addMonths(anchor, 6);
		case 'annual':
			return addMonths(anchor, 12);
		case 'lastDayOfMonth':
			return lastDayOfMonth(anchor, 1);
	}
};

/**
 * The due date a recurring task moves to when its current occurrence is
 * completed: one step from the anchor (`punted_from_due_date ?? due_date`),
 * advanced until it is past the current `due_date`. Mirrored by
 * `next_due_after_current` in `server/src/routes/recurrence.rs`; both are
 * pinned by `shared/fixtures/recurrence-cases.json`.
 */
export const nextDueAfterCurrent = (
	dueDate: string | undefined,
	puntedFromDueDate: string | undefined,
	recur?: string
) => {
	const anchor = puntedFromDueDate ?? dueDate;
	let next = nextDueForRecurrence(anchor, recur);
	if (!next) return dueDate;
	while (dueDate && next <= dueDate) {
		const candidate = nextDueForRecurrence(next, recur);
		if (!candidate || candidate === next) break;
		next = candidate;
	}
	return next;
};

export const prevDueForRecurrence = (current: string | undefined, recur?: string) => {
	if (!current || !isRecurrenceRule(recur)) return current;
	switch (recur) {
		case 'daily':
			return addDays(current, -1);
		case 'weekdays':
			return subtractWeekdays(current, 1);
		case 'weekly':
			return addDays(current, -7);
		case 'biweekly':
			return addDays(current, -14);
		case 'monthly':
			return addMonths(current, -1);
		case 'quarterly':
			return addMonths(current, -3);
		case 'biannual':
			return addMonths(current, -6);
		case 'annual':
			return addMonths(current, -12);
		case 'lastDayOfMonth':
			return lastDayOfMonth(current, -1);
	}
};
