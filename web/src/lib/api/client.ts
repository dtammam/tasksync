import { buildHeaders } from './headers';
import type {
	AuthCreateMemberRequest,
	AuthChangePasswordRequest,
	AuthLoginRequest,
	AuthLoginResponse,
	AuthSetMemberPasswordRequest,
	AuthUpdateProfileRequest,
	AuthUser,
	ListGrant,
	SetListGrantRequest,
	SpaceMember
} from '$shared/types/auth';
import type {
	SyncPullRequest,
	SyncPullResponse,
	SyncPushRequest,
	SyncPushResponse
} from '$shared/types/sync';
import type { SoundSettings, UiPreferencesWire } from '$shared/types/settings';
import type { SpaceBackupBundle, SpaceBackupRestoreResponse } from '$shared/types/backup';

const defaultApiUrl = () => {
	if (typeof window === 'undefined') return 'http://localhost:3000';
	const apiOrigin = new URL(window.location.origin);
	apiOrigin.port = '3000';
	return apiOrigin.origin;
};

const baseUrl = import.meta.env.VITE_API_URL ?? defaultApiUrl();

export interface ApiList {
	id: string;
	space_id: string;
	name: string;
	icon?: string;
	color?: string;
	order: string;
}

export interface ApiTask {
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
	completed_ts?: number;
	notes?: string;
	assignee_user_id?: string;
	created_by_user_id?: string;
}

const fetchJson = async <T>(path: string, opts: RequestInit = {}): Promise<T> => {
	const res = await fetch(`${baseUrl}${path}`, {
		...opts,
		headers: {
			'content-type': 'application/json',
			...buildHeaders(),
			...(opts.headers ?? {})
		}
	});
	if (!res.ok) {
		throw new Error(`API ${res.status} ${res.statusText}`);
	}
	if (res.status === 204) {
		return undefined as T;
	}
	const raw = await res.text();
	if (!raw.trim()) {
		return undefined as T;
	}
	return JSON.parse(raw) as T;
};

export const api = {
	login: (body: AuthLoginRequest) =>
		fetchJson<AuthLoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
	me: () => fetchJson<AuthUser>('/auth/me'),
	updateMe: (body: AuthUpdateProfileRequest) =>
		fetchJson<AuthUser>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
	getSoundSettings: () => fetchJson<SoundSettings>('/auth/sound'),
	updateSoundSettings: (
		body: Partial<SoundSettings> & {
			clearCustomSound?: boolean;
		}
	) => fetchJson<SoundSettings>('/auth/sound', { method: 'PATCH', body: JSON.stringify(body) }),
	getUiPreferences: () => fetchJson<UiPreferencesWire>('/auth/preferences'),
	updateUiPreferences: (body: Partial<UiPreferencesWire>) =>
		fetchJson<UiPreferencesWire>('/auth/preferences', { method: 'PATCH', body: JSON.stringify(body) }),
	getSpaceBackup: () => fetchJson<SpaceBackupBundle>('/auth/backup'),
	restoreSpaceBackup: (body: SpaceBackupBundle) =>
		fetchJson<SpaceBackupRestoreResponse>('/auth/backup', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
	changePassword: (body: AuthChangePasswordRequest) =>
		fetchJson<void>('/auth/password', { method: 'PATCH', body: JSON.stringify(body) }),
	getMembers: () => fetchJson<SpaceMember[]>('/auth/members'),
	createMember: (body: AuthCreateMemberRequest) =>
		fetchJson<SpaceMember>('/auth/members', { method: 'POST', body: JSON.stringify(body) }),
	deleteMember: (userId: string) =>
		fetchJson<void>(`/auth/members/${userId}`, {
			method: 'DELETE'
		}),
	setMemberPassword: (userId: string, body: AuthSetMemberPasswordRequest) =>
		fetchJson<void>(`/auth/members/${userId}/password`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		}),
	getListGrants: () => fetchJson<ListGrant[]>('/auth/grants'),
	setListGrant: (body: SetListGrantRequest) =>
		fetchJson<ListGrant>('/auth/grants', { method: 'PUT', body: JSON.stringify(body) }),
	getLists: () => fetchJson<ApiList[]>('/lists'),
	createList: (body: { name: string; icon?: string; color?: string; order?: string }) =>
		fetchJson<ApiList>('/lists', { method: 'POST', body: JSON.stringify(body) }),
	updateList: (id: string, body: { name?: string; icon?: string; color?: string; order?: string }) =>
		fetchJson<ApiList>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
	deleteList: (id: string) =>
		fetchJson<void>(`/lists/${id}`, {
			method: 'DELETE'
		}),
	getTasks: () => fetchJson<ApiTask[]>('/tasks'),
	syncPull: (body: SyncPullRequest = {}) =>
		fetchJson<SyncPullResponse>('/sync/pull', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
	syncPush: (body: SyncPushRequest) =>
		fetchJson<SyncPushResponse>('/sync/push', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
	createTask: (body: {
		id?: string;
		title: string;
		list_id: string;
		my_day?: boolean;
		order?: string;
		url?: string;
		recur_rule?: string;
		attachments?: string;
		due_date?: string;
		notes?: string;
		assignee_user_id?: string;
	}) =>
		fetchJson<ApiTask>('/tasks', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
	updateTaskMeta: (
		id: string,
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
			completed_ts?: number;
			assignee_user_id?: string;
		}
	) =>
		fetchJson<ApiTask>(`/tasks/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		}),
	deleteTask: (id: string) =>
		fetchJson<void>(`/tasks/${id}`, {
			method: 'DELETE'
		}),
	updateTaskStatus: (id: string, status: string) =>
		fetchJson<ApiTask>(`/tasks/${id}/status`, {
			method: 'POST',
			body: JSON.stringify({ status })
		})
};
