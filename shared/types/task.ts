export type TaskStatus = 'pending' | 'done' | 'cancelled';

export interface ChecklistItem {
	id: string;
	title: string;
	done: boolean;
	order: string;
}

export interface FileRef {
	id: string;
	name: string;
	size: number; // bytes, enforced <= 10MB
	mime: string;
	hash: string;
	path: string;
}

export interface Task {
	id: string;
	title: string;
	url?: string;
	due?: string;
	start?: string;
	scheduled?: string;
	due_date?: string;
	priority: 0 | 1 | 2 | 3;
	status: TaskStatus;
	list_id: string;
	project_id?: string;
	area_id?: string;
	tags: string[];
	checklist: ChecklistItem[];
	order: string;
	recurrence_id?: string;
	recur_state?: string;
	attachments: FileRef[];
	notes?: string;
	occurrences_completed?: number;
	created_ts: number;
	updated_ts: number;
	my_day?: boolean;
	dirty?: boolean;
	local?: boolean;
}
