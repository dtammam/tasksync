import { expect, test, type Page } from '@playwright/test';
import { setAuthenticatedClientState, defaultTestUser } from './helpers/auth';

const resetClientState = async (page: Page, role: 'admin' | 'contributor' = 'admin') => {
	await setAuthenticatedClientState(page, { ...defaultTestUser, role });
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
};

const openTagsSection = async (page: Page) => {
	await page.getByTestId('settings-open').click();
	await expect(page.getByTestId('settings-window')).toBeVisible();
	await page.getByTestId('settings-section-tags').first().click();
	await expect(page.getByTestId('tag-palette-settings')).toBeVisible();
};

test.describe('Tag palette settings', () => {
	test('non-admin cannot see the Tags settings section at all', async ({ page }) => {
		await resetClientState(page, 'contributor');
		await page.getByTestId('settings-open').click();
		await expect(page.getByTestId('settings-window')).toBeVisible();
		await expect(page.getByTestId('settings-section-tags')).toHaveCount(0);
	});

	test('admin sees the built-in default palette when the space has never saved one', async ({
		page
	}) => {
		let getCalls = 0;
		await page.route('**/tags', async (route) => {
			if (route.request().method() === 'GET') {
				getCalls += 1;
				await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
				return;
			}
			await route.continue();
		});

		await resetClientState(page);
		await openTagsSection(page);

		const firstSection = page.locator('.section-block').first();
		await expect(firstSection.getByLabel('Section name')).toHaveValue('Time / priority');
		await expect(firstSection.locator('.entry-row').first().getByLabel('Tag label')).toHaveValue(
			'Starred'
		);
		expect(getCalls).toBeGreaterThan(0);
	});

	test('admin can edit a tag and save; a failed save preserves the in-progress edit', async ({
		page
	}) => {
		let putBody: unknown = null;
		await page.route('**/tags', async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
				return;
			}
			if (route.request().method() === 'PUT') {
				if (putBody === 'fail-once') {
					putBody = null;
					await route.fulfill({ status: 500, contentType: 'text/plain', body: 'boom' });
					return;
				}
				putBody = JSON.parse(route.request().postData() ?? '[]');
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: route.request().postData() ?? '[]'
				});
				return;
			}
			await route.continue();
		});

		await resetClientState(page);
		await openTagsSection(page);

		const starredLabel = page
			.locator('.section-block')
			.first()
			.locator('.entry-row')
			.first()
			.locator('.name-input');
		await starredLabel.fill('Top priority');

		// Force one failed save first to prove the edit survives an error.
		putBody = 'fail-once';
		const saveButton = page.getByText('Save changes');
		await saveButton.click();
		await expect(page.locator('.tags .error')).toBeVisible();
		await expect(starredLabel).toHaveValue('Top priority');

		await saveButton.click();
		await expect(page.locator('.tags .ok')).toContainText('Saved.');
		expect(putBody).toBeTruthy();
	});
});
