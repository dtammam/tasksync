import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'tasksync:server-url';

const defaultApiUrl = (): string => {
	if (typeof window === 'undefined') return 'http://localhost:3000';
	const apiOrigin = new URL(window.location.origin);
	apiOrigin.port = '3000';
	return apiOrigin.origin;
};

function validateAndNormalize(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		console.warn(`[serverUrl] invalid URL: ${JSON.stringify(trimmed)}`);
		return null;
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		console.warn(`[serverUrl] unsupported protocol: ${parsed.protocol} in ${JSON.stringify(trimmed)}`);
		return null;
	}

	// Use origin (strips path, query, hash) and remove trailing slashes
	return parsed.origin.replace(/\/+$/, '');
}

function writeRuntimeConfig(url: string | null): void {
	if (typeof window === 'undefined') return;
	if (url) {
		if (!window.__TASKSYNC_RUNTIME_CONFIG__) {
			window.__TASKSYNC_RUNTIME_CONFIG__ = {};
		}
		window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl = url;
	} else {
		if (window.__TASKSYNC_RUNTIME_CONFIG__) {
			window.__TASKSYNC_RUNTIME_CONFIG__.apiUrl = undefined;
		}
	}
}

// Initialize from localStorage
function initFromStorage(): string | null {
	if (typeof localStorage === 'undefined') return null;
	const stored = localStorage.getItem(STORAGE_KEY);
	if (!stored) return null;

	const validated = validateAndNormalize(stored);
	if (validated) {
		writeRuntimeConfig(validated);
		return validated;
	}

	// Invalid stored value — clear it
	localStorage.removeItem(STORAGE_KEY);
	return null;
}

const store = writable<string | null>(initFromStorage());

export const serverUrl = {
	subscribe: store.subscribe,

	get(): string | null {
		return get(store);
	},

	set(url: string): void {
		const validated = validateAndNormalize(url);
		if (!validated) return;

		localStorage.setItem(STORAGE_KEY, validated);
		writeRuntimeConfig(validated);
		store.set(validated);
	},

	clear(): void {
		localStorage.removeItem(STORAGE_KEY);
		writeRuntimeConfig(null);
		store.set(null);
	},

	getEffective(): string {
		return get(store) ?? defaultApiUrl();
	}
};
