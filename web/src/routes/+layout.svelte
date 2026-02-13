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
	import { uiPreferences } from '$lib/stores/preferences';
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
	let lastFollowerReplayTs = 0;
	let lastFollowerHydrateAt = 0;
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
				if (pushResult.pushed || pushResult.created || pushResult.rejected) {
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
		if (syncCoordinator && !syncLeader) {
			syncCoordinator.requestSync(reason);
			return;
		}
		return runSync();
	};

	const refreshNow = () => {
		if (typeof window === 'undefined') return;
		window.location.reload();
	};

	const fallbackCopyText = (text) => {
		if (typeof document === 'undefined') return false;
		const el = document.createElement('textarea');
		el.value = text;
		el.setAttribute('readonly', 'true');
		el.style.position = 'fixed';
		el.style.opacity = '0';
		el.style.pointerEvents = 'none';
		document.body.appendChild(el);
		el.focus();
		el.select();
		let copied = false;
		try {
			copied = document.execCommand('copy');
		} catch {
			copied = false;
		}
		document.body.removeChild(el);
		return copied;
	};

	const setCopyLabel = (label) => {
		copyLabel = label;
		if (copyResetTimer) {
			clearTimeout(copyResetTimer);
		}
		if (label !== 'Copy') {
			copyResetTimer = setTimeout(() => {
				copyLabel = 'Copy';
				copyResetTimer = null;
			}, 1400);
		}
	};

	const collectCopyLines = () => {
		if (typeof window === 'undefined') return [];
		const provider = Reflect.get(window, '__copyTasksAsJoplin');
		if (typeof provider !== 'function') return [];
		const lines = provider();
		if (!Array.isArray(lines)) return [];
		return lines.filter((line) => typeof line === 'string' && line.trim().length > 0);
	};

	const copyTasks = async () => {
		const lines = collectCopyLines();
		if (!lines.length) {
			setCopyLabel('Nothing to copy');
			return;
		}
		const payload = lines.join('\n');
		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(payload);
			} else if (!fallbackCopyText(payload)) {
				throw new Error('Clipboard not available');
			}
			setCopyLabel('Copied');
		} catch {
			setCopyLabel('Copy failed');
		}
	};

	const publishSyncStatus = () => {
		if (!syncCoordinator || !syncLeader || !auth.isAuthenticated()) return;
		syncCoordinator.publishStatus(get(syncStatus));
	};

	let retryTimer = null;
	let visibilityListener = null;
	let copyResetTimer = null;
	let copyLabel = 'Copy';
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
		await Promise.all([
			lists.hydrateFromDb(),
			tasks.hydrateFromDb(),
			soundSettings.hydrateFromDb(),
			uiPreferences.hydrateFromLocal()
		]);
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
					const replayTs = status.lastReplayTs ?? 0;
					let shouldHydrate = false;
					if (replayTs > lastFollowerReplayTs) {
						lastFollowerReplayTs = replayTs;
						shouldHydrate = true;
					}
					if (
						status.pull === 'idle' &&
						status.push === 'idle' &&
						!status.lastError &&
						Date.now() - lastFollowerHydrateAt > 1000
					) {
						shouldHydrate = true;
					}
					if (shouldHydrate) {
						lastFollowerHydrateAt = Date.now();
						void hydrateScopedStores();
					}
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
		await soundSettings.hydrateFromServer();
		await uiPreferences.hydrateFromServer();
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
		visibilityListener = () => {
			if (document.visibilityState === 'visible' && auth.isAuthenticated()) {
				requestSync('focus');
			}
		};
		document.addEventListener('visibilitychange', visibilityListener);
	});

	onDestroy(() => {
		if (retryTimer) clearInterval(retryTimer);
		if (copyResetTimer) clearTimeout(copyResetTimer);
		if (visibilityListener) {
			document.removeEventListener('visibilitychange', visibilityListener);
		}
		if (syncStatusUnsub) syncStatusUnsub();
		if (syncCoordinator) syncCoordinator.destroy();
	});

	$: scopeKey = storageScopeFromAuth($auth);
	$: if (appReady && scopeKey !== lastScopeKey) {
		lastScopeKey = scopeKey;
		void (async () => {
			resetSyncCursor();
			await hydrateScopedStores();
			await soundSettings.hydrateFromServer();
			await uiPreferences.hydrateFromServer();
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
	$: showSyncBadge =
		$auth.status === 'loading' ||
		$auth.status !== 'authenticated' ||
		$syncStatus.pull === 'running' ||
		$syncStatus.push === 'running' ||
		$syncStatus.pull === 'error' ||
		$syncStatus.push === 'error';
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
	<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="apple-touch-icon-precomposed" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="theme-color" content="#0b1221" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="tasksync" />
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
				{#if showSyncBadge}
					<span
						class={`badge ${
							$syncStatus.pull === 'error' || $syncStatus.push === 'error'
								? 'error'
								: $syncStatus.pull === 'running' || $syncStatus.push === 'running'
									? 'busy'
									: ''
						}`}
					>
						{#if $auth.status === 'loading'}
							Checking auth…
						{:else if $auth.status !== 'authenticated'}
							Offline
						{:else if $syncStatus.pull === 'error' || $syncStatus.push === 'error'}
							Sync issue
						{:else}
							Syncing…
						{/if}
					</span>
				{/if}
				<button class="refresh-btn" type="button" on:click={refreshNow}>
					Refresh
				</button>
				<button class="refresh-btn" type="button" on:click={copyTasks}>
					{copyLabel}
				</button>
				{#if ($syncStatus.pull === 'error' || $syncStatus.push === 'error') && $syncStatus.lastError}
					<span class="err-msg">{$syncStatus.lastError}</span>
				{/if}
			</div>
		</header>
		<slot />
	</main>
</div>

<style>
	:global(:root) {
		--app-bg: radial-gradient(circle at 10% 20%, #0f172a, #0b1221 40%, #050a1a);
		--app-bg-mobile: #0b1221;
		--app-text: #e2e8f0;
		--app-muted: #cbd5e1;
		--surface-1: #0f172a;
		--surface-2: #0b1221;
		--surface-3: #11192b;
		--surface-accent: #1d4ed8;
		--border-1: #1f2937;
		--border-2: #27344f;
		--error: #ef4444;
		--focus: #60a5fa;
	}

	:global(html[data-ui-theme='dark']) {
		--app-bg: radial-gradient(circle at 15% 18%, #111111, #090909 45%, #040404);
		--app-bg-mobile: #080808;
		--app-text: #f1f5f9;
		--app-muted: #d4d4d8;
		--surface-1: #0d0d0d;
		--surface-2: #070707;
		--surface-3: #111111;
		--surface-accent: #3b82f6;
		--border-1: #1f1f1f;
		--border-2: #2c2c2c;
		--error: #fb7185;
		--focus: #93c5fd;
	}

	:global(html[data-ui-theme='light']) {
		--app-bg: linear-gradient(180deg, #f6f9ff, #ecf3ff 36%, #f8fbff);
		--app-bg-mobile: #f8fbff;
		--app-text: #0f172a;
		--app-muted: #334155;
		--surface-1: #ffffff;
		--surface-2: #f8fbff;
		--surface-3: #eef4ff;
		--surface-accent: #2563eb;
		--border-1: #cbd5e1;
		--border-2: #94a3b8;
		--error: #b91c1c;
		--focus: #1d4ed8;
	}

	:global(body) {
		margin: 0;
		background: var(--app-bg);
		color: var(--app-text);
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
		outline: 2px solid var(--focus);
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
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
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
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-muted);
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

	.refresh-btn {
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-muted);
		border-radius: 999px;
		padding: 6px 10px;
		font-size: 12px;
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
			background: var(--app-bg-mobile);
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

		.refresh-btn {
			font-size: 11px;
			padding: 6px 8px;
		}

		.err-msg {
			display: none;
		}
	}

	:global(.card),
	:global(.task),
	:global(.mobile-add .bar),
	:global(.empty),
	:global(.sorter select),
	:global(.list-sort select),
	:global(.mobile-add input),
	:global(input),
	:global(select),
	:global(textarea) {
		color: var(--app-text);
	}
</style>
