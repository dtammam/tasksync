const spaceId = import.meta.env.VITE_SPACE_ID ?? 's1';
const userId = import.meta.env.VITE_USER_ID ?? 'admin';
const role = import.meta.env.VITE_ROLE ?? 'admin';
const authTokenKey = 'tasksync:auth-token';
const authModeKey = 'tasksync:auth-mode';

export type AuthMode = 'legacy' | 'token';

export const getAuthToken = () => {
	if (typeof localStorage === 'undefined') return null;
	const token = localStorage.getItem(authTokenKey)?.trim();
	return token ? token : null;
};

export const getAuthMode = (): AuthMode => {
	if (typeof localStorage === 'undefined') return 'legacy';
	const mode = localStorage.getItem(authModeKey);
	return mode === 'token' ? 'token' : 'legacy';
};

export const setAuthToken = (token: string | null) => {
	if (typeof localStorage === 'undefined') return;
	if (!token) {
		localStorage.removeItem(authTokenKey);
		return;
	}
	localStorage.setItem(authTokenKey, token);
};

export const setAuthMode = (mode: AuthMode) => {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(authModeKey, mode);
};

export const buildHeaders = () => {
	const token = getAuthToken();
	if (token) {
		return {
			authorization: `Bearer ${token}`
		};
	}

	if (getAuthMode() === 'token') {
		return {};
	}

	const headers: Record<string, string> = {
		'x-space-id': spaceId,
		'x-user-id': userId,
		'x-role': role
	};
	return headers;
};
