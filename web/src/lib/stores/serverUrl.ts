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

/**
 * Validate a raw URL string for use as a server URL.
 * Returns an error message on failure, or null on success.
 */
export function validateServerUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return 'Enter a valid http:// or https:// URL.';
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return 'Enter a valid http:// or https:// URL.';
		}
		return null;
	} catch {
		return 'Enter a valid http:// or https:// URL.';
	}
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
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch (err) {
		console.error('[serverUrl] failed to clear invalid URL from localStorage:', err);
	}
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

		try {
			localStorage.setItem(STORAGE_KEY, validated);
		} catch (err) {
			console.error('[serverUrl] failed to persist URL to localStorage:', err);
		}
		writeRuntimeConfig(validated);
		store.set(validated);
	},

	clear(): void {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch (err) {
			console.error('[serverUrl] failed to clear URL from localStorage:', err);
		}
		writeRuntimeConfig(null);
		store.set(null);
	},

	getEffective(): string {
		return get(store) ?? defaultApiUrl();
	}
};
