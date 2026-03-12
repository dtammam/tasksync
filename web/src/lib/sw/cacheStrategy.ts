/**
 * Caching strategy helpers for the service worker.
 *
 * Extracted as pure functions (injectable deps) so they can be unit-tested
 * without a real ServiceWorkerGlobalScope. The service worker imports and
 * calls these directly; no behavior change from the original inline handlers.
 */

export interface CacheLike {
	match(req: RequestInfo): Promise<Response | undefined>;
	put(req: RequestInfo, res: Response): Promise<void>;
}

export interface CachesDeps {
	open(name: string): Promise<CacheLike>;
}

export interface StrategyDeps {
	caches: CachesDeps;
	doFetch(req: Request): Promise<Response>;
	warn(msg: string, err: unknown): void;
}

/** Store a valid response in cache (skips non-ok, non-opaque responses). */
const storeInCache = async (cache: CacheLike, req: Request, res: Response): Promise<void> => {
	if (!res || (!res.ok && res.type !== 'opaque')) return;
	await cache.put(req, res.clone());
};

/**
 * Network-first strategy used for navigate (document) requests.
 * - Tries network; caches the response on success.
 * - On failure: returns exact-URL cache hit, then app-shell fallback, then throws.
 */
export const networkFirstNavigate = async (
	request: Request,
	shellCacheName: string,
	shellUrl: string,
	deps: StrategyDeps
): Promise<Response> => {
	try {
		const res = await deps.doFetch(request);
		const cache = await deps.caches.open(shellCacheName);
		await storeInCache(cache, request, res);
		return res;
	} catch (err) {
		deps.warn('[sw] fetch failed', err);
		const cache = await deps.caches.open(shellCacheName);
		const exact = await cache.match(request);
		if (exact) return exact;
		const shell = await cache.match(shellUrl);
		if (shell) return shell;
		throw new Error('Offline and no cached shell available');
	}
};

/**
 * Cache-first strategy used for asset (script/style/image/font) requests.
 * - Returns cached runtime hit immediately.
 * - On miss: fetches from network and caches; on network failure falls back
 *   to shell cache, then throws.
 */
export const cacheFirstAsset = async (
	request: Request,
	runtimeCacheName: string,
	shellCacheName: string,
	deps: StrategyDeps
): Promise<Response> => {
	const runtime = await deps.caches.open(runtimeCacheName);
	const cached = await runtime.match(request);
	if (cached) return cached;
	try {
		const res = await deps.doFetch(request);
		await storeInCache(runtime, request, res);
		return res;
	} catch (err) {
		deps.warn('[sw] fetch failed', err);
		const shell = await deps.caches.open(shellCacheName);
		const hit = await shell.match(request);
		if (hit) return hit;
		throw new Error('Offline and request not cached');
	}
};
