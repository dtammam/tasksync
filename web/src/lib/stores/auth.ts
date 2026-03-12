import { get, writable } from 'svelte/store';
import { api, apiErrorStatus } from '$lib/api/client';
import { getAuthMode, getAuthToken, setAuthMode, setAuthToken, type AuthMode } from '$lib/api/headers';
import type { AuthUpdateProfileRequest, AuthUser } from '$shared/types/auth';

const authUserKey = 'tasksync:auth-user';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
type AuthOrigin = 'token' | 'legacy' | null;

export interface AuthState {
	status: AuthStatus;
	mode: AuthMode;
	source: AuthOrigin;
	user: AuthUser | null;
	error: string | null;
}

const initialState: AuthState = {
	status: 'loading',
	mode: 'token',
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
		avatar_icon: typeof candidate.avatar_icon === 'string' ? candidate.avatar_icon : undefined,
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
const isLikelyNetworkError = (err: unknown) => /failed to fetch|networkerror|network request failed/i.test(authError(err));

const formatHydrateError = (err: unknown): string => {
	const code = apiErrorStatus(err);
	if (code === 401 || code === 403) {
		return 'Your session expired or is not valid. Please sign in again.';
	}
	if (code === 404) {
		return 'Auth endpoint was not found (404). Check that web and server versions match.';
	}
	if (code && code >= 500) {
		return `Server auth is unavailable right now (${code}). Please try again shortly.`;
	}
	if (isLikelyNetworkError(err)) {
		return 'Cannot reach the server right now. You can continue local use and retry sign-in later.';
	}
	return `Could not verify your session: ${authError(err)}`;
};

const formatLoginError = (err: unknown): string => {
	const code = apiErrorStatus(err);
	if (code === 400) {
		return 'Sign in request is invalid. Check email, password, and space ID.';
	}
	if (code === 401 || code === 403) {
		return 'Sign in failed. Check your email, password, and space ID.';
	}
	if (code === 404) {
		return 'Sign in endpoint was not found (404). Check the API URL and server version.';
	}
	if (code && code >= 500) {
		return `Sign in is temporarily unavailable (${code}). Please try again shortly.`;
	}
	if (isLikelyNetworkError(err)) {
		return 'Cannot reach the server. Check your connection and API URL.';
	}
	return `Sign in failed: ${authError(err)}`;
};

const isAuthFailure = (err: unknown) => {
	const code = apiErrorStatus(err);
	return code === 401 || code === 403;
};

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
			if (isAuthFailure(err)) {
				if (token) {
					setAuthToken(null);
				}
				persistUser(null);
				authStore.set({
					status: 'anonymous',
					mode,
					source: null,
					user: null,
					error: formatHydrateError(err)
				});
				return;
			}

			if (mode === 'token' && token && cachedUser) {
				authStore.set({
					status: 'authenticated',
					mode,
					source: 'token',
					user: cachedUser,
					error: formatHydrateError(err)
				});
				return;
			}

			if (token && mode !== 'token') {
				setAuthToken(null);
			}
			persistUser(null);
			authStore.set({
				status: 'anonymous',
				mode,
				source: null,
				user: null,
				error: formatHydrateError(err)
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
				avatar_icon: response.avatar_icon,
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
				error: formatLoginError(err)
			});
			throw err;
		}
	},
	async updateProfile(body: AuthUpdateProfileRequest) {
		const current = get(authStore);
		if (current.status !== 'authenticated' || !current.user) {
			throw new Error('Not authenticated');
		}
		const updated = await api.updateMe(body);
		persistUser(updated);
		authStore.set({
			...current,
			user: updated,
			error: null
		});
		return updated;
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
