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
	SyncList,
	SyncTask,
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

const runtimeApiUrl = () => {
	if (typeof window === 'undefined') return undefined;
	const configured = window.__TASKSYNC_RUNTIME_CONFIG__?.apiUrl?.trim();
	return configured ? configured : undefined;
};

const getBaseUrl = () => runtimeApiUrl() ?? import.meta.env.VITE_API_URL ?? defaultApiUrl();

export class ApiError extends Error {
	status: number;
	statusText: string;
	detail?: string;

	constructor(status: number, statusText: string, detail?: string) {
		const base = `API ${status} ${statusText}`;
		super(detail ? `${base}: ${detail}` : base);
		this.name = 'ApiError';
		this.status = status;
		this.statusText = statusText;
		this.detail = detail;
	}
}

const parseErrorDetail = (raw: string): string | undefined => {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed === 'string' && parsed.trim()) {
			return parsed.trim();
		}
		if (parsed && typeof parsed === 'object') {
			const candidate = parsed as Record<string, unknown>;
			const message = candidate.message;
			if (typeof message === 'string' && message.trim()) {
				return message.trim();
			}
			const error = candidate.error;
			if (typeof error === 'string' && error.trim()) {
				return error.trim();
			}
		}
	} catch {
		// Fall back to short plain-text payloads when server sends non-JSON errors.
	}
	return trimmed.length <= 160 ? trimmed : undefined;
};

export const apiErrorStatus = (err: unknown): number | null => {
	if (err instanceof ApiError) return err.status;
	const message = err instanceof Error ? err.message : String(err);
	const match = /^API\s+(\d{3})\b/.exec(message);
	if (!match) return null;
	const parsed = Number.parseInt(match[1], 10);
	return Number.isFinite(parsed) ? parsed : null;
};

export type { SyncList as SyncList, SyncTask as SyncTask } from '$shared/types/sync';

const fetchJson = async <T>(path: string, opts: RequestInit = {}): Promise<T> => {
	const res = await fetch(`${getBaseUrl()}${path}`, {
		...opts,
		headers: {
			'content-type': 'application/json',
			...buildHeaders(),
			...(opts.headers ?? {})
		}
	});
	const raw = await res.text();
	if (!res.ok) {
		const detail = parseErrorDetail(raw);
		throw new ApiError(res.status, res.statusText, detail);
	}
	if (res.status === 204) {
		return undefined as T;
	}
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
	getLists: () => fetchJson<SyncList[]>('/lists'),
	createList: (body: { name: string; icon?: string; color?: string; order?: string }) =>
		fetchJson<SyncList>('/lists', { method: 'POST', body: JSON.stringify(body) }),
	updateList: (id: string, body: { name?: string; icon?: string; color?: string; order?: string }) =>
		fetchJson<SyncList>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
	deleteList: (id: string) =>
		fetchJson<void>(`/lists/${id}`, {
			method: 'DELETE'
		}),
	getTasks: () => fetchJson<SyncTask[]>('/tasks'),
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
		priority?: number;
		order?: string;
		url?: string;
		recur_rule?: string;
		due_date?: string;
		punted_from_due_date?: string;
		punted_on_date?: string;
		notes?: string;
		assignee_user_id?: string;
	}) =>
		fetchJson<SyncTask>('/tasks', {
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
			priority?: number;
			url?: string;
			recur_rule?: string;
			due_date?: string;
			punted_from_due_date?: string;
			punted_on_date?: string;
			notes?: string;
			occurrences_completed?: number;
			completed_ts?: number;
			assignee_user_id?: string;
		}
	) =>
		fetchJson<SyncTask>(`/tasks/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		}),
	deleteTask: (id: string) =>
		fetchJson<void>(`/tasks/${id}`, {
			method: 'DELETE'
		}),
	updateTaskStatus: (id: string, status: string) =>
		fetchJson<SyncTask>(`/tasks/${id}/status`, {
			method: 'POST',
			body: JSON.stringify({ status })
		})
};
