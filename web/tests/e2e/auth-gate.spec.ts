import { expect, test } from '@playwright/test';

/**
 * Gated login wall E2E coverage.
 *
 * The auth gate in +layout.svelte withholds all app content (app-shell,
 * Sidebar, routed pages) until $auth.status === 'authenticated'. An
 * unauthenticated visitor sees only <LoginWall/>, which picks first-run
 * setup vs login from GET /auth/status.
 */

test.describe('Gated login wall', () => {
	test('@smoke anonymous visitor sees the login wall and no app content', async ({ page }) => {
		await page.route('**/auth/status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ owner_exists: true })
			});
		});

		await page.goto('/');

		await expect(page.getByTestId('login-wall')).toBeVisible();
		await expect(page.getByTestId('loginwall-login')).toBeVisible();

		// No app-shell, no Sidebar, no task/list content reaches an anonymous visitor.
		await expect(page.getByTestId('app-shell')).toHaveCount(0);
		await expect(page.getByTestId('sidebar-drawer')).toHaveCount(0);
		await expect(page.getByTestId('new-task-input')).toHaveCount(0);
		await expect(page.getByTestId('task-row')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'My Day' })).toHaveCount(0);
	});

	test('@smoke fresh deployment with no owner shows the first-run setup screen', async ({ page }) => {
		await page.route('**/auth/status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ owner_exists: false })
			});
		});

		await page.goto('/');

		await expect(page.getByTestId('loginwall-setup')).toBeVisible();
		await expect(page.getByTestId('loginwall-login')).toHaveCount(0);
	});

	test('@smoke deployment with an existing owner shows the login screen', async ({ page }) => {
		await page.route('**/auth/status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ owner_exists: true })
			});
		});

		await page.goto('/');

		await expect(page.getByTestId('loginwall-login')).toBeVisible();
		await expect(page.getByTestId('loginwall-setup')).toHaveCount(0);
	});

	test('@smoke anonymous visitor has no reachable Sidebar login form', async ({ page }) => {
		await page.route('**/auth/status', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ owner_exists: true })
			});
		});

		await page.goto('/');

		// The only sign-in control reachable for an anonymous visitor is the
		// LoginWall's own — the Sidebar (and the settings drawer where the login
		// form used to live, reachable only after opening the sidebar) is not
		// rendered at all for an unauthenticated visitor.
		await expect(page.getByTestId('login-wall').getByTestId('auth-signin')).toBeVisible();
		await expect(page.getByTestId('auth-signin')).toHaveCount(1);
		await expect(page.getByTestId('settings-open')).toHaveCount(0);
		await expect(page.getByTestId('sidebar-drawer')).toHaveCount(0);
		await expect(page.getByTestId('auth-panel')).toHaveCount(0);
	});
});
