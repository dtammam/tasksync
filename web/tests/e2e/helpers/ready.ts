import { expect, type Page } from '@playwright/test';

/**
 * Wait until the app shell has both hydrated locally (`data-ready`) AND applied
 * its first authenticated server sync (`data-synced`).
 *
 * `data-ready` reflects only local IndexedDB / seed hydration, so asserting on
 * server-origin rows or lists right after it races the async startup `/sync/pull`
 * (tech-debt #050 and the sidebar-drag count flake). Waiting on `data-synced`
 * gates on "server state applied" instead. The timeout is generous on purpose:
 * it is a bounded wait on a real, deterministic condition that resolves the
 * instant the sync settles — not a fixed sleep — so it tolerates a slow boot or
 * pull under CI load without racing the default 10s expect window.
 */
export async function expectAppSynced(page: Page, timeout = 30_000): Promise<void> {
	const shell = page.getByTestId('app-shell');
	await expect(shell).toHaveAttribute('data-ready', 'true', { timeout });
	await expect(shell).toHaveAttribute('data-synced', 'true', { timeout });
}
