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
		--app-bg:
			radial-gradient(circle at 8% 6%, rgba(56, 189, 248, 0.11), transparent 30%),
			radial-gradient(circle at 92% 0%, rgba(59, 130, 246, 0.1), transparent 28%),
			linear-gradient(180deg, #04070f 0%, #060b16 52%, #050913 100%);
		--app-bg-mobile: #0b1221;
		--app-text: #e2e8f0;
		--app-muted: #cbd5e1;
		--surface-1: #0c1322;
		--surface-2: #0a101d;
		--surface-3: #161f31;
		--surface-accent: #1d4ed8;
		--border-1: #2b374f;
		--border-2: #3a4a67;
		--error: #ef4444;
		--focus: #60a5fa;
		--ring-shadow: 0 0 0 1px rgba(148, 163, 184, 0.18), 0 8px 20px rgba(2, 6, 23, 0.34);
		--soft-shadow: 0 16px 34px rgba(2, 6, 23, 0.34);
	}

	:global(html[data-ui-theme='dark']) {
		--app-bg: #0e0e0e;
		--app-bg-mobile: #0e0e0e;
		--app-text: #f5f7fb;
		--app-muted: #b8bec9;
		--surface-1: #181818;
		--surface-2: #121212;
		--surface-3: #202020;
		--border-1: #2a2a2a;
		--border-2: #3a3a3a;
	}

	:global(html[data-ui-theme='light']) {
		--app-bg: #f5f7fb;
		--app-bg-mobile: #f5f7fb;
		--app-text: #0f172a;
		--app-muted: #465870;
		--surface-1: #ffffff;
		--surface-2: #f4f7fb;
		--surface-3: #eaf0f7;
		--surface-accent: #2563eb;
		--border-1: #ccd6e4;
		--border-2: #a5b5cb;
		--focus: #1d4ed8;
	}


	:global(html[data-ui-theme='demo-theme']) {
		--app-bg: #f5f1e8;
		--app-bg-mobile: #f5f1e8;
		--app-text: #4a3f2e;
		--app-muted: #5a4a38;
		--surface-1: #fffef9;
		--surface-2: #f5f1e8;
		--surface-3: #d4b896;
		--surface-accent: #b8956a;
		--border-1: #d4b896;
		--border-2: #b8956a;
	}
	:global(html[data-ui-theme='shades-of-coffee']) { --app-bg:#e2d8cf; --app-bg-mobile:#e2d8cf; --app-text:#1a0c00; --app-muted:#604b39; --surface-1:#f5f2ef; --surface-2:#e2d8cf; --surface-3:#c29670; --surface-accent:#cfb3ff; --border-1:#c29670; --border-2:#604b39; }
	:global(html[data-ui-theme='miami-beach']) { --app-bg:#d095ca; --app-bg-mobile:#d095ca; --app-text:#5e2a91; --app-muted:#1e9484; --surface-1:#f9deb8; --surface-2:#c5ece4; --surface-3:#24b2a0; --surface-accent:#5e2a91; --border-1:#24b2a0; --border-2:#1e9484; }
	:global(html[data-ui-theme='simple-dark']) { --app-bg:#222222; --app-bg-mobile:#222222; --app-text:#d9e2ec; --app-muted:#edbe5e; --surface-1:#063446; --surface-2:#222222; --surface-3:#434343; --surface-accent:#14aeeb; --border-1:#434343; --border-2:#14aeeb; }
	:global(html[data-ui-theme='matrix']) { --app-bg:#000000; --app-bg-mobile:#000000; --app-text:#39ff14; --app-muted:#00ff00; --surface-1:#001a00; --surface-2:#000000; --surface-3:#004400; --surface-accent:#00ff41; --border-1:#004400; --border-2:#00ff00; }
	:global(html[data-ui-theme='black-gold']) { --app-bg:#141520; --app-bg-mobile:#141520; --app-text:#E8ECF0; --app-muted:#FFD700; --surface-1:#242733; --surface-2:#141520; --surface-3:#373B4A; --surface-accent:#FFD700; --border-1:#373B4A; --border-2:#8F7A20; }
	:global(html[data-ui-theme='okabe-ito']) { --app-bg:#222222; --app-bg-mobile:#222222; --app-text:#e69f00; --app-muted:#56b4e9; --surface-1:#141520; --surface-2:#222222; --surface-3:#00304d; --surface-accent:#b88115; --border-1:#00304d; --border-2:#56b4e9; }
	:global(html[data-ui-theme='theme-from-1970']) { --app-bg:#f2f2f2; --app-bg-mobile:#f2f2f2; --app-text:#4d2d19; --app-muted:#61591f; --surface-1:#f4ebe7; --surface-2:#f2f2f2; --surface-3:#dad18b; --surface-accent:#a92da3; --border-1:#dad18b; --border-2:#61591f; }
	:global(html[data-ui-theme='shades-of-gray-light']) { --app-bg:hsl(0, 0%, 90%); --app-bg-mobile:hsl(0, 0%, 90%); --app-text:hsl(0, 0%, 20%); --app-muted:hsl(0, 0%, 35%); --surface-1:#fff; --surface-2:hsl(0, 0%, 90%); --surface-3:hsl(0, 0%, 80%); --surface-accent:#99ffff; --border-1:hsl(0, 0%, 80%); --border-2:hsl(0, 0%, 35%); }
	:global(html[data-ui-theme='catppuccin-latte']) { --app-bg:#eff1f5; --app-bg-mobile:#eff1f5; --app-text:#4c4f69; --app-muted:#8839ef; --surface-1:#dce0e8; --surface-2:#eff1f5; --surface-3:#ccd0da; --surface-accent:#1e66f5; --border-1:#ccd0da; --border-2:#8839ef; }
	:global(html[data-ui-theme='catppuccin-frappe']) { --app-bg:#303446; --app-bg-mobile:#303446; --app-text:#c6d0f5; --app-muted:#ca9ee6; --surface-1:#232634; --surface-2:#303446; --surface-3:#414559; --surface-accent:#8caaee; --border-1:#414559; --border-2:#ca9ee6; }
	:global(html[data-ui-theme='catppuccin-macchiato']) { --app-bg:#24273a; --app-bg-mobile:#24273a; --app-text:#cad3f5; --app-muted:#c6a0f6; --surface-1:#181926; --surface-2:#24273a; --surface-3:#363a4f; --surface-accent:#8aadf4; --border-1:#363a4f; --border-2:#c6a0f6; }
	:global(html[data-ui-theme='catppuccin-mocha']) { --app-bg:#1e1e2e; --app-bg-mobile:#1e1e2e; --app-text:#cdd6f4; --app-muted:#cba6f7; --surface-1:#11111b; --surface-2:#1e1e2e; --surface-3:#313244; --surface-accent:#89b4fa; --border-1:#313244; --border-2:#cba6f7; }
	:global(html[data-ui-theme='you-need-a-dark-mode']) { --app-bg:#121212; --app-bg-mobile:#121212; --app-text:#D4D4D4; --app-muted:#00B3C4; --surface-1:#1E1E1E; --surface-2:#121212; --surface-3:#333333; --surface-accent:#00B3C4; --border-1:#333333; --border-2:#006A84; }
	:global(html[data-ui-theme='butterfly']) { --app-bg:#12110F; --app-bg-mobile:#12110F; --app-text:#E5E7EB; --app-muted:#F35B16; --surface-1:#22201D; --surface-2:#12110F; --surface-3:#3D261C; --surface-accent:#1B8366; --border-1:#3D261C; --border-2:#F35B16; }

	:global(body) {
		margin: 0;
		background: var(--app-bg);
		color: var(--app-text);
		font-family:
			-apple-system,
			BlinkMacSystemFont,
			'SF Pro Text',
			'Segoe UI',
			Roboto,
			'Helvetica Neue',
			Arial,
			sans-serif;
		text-rendering: geometricPrecision;
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
		width: 100%;
	}

	:global(html),
	:global(body) {
		height: 100%;
		max-width: 100vw;
		overflow-x: hidden;
	}

	:global(h1),
	:global(h2),
	:global(h3) {
		letter-spacing: -0.025em;
		font-weight: 700;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font-family: inherit;
		transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
	}

	:global(input),
	:global(select),
	:global(textarea) {
		font-size: 16px;
	}

	:global(button),
	:global(input),
	:global(select),
	:global(textarea) {
		font-family: inherit;
		transition:
			border-color 120ms ease,
			background-color 120ms ease,
			color 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}

	:global(button:focus-visible),
	:global(input:focus-visible),
	:global(select:focus-visible),
	:global(textarea:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	:global(*) {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--border-2) 88%, white 12%) transparent;
	}

	:global(*::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(*::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(*::-webkit-scrollbar-thumb) {
		background: color-mix(in oklab, var(--border-2) 84%, white 16%);
		border-radius: 999px;
		border: 2px solid transparent;
		background-clip: content-box;
	}

	:global(*::-webkit-scrollbar-thumb:hover) {
		background: color-mix(in oklab, var(--border-2) 68%, white 32%);
		background-clip: content-box;
	}

	.app-shell {
		--sidebar-offset: 240px;
		display: grid;
		grid-template-columns: 240px 1fr;
		height: 100vh;
		width: 100%;
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
		padding: 30px 34px;
		height: 100vh;
		overflow-y: auto;
		overflow-x: hidden;
		min-width: 0;
		scrollbar-width: thin;
		scrollbar-color: var(--border-2) transparent;
	}

	main::-webkit-scrollbar {
		width: 10px;
	}

	main::-webkit-scrollbar-thumb {
		background: linear-gradient(180deg, var(--border-2), var(--border-1));
		border-radius: 999px;
	}

	.app-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18px;
	}

	.brand {
		display: flex;
		gap: 10px;
		align-items: center;
		font-weight: 620;
		letter-spacing: 0.01em;
	}

	.brand img { width: 28px; height: 28px; }

	.nav-toggle,
	.refresh-btn {
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 10px;
		padding: 6px 10px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.refresh-btn:hover,
	.nav-toggle:hover {
		transform: translateY(-1px);
	}

	.sync {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.badge {
		padding: 6px 10px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--surface-1) 92%, white 3%);
		border: 1px solid var(--border-1);
		color: var(--app-muted);
		font-size: 12px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
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
		box-shadow: var(--ring-shadow);
	}

	.refresh-btn:hover {
		transform: translateY(-1px);
		color: var(--app-text);
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(3px);
		border: none;
		z-index: 9;
	}

	@media (max-width: 900px) {
		:global(body) { background: var(--app-bg-mobile); }
		.app-shell { --sidebar-offset: 0px; grid-template-columns: 1fr; }
		.sidebar-drawer {
			position: fixed;
			inset: 0 auto 0 0;
			width: min(264px, 80vw);
			transform: translateX(-110%);
			transition: transform 170ms ease-out;
			box-shadow: 12px 0 30px rgba(0, 0, 0, 0.5);
			z-index: 12;
			pointer-events: none;
		}
		.sidebar-drawer.open { transform: translateX(0); pointer-events: auto; }
		.app-shell.nav-split { --sidebar-offset: min(208px, 58vw); grid-template-columns: min(208px, 58vw) 1fr; }
		.app-shell.nav-split .sidebar-drawer { position: sticky; inset: auto; width: 100%; transform: none; transition: none; box-shadow: none; pointer-events: auto; }
		.app-shell.nav-split main { padding: 16px 12px 24px; }
		main { padding: 18px 16px 28px; }
		.app-header { margin-bottom: 12px; }
		.nav-toggle { display: inline-flex; align-items: center; justify-content: center; }
		.badge { font-size: 11px; padding: 6px 8px; }
	}
</style>
