import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('serverUrl store', () => {
	beforeEach(() => {
		localStorage.clear();
		// Reset runtime config
		if (window.__TASKSYNC_RUNTIME_CONFIG__) {
			window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl = undefined;
		}
		vi.resetModules();
	});

	async function loadStore() {
		const mod = await import('./serverUrl');
		return mod.serverUrl;
	}

	it('set() persists a valid URL to localStorage and store', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://example.com');

		expect(serverUrl.get()).toBe('https://example.com');
		expect(localStorage.getItem('tasksync:server-url')).toBe('https://example.com');
	});

	it('rejects empty string', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const serverUrl = await loadStore();
		serverUrl.set('');

		expect(serverUrl.get()).toBeNull();
		expect(localStorage.getItem('tasksync:server-url')).toBeNull();
		warnSpy.mockRestore();
	});

	it('rejects non-URL string', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const serverUrl = await loadStore();
		serverUrl.set('not-a-url');

		expect(serverUrl.get()).toBeNull();
		expect(localStorage.getItem('tasksync:server-url')).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('rejects ftp:// protocol', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const serverUrl = await loadStore();
		serverUrl.set('ftp://example.com');

		expect(serverUrl.get()).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('rejects bare path "/api"', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const serverUrl = await loadStore();
		serverUrl.set('/api');

		expect(serverUrl.get()).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('strips trailing slashes', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://example.com/');
		expect(serverUrl.get()).toBe('https://example.com');

		serverUrl.set('https://example.com///');
		expect(serverUrl.get()).toBe('https://example.com');
	});

	it('trims whitespace', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('  https://example.com  ');
		expect(serverUrl.get()).toBe('https://example.com');
	});

	it('clear() resets to null and removes localStorage key', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://example.com');
		expect(serverUrl.get()).toBe('https://example.com');

		serverUrl.clear();
		expect(serverUrl.get()).toBeNull();
		expect(localStorage.getItem('tasksync:server-url')).toBeNull();
	});

	it('getEffective() returns configured URL when set', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://my-server.com');
		expect(serverUrl.getEffective()).toBe('https://my-server.com');
	});

	it('getEffective() returns default when no URL configured', async () => {
		const serverUrl = await loadStore();
		const effective = serverUrl.getEffective();
		// Should return a sensible default (port 3000 on current origin)
		expect(effective).toMatch(/^https?:\/\//);
		expect(effective).toContain(':3000');
	});

	it('updates window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl on set()', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://runtime.example.com');
		expect(window.__TASKSYNC_RUNTIME_CONFIG__?.apiUrl).toBe('https://runtime.example.com');
	});

	it('clears window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl on clear()', async () => {
		const serverUrl = await loadStore();
		serverUrl.set('https://runtime.example.com');
		serverUrl.clear();
		expect(window.__TASKSYNC_RUNTIME_CONFIG__?.apiUrl).toBeUndefined();
	});

	it('initializes from localStorage on module load', async () => {
		localStorage.setItem('tasksync:server-url', 'https://pre-set.example.com');
		const serverUrl = await loadStore();

		expect(serverUrl.get()).toBe('https://pre-set.example.com');
		expect(window.__TASKSYNC_RUNTIME_CONFIG__?.apiUrl).toBe('https://pre-set.example.com');
	});

	it('clears invalid stored value on init and warns', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		localStorage.setItem('tasksync:server-url', 'not-valid');
		const serverUrl = await loadStore();

		expect(serverUrl.get()).toBeNull();
		expect(localStorage.getItem('tasksync:server-url')).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('rejects javascript: protocol URLs', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
		const serverUrl = await loadStore();
		serverUrl.set('javascript:alert(1)');

		expect(serverUrl.get()).toBeNull();
		expect(localStorage.getItem('tasksync:server-url')).toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('is reactive via subscribe', async () => {
		const serverUrl = await loadStore();
		const values: (string | null)[] = [];
		const unsub = serverUrl.subscribe((v) => values.push(v));

		serverUrl.set('https://a.com');
		serverUrl.set('https://b.com');
		serverUrl.clear();

		unsub();
		expect(values).toEqual([null, 'https://a.com', 'https://b.com', null]);
	});
});
