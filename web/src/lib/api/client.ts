import { buildHeaders } from './headers';
import type {
	AuthCreateMemberRequest,
	AuthLoginRequest,
	AuthLoginResponse,
	AuthUpdateProfileRequest,
	AuthUser,
	ListGrant,
	SetListGrantRequest,
	SpaceMember
} from '$shared/types/auth';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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
	return (await res.json()) as T;
};

export const api = {
	login: (body: AuthLoginRequest) =>
		fetchJson<AuthLoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
	me: () => fetchJson<AuthUser>('/auth/me'),
	updateMe: (body: AuthUpdateProfileRequest) =>
		fetchJson<AuthUser>('/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),
	getMembers: () => fetchJson<SpaceMember[]>('/auth/members'),
	createMember: (body: AuthCreateMemberRequest) =>
		fetchJson<SpaceMember>('/auth/members', { method: 'POST', body: JSON.stringify(body) }),
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
	createTask: (body: {
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
			assignee_user_id?: string;
		}
	) =>
		fetchJson<ApiTask>(`/tasks/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body)
		}),
	updateTaskStatus: (id: string, status: string) =>
		fetchJson<ApiTask>(`/tasks/${id}/status`, {
			method: 'POST',
			body: JSON.stringify({ status })
		})
};
