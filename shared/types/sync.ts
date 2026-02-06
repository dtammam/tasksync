export interface SyncList {
	id: string;
	space_id: string;
	name: string;
	icon?: string;
	color?: string;
	order: string;
}

export interface SyncTask {
	id: string;
	space_id: string;
	title: string;
	status: string;
	list_id: string;
	my_day: number;
	order: string;
	updated_ts: number;
	created_ts: number;
	url?: string;
	recur_rule?: string;
	attachments?: string;
	due_date?: string;
	occurrences_completed?: number;
	notes?: string;
	assignee_user_id?: string;
	created_by_user_id?: string;
}

export interface SyncPullRequest {
	since_ts?: number;
}

export interface SyncPullResponse {
	protocol: 'delta-v1';
	cursor_ts: number;
	lists: SyncList[];
	tasks: SyncTask[];
}

export interface SyncCreateTaskChange {
	kind: 'create_task';
	op_id: string;
	body: {
		id?: string;
		title: string;
		list_id: string;
		order?: string;
		my_day?: boolean;
		url?: string;
		recur_rule?: string;
		attachments?: string;
		due_date?: string;
		notes?: string;
		assignee_user_id?: string;
	};
}

export interface SyncUpdateTaskChange {
	kind: 'update_task';
	op_id: string;
	task_id: string;
	body: {
		title?: string;
		status?: string;
		list_id?: string;
		my_day?: boolean;
		url?: string;
		recur_rule?: string;
		attachments?: string;
		due_date?: string;
		notes?: string;
		occurrences_completed?: number;
		assignee_user_id?: string;
	};
}

export interface SyncUpdateTaskStatusChange {
	kind: 'update_task_status';
	op_id: string;
	task_id: string;
	status: string;
}

export type SyncPushChange = SyncCreateTaskChange | SyncUpdateTaskChange | SyncUpdateTaskStatusChange;

export interface SyncPushRequest {
	changes: SyncPushChange[];
}

export interface SyncPushRejected {
	op_id: string;
	status: number;
	error: string;
}

export interface SyncPushResponse {
	protocol: 'delta-v1';
	cursor_ts: number;
	applied: SyncTask[];
	rejected: SyncPushRejected[];
}
