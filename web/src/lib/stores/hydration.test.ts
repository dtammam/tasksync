import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

describe('hydration store', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	async function loadModule() {
		const mod = await import('./hydration');
		return { hydrated: mod.hydrated, markHydrated: mod.markHydrated };
	}

	it('hydrated defaults to false', async () => {
		const { hydrated } = await loadModule();
		expect(get(hydrated)).toBe(false);
	});

	it('markHydrated sets hydrated to true', async () => {
		const { hydrated, markHydrated } = await loadModule();
		markHydrated();
		expect(get(hydrated)).toBe(true);
	});

	it('calling markHydrated multiple times is idempotent and stays true', async () => {
		const { hydrated, markHydrated } = await loadModule();
		markHydrated();
		markHydrated();
		markHydrated();
		expect(get(hydrated)).toBe(true);
	});
});
