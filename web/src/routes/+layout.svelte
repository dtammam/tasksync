<script>
	// @ts-nocheck
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { afterNavigate } from '$app/navigation';
	import { lists } from '$lib/stores/lists';
	import { members } from '$lib/stores/members';
	import { tasks } from '$lib/stores/tasks';
	import { soundSettings } from '$lib/stores/settings';
	import { setDbScope } from '$lib/data/idb';
	import { auth } from '$lib/stores/auth';
	import { pushPendingToServer, resetSyncCursor, syncFromServer } from '$lib/sync/sync';
	import { syncStatus } from '$lib/sync/status';
	import { createSyncCoordinator } from '$lib/sync/coordinator';

	const NAV_PIN_KEY = 'tasksync:nav-pinned';
	let navOpen = false;
	let navPinned = false;
	let appReady = false;
	let syncInFlight = null;
	let syncCoordinator = null;
	let syncLeader = true;
	let syncStatusUnsub = null;
	const toggleNav = () => {
		if (navPinned && navOpen) {
			savePinned(false);
			navOpen = false;
			return;
		}
		navOpen = !navOpen;
	};
	const closeNav = () => {
		if (!navPinned) navOpen = false;
	};

	const savePinned = (pinned) => {
		navPinned = pinned;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(NAV_PIN_KEY, pinned ? '1' : '0');
		}
		if (pinned) {
			navOpen = true;
		}
	};

	afterNavigate(() => {
		if (!navPinned) {
			navOpen = false;
		}
	});

	const runSync = async () => {
		if (!auth.isAuthenticated()) return;
		if (syncInFlight) return syncInFlight;
		syncInFlight = (async () => {
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
			} finally {
				syncInFlight = null;
			}
		})();
		return syncInFlight;
	};

	const requestSync = (reason = 'manual') => {
		if (!auth.isAuthenticated()) return;
		if (syncCoordinator) {
			syncCoordinator.requestSync(reason);
			return;
		}
		void runSync();
	};

	const publishSyncStatus = () => {
		if (!syncCoordinator || !syncLeader || !auth.isAuthenticated()) return;
		syncCoordinator.publishStatus(get(syncStatus));
	};

	let retryTimer = null;
	let lastScopeKey = '';

	const storageScopeFromAuth = (state) => {
		if (state.status === 'authenticated' && state.user) {
			return `space:${state.user.space_id}:user:${state.user.user_id}`;
		}
		return state.mode === 'token' ? 'token-anonymous' : 'legacy-default';
	};

	const hydrateScopedStores = async () => {
		const scope = storageScopeFromAuth(auth.get());
		setDbScope(scope);
		await Promise.all([lists.hydrateFromDb(), tasks.hydrateFromDb(), soundSettings.hydrateFromDb()]);
	};

	onMount(async () => {
		syncCoordinator = createSyncCoordinator({
			onLeaderChange: (isLeader) => {
				syncLeader = isLeader;
				if (isLeader && auth.isAuthenticated()) {
					publishSyncStatus();
					void runSync();
				}
			},
			onRunSync: () => {
				if (auth.isAuthenticated()) {
					void runSync();
				}
			},
			onStatus: (status) => {
				if (!syncLeader && auth.isAuthenticated()) {
					syncStatus.setSnapshot(status);
				}
			}
		});
		syncStatusUnsub = syncStatus.subscribe(() => publishSyncStatus());
		if (typeof localStorage !== 'undefined') {
			navPinned = localStorage.getItem(NAV_PIN_KEY) === '1';
			navOpen = navPinned;
		}
		await auth.hydrate();
		syncCoordinator.setAuthenticated(auth.isAuthenticated());
		await hydrateScopedStores();
		await members.hydrateFromServer();
		lastScopeKey = storageScopeFromAuth(auth.get());
		appReady = true;
		if (auth.isAuthenticated()) {
			requestSync('startup');
		}
		retryTimer = setInterval(() => {
			const s = get(syncStatus);
			if (!syncLeader || !auth.isAuthenticated()) return;
			if (s.pull === 'error' || s.push === 'error' || tasks.getAll().some((t) => t.dirty)) {
				requestSync('retry');
			}
		}, 15000);
	});

	onDestroy(() => {
		if (retryTimer) clearInterval(retryTimer);
		if (syncStatusUnsub) syncStatusUnsub();
		if (syncCoordinator) syncCoordinator.destroy();
	});

	$: scopeKey = storageScopeFromAuth($auth);
	$: if (appReady && scopeKey !== lastScopeKey) {
		lastScopeKey = scopeKey;
		void (async () => {
			resetSyncCursor();
			await hydrateScopedStores();
			await members.hydrateFromServer();
			if (auth.isAuthenticated()) {
				requestSync('scope-change');
			}
		})();
	}
	$: if (syncCoordinator) {
		syncCoordinator.setAuthenticated(auth.isAuthenticated());
	}
	$: if (!auth.isAuthenticated()) {
		members.clear();
		resetSyncCursor();
		syncStatus.setSnapshot({ pull: 'idle', push: 'idle' });
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
	<title>tasksync</title>
</svelte:head>

<div
	class={`app-shell ${navPinned && navOpen ? 'nav-split' : ''}`}
	data-testid="app-shell"
	data-ready={appReady ? 'true' : 'false'}
>
	<div class={`sidebar-drawer ${navOpen ? 'open' : ''}`} data-testid="sidebar-drawer">
		<Sidebar navPinned={navPinned} on:togglePin={(e) => savePinned(e.detail.pinned)} />
	</div>
	{#if navOpen && !navPinned}
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
					<button
						class="link"
						on:click={() => requestSync('manual')}
						title={
							syncLeader
								? 'Auto-sync runs every 15s; click to retry now'
								: 'Auto-sync is managed by another open tab; click to request sync now'
						}
					>
						{#if $auth.status === 'loading'}
							Checking auth...
						{:else if $auth.status !== 'authenticated'}
							Sign in to sync
						{:else if !syncLeader}
							Auto-sync linked
						{:else if $syncStatus.pull === 'running' || $syncStatus.push === 'running'}
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
		font-family: 'Segoe UI Variable Text', 'Segoe UI', 'SF Pro Text', system-ui, sans-serif;
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

	:global(button:focus-visible),
	:global(input:focus-visible),
	:global(select:focus-visible),
	:global(textarea:focus-visible) {
		outline: 2px solid #60a5fa;
		outline-offset: 2px;
	}

	.app-shell {
		--sidebar-offset: 240px;
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
		min-width: 0;
	}

	main {
		padding: 28px 32px;
		height: 100vh;
		overflow-y: auto;
		overflow-x: hidden;
		max-width: 100vw;
		min-width: 0;
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
			--sidebar-offset: 0px;
			grid-template-columns: 1fr;
		}

		.sidebar-drawer {
			position: fixed;
			inset: 0 auto 0 0;
			width: min(260px, 78vw);
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

		.app-shell.nav-split {
			--sidebar-offset: min(208px, 58vw);
			grid-template-columns: min(208px, 58vw) 1fr;
		}

		.app-shell.nav-split .sidebar-drawer {
			position: sticky;
			inset: auto;
			width: 100%;
			transform: none;
			transition: none;
			box-shadow: none;
			pointer-events: auto;
		}

		.app-shell.nav-split main {
			padding: 16px 12px 24px;
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
