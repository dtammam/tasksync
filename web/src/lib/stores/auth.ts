import { get, writable } from 'svelte/store';
import { api } from '$lib/api/client';
import { getAuthMode, getAuthToken, setAuthMode, setAuthToken, type AuthMode } from '$lib/api/headers';
import type { AuthUser } from '$shared/types/auth';

const authUserKey = 'tasksync:auth-user';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
type AuthSource = 'token' | 'legacy' | null;

export interface AuthState {
	status: AuthStatus;
	mode: AuthMode;
	source: AuthSource;
	user: AuthUser | null;
	error: string | null;
}

const initialState: AuthState = {
	status: 'loading',
	mode: 'legacy',
	source: null,
	user: null,
	error: null
};

const authStore = writable<AuthState>(initialState);

const normalizeUser = (value: unknown): AuthUser | null => {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.user_id !== 'string' ||
		typeof candidate.email !== 'string' ||
		typeof candidate.display !== 'string' ||
		typeof candidate.space_id !== 'string' ||
		(candidate.role !== 'admin' && candidate.role !== 'contributor')
	) {
		return null;
	}
	return {
		user_id: candidate.user_id,
		email: candidate.email,
		display: candidate.display,
		space_id: candidate.space_id,
		role: candidate.role
	};
};

const readStoredUser = (): AuthUser | null => {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(authUserKey);
	if (!raw) return null;
	try {
		return normalizeUser(JSON.parse(raw));
	} catch {
		return null;
	}
};

const persistUser = (user: AuthUser | null) => {
	if (typeof localStorage === 'undefined') return;
	if (!user) {
		localStorage.removeItem(authUserKey);
		return;
	}
	localStorage.setItem(authUserKey, JSON.stringify(user));
};

const authError = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const auth = {
	subscribe: authStore.subscribe,
	get() {
		return get(authStore);
	},
	isAuthenticated() {
		return get(authStore).status === 'authenticated';
	},
	async hydrate() {
		const mode = getAuthMode();
		const token = getAuthToken();
		const cachedUser = readStoredUser();
		authStore.set({
			status: 'loading',
			mode,
			source: token ? 'token' : mode === 'legacy' ? 'legacy' : null,
			user: cachedUser,
			error: null
		});

		if (mode === 'token' && !token) {
			authStore.set({
				status: 'anonymous',
				mode,
				source: null,
				user: null,
				error: null
			});
			return;
		}

		try {
			const me = await api.me();
			persistUser(me);
			authStore.set({
				status: 'authenticated',
				mode,
				source: token ? 'token' : 'legacy',
				user: me,
				error: null
			});
		} catch (err) {
			if (token) {
				setAuthToken(null);
			}
			persistUser(null);
			authStore.set({
				status: 'anonymous',
				mode,
				source: null,
				user: null,
				error: authError(err)
			});
		}
	},
	async login(email: string, password: string, spaceId?: string) {
		authStore.update((current) => ({
			...current,
			status: 'loading',
			mode: 'token',
			error: null
		}));
		try {
			const response = await api.login({
				email,
				password,
				space_id: spaceId || undefined
			});
			const user: AuthUser = {
				user_id: response.user_id,
				email: response.email,
				display: response.display,
				space_id: response.space_id,
				role: response.role
			};
			setAuthMode('token');
			setAuthToken(response.token);
			persistUser(user);
			authStore.set({
				status: 'authenticated',
				mode: 'token',
				source: 'token',
				user,
				error: null
			});
			return user;
		} catch (err) {
			authStore.set({
				status: 'anonymous',
				mode: 'token',
				source: null,
				user: null,
				error: authError(err)
			});
			throw err;
		}
	},
	logout() {
		setAuthMode('token');
		setAuthToken(null);
		persistUser(null);
		authStore.set({
			status: 'anonymous',
			mode: 'token',
			source: null,
			user: null,
			error: null
		});
	}
};
