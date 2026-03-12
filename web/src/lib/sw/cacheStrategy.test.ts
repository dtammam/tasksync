import { describe, it, expect, vi } from 'vitest';
import { cacheFirstAsset, networkFirstNavigate } from './cacheStrategy';

const RUNTIME = 'runtime-cache';
const SHELL = 'shell-cache';
const SHELL_URL = '/';

const makeResponse = (body = 'ok', ok = true) =>
	new Response(body, { status: ok ? 200 : 503 });

const makeCacheLike = (initial?: Response) => {
	let stored: Response | undefined = initial;
	return {
		match: vi.fn(async () => stored),
		put: vi.fn(async (_req: RequestInfo, res: Response) => {
			stored = res;
		})
	};
};

/** Build a StrategyDeps with independent runtime and shell caches. */
const makeDeps = (opts: {
	runtimeHit?: Response;
	shellHit?: Response;
	fetchResult?: Response | Error;
}) => {
	const runtimeCache = makeCacheLike(opts.runtimeHit);
	const shellCache = makeCacheLike(opts.shellHit);
	const warn = vi.fn();
	const doFetch = vi.fn(async () => {
		if (opts.fetchResult instanceof Error) throw opts.fetchResult;
		return opts.fetchResult ?? makeResponse();
	});
	const caches = {
		open: vi.fn(async (name: string) => (name === RUNTIME ? runtimeCache : shellCache))
	};
	return { deps: { caches, doFetch, warn }, runtimeCache, shellCache };
};

// ---------------------------------------------------------------------------
// cacheFirstAsset
// ---------------------------------------------------------------------------

describe('cacheFirstAsset', () => {
	it('returns cached runtime response without fetching (cache-first hit)', async () => {
		const cached = makeResponse('from-cache');
		const { deps } = makeDeps({ runtimeHit: cached });
		const req = new Request('https://app.test/app.js');

		const result = await cacheFirstAsset(req, RUNTIME, SHELL, deps);

		expect(await result.text()).toBe('from-cache');
		expect(deps.doFetch).not.toHaveBeenCalled();
	});

	it('fetches from network on cache miss and stores the response', async () => {
		const networkRes = makeResponse('from-network');
		const { deps, runtimeCache } = makeDeps({ fetchResult: networkRes });
		const req = new Request('https://app.test/app.js');

		const result = await cacheFirstAsset(req, RUNTIME, SHELL, deps);

		expect(await result.text()).toBe('from-network');
		expect(deps.doFetch).toHaveBeenCalledOnce();
		expect(runtimeCache.put).toHaveBeenCalledOnce();
	});

	it('returns shell cache hit when network fails (cache fallback)', async () => {
		const shellRes = makeResponse('shell-fallback');
		const { deps } = makeDeps({
			fetchResult: new Error('network error'),
			shellHit: shellRes
		});
		const req = new Request('https://app.test/app.js');

		const result = await cacheFirstAsset(req, RUNTIME, SHELL, deps);

		expect(await result.text()).toBe('shell-fallback');
		expect(deps.warn).toHaveBeenCalledWith('[sw] fetch failed', expect.any(Error));
	});

	it('throws when network fails and no cache exists', async () => {
		const { deps } = makeDeps({ fetchResult: new Error('network error') });
		const req = new Request('https://app.test/app.js');

		await expect(cacheFirstAsset(req, RUNTIME, SHELL, deps)).rejects.toThrow(
			'Offline and request not cached'
		);
	});
});

// ---------------------------------------------------------------------------
// networkFirstNavigate
// ---------------------------------------------------------------------------

describe('networkFirstNavigate', () => {
	it('returns network response and caches it on success', async () => {
		const networkRes = makeResponse('page-html');
		const { deps, shellCache } = makeDeps({ fetchResult: networkRes });
		const req = new Request('https://app.test/');

		const result = await networkFirstNavigate(req, SHELL, SHELL_URL, deps);

		expect(await result.text()).toBe('page-html');
		expect(shellCache.put).toHaveBeenCalledOnce();
	});

	it('returns exact-URL cache hit when network fails', async () => {
		const cachedPage = makeResponse('cached-page');
		const { deps } = makeDeps({
			fetchResult: new Error('offline'),
			runtimeHit: cachedPage // shell cache uses runtimeHit slot in single-cache deps
		});
		// Build deps with a shell cache that returns the cached page for the exact URL
		const shellCache = makeCacheLike(cachedPage);
		const customDeps = {
			...deps,
			caches: { open: vi.fn(async () => shellCache) }
		};
		const req = new Request('https://app.test/');

		const result = await networkFirstNavigate(req, SHELL, SHELL_URL, customDeps);

		expect(await result.text()).toBe('cached-page');
		expect(customDeps.warn).toHaveBeenCalledWith('[sw] fetch failed', expect.any(Error));
	});

	it('throws when network fails and no cache exists', async () => {
		const { deps } = makeDeps({ fetchResult: new Error('offline') });
		const req = new Request('https://app.test/');

		await expect(networkFirstNavigate(req, SHELL, SHELL_URL, deps)).rejects.toThrow(
			'Offline and no cached shell available'
		);
	});
});
