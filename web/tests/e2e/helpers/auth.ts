import type { Page } from '@playwright/test';

// Shared E2E test-user shape. Mirrors the wire fields the client persists in
// `tasksync:auth-user` (see web/src/lib/stores/auth.ts's AuthUser).
export interface TestUser {
	user_id: string;
	email: string;
	display: string;
	space_id: string;
	role?: 'admin' | 'contributor';
}

export const defaultTestUser: TestUser = {
	user_id: 'admin',
	email: 'admin@example.com',
	display: 'Admin',
	space_id: 's1'
};

/**
 * Seeds a cached authenticated session (token + user) via `addInitScript`, so
 * it is present before the app's first script runs on every subsequent
 * navigation/reload in the test. The gated login wall (`+layout.svelte`)
 * renders app content only once `$auth.status === 'authenticated'`; with no
 * live backend in the E2E environment, `auth.hydrate()`'s `api.me()` call
 * fails with a network error (not 401) and resolves 'authenticated' from this
 * cached token+user — offline-first, no live round-trip required.
 */
export const setAuthenticatedClientState = async (page: Page, user: TestUser = defaultTestUser) => {
	await page.addInitScript((initialUser) => {
		localStorage.setItem('tasksync:auth-token', 'test-token');
		localStorage.setItem(
			'tasksync:auth-user',
			JSON.stringify({
				...initialUser,
				role: initialUser.role ?? 'admin'
			})
		);
	}, user);
};
