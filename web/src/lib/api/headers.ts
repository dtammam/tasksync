const spaceId = import.meta.env.VITE_SPACE_ID ?? '';
const userId = import.meta.env.VITE_USER_ID ?? '';
const role = import.meta.env.VITE_ROLE ?? 'admin';

export const buildHeaders = () => {
	const headers: Record<string, string> = {
		'x-space-id': spaceId,
		'x-user-id': userId,
		'x-role': role
	};
	return headers;
};
