<script lang="ts">
	import { serverUrl, validateServerUrl } from '$lib/stores/serverUrl';

	let urlDraft = serverUrl.getEffective();
	let urlError = '';
	let urlMessage = '';
	let urlMessageTimer: ReturnType<typeof setTimeout> | null = null;

	const saveUrl = () => {
		const err = validateServerUrl(urlDraft);
		if (err) {
			urlError = err;
			urlMessage = '';
			return;
		}
		urlError = '';
		serverUrl.set(urlDraft.trim());
		urlDraft = serverUrl.getEffective();
		if (urlMessageTimer !== null) clearTimeout(urlMessageTimer);
		urlMessage = 'Saved.';
		urlMessageTimer = setTimeout(() => {
			urlMessage = '';
			urlMessageTimer = null;
		}, 2000);
	};

	const resetUrl = () => {
		serverUrl.clear();
		urlDraft = serverUrl.getEffective();
		urlError = '';
		urlMessage = '';
	};
</script>

<div class="card server" data-testid="server-settings-panel">
	<p class="muted-note">
		Set a custom server URL for sync. Leave as the default if you are not using a custom deployment.
	</p>
	<label>
		Server URL
		<input
			type="text"
			data-testid="server-url-input"
			value={urlDraft}
			placeholder="https://your-server.example.com"
			on:input={(event) => {
				urlDraft = (event.currentTarget as HTMLInputElement).value;
				urlError = '';
			}}
		/>
	</label>
	{#if urlError}
		<p class="error">{urlError}</p>
	{/if}
	<div class="server-actions">
		<button type="button" class="primary" data-testid="server-url-save" on:click={saveUrl}>
			Save
		</button>
		<button type="button" class="ghost" data-testid="server-url-reset" on:click={resetUrl}>
			Reset to default
		</button>
	</div>
	{#if urlMessage}
		<p class="ok">{urlMessage}</p>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.muted-note {
		margin: 0;
		font-size: 12px;
		color: var(--app-muted);
	}

	.ok {
		margin: 0;
		color: #86efac;
		font-size: 12px;
	}

	.error {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}

	.server-actions {
		display: flex;
		gap: 8px;
	}
</style>
