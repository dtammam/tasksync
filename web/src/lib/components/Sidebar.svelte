<script lang="ts">
// @ts-nocheck
import { page } from '$app/stores';
import { createEventDispatcher } from 'svelte';
import { lists } from '$lib/stores/lists';
import { listCounts, myDayPending } from '$lib/stores/tasks';
import { soundSettings, soundThemes } from '$lib/stores/settings';
import { auth } from '$lib/stores/auth';

export let navPinned = false;

const dispatch = createEventDispatcher();

let showManager = false;
let newListName = '';
let newListIcon = '';
let renameDraft = {};
let listError = '';
let busy = false;
let authBusy = false;
let loginEmail = 'admin@example.com';
let loginPassword = '';
let loginSpaceId = 's1';

const togglePin = () => {
	dispatch('togglePin', { pinned: !navPinned });
};

const resetDrafts = () => {
	renameDraft = {};
	newListName = '';
	newListIcon = '';
	listError = '';
};

const createList = async () => {
	const name = newListName.trim();
	if (!name) return;
	busy = true;
	listError = '';
	try {
		await lists.createRemote(name, newListIcon || undefined);
		resetDrafts();
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const renameList = async (id) => {
	const name = (renameDraft[id] ?? '').trim();
	if (!name) return;
	busy = true;
	listError = '';
	try {
		await lists.updateRemote(id, { name });
		renameDraft = { ...renameDraft, [id]: '' };
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const deleteList = async (id) => {
	if (!confirm('Delete this list? Tasks within cannot be deleted yet.')) return;
	busy = true;
	listError = '';
	try {
		await lists.deleteRemote(id);
	} catch (err) {
		listError =
			err instanceof Error && err.message.includes('409')
				? 'Cannot delete: list still has tasks.'
				: err instanceof Error
					? err.message
					: String(err);
	} finally {
		busy = false;
	}
};

const signIn = async () => {
	const email = loginEmail.trim();
	const password = loginPassword.trim();
	const spaceId = loginSpaceId.trim();
	if (!email || !password) return;
	authBusy = true;
	try {
		await auth.login(email, password, spaceId || undefined);
		loginPassword = '';
	} catch {
		// Error messaging comes from the auth store.
	} finally {
		authBusy = false;
	}
};

const signOut = () => {
	auth.logout();
	loginPassword = '';
};
</script>

<nav class="sidebar">
	<div class="title-row">
		<div class="app-title">tasksync</div>
		<button
			class={`pin ${navPinned ? 'active' : ''}`}
			type="button"
			data-testid="nav-pin"
			aria-pressed={navPinned}
			on:click={togglePin}
			title={navPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
		>
			{navPinned ? 'Unpin' : 'Pin'}
		</button>
	</div>
	<div class="section-label">Today</div>
	{#if $lists}
		{#each [...$lists].sort((a, b) => (a.id === 'my-day' ? -1 : b.id === 'my-day' ? 1 : (a.order ?? '').localeCompare(b.order ?? ''))) as list}
			{#if list.id === 'my-day'}
				<a class:selected={$page.url.pathname === '/'} href="/">
					<span class="icon">🌅</span>
					<span>{list.name}</span>
					<span class="count">{$myDayPending?.length ?? 0}</span>
				</a>
			{:else}
				<a
					class:selected={$page.url.pathname === `/list/${list.id}`}
					href={`/list/${list.id}`}
				>
					<span class="icon">{list.icon ?? '•'}</span>
					<span>{list.name}</span>
					<span class="count">{$listCounts?.[list.id]?.pending ?? 0}</span>
				</a>
			{/if}
		{/each}
	{/if}
	<div class="section-label muted">Collections</div>
	<button class="add" type="button" on:click={() => (showManager = !showManager)}>
		{showManager ? 'Close list manager' : '+ New list'}
	</button>
	{#if showManager}
		<div class="manager">
			<label>
				Name
				<input
					type="text"
					placeholder="List name"
					bind:value={newListName}
					on:keydown={(e) => e.key === 'Enter' && createList()}
				/>
			</label>
			<label>
				Icon (optional)
				<input
					type="text"
					placeholder="emoji"
					maxlength="3"
					bind:value={newListIcon}
					on:keydown={(e) => e.key === 'Enter' && createList()}
				/>
			</label>
			<button type="button" class="primary" on:click={createList} disabled={busy || !newListName.trim()}>
				Create list
			</button>
			{#if listError}
				<p class="error">{listError}</p>
			{/if}
			<div class="existing">
				{#each $lists.filter((l) => l.id !== 'my-day') as list}
					<div class="row">
						<input
							type="text"
							placeholder={list.name}
							bind:value={renameDraft[list.id]}
							on:keydown={(e) => e.key === 'Enter' && renameList(list.id)}
						/>
						<button type="button" on:click={() => renameList(list.id)} disabled={busy}>
							Rename
						</button>
						<button type="button" class="ghost" on:click={() => deleteList(list.id)} disabled={busy}>
							Delete
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
	<div class="section-label muted">Account</div>
	<div class="account" data-testid="auth-panel">
		{#if $auth.status === 'loading'}
			<p class="muted-note">Checking session...</p>
		{:else if $auth.status === 'authenticated' && $auth.user}
			<div class="who" data-testid="auth-user">
				<strong>{$auth.user.display}</strong>
				<span>{$auth.user.email}</span>
				<span class="meta">
					{$auth.user.role} in {$auth.user.space_id}
					{$auth.source === 'token' ? '(token)' : '(legacy)'}
				</span>
			</div>
			<button type="button" class="ghost" data-testid="auth-signout" on:click={signOut}>
				Sign out
			</button>
		{:else}
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
				disabled={authBusy || !loginEmail.trim() || !loginPassword.trim()}
				on:click={signIn}
			>
				{authBusy ? 'Signing in...' : 'Sign in'}
			</button>
			{#if $auth.error}
				<p class="error">{$auth.error}</p>
			{/if}
		{/if}
	</div>
	<div class="section-label muted">Sound</div>
	<div class="sound">
		<label class="toggle" for="sound-enabled">
			<input
				id="sound-enabled"
				data-testid="sound-enabled"
				type="checkbox"
				checked={$soundSettings.enabled}
				on:change={(e) => soundSettings.setEnabled(e.target.checked)}
			/>
			Completion sound
		</label>
		<label>
			Theme
			<select
				data-testid="sound-theme"
				value={$soundSettings.theme}
				on:change={(e) => soundSettings.setTheme(e.target.value)}
			>
				{#each soundThemes as theme}
					<option value={theme}>{theme.replace('_', ' ')}</option>
				{/each}
			</select>
		</label>
		<label>
			Volume
			<div class="volume">
				<input
					data-testid="sound-volume"
					type="range"
					min="0"
					max="100"
					step="1"
					value={$soundSettings.volume}
					on:input={(e) => soundSettings.setVolume(Number(e.target.value))}
				/>
				<span>{$soundSettings.volume}%</span>
			</div>
		</label>
	</div>
</nav>

<style>
	.sidebar {
		width: 100%;
		max-width: 240px;
		background: #0a0f1c;
		border-right: 1px solid #131a2d;
		color: #cbd5e1;
		padding: 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100vh;
		position: sticky;
		top: 0;
		overflow-y: auto;
		box-sizing: border-box;
	}

	.app-title {
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e2e8f0;
		margin-bottom: 8px;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.title-row .app-title {
		margin-bottom: 0;
	}

	.pin {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #cbd5e1;
		border-radius: 999px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}

	.pin.active {
		border-color: #16a34a;
		background: #0b3a2a;
		color: #d1fae5;
	}

	.section-label {
		text-transform: uppercase;
		font-size: 11px;
		color: #64748b;
		margin: 6px 6px 2px;
	}

	.section-label.muted {
		color: #475569;
	}

	a {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		align-items: center;
		gap: 8px;
		color: #cbd5e1;
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 10px;
		transition: background 120ms ease, color 120ms ease;
	}

	a:hover {
		background: #11192b;
	}

	a.selected {
		background: linear-gradient(90deg, #1f2a44, #182135);
		color: #e2e8f0;
	}

	.icon {
		font-size: 15px;
	}

	.count {
		font-size: 12px;
		color: #94a3b8;
	}

	.add {
		color: #e2e8f0;
		background: #11192b;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 8px 10px;
		text-align: left;
		cursor: pointer;
	}

	.manager {
		margin-top: 8px;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: #0c1322;
	}

	.manager label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #cbd5e1;
	}

	.manager input {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.manager .row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 6px;
		align-items: center;
	}

	.manager button.primary {
		background: #1d4ed8;
		border: none;
		color: #fff;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.manager button.ghost {
		background: #0b1221;
		border: 1px solid #1f2937;
		color: #cbd5e1;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.manager .existing {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 6px;
	}

	.account {
		margin-top: 6px;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 10px;
		background: #0c1322;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.account label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #cbd5e1;
	}

	.account input {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.account .who {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.account .who strong {
		color: #e2e8f0;
	}

	.account .meta {
		color: #94a3b8;
		font-size: 11px;
	}

	.account .muted-note {
		margin: 0;
		color: #94a3b8;
		font-size: 12px;
	}

	.account button.primary {
		background: #1d4ed8;
		border: none;
		color: #fff;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.account button.ghost {
		background: #0b1221;
		border: 1px solid #1f2937;
		color: #cbd5e1;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.sound {
		margin-top: 6px;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 10px;
		background: #0c1322;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sound label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #cbd5e1;
	}

	.sound .toggle {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	.sound select,
	.sound input[type='range'] {
		width: 100%;
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.sound input[type='checkbox'] {
		accent-color: #1d4ed8;
	}

	.sound .volume {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.sound .volume span {
		color: #94a3b8;
		font-size: 12px;
		min-width: 38px;
		text-align: right;
	}

	.error {
		color: #ef4444;
		font-size: 12px;
	}

	@media (max-width: 900px) {
		.sidebar {
			max-width: none;
			padding: 14px 10px;
		}

		a {
			padding: 7px 8px;
			gap: 6px;
			font-size: 13px;
		}

		.count {
			font-size: 11px;
		}
	}
</style>
