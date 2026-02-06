import { afterEach, describe, expect, it } from 'vitest';
import { buildHeaders, getAuthToken, setAuthMode, setAuthToken } from './headers';

describe('auth headers', () => {
	afterEach(() => {
		localStorage.clear();
	});

	it('returns bearer authorization when token exists', () => {
		setAuthToken('abc123');
		expect(getAuthToken()).toBe('abc123');
		expect(buildHeaders()).toEqual({ authorization: 'Bearer abc123' });
	});

	it('falls back to legacy headers when token is missing', () => {
		setAuthMode('legacy');
		setAuthToken(null);
		const headers = buildHeaders();
		expect(headers['x-space-id']).toBeTruthy();
		expect(headers['x-user-id']).toBeTruthy();
	});

	it('returns empty headers in token mode without token', () => {
		setAuthMode('token');
		setAuthToken(null);
		expect(buildHeaders()).toEqual({});
	});
});
