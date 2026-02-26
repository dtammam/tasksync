/// <reference types="@sveltejs/kit" />

declare const self: ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';
import { base } from '$app/paths';

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
const withBase = (value: string) => `${base}${value}`.replace(/\/\/{2,}/g, '/');

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

const cacheResponse = async (cacheName: string, request: Request, response: Response) => {
	if (!response || (!response.ok && response.type !== 'opaque')) return;
	const cache = await caches.open(cacheName);
	await cache.put(request, response.clone());
};

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	if (!shouldHandleRequest(request, url)) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const networkResponse = await fetch(request);
					await cacheResponse(SHELL_CACHE, request, networkResponse);
					return networkResponse;
				} catch {
					const cache = await caches.open(SHELL_CACHE);
					const cachedNavigation = await cache.match(request);
					if (cachedNavigation) return cachedNavigation;
					const cachedShell = await cache.match(withBase('/'));
					if (cachedShell) return cachedShell;
					throw new Error('Offline and no cached shell available');
				}
			})()
		);
		return;
	}

	event.respondWith(
		(async () => {
			const runtime = await caches.open(RUNTIME_CACHE);
			const cached = await runtime.match(request);
			if (cached) {
				return cached;
			}
			try {
				const networkResponse = await fetch(request);
				await cacheResponse(RUNTIME_CACHE, request, networkResponse);
				return networkResponse;
			} catch {
				const shell = await caches.open(SHELL_CACHE);
				const shellHit = await shell.match(request);
				if (shellHit) return shellHit;
				throw new Error('Offline and request not cached');
			}
		})()
	);
});
