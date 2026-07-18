import { get, writable } from 'svelte/store';
import { api, apiErrorStatus } from '$lib/api/client';
import { getAuthToken, setAuthToken } from '$lib/api/headers';
import type {
	AuthChangePasswordRequest,
	AuthSetupRequest,
	AuthUpdateProfileRequest,
	AuthUser
} from '$shared/types/auth';

const authUserKey = 'tasksync:auth-user';
const staleAuthModeKey = 'tasksync:auth-mode';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
type AuthOrigin = 'token' | null;

export interface AuthState {
	status: AuthStatus;
	source: AuthOrigin;
	user: AuthUser | null;
	error: string | null;
}

const initialState: AuthState = {
	status: 'loading',
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

const formatSetupError = (err: unknown): string => {
	const code = apiErrorStatus(err);
	if (code === 400) {
		return 'Owner setup request is invalid. Check email, display name, and password.';
	}
	if (code === 409) {
		return 'An owner account already exists. Please sign in instead.';
	}
	if (code === 404) {
		return 'Setup endpoint was not found (404). Check the API URL and server version.';
	}
	if (code && code >= 500) {
		return `Owner setup is temporarily unavailable (${code}). Please try again shortly.`;
	}
	if (isLikelyNetworkError(err)) {
		return 'Cannot reach the server. Check your connection and API URL.';
	}
	return `Owner setup failed: ${authError(err)}`;
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
		// One-time cleanup: retire the pre-token-auth legacy mode flag. A stale
		// legacy device resolves anonymous below with no network call (offline-first).
		if (typeof localStorage !== 'undefined') {
			localStorage.removeItem(staleAuthModeKey);
		}
		const token = getAuthToken();
		const cachedUser = readStoredUser();
		authStore.set({
			status: 'loading',
			source: token ? 'token' : null,
			user: cachedUser,
			error: null
		});

		if (!token) {
			authStore.set({
				status: 'anonymous',
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
				source: 'token',
				user: me,
				error: null
			});
		} catch (err) {
			if (isAuthFailure(err)) {
				setAuthToken(null);
				persistUser(null);
				authStore.set({
					status: 'anonymous',
					source: null,
					user: null,
					error: formatHydrateError(err)
				});
				return;
			}

			if (cachedUser) {
				authStore.set({
					status: 'authenticated',
					source: 'token',
					user: cachedUser,
					error: formatHydrateError(err)
				});
				return;
			}

			persistUser(null);
			authStore.set({
				status: 'anonymous',
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
			setAuthToken(response.token);
			persistUser(user);
			authStore.set({
				status: 'authenticated',
				source: 'token',
				user,
				error: null
			});
			return user;
		} catch (err) {
			authStore.set({
				status: 'anonymous',
				source: null,
				user: null,
				error: formatLoginError(err)
			});
			throw err;
		}
	},
	async setupOwner(body: AuthSetupRequest) {
		authStore.update((current) => ({
			...current,
			status: 'loading',
			error: null
		}));
		try {
			const response = await api.setupOwner(body);
			const user: AuthUser = {
				user_id: response.user_id,
				email: response.email,
				display: response.display,
				avatar_icon: response.avatar_icon,
				space_id: response.space_id,
				role: response.role
			};
			setAuthToken(response.token);
			persistUser(user);
			authStore.set({
				status: 'authenticated',
				source: 'token',
				user,
				error: null
			});
			return user;
		} catch (err) {
			authStore.set({
				status: 'anonymous',
				source: null,
				user: null,
				error: formatSetupError(err)
			});
			throw err;
		}
	},
	async fetchOwnerStatus(): Promise<boolean> {
		const response = await api.authStatus();
		return response.owner_exists;
	},
	async revokeAllSessions(): Promise<void> {
		const current = get(authStore);
		if (current.status !== 'authenticated') {
			throw new Error('Not authenticated');
		}
		const response = await api.revokeSessions();
		setAuthToken(response.token);
	},
	async changePassword(body: AuthChangePasswordRequest): Promise<void> {
		const response = await api.changePassword(body);
		setAuthToken(response.token);
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
		setAuthToken(null);
		persistUser(null);
		authStore.set({
			status: 'anonymous',
			source: null,
			user: null,
			error: null
		});
	}
};
