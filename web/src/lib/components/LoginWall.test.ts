import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import type { AuthState } from '$lib/stores/auth';

// Mock the auth store so tests can control fetchOwnerStatus/login/setupOwner
// independently, while still exposing a real writable for $auth reactive
// bindings (error display).
const mockAuthState = writable<AuthState>({
	status: 'anonymous',
	source: null,
	user: null,
	error: null
});

const mockFetchOwnerStatus = vi.fn();
const mockLogin = vi.fn();
const mockSetupOwner = vi.fn();

vi.mock('$lib/stores/auth', () => ({
	auth: {
		subscribe: (run: (state: AuthState) => void) => mockAuthState.subscribe(run),
		fetchOwnerStatus: (...args: unknown[]) => mockFetchOwnerStatus(...args),
		login: (...args: unknown[]) => mockLogin(...args),
		setupOwner: (...args: unknown[]) => mockSetupOwner(...args)
	}
}));

beforeEach(() => {
	mockAuthState.set({ status: 'anonymous', source: null, user: null, error: null });
	mockFetchOwnerStatus.mockReset();
	mockLogin.mockReset();
	mockSetupOwner.mockReset();
});

async function renderWall() {
	const { default: LoginWall } = await import('./LoginWall.svelte');
	const result = render(LoginWall);
	await tick();
	return result;
}

describe('LoginWall', () => {
	it('renders the setup form when owner_exists is false', async () => {
		mockFetchOwnerStatus.mockResolvedValue(false);

		const { getByTestId, queryByTestId } = await renderWall();
		await tick();
		await tick();

		expect(getByTestId('loginwall-setup')).toBeTruthy();
		expect(getByTestId('setup-email')).toBeTruthy();
		expect(getByTestId('setup-display')).toBeTruthy();
		expect(getByTestId('setup-password')).toBeTruthy();
		expect(getByTestId('setup-submit')).toBeTruthy();
		expect(queryByTestId('loginwall-login')).toBeNull();
	});

	it('renders the login form when owner_exists is true', async () => {
		mockFetchOwnerStatus.mockResolvedValue(true);

		const { getByTestId, queryByTestId } = await renderWall();
		await tick();
		await tick();

		expect(getByTestId('loginwall-login')).toBeTruthy();
		expect(getByTestId('auth-email')).toBeTruthy();
		expect(getByTestId('auth-password')).toBeTruthy();
		expect(getByTestId('auth-space')).toBeTruthy();
		expect(getByTestId('auth-signin')).toBeTruthy();
		expect(queryByTestId('loginwall-setup')).toBeNull();
	});

	it('defaults to the login form when the status fetch fails (fail toward login)', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		mockFetchOwnerStatus.mockRejectedValue(new Error('offline'));

		const { getByTestId, queryByTestId } = await renderWall();
		await tick();
		await tick();

		expect(getByTestId('loginwall-login')).toBeTruthy();
		expect(queryByTestId('loginwall-setup')).toBeNull();
		expect(warnSpy).toHaveBeenCalled();

		warnSpy.mockRestore();
	});

	it('renders a minimal loading state while the status probe is in flight', async () => {
		let resolveStatus: (value: boolean) => void = () => undefined;
		mockFetchOwnerStatus.mockReturnValue(
			new Promise<boolean>((resolve) => {
				resolveStatus = resolve;
			})
		);

		const { getByTestId, queryByTestId } = await renderWall();

		expect(getByTestId('loginwall-loading')).toBeTruthy();
		expect(queryByTestId('loginwall-setup')).toBeNull();
		expect(queryByTestId('loginwall-login')).toBeNull();

		resolveStatus(true);
		await tick();
		await tick();

		expect(getByTestId('loginwall-login')).toBeTruthy();
	});

	it('disables the sign-in button until email and password are filled, then calls auth.login', async () => {
		mockFetchOwnerStatus.mockResolvedValue(true);
		mockLogin.mockResolvedValue(undefined);

		const { getByTestId } = await renderWall();
		await tick();
		await tick();

		const submit = getByTestId('auth-signin') as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		const email = getByTestId('auth-email') as HTMLInputElement;
		const password = getByTestId('auth-password') as HTMLInputElement;
		const space = getByTestId('auth-space') as HTMLInputElement;
		await fireEvent.input(email, { target: { value: ' owner@example.com ' } });
		await fireEvent.input(password, { target: { value: ' hunter2 ' } });
		await fireEvent.input(space, { target: { value: 's1' } });
		await tick();

		expect(submit.disabled).toBe(false);

		await fireEvent.click(submit);
		await tick();

		expect(mockLogin).toHaveBeenCalledWith('owner@example.com', 'hunter2', 's1');
	});

	it('disables the create-owner button until required fields are filled, then calls auth.setupOwner', async () => {
		mockFetchOwnerStatus.mockResolvedValue(false);
		mockSetupOwner.mockResolvedValue(undefined);

		const { getByTestId } = await renderWall();
		await tick();
		await tick();

		const submit = getByTestId('setup-submit') as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		await fireEvent.input(getByTestId('setup-email'), { target: { value: 'owner@example.com' } });
		await fireEvent.input(getByTestId('setup-display'), { target: { value: 'Owner' } });
		await fireEvent.input(getByTestId('setup-password'), { target: { value: 'supersecret' } });
		await tick();

		expect(submit.disabled).toBe(false);

		await fireEvent.click(submit);
		await tick();

		expect(mockSetupOwner).toHaveBeenCalledWith({
			email: 'owner@example.com',
			display: 'Owner',
			password: 'supersecret',
			space_id: 's1'
		});
	});

	it('shows the friendly $auth.error message inline on the login form', async () => {
		mockFetchOwnerStatus.mockResolvedValue(true);

		const { getByTestId, queryByText } = await renderWall();
		await tick();
		await tick();

		mockAuthState.set({
			status: 'anonymous',
			source: null,
			user: null,
			error: 'Sign in failed. Check your email, password, and space ID.'
		});
		await tick();

		expect(getByTestId('loginwall-login')).toBeTruthy();
		expect(queryByText('Sign in failed. Check your email, password, and space ID.')).toBeTruthy();
	});
});
