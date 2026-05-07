<script lang="ts">
	import { onMount } from 'svelte';
	import { Capacitor } from '@capacitor/core';
	import { serverUrl, validateServerUrl } from '$lib/stores/serverUrl';

	const PROMPTED_KEY = 'tasksync:server-url-prompted';

	let visible = false;
	let urlDraft = '';
	let urlError = '';

	onMount(() => {
		const isNative = Capacitor.isNativePlatform();
		const alreadyPrompted = localStorage.getItem(PROMPTED_KEY) === '1';
		const hasUrl = serverUrl.get() !== null;

		if (isNative && !alreadyPrompted && !hasUrl) {
			urlDraft = serverUrl.getEffective();
			visible = true;
		}
	});

	const handleSave = () => {
		const err = validateServerUrl(urlDraft);
		if (err) {
			urlError = err;
			return;
		}
		urlError = '';
		serverUrl.set(urlDraft.trim());
		try {
			localStorage.setItem(PROMPTED_KEY, '1');
		} catch (err) {
			console.error('Failed to persist server URL prompt state', err);
		}
		visible = false;
	};

	const handleSkip = () => {
		try {
			localStorage.setItem(PROMPTED_KEY, '1');
		} catch (err) {
			console.error('Failed to persist server URL prompt state', err);
		}
		visible = false;
	};

	const handleInput = (event: Event) => {
		urlDraft = (event.currentTarget as HTMLInputElement).value;
		urlError = '';
	};
</script>

{#if visible}
	<div class="overlay" data-testid="server-url-prompt-overlay" role="dialog" aria-modal="true" aria-labelledby="server-url-prompt-heading">
		<div class="card">
			<h2 id="server-url-prompt-heading">Connect to Server</h2>
			<p class="description">Enter your TaskSync server URL to sync your tasks.</p>
			<label for="server-url-prompt-input" class="input-label">Server URL</label>
			<input
				id="server-url-prompt-input"
				type="text"
				data-testid="server-url-prompt-input"
				value={urlDraft}
				placeholder="https://your-server.example.com"
				on:input={handleInput}
			/>
			{#if urlError}
				<p class="error" data-testid="server-url-prompt-error" role="alert">{urlError}</p>
			{/if}
			<div class="actions">
				<button type="button" class="primary" data-testid="server-url-prompt-save" on:click={handleSave}>
					Save
				</button>
				<button type="button" class="skip" data-testid="server-url-prompt-skip" on:click={handleSkip}>
					Use Default
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		padding: var(--sp-4);
	}

	.card {
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		border-radius: 16px;
		padding: var(--sp-6);
		width: 100%;
		max-width: 400px;
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		box-shadow: var(--ring-shadow);
	}

	h2 {
		margin: 0;
		font-size: var(--text-lg);
		color: var(--app-text);
	}

	.description {
		margin: 0;
		font-size: var(--text-base);
		color: var(--app-muted);
	}

	.input-label {
		font-size: var(--text-sm);
		color: var(--app-muted);
		display: block;
		margin-bottom: calc(var(--sp-2) * -1);
	}

	input {
		width: 100%;
		background: var(--surface-2, #0a101d);
		border: 1px solid var(--border-1);
		border-radius: 8px;
		color: var(--app-text);
		padding: 10px 12px;
		font-size: 16px;
		box-sizing: border-box;
	}

	input:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--error);
	}

	.actions {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
	}

	.primary {
		background: var(--surface-accent, #1d4ed8);
		border: none;
		border-radius: 8px;
		color: #fff;
		padding: 10px 20px;
		font-size: var(--text-md);
		cursor: pointer;
		font-weight: 600;
	}

	.primary:hover {
		opacity: 0.9;
	}

	.skip {
		background: none;
		border: none;
		color: var(--app-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 4px 8px;
		text-decoration: underline;
	}

	.skip:hover {
		color: var(--app-text);
	}
</style>
