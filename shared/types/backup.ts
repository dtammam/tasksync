export const BACKUP_SCHEMA_V1 = 'tasksync-space-backup-v1';

export interface SpaceBackupSpace {
	id: string;
	name: string;
}

export interface SpaceBackupUser {
	id: string;
	email: string;
	display: string;
	avatar_icon?: string;
	password_hash?: string;
	sound_enabled: boolean;
	sound_volume: number;
	sound_theme: string;
	custom_sound_file_id?: string;
	custom_sound_file_name?: string;
	custom_sound_data_url?: string;
	custom_sound_files_json?: string;
	profile_attachments?: string;
	ui_theme?: string;
	ui_sidebar_panels?: string;
}

export interface SpaceBackupMembership {
	id: string;
	space_id: string;
	user_id: string;
	role: 'admin' | 'contributor';
}

export interface SpaceBackupList {
	id: string;
	space_id: string;
	name: string;
	icon?: string;
	color?: string;
	list_order: string;
}

export interface SpaceBackupGrant {
	id: string;
	space_id: string;
	list_id: string;
	user_id: string;
}

export interface SpaceBackupTask {
	id: string;
	space_id: string;
	title: string;
	status: 'pending' | 'done' | 'cancelled';
	list_id: string;
	my_day: number;
	task_order: string;
	updated_ts: number;
	created_ts: number;
	url?: string;
	recur_rule?: string;
	attachments?: string;
	due_date?: string;
	occurrences_completed: number;
	completed_ts?: number;
	notes?: string;
	assignee_user_id?: string;
	created_by_user_id?: string;
}

export interface SpaceBackupBundle {
	schema: string;
	exported_at_ts: number;
	space: SpaceBackupSpace;
	users: SpaceBackupUser[];
	memberships: SpaceBackupMembership[];
	lists: SpaceBackupList[];
	list_grants: SpaceBackupGrant[];
	tasks: SpaceBackupTask[];
}

export interface SpaceBackupRestoreResponse {
	restored_at_ts: number;
	space_id: string;
	users: number;
	memberships: number;
	lists: number;
	list_grants: number;
	tasks: number;
}
