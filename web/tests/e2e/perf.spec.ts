/**
 * @smoke @perf — interaction timing regression guard.
 *
 * Budget (docs/RELIABILITY.md): primary UI actions < 16 ms product target.
 * E2E ceiling: < 200 ms (generous allowance for test-runner overhead, IPC,
 * and paint commit lag; not a substitute for the product budget).
 *
 * Only Chromium — timing is too variable across headless engines to gate on.
 */

import { expect, test } from '@playwright/test';

const resetClientState = async (page: import('@playwright/test').Page) => {
	await page.addInitScript(() => {
		localStorage.setItem('tasksync:auth-mode', 'token');
		localStorage.removeItem('tasksync:auth-token');
		localStorage.removeItem('tasksync:auth-user');
	});
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
};

test('@smoke @perf task toggle is fast (< 200 ms E2E ceiling)', async ({ page }) => {
	await resetClientState(page);

	// Seed a task.
	const title = `perf-test-${Math.random().toString(36).slice(2, 8)}`;
	await page.getByTestId('new-task-input').fill(title);
	await page.getByTestId('new-task-submit').click();

	const row = page.getByTestId('task-row').filter({ hasText: title });
	await expect(row).toHaveCount(1);

	// Measure: time from clicking the toggle to the task appearing in completed.
	const toggle = row.getByTestId('task-toggle');
	const t0 = Date.now();
	await toggle.click();

	// Task should move to completed section — toggle becomes acknowledged.
	await expect(toggle).toHaveAttribute('data-acknowledged', 'true', { timeout: 1000 });
	const elapsed = Date.now() - t0;

	// E2E ceiling — fails only on severe regression, not minor variance.
	expect(elapsed, `task toggle took ${elapsed} ms, ceiling is 200 ms`).toBeLessThan(200);
});
