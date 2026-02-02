<script>
	// @ts-nocheck
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { afterNavigate } from '$app/navigation';
	import { lists } from '$lib/stores/lists';
	import { tasks } from '$lib/stores/tasks';
	import { pushPendingToServer, syncFromServer } from '$lib/sync/sync';
	import { syncStatus } from '$lib/sync/status';

	let navOpen = false;
	const toggleNav = () => (navOpen = !navOpen);
	const closeNav = () => (navOpen = false);

	afterNavigate(() => {
		navOpen = false;
	});

const runSync = async () => {
		try {
			syncStatus.resetError();
			await syncFromServer();
			const pushResult = await pushPendingToServer();
			// Re-pull after successful push to persist server IDs and avoid repeat creations on refresh.
			if (pushResult.pushed || pushResult.created) {
				await syncFromServer();
			}
		} catch (err) {
			console.warn('sync retry failed', err);
		}
	};

	let retryTimer = null;

	onMount(async () => {
		await Promise.all([lists.hydrateFromDb(), tasks.hydrateFromDb()]);
		void runSync();
		retryTimer = setInterval(() => {
			const s = get(syncStatus);
			if (s.pull === 'error' || s.push === 'error' || tasks.getAll().some((t) => t.dirty)) {
				void runSync();
			}
		}, 15000);
	});

	onDestroy(() => {
		if (retryTimer) clearInterval(retryTimer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
	<title>tasksync</title>
</svelte:head>

<div class="app-shell">
	<div class={`sidebar-drawer ${navOpen ? 'open' : ''}`}>
		<Sidebar />
	</div>
	{#if navOpen}
		<button class="drawer-backdrop" type="button" aria-label="Close navigation" on:click={closeNav}></button>
	{/if}
	<main>
		<header class="app-header">
			<div class="brand">
				<button class="nav-toggle" aria-label="Toggle navigation" on:click={toggleNav}>
					☰
				</button>
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
					<button class="link" on:click={runSync} title="Auto-sync runs every 15s; click to retry now">
						{#if $syncStatus.pull === 'running' || $syncStatus.push === 'running'}
							Auto-syncing…
						{:else if $syncStatus.pull === 'error' || $syncStatus.push === 'error'}
							Sync error (auto-retrying)
						{:else}
							Auto-sync ready
						{/if}
					</button>
				</span>
				{#if $syncStatus.lastError}
					<span class="err-msg">{$syncStatus.lastError}</span>
				{/if}
			</div>
		</header>
		<slot />
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: radial-gradient(circle at 10% 20%, #0f172a, #0b1221 40%, #050a1a);
		color: #e2e8f0;
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
		overflow: hidden;
		overflow-x: hidden;
		width: 100%;
	}

	:global(html),
	:global(body) {
		height: 100%;
		max-width: 100vw;
		overflow-x: hidden;
	}

	:global(input),
	:global(select),
	:global(textarea) {
		font-size: 16px;
	}

	.app-shell {
		display: grid;
		grid-template-columns: 240px 1fr;
		min-height: 100vh;
		height: 100vh;
		width: 100%;
		max-width: 100vw;
		overflow: hidden;
	}

	.sidebar-drawer {
		position: sticky;
		top: 0;
		height: 100vh;
		z-index: 10;
	}

	main {
		padding: 28px 32px;
		height: 100vh;
		overflow-y: auto;
		overflow-x: hidden;
		max-width: 100vw;
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

	.nav-toggle {
		display: none;
		margin-right: 8px;
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
		cursor: pointer;
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

	.link {
		all: unset;
		cursor: pointer;
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(2px);
		border: none;
		z-index: 9;
	}

	@media (max-width: 900px) {
		:global(body) {
			background: #0b1221;
		}

		.app-shell {
			grid-template-columns: 1fr;
		}

		.sidebar-drawer {
			position: fixed;
			inset: 0 auto 0 0;
			width: min(280px, 82vw);
			transform: translateX(-110%);
			transition: transform 160ms ease-out;
			box-shadow: 12px 0 30px rgba(0, 0, 0, 0.4);
			background: #0a0f1c;
			z-index: 12;
			pointer-events: none;
		}

		.sidebar-drawer.open {
			transform: translateX(0);
			pointer-events: auto;
		}

		main {
			padding: 18px 16px 28px;
		}

		.app-header {
			margin-bottom: 12px;
		}

		.brand {
			gap: 6px;
		}

		.nav-toggle {
			display: inline-flex;
			align-items: center;
			justify-content: center;
		}

		.sync {
			gap: 4px;
		}

		.badge {
			font-size: 11px;
			padding: 6px 8px;
		}

		.err-msg {
			display: none;
		}
	}
</style>
