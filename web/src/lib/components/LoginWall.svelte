<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth';
	import type { AuthSetupRequest } from '$shared/types/auth';

	type WallMode = 'loading' | 'setup' | 'login';

	let mode: WallMode = 'loading';
	let busy = false;

	// Login form fields (mirrors the anonymous login form previously in Sidebar.svelte).
	let loginEmail = '';
	let loginPassword = '';
	let loginSpaceId = 's1';

	// First-run owner-setup form fields.
	let setupEmail = '';
	let setupDisplay = '';
	let setupPassword = '';
	let setupSpaceId = 's1';

	onMount(async () => {
		try {
			const ownerExists = await auth.fetchOwnerStatus();
			mode = ownerExists ? 'login' : 'setup';
		} catch (err) {
			// Fail toward login: never expose the setup form on an unknown state.
			// This is an expected/recoverable case (e.g. offline), so warn rather
			// than error.
			console.warn('Could not determine owner status; defaulting to login', err);
			mode = 'login';
		}
	});

	const signIn = async () => {
		const email = loginEmail.trim();
		const password = loginPassword.trim();
		const spaceId = loginSpaceId.trim();
		if (!email || !password) return;
		busy = true;
		try {
			await auth.login(email, password, spaceId || undefined);
			loginPassword = '';
		} catch {
			// Error messaging comes from the auth store ($auth.error).
		} finally {
			busy = false;
		}
	};

	const createOwner = async () => {
		const email = setupEmail.trim();
		const display = setupDisplay.trim();
		const password = setupPassword.trim();
		const spaceId = setupSpaceId.trim();
		if (!email || !display || !password) return;
		const body: AuthSetupRequest = {
			email,
			display,
			password,
			space_id: spaceId || undefined
		};
		busy = true;
		try {
			await auth.setupOwner(body);
			setupPassword = '';
		} catch {
			// Error messaging comes from the auth store ($auth.error).
		} finally {
			busy = false;
		}
	};
</script>

<div class="login-wall" data-testid="login-wall">
	{#if mode === 'loading'}
		<div class="card" data-testid="loginwall-loading">
			<p class="loading-text">Loading…</p>
		</div>
	{:else if mode === 'setup'}
		<div class="card" data-testid="loginwall-setup">
			<h1>Welcome to TaskSync</h1>
			<p class="description">Create the owner account to get started.</p>
			<label>
				Email
				<input
					type="email"
					placeholder="you@example.com"
					autocomplete="username"
					data-testid="setup-email"
					bind:value={setupEmail}
				/>
			</label>
			<label>
				Display name
				<input
					type="text"
					placeholder="Your name"
					autocomplete="name"
					data-testid="setup-display"
					bind:value={setupDisplay}
				/>
			</label>
			<label>
				Password
				<input
					type="password"
					placeholder="min 8 chars"
					autocomplete="new-password"
					data-testid="setup-password"
					bind:value={setupPassword}
					on:keydown={(e) => e.key === 'Enter' && createOwner()}
				/>
			</label>
			<label>
				Space
				<input type="text" placeholder="s1" data-testid="setup-space" bind:value={setupSpaceId} />
			</label>
			<button
				type="button"
				class="primary"
				data-testid="setup-submit"
				disabled={busy || !setupEmail.trim() || !setupDisplay.trim() || !setupPassword.trim()}
				on:click={createOwner}
			>
				{busy ? 'Creating owner…' : 'Create owner account'}
			</button>
			{#if $auth.error}
				<p class="error">{$auth.error}</p>
			{/if}
		</div>
	{:else}
		<div class="card" data-testid="loginwall-login">
			<h1>Sign in</h1>
			<p class="description">Sign in to your TaskSync account.</p>
			<label>
				Email
				<input
					type="email"
					placeholder="you@example.com"
					autocomplete="username"
					data-testid="auth-email"
					bind:value={loginEmail}
				/>
			</label>
			<label>
				Password
				<input
					type="password"
					placeholder="password"
					autocomplete="current-password"
					data-testid="auth-password"
					bind:value={loginPassword}
					on:keydown={(e) => e.key === 'Enter' && signIn()}
				/>
			</label>
			<label>
				Space
				<input type="text" placeholder="s1" data-testid="auth-space" bind:value={loginSpaceId} />
			</label>
			<button
				type="button"
				class="primary"
				data-testid="auth-signin"
				disabled={busy || !loginEmail.trim() || !loginPassword.trim()}
				on:click={signIn}
			>
				{busy ? 'Signing in…' : 'Sign in'}
			</button>
			{#if $auth.error}
				<p class="error">{$auth.error}</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.login-wall {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--app-bg, #04070f);
		padding: var(--sp-4, 16px);
	}

	.card {
		background: var(--surface-1, #0c1322);
		border: 1px solid var(--border-1, #2b374f);
		border-radius: 16px;
		padding: var(--sp-6, 32px);
		width: 100%;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: var(--sp-3, 12px);
		box-shadow: var(--ring-shadow, 0 16px 34px rgba(2, 6, 23, 0.34));
	}

	h1 {
		margin: 0;
		font-size: var(--text-lg, 20px);
		color: var(--app-text, #e2e8f0);
	}

	.description {
		margin: 0 0 var(--sp-2, 8px);
		font-size: var(--text-base, 13px);
		color: var(--app-muted, #cbd5e1);
	}

	.loading-text {
		margin: 0;
		font-size: var(--text-base, 13px);
		color: var(--app-muted, #cbd5e1);
		text-align: center;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-sm, 12px);
		color: var(--app-text, #e2e8f0);
	}

	input {
		background: linear-gradient(180deg, var(--surface-1, #0c1322), var(--surface-2, #0a101d));
		border: 1px solid var(--border-1, #2b374f);
		color: var(--app-text, #e2e8f0);
		border-radius: 8px;
		padding: 9px 10px;
		font-size: 16px;
		box-sizing: border-box;
	}

	input:focus-visible {
		outline: 2px solid var(--focus, #60a5fa);
		outline-offset: 2px;
	}

	.primary {
		background: var(--surface-accent, #1d4ed8);
		border: none;
		border-radius: 10px;
		color: #fff;
		padding: 10px 14px;
		cursor: pointer;
		font-weight: 650;
		font-size: var(--text-md, 14px);
		box-shadow: 0 4px 12px color-mix(in oklab, var(--surface-accent, #1d4ed8) 45%, transparent);
	}

	.primary:hover:not(:disabled) {
		opacity: 0.92;
	}

	.primary:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.error {
		color: #fda4af;
		font-size: 12px;
		margin: 0;
	}
</style>
