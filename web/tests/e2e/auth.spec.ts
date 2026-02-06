import { expect, test } from '@playwright/test';

test('can sign in with token mode and restore session after reload', async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('pw-auth-init') === '1') return;
		sessionStorage.setItem('pw-auth-init', '1');
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	await page.route('**/auth/login', async (route) => {
		const body = route.request().postDataJSON() as {
			email?: string;
			password?: string;
			space_id?: string;
		};
		if (body.email !== 'admin@example.com' || body.password !== 'tasksync') {
			await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				token: 'test-token',
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: body.space_id ?? 's1',
				role: 'admin'
			})
		});
	});

	await page.route('**/auth/me', async (route) => {
		const authHeader = route.request().headers()['authorization'];
		if (authHeader !== 'Bearer test-token') {
			await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				user_id: 'admin',
				email: 'admin@example.com',
				display: 'Admin',
				space_id: 's1',
				role: 'admin'
			})
		});
	});

	await page.route('**/lists', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await page.route('**/tasks', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);

	await page.goto('/');
	await expect(page.getByTestId('auth-email')).toBeVisible();
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-space').fill('s1');
	await page.getByTestId('auth-signin').click();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');

	await page.reload();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');
});
