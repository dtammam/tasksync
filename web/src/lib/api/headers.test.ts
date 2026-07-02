import { afterEach, describe, expect, it } from 'vitest';
import { buildHeaders, getAuthToken, setAuthToken } from './headers';

describe('auth headers', () => {
	afterEach(() => {
		localStorage.clear();
	});

	it('returns bearer authorization when token exists', () => {
		setAuthToken('abc123');
		expect(getAuthToken()).toBe('abc123');
		expect(buildHeaders()).toEqual({ authorization: 'Bearer abc123' });
	});

	it('returns empty headers without a token', () => {
		setAuthToken(null);
		expect(buildHeaders()).toEqual({});
	});

	it('treats a whitespace-only stored token as absent', () => {
		localStorage.setItem('tasksync:auth-token', '   ');
		expect(getAuthToken()).toBeNull();
		expect(buildHeaders()).toEqual({});
	});

	it('setAuthToken(null) removes the stored token', () => {
		setAuthToken('abc123');
		setAuthToken(null);
		expect(localStorage.getItem('tasksync:auth-token')).toBeNull();
		expect(getAuthToken()).toBeNull();
	});
});
