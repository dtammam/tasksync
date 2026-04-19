import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

// Mock @capacitor/core — default to browser (non-native) mode.
vi.mock('@capacitor/core', () => ({
	Capacitor: {
		isNativePlatform: vi.fn(() => false)
	}
}));

// Mock the serverUrl store so tests can control get() return value
// independently of localStorage state.
const mockServerUrlGet = vi.fn((): string | null => null);
const mockServerUrlSet = vi.fn() as ReturnType<typeof vi.fn<(url: string) => void>>;
const mockServerUrlGetEffective = vi.fn((): string => 'http://localhost:3000');
const mockServerUrlSubscribe = vi.fn(() => () => undefined);

vi.mock('$lib/stores/serverUrl', () => ({
	serverUrl: {
		get: mockServerUrlGet,
		set: mockServerUrlSet,
		getEffective: mockServerUrlGetEffective,
		subscribe: mockServerUrlSubscribe
	},
	validateServerUrl: (raw: string): string | null => {
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
}));

// Import after mocks are registered.
import { Capacitor } from '@capacitor/core';

const PROMPTED_KEY = 'tasksync:server-url-prompted';
const SERVER_URL_KEY = 'tasksync:server-url';

beforeEach(() => {
	localStorage.clear();
	vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
	mockServerUrlGet.mockReturnValue(null);
	mockServerUrlSet.mockReset();
	mockServerUrlGetEffective.mockReturnValue('http://localhost:3000');
});

async function renderPrompt() {
	const { default: ServerUrlPrompt } = await import('./ServerUrlPrompt.svelte');
	const result = render(ServerUrlPrompt);
	// Flush onMount
	await tick();
	return result;
}

describe('ServerUrlPrompt', () => {
	it('does not render the modal when running in browser (isNativePlatform returns false)', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
		mockServerUrlGet.mockReturnValue(null);

		const { queryByTestId } = await renderPrompt();

		expect(queryByTestId('server-url-prompt-overlay')).toBeNull();
	});

	it('does not render the modal when the user has already been prompted', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		localStorage.setItem(PROMPTED_KEY, '1');
		mockServerUrlGet.mockReturnValue(null);

		const { queryByTestId } = await renderPrompt();

		expect(queryByTestId('server-url-prompt-overlay')).toBeNull();
	});

	it('does not render the modal when a server URL is already configured', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		mockServerUrlGet.mockReturnValue('https://existing.example.com');

		const { queryByTestId } = await renderPrompt();

		expect(queryByTestId('server-url-prompt-overlay')).toBeNull();
	});

	it('renders the modal when running in Capacitor with no URL and not yet prompted', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		mockServerUrlGet.mockReturnValue(null);

		const { getByTestId, getByText } = await renderPrompt();

		expect(getByTestId('server-url-prompt-overlay')).toBeTruthy();
		expect(getByText('Connect to Server')).toBeTruthy();
		expect(getByText('Enter your TaskSync server URL to sync your tasks.')).toBeTruthy();
	});

	it('saves a valid URL, sets the prompted flag, and dismisses the modal on Save', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		mockServerUrlGet.mockReturnValue(null);

		const { getByTestId, queryByTestId } = await renderPrompt();

		const input = getByTestId('server-url-prompt-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'https://my-server.example.com' } });
		await fireEvent.click(getByTestId('server-url-prompt-save'));
		await tick();

		// Modal dismissed
		expect(queryByTestId('server-url-prompt-overlay')).toBeNull();
		// Prompted flag set
		expect(localStorage.getItem(PROMPTED_KEY)).toBe('1');
		// serverUrl.set called with the entered URL
		expect(mockServerUrlSet).toHaveBeenCalledWith('https://my-server.example.com');
		// No URL written directly to localStorage by the test itself
		expect(localStorage.getItem(SERVER_URL_KEY)).toBeNull();
	});

	it('shows an inline error and keeps the modal open when Save is clicked with an invalid URL', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		mockServerUrlGet.mockReturnValue(null);

		const { getByTestId, queryByTestId } = await renderPrompt();

		const input = getByTestId('server-url-prompt-input') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'not-a-valid-url' } });
		await fireEvent.click(getByTestId('server-url-prompt-save'));
		await tick();

		// Modal still visible
		expect(queryByTestId('server-url-prompt-overlay')).not.toBeNull();
		// Inline error shown
		expect(getByTestId('server-url-prompt-error')).toBeTruthy();
		// Prompted flag NOT set
		expect(localStorage.getItem(PROMPTED_KEY)).toBeNull();
		// serverUrl.set NOT called
		expect(mockServerUrlSet).not.toHaveBeenCalled();
	});

	it('sets the prompted flag and dismisses the modal on Skip without saving a URL', async () => {
		vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
		mockServerUrlGet.mockReturnValue(null);

		const { getByTestId, queryByTestId } = await renderPrompt();

		await fireEvent.click(getByTestId('server-url-prompt-skip'));
		await tick();

		// Modal dismissed
		expect(queryByTestId('server-url-prompt-overlay')).toBeNull();
		// Prompted flag set so prompt won't reappear
		expect(localStorage.getItem(PROMPTED_KEY)).toBe('1');
		// serverUrl.set NOT called
		expect(mockServerUrlSet).not.toHaveBeenCalled();
	});
});
