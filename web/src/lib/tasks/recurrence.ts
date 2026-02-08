export const recurrenceRules = [
	'daily',
	'weekdays',
	'weekly',
	'biweekly',
	'monthly',
	'quarterly',
	'biannual',
	'annual'
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
	annual: 'Annually'
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

const addMonths = (dateStr: string, months: number) => {
	const d = parseIsoDate(dateStr);
	d.setMonth(d.getMonth() + months);
	return toLocalIsoDate(d);
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
	}
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
	}
};
