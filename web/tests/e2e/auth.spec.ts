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
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('open-settings').click();
	await expect(page.getByTestId('settings-modal')).toBeVisible();
	await expect(page.getByTestId('auth-email')).toBeVisible();
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-space').fill('s1');
	await page.getByTestId('auth-signin').click();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');
	await expect(page.getByTestId('settings-modal')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Members' })).toBeVisible();
	await page.getByTestId('close-settings').click();

	await page.reload();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');
	await expect(page.getByTestId('open-settings')).toBeVisible();
});

test('can change password from account panel', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});

	let capturedBody: { current_password?: string; new_password?: string } | null = null;

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

	await page.route('**/auth/password', async (route) => {
		capturedBody = route.request().postDataJSON() as {
			current_password?: string;
			new_password?: string;
		};
		await route.fulfill({ status: 204, body: '' });
	});

	await page.route('**/lists', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);
	await page.route('**/tasks', (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
	);

	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('open-settings').click();
	await expect(page.getByTestId('settings-modal')).toBeVisible();
	await page.getByTestId('auth-email').fill('admin@example.com');
	await page.getByTestId('auth-password').fill('tasksync');
	await page.getByTestId('auth-signin').click();
	await expect(page.getByTestId('auth-user')).toContainText('admin@example.com');
	await expect(page.getByTestId('settings-modal')).toBeVisible();

	await page.getByRole('button', { name: 'Change password' }).click();
	await page.getByLabel('Current password').fill('tasksync');
	await page.getByPlaceholder('min 8 chars').fill('tasksync-new');
	await page.getByPlaceholder('repeat new password').fill('tasksync-new');
	await page.getByRole('button', { name: 'Update password' }).click();

	await expect(page.getByText('Password updated.')).toBeVisible();
	await expect.poll(() => capturedBody?.current_password).toBe('tasksync');
	await expect.poll(() => capturedBody?.new_password).toBe('tasksync-new');
});
