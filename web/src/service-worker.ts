/// <reference types="@sveltejs/kit" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';
import { networkFirstNavigate, cacheFirstAsset } from '$lib/sw/cacheStrategy';

const SHELL_CACHE = `tasksync-shell-${version}`;
const RUNTIME_CACHE = `tasksync-runtime-${version}`;

const CACHEABLE_DESTINATIONS = new Set([
	'document',
	'script',
	'style',
	'font',
	'image',
	'manifest',
	'worker'
]);

const API_ROUTE_PREFIXES = ['/api', '/auth', '/sync', '/tasks', '/lists', '/members', '/backup'];

const normalizeUrlPath = (value: string) => (value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value);
const scopeBasePath = (() => {
	const pathname = normalizeUrlPath(new URL(self.registration.scope).pathname);
	return pathname === '/' ? '' : pathname;
})();

const withBase = (value: string) => {
	const prefixed = value.startsWith('/') ? value : `/${value}`;
	if (!scopeBasePath) return prefixed;
	if (prefixed === scopeBasePath || prefixed.startsWith(`${scopeBasePath}/`)) {
		return prefixed;
	}
	return `${scopeBasePath}${prefixed}`.replace(/\/\/{2,}/g, '/');
};

const isApiRequest = (url: URL) => {
	const pathname = normalizeUrlPath(url.pathname);
	return API_ROUTE_PREFIXES.some((prefix) => {
		const rooted = normalizeUrlPath(withBase(prefix));
		return pathname === rooted || pathname.startsWith(`${rooted}/`);
	});
};

const shellAssets = [
	...build,
	...files,
	'/',
	'/runtime-config.js',
	'/manifest.webmanifest',
	'/favicon.svg',
	'/favicon-32x32.png',
	'/favicon-16x16.png',
	'/apple-touch-icon.png'
].map((path) => withBase(path));

const addShellAssets = async () => {
	const cache = await caches.open(SHELL_CACHE);
	await Promise.allSettled(shellAssets.map(async (asset) => cache.add(asset)));
};

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			await addShellAssets();
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
					.map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

const shouldHandleRequest = (request: Request, url: URL) => {
	if (request.method !== 'GET') return false;
	if (url.origin !== self.location.origin) return false;
	if (isApiRequest(url)) return false;
	if (request.mode === 'navigate') return true;
	return CACHEABLE_DESTINATIONS.has(request.destination);
};

const swDeps = {
	caches,
	doFetch: (req: Request) => fetch(req),
	warn: (msg: string, err: unknown) => console.warn(msg, err)
};

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	if (!shouldHandleRequest(request, url)) return;

	if (request.mode === 'navigate') {
		event.respondWith(networkFirstNavigate(request, SHELL_CACHE, withBase('/'), swDeps));
		return;
	}

	event.respondWith(cacheFirstAsset(request, RUNTIME_CACHE, SHELL_CACHE, swDeps));
});
