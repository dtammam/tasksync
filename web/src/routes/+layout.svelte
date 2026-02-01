<script lang="ts">
import favicon from '$lib/assets/favicon.svg';
import Sidebar from '$lib/components/Sidebar.svelte';
import { onMount } from 'svelte';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import { pushPendingToServer, syncFromServer } from '$lib/sync/sync';
import { syncStatus } from '$lib/sync/status';

	let { children } = $props();

onMount(async () => {
	await Promise.all([lists.hydrateFromDb(), tasks.hydrateFromDb()]);
	void syncFromServer();
	void pushPendingToServer();
});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>tasksync</title>
</svelte:head>

<div class="app-shell">
	<Sidebar />
	<main>
		<header class="app-header">
			<div class="brand">
				<img src={favicon} alt="logo" />
				<span>tasksync</span>
			</div>
			<div class="sync">
				<span
					class={`badge ${
						$syncStatus.pull === 'error' || $syncStatus.push === 'error'
							? 'error'
							: $syncStatus.pull === 'running' || $syncStatus.push === 'running'
								? 'busy'
								: ''
					}`}
				>
					{#if $syncStatus.pull === 'running' || $syncStatus.push === 'running'}
						Syncing…
					{:else if $syncStatus.pull === 'error' || $syncStatus.push === 'error'}
						Sync error
					{:else}
						Sync idle
					{/if}
				</span>
				{#if $syncStatus.lastError}
					<span class="err-msg">{$syncStatus.lastError}</span>
				{/if}
			</div>
		</header>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: radial-gradient(circle at 10% 20%, #0f172a, #0b1221 40%, #050a1a);
		color: #e2e8f0;
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 100vh;
	}

	main {
		padding: 28px 32px;
	}

	.app-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}

	.brand {
		display: flex;
		gap: 10px;
		align-items: center;
		font-weight: 700;
		letter-spacing: 0.02em;
	}

	.brand img {
		width: 28px;
		height: 28px;
	}

	.sync {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.badge {
		padding: 6px 10px;
		border-radius: 999px;
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #cbd5e1;
		font-size: 12px;
	}

	.badge.busy {
		background: #1d4ed8;
		border-color: #1d4ed8;
		color: white;
	}

	.badge.error {
		background: #7f1d1d;
		border-color: #ef4444;
		color: #fecdd3;
	}

	.err-msg {
		color: #ef4444;
		font-size: 12px;
	}
</style>
