import { expect, test, type Page } from '@playwright/test';
import { updateTaskInIdb, waitForTaskInIdb } from './helpers/idb';
import { setAuthenticatedClientState } from './helpers/auth';

const makeTitle = (base: string) => `${base} ${Math.random().toString(36).slice(2, 8)}`;

const resetClientState = async (page: Page) => {
	await setAuthenticatedClientState(page);
	await page.goto('/');
	await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');
};

test.describe('Task tags', () => {
	test('list view groups into tag-headed sections in palette order, untagged at the bottom', async ({
		page
	}) => {
		await resetClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const untaggedTitle = makeTitle('Untagged item');
		const dairyTitle = makeTitle('Dairy item');
		const priorityTitle = makeTitle('Priority item');

		for (const title of [untaggedTitle, dairyTitle, priorityTitle]) {
			await page.getByTestId('new-task-input').fill(title);
			await page.getByTestId('new-task-submit').click();
			await waitForTaskInIdb(page, title);
		}

		// 🥛 (dairy) is defined after ⭐ (time/priority) in the palette, so its
		// section must render second even though it was tagged in this order.
		await updateTaskInIdb(page, dairyTitle, { emoji: '🥛' });
		await updateTaskInIdb(page, priorityTitle, { emoji: '⭐' });

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		// Three distinct tag states in play (⭐, 🥛, untagged) -> three sections,
		// and ⭐ (Time/priority) is defined before 🥛 (Grocery aisles) in the
		// palette, so it must render first regardless of tagging order; Untagged
		// always sorts last.
		const groupTitles = page.getByTestId('tag-group-title');
		await expect(groupTitles).toHaveCount(3);
		await expect(groupTitles.nth(0)).toContainText('⭐');
		await expect(groupTitles.nth(1)).toContainText('🥛');
		await expect(groupTitles.nth(2)).toContainText('Untagged');

		// Each row actually renders (not just its group header).
		await expect(page.getByTestId('task-title').filter({ hasText: priorityTitle })).toBeVisible();
		await expect(page.getByTestId('task-title').filter({ hasText: dairyTitle })).toBeVisible();
		await expect(
			page.getByTestId('task-title').filter({ hasText: untaggedTitle })
		).toBeVisible();
	});

	test('group headers update once a custom palette finishes hydrating, with no reload or extra edit', async ({
		page
	}) => {
		// Reproduces a real reactivity bug: `pendingGroups`/`completedGroups` are
		// Svelte `$:` blocks that call groupTasksByTag(), which reads the tag
		// palette store through a plain function call the Svelte compiler can't
		// see into -- so the groups never recomputed once the palette finished
		// hydrating asynchronously after first paint (by design: hydration must
		// not block first paint). The tag's own emoji glyph still rendered fine
		// (TaskRow reads task.emoji directly), but the group *header* stayed
		// frozen at whatever the palette looked like on first render -- the
		// built-in default, since a real palette hasn't hydrated yet. A custom
		// tag not in the default palette (like this one) renders a doubled-emoji
		// fallback label until the fix makes the header depend on `$tagPalette`.
		let releaseTagsResponse: (() => void) | null = null;
		const tagsResponseGate = new Promise<void>((resolve) => {
			releaseTagsResponse = resolve;
		});
		await page.route('**/tags', async (route) => {
			if (route.request().method() !== 'GET') {
				await route.continue();
				return;
			}
			await tagsResponseGate;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([{ section: 'Night', entries: [{ emoji: '🌙', label: 'Night' }] }])
			});
		});

		await setAuthenticatedClientState(page);
		await page.goto('/list/goal-management');
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		const title = makeTitle('Night item');
		await page.getByTestId('new-task-input').fill(title);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, title);
		await updateTaskInIdb(page, title, { emoji: '🌙' });

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		// Before hydration resolves: 🌙 isn't in the built-in default palette,
		// so the group falls back to the raw emoji as its own label -- the
		// bug's exact symptom (a doubled emoji, never a real label) if this
		// never clears without further interaction.
		const nightGroup = page.getByTestId('tag-group-title').filter({ hasText: '🌙' });
		await expect(nightGroup).toBeVisible();
		await expect(nightGroup).not.toContainText('Night');

		releaseTagsResponse!();

		await expect(page.getByTestId('tag-group-title').filter({ hasText: 'Night' })).toBeVisible();
	});

	test('My Day grouping is off by default and only groups once the toggle is enabled', async ({
		page
	}) => {
		await resetClientState(page);

		const taggedTitle = makeTitle('My Day tagged');
		await page.getByTestId('new-task-input').fill(taggedTitle);
		await page.getByTestId('new-task-submit').click();
		await waitForTaskInIdb(page, taggedTitle);
		await updateTaskInIdb(page, taggedTitle, { emoji: '🎯', my_day: true });

		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('app-shell')).toHaveAttribute('data-ready', 'true');

		// Off by default: no group header, even though a tagged task is present.
		await expect(page.getByTestId('tag-group-title')).toHaveCount(0);

		const toggle = page.getByTestId('myday-group-by-tag-toggle');
		await expect(toggle).toHaveAttribute('aria-pressed', 'false');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');

		await expect(page.getByTestId('tag-group-title').first()).toContainText('🎯');
	});
});
