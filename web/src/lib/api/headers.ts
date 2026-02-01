const spaceId = import.meta.env.VITE_SPACE_ID ?? 's1';
const userId = import.meta.env.VITE_USER_ID ?? 'admin';
const role = import.meta.env.VITE_ROLE ?? 'admin';

export const buildHeaders = () => {
	const headers: Record<string, string> = {
		'x-space-id': spaceId,
		'x-user-id': userId,
		'x-role': role
	};
	return headers;
};
