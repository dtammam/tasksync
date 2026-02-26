import { expect, test, type Page } from '@playwright/test';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const resetClientState = async (page: Page) => {
	await page.addInitScript(() => {
		// Keep e2e deterministic and local-first: signed-out token mode disables live server sync.
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});
};

const ensureServiceWorkerControlsPage = async (page: Page) => {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					if (!('serviceWorker' in navigator)) return 'missing';
					const registration = await navigator.serviceWorker.ready;
					if (!registration?.active) return 'missing';
					return navigator.serviceWorker.controller ? 'controlled' : 'active';
				}),
			{ timeout: 20_000 }
		)
		.not.toBe('missing');

	if (!(await page.evaluate(() => !!navigator.serviceWorker?.controller))) {
		await page.reload();
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(true);
	}
};

test.describe('Offline continuity', () => {
	test.use({ serviceWorkers: 'allow' });

	test('hard reload offline keeps cached shell and local data', async ({ page, context }) => {
		await resetClientState(page);
		await page.goto('/');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const title = makeTitle('Offline continuity');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);

		await ensureServiceWorkerControlsPage(page);

		await context.setOffline(true);
		await page.reload({ waitUntil: 'domcontentloaded' });

		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
		await expect(page.getByTestId('task-row').filter({ hasText: title })).toHaveCount(1);
	});
});
