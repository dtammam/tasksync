const authTokenKey = 'tasksync:auth-token';

export const getAuthToken = () => {
	if (typeof localStorage === 'undefined') return null;
	const token = localStorage.getItem(authTokenKey)?.trim();
	return token ? token : null;
};

export const setAuthToken = (token: string | null) => {
	if (typeof localStorage === 'undefined') return;
	if (!token) {
		localStorage.removeItem(authTokenKey);
		return;
	}
	localStorage.setItem(authTokenKey, token);
};

export const buildHeaders = (): Record<string, string> => {
	const token = getAuthToken();
	if (token) {
		return {
			authorization: `Bearer ${token}`
		};
	}
	return {};
};
