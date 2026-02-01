import { buildHeaders } from './headers';

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
	getLists: () => fetchJson<ApiList[]>('/lists'),
	getTasks: () => fetchJson<ApiTask[]>('/tasks'),
	createTask: (body: { title: string; list_id: string; my_day?: boolean; order?: string }) =>
		fetchJson<ApiTask>('/tasks', {
			method: 'POST',
			body: JSON.stringify(body)
		})
};
