<script lang="ts">
// @ts-nocheck
import { page } from '$app/stores';
import { createEventDispatcher } from 'svelte';
import { lists } from '$lib/stores/lists';
import { listCounts, myDayPending } from '$lib/stores/tasks';
import { soundSettings, soundThemes } from '$lib/stores/settings';
import { auth } from '$lib/stores/auth';
import { members } from '$lib/stores/members';
import { api } from '$lib/api/client';
import { playCompletion, playCustomDataUrl } from '$lib/sound/sound';

export let navPinned = false;

const dispatch = createEventDispatcher();

let showManager = false;
let newListName = '';
let newListIcon = '';
let renameDraft = {};
let iconDraft = {};
let listError = '';
let busy = false;
let listSortMode = 'manual';
let listSortLoaded = false;
const LIST_SORT_KEY = 'tasksync:sort:sidebar-lists';

let authBusy = false;
let loginEmail = 'admin@example.com';
let loginPassword = '';
let loginSpaceId = 's1';
let showProfileEditor = false;
let profileBusy = false;
let profileDisplay = '';
let profileIcon = '';
let profileMessage = '';
let profileError = '';
let profileSeedUserId = '';
let showPasswordEditor = false;
let passwordBusy = false;
let currentPasswordDraft = '';
let newPasswordDraft = '';
let confirmPasswordDraft = '';
let passwordMessage = '';
let passwordError = '';

let showTeam = false;
let teamBusy = false;
let teamError = '';
let teamMessage = '';
let grantsLoading = false;
let grants = [];
let loadedAdminScope = '';
let newMemberEmail = '';
let newMemberDisplay = '';
let newMemberRole = 'contributor';
let newMemberPassword = '';
let newMemberIcon = '';
let adminMode = false;
let soundBusy = false;
let soundError = '';
let soundMessage = '';

const iconFromIdentity = (display, email) => {
	const source = (display ?? email ?? '').trim();
	if (!source) return '?';
	return source.charAt(0).toUpperCase();
};

const avatarFor = (user) => {
	const icon = user?.avatar_icon?.trim();
	if (icon) return icon.slice(0, 4);
	return iconFromIdentity(user?.display, user?.email);
};

const roleLabel = (role) => (role === 'admin' ? 'Admin' : 'Contributor');

const passwordIsValid = (value) => value.trim().length >= 8;

const readAsDataUrl = (file) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(new Error('Could not read sound file.'));
		reader.readAsDataURL(file);
	});

const uploadCustomSound = async (event) => {
	const input = event.currentTarget;
	const file = input?.files?.[0];
	if (!file) return;
	if (!/\.(mp3|wav)$/i.test(file.name)) {
		soundError = 'Upload an MP3 or WAV file.';
		soundMessage = '';
		input.value = '';
		return;
	}
	if (file.size > 2 * 1024 * 1024) {
		soundError = 'Sound file is too large (max 2MB).';
		soundMessage = '';
		input.value = '';
		return;
	}
	soundBusy = true;
	soundError = '';
	soundMessage = '';
	try {
		const dataUrl = await readAsDataUrl(file);
		soundSettings.addCustomSound(file.name, dataUrl);
		soundMessage = `Saved ${file.name}.`;
	} catch (err) {
		soundError = err instanceof Error ? err.message : String(err);
	} finally {
		soundBusy = false;
		input.value = '';
	}
};

const testCurrentSound = async () => {
	await playCompletion(soundSettings.get());
};

const testCustomSound = async (dataUrl) => {
	await playCustomDataUrl(dataUrl, soundSettings.get().volume);
};

const useCustomSound = (id) => {
	soundSettings.selectCustomSound(id);
	soundMessage = 'Custom sound selected.';
	soundError = '';
};

const deleteCustomSound = (id) => {
	soundSettings.deleteCustomSound(id);
	soundMessage = 'Custom sound removed.';
	soundError = '';
};

const resetDefaultSounds = () => {
	soundSettings.resetDefaultSounds();
	soundMessage = 'Sound library reset to defaults.';
	soundError = '';
};

const resetDrafts = () => {
	renameDraft = {};
	iconDraft = {};
	newListName = '';
	newListIcon = '';
	listError = '';
};

const sortByOrder = (items) =>
	[...items].sort((a, b) => (a.order ?? '').localeCompare(b.order ?? ''));

const manualOrderValue = (index) => `m-${String(index).padStart(4, '0')}`;

$: adminMode = $auth.status === 'authenticated' && $auth.user?.role === 'admin';

const togglePin = () => {
	dispatch('togglePin', { pinned: !navPinned });
};

const createList = async () => {
	if (!adminMode) return;
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
	if (!adminMode) return;
	const name = (renameDraft[id] ?? '').trim();
	const iconInput = iconDraft[id];
	const icon =
		typeof iconInput === 'string'
			? iconInput.trim()
			: undefined;
	if (!name && typeof iconInput !== 'string') return;
	busy = true;
	listError = '';
	try {
		await lists.updateRemote(id, {
			name: name || undefined,
			icon: typeof iconInput === 'string' ? icon || '' : undefined
		});
		renameDraft = { ...renameDraft, [id]: '' };
		iconDraft = { ...iconDraft, [id]: '' };
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const moveList = async (id, direction) => {
	if (!adminMode || busy) return;
	const ordered = sortByOrder(($lists ?? []).filter((list) => list.id !== 'my-day'));
	const currentIndex = ordered.findIndex((list) => list.id === id);
	if (currentIndex < 0) return;
	const nextIndex = currentIndex + direction;
	if (nextIndex < 0 || nextIndex >= ordered.length) return;

	const reordered = [...ordered];
	const [moving] = reordered.splice(currentIndex, 1);
	reordered.splice(nextIndex, 0, moving);

	const updates = [];
	reordered.forEach((list, index) => {
		const nextOrder = manualOrderValue(index);
		if ((list.order ?? '') !== nextOrder) {
			updates.push(lists.updateRemote(list.id, { order: nextOrder }));
		}
	});
	if (!updates.length) return;

	busy = true;
	listError = '';
	try {
		await Promise.all(updates);
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const deleteList = async (id) => {
	if (!adminMode) return;
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
	showProfileEditor = false;
	showPasswordEditor = false;
	profileMessage = '';
	profileError = '';
	passwordMessage = '';
	passwordError = '';
	currentPasswordDraft = '';
	newPasswordDraft = '';
	confirmPasswordDraft = '';
};

const saveProfile = async () => {
	if ($auth.status !== 'authenticated') return;
	const display = profileDisplay.trim();
	if (!display) {
		profileError = 'Display name is required.';
		return;
	}
	profileBusy = true;
	profileError = '';
	profileMessage = '';
	try {
		await auth.updateProfile({
			display,
			avatar_icon: profileIcon
		});
		await members.hydrateFromServer();
		profileMessage = 'Profile updated.';
	} catch (err) {
		profileError = err instanceof Error ? err.message : String(err);
	} finally {
		profileBusy = false;
	}
};

const savePassword = async () => {
	if ($auth.status !== 'authenticated') return;
	const currentPassword = currentPasswordDraft.trim();
	const newPassword = newPasswordDraft.trim();
	const confirmPassword = confirmPasswordDraft.trim();
	if (!currentPassword) {
		passwordError = 'Current password is required.';
		return;
	}
	if (!passwordIsValid(newPassword)) {
		passwordError = 'New password must be at least 8 characters.';
		return;
	}
	if (newPassword !== confirmPassword) {
		passwordError = 'New passwords do not match.';
		return;
	}
	passwordBusy = true;
	passwordError = '';
	passwordMessage = '';
	try {
		await api.changePassword({
			current_password: currentPassword,
			new_password: newPassword
		});
		currentPasswordDraft = '';
		newPasswordDraft = '';
		confirmPasswordDraft = '';
		passwordMessage = 'Password updated.';
	} catch (err) {
		passwordError = err instanceof Error ? err.message : String(err);
	} finally {
		passwordBusy = false;
	}
};

const loadGrants = async () => {
	if (!adminMode) return;
	grantsLoading = true;
	teamError = '';
	teamMessage = '';
	try {
		grants = await api.getListGrants();
	} catch (err) {
		teamError = err instanceof Error ? err.message : String(err);
	} finally {
		grantsLoading = false;
	}
};

const createMember = async () => {
	if (!adminMode) return;
	const email = newMemberEmail.trim().toLowerCase();
	const display = newMemberDisplay.trim();
	const password = newMemberPassword.trim();
	if (!email || !display || !passwordIsValid(password)) {
		teamError = 'Member password must be at least 8 characters.';
		return;
	}
	teamBusy = true;
	teamError = '';
	teamMessage = '';
	try {
		await api.createMember({
			email,
			display,
			role: newMemberRole,
			password,
			avatar_icon: newMemberIcon
		});
		newMemberEmail = '';
		newMemberDisplay = '';
		newMemberRole = 'contributor';
		newMemberPassword = '';
		newMemberIcon = '';
		await Promise.all([members.hydrateFromServer(), loadGrants()]);
		teamMessage = `Added ${display}.`;
	} catch (err) {
		teamError = err instanceof Error ? err.message : String(err);
	} finally {
		teamBusy = false;
	}
};

const hasGrant = (userId, listId) =>
	grants.some((grant) => grant.user_id === userId && grant.list_id === listId);

const setGrant = async (userId, listId, granted) => {
	if (!adminMode) return;
	teamBusy = true;
	teamError = '';
	teamMessage = '';
	try {
		await api.setListGrant({ user_id: userId, list_id: listId, granted });
		if (granted) {
			if (!hasGrant(userId, listId)) {
				grants = [...grants, { user_id: userId, list_id: listId }];
			}
		} else {
			grants = grants.filter((grant) => !(grant.user_id === userId && grant.list_id === listId));
		}
	} catch (err) {
		teamError = err instanceof Error ? err.message : String(err);
	} finally {
		teamBusy = false;
	}
};

const resetMemberPassword = async (member) => {
	if (!adminMode) return;
	const draft = prompt(`New password for ${member.display}`, '');
	if (draft === null) return;
	const password = draft.trim();
	if (!passwordIsValid(password)) {
		teamError = 'Member password must be at least 8 characters.';
		teamMessage = '';
		return;
	}
	teamBusy = true;
	teamError = '';
	teamMessage = '';
	try {
		await api.setMemberPassword(member.user_id, { password });
		teamMessage = `Password reset for ${member.display}.`;
	} catch (err) {
		teamError = err instanceof Error ? err.message : String(err);
	} finally {
		teamBusy = false;
	}
};

$: if ($auth.user?.user_id && profileSeedUserId !== $auth.user.user_id) {
	profileSeedUserId = $auth.user.user_id;
	profileDisplay = $auth.user.display ?? '';
	profileIcon = $auth.user.avatar_icon ?? '';
	profileMessage = '';
	profileError = '';
	passwordMessage = '';
	passwordError = '';
	currentPasswordDraft = '';
	newPasswordDraft = '';
	confirmPasswordDraft = '';
	showProfileEditor = false;
	showPasswordEditor = false;
}

$: adminScope = adminMode && $auth.user ? `${$auth.user.space_id}:${$auth.user.user_id}` : '';
$: if (adminScope && adminScope !== loadedAdminScope) {
	loadedAdminScope = adminScope;
	void Promise.all([members.hydrateFromServer(), loadGrants()]);
}
$: if (!adminScope && loadedAdminScope) {
	loadedAdminScope = '';
	grants = [];
	showTeam = false;
	teamMessage = '';
}

$: contributorMembers = ($members ?? []).filter((member) => member.role === 'contributor');
$: managedLists = ($lists ?? []).filter((list) => list.id !== 'my-day');
$: managedListsManual = sortByOrder($lists ?? []).filter((list) => list.id !== 'my-day');
$: if (typeof localStorage !== 'undefined' && !listSortLoaded) {
	const saved = localStorage.getItem(LIST_SORT_KEY);
	if (saved === 'manual' || saved === 'alpha') {
		listSortMode = saved;
	}
	listSortLoaded = true;
}
$: if (typeof localStorage !== 'undefined' && listSortLoaded) {
	localStorage.setItem(LIST_SORT_KEY, listSortMode);
}
$: sidebarLists = [...($lists ?? [])].sort((a, b) => {
	if (a.id === 'my-day') return -1;
	if (b.id === 'my-day') return 1;
	if (listSortMode === 'alpha') {
		return (a.name ?? '').localeCompare(b.name ?? '', undefined, {
			sensitivity: 'base',
			numeric: true
		});
	}
	return (a.order ?? '').localeCompare(b.order ?? '');
});
</script>

<nav class="sidebar">
	<div class="sidebar-main">
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
		<label class="list-sort">
			Sort lists
			<select bind:value={listSortMode} aria-label="Sort lists">
				<option value="manual">Manual</option>
				<option value="alpha">Alphabetical</option>
			</select>
		</label>
		{#if sidebarLists}
			{#each sidebarLists as list}
				{#if list.id === 'my-day'}
					<a class:selected={$page.url.pathname === '/'} href="/">
						<span class="icon">🌅</span>
						<span>{list.name}</span>
						<span class="count">{$myDayPending?.length ?? 0}</span>
					</a>
				{:else}
					<a class:selected={$page.url.pathname === `/list/${list.id}`} href={`/list/${list.id}`}>
						<span class="icon">{list.icon ?? '•'}</span>
						<span>{list.name}</span>
						<span class="count">{$listCounts?.[list.id]?.pending ?? 0}</span>
					</a>
				{/if}
			{/each}
		{/if}

		{#if adminMode}
			<div class="section-label muted">Collections</div>
			<button class="section-toggle" type="button" on:click={() => (showManager = !showManager)}>
				{showManager ? 'Close list manager' : '+ New list'}
			</button>
			{#if showManager}
				<div class="card manager">
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
							maxlength="4"
							bind:value={newListIcon}
							on:keydown={(e) => e.key === 'Enter' && createList()}
						/>
					</label>
					<button
						type="button"
						class="primary"
						on:click={createList}
						disabled={busy || !newListName.trim()}
					>
						Create list
					</button>
					{#if listError}
						<p class="error">{listError}</p>
					{/if}
					<p class="muted-note">Manual order: use ↑ and ↓, then keep list sort set to Manual.</p>
					<div class="existing">
						{#each managedListsManual as list, index}
							<div class="row">
								<input
									class="name-input"
									type="text"
									placeholder={list.name}
									bind:value={renameDraft[list.id]}
									on:keydown={(e) => e.key === 'Enter' && renameList(list.id)}
								/>
								<input
									class="icon-input"
									type="text"
									placeholder={list.icon ?? 'emoji'}
									maxlength="4"
									bind:value={iconDraft[list.id]}
									on:keydown={(e) => e.key === 'Enter' && renameList(list.id)}
								/>
								<div class="row-actions">
									<button
										type="button"
										class="ghost tiny"
										aria-label={`Move ${list.name} up`}
										title="Move up"
										on:click={() => moveList(list.id, -1)}
										disabled={busy || index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="ghost tiny"
										aria-label={`Move ${list.name} down`}
										title="Move down"
										on:click={() => moveList(list.id, 1)}
										disabled={busy || index === managedListsManual.length - 1}
									>
										↓
									</button>
									<button type="button" on:click={() => renameList(list.id)} disabled={busy}>
										Save
									</button>
									<button type="button" class="ghost" on:click={() => deleteList(list.id)} disabled={busy}>
										Delete
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="section-label muted">Team</div>
			<button class="section-toggle" type="button" on:click={() => (showTeam = !showTeam)}>
				{showTeam ? 'Close team manager' : 'Manage contributors'}
			</button>
			{#if showTeam}
				<div class="card team">
					<div class="create-member">
						<p class="team-helper">Create a member, then toggle list access below.</p>
						<div class="field-row">
							<label>
								Display
								<input type="text" placeholder="Name" bind:value={newMemberDisplay} />
							</label>
							<label>
								Email
								<input type="email" placeholder="person@example.com" bind:value={newMemberEmail} />
							</label>
						</div>
						<div class="field-row">
							<label>
								Role
								<select bind:value={newMemberRole}>
									<option value="contributor">Contributor</option>
									<option value="admin">Admin</option>
								</select>
							</label>
							<label>
								Password
								<input
									type="password"
									placeholder="min 8 chars"
									autocomplete="new-password"
									bind:value={newMemberPassword}
								/>
							</label>
							<label>
								Icon
								<input type="text" placeholder="AA" maxlength="4" bind:value={newMemberIcon} />
							</label>
						</div>
						<button
							type="button"
							class="primary"
							on:click={createMember}
							disabled={
								teamBusy ||
								!newMemberDisplay.trim() ||
								!newMemberEmail.trim() ||
								newMemberPassword.trim().length < 8
							}
						>
							Add member
						</button>
					</div>

					{#if grantsLoading}
						<p class="muted-note">Loading access matrix...</p>
					{:else}
						<div class="member-list">
							{#if contributorMembers.length}
								{#each contributorMembers as member}
									<div class="member-row">
										<div class="member-head">
											<span class="avatar small">{avatarFor(member)}</span>
											<div>
												<strong>{member.display}</strong>
												<span>{member.email}</span>
											</div>
											<span class="role-chip">{roleLabel(member.role)}</span>
										</div>
										<div class="member-tools">
											<button
												type="button"
												class="ghost tiny"
												disabled={teamBusy}
												on:click={() => resetMemberPassword(member)}
											>
												Reset password
											</button>
										</div>
										<div class="grant-grid">
											{#each managedLists as list}
												<label class={`grant-row ${hasGrant(member.user_id, list.id) ? 'on' : ''}`}>
													<span class="grant-name">{list.icon ?? '•'} {list.name}</span>
													<span class="grant-controls">
														<span class="grant-state">{hasGrant(member.user_id, list.id) ? 'On' : 'Off'}</span>
														<input
															type="checkbox"
															checked={hasGrant(member.user_id, list.id)}
															disabled={teamBusy}
															on:change={(e) =>
																setGrant(member.user_id, list.id, e.currentTarget.checked)}
														/>
													</span>
												</label>
											{/each}
										</div>
									</div>
								{/each}
							{:else}
								<p class="muted-note">No contributors yet. Add one above.</p>
							{/if}
						</div>
					{/if}
					{#if teamMessage}
						<p class="ok">{teamMessage}</p>
					{/if}
					{#if teamError}
						<p class="error">{teamError}</p>
					{/if}
				</div>
			{/if}
		{/if}
	</div>

	<div class="sidebar-bottom">
		<div class="section-label muted">Sound</div>
		<div class="card sound">
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
				Add custom sound
				<input
					type="file"
					accept=".mp3,.wav,audio/mpeg,audio/wav"
					on:change={uploadCustomSound}
					disabled={soundBusy}
				/>
			</label>
			<div class="sound-actions">
				<button type="button" class="ghost tiny" on:click={testCurrentSound}>Test current</button>
				<button type="button" class="ghost tiny" on:click={resetDefaultSounds}>Reset defaults</button>
			</div>
			{#if $soundSettings.customSounds?.length}
				<div class="sound-library">
					<p class="muted-note">Saved sounds</p>
					{#each $soundSettings.customSounds as custom}
						<div class="sound-item">
							<span class="sound-name">{custom.name}</span>
							<div class="sound-item-actions">
								<button type="button" class="ghost tiny" on:click={() => useCustomSound(custom.id)}>
									Use
								</button>
								<button type="button" class="ghost tiny" on:click={() => testCustomSound(custom.data_url)}>
									Test
								</button>
								<button type="button" class="ghost tiny danger" on:click={() => deleteCustomSound(custom.id)}>
									Delete
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{#if soundMessage}
				<p class="ok">{soundMessage}</p>
			{/if}
			{#if soundError}
				<p class="error">{soundError}</p>
			{/if}
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

		<div class="section-label muted">Account</div>
		<div class="card account" data-testid="auth-panel">
			{#if $auth.status === 'loading'}
				<p class="muted-note">Checking session...</p>
			{:else if $auth.status === 'authenticated' && $auth.user}
				<div class="user-head" data-testid="auth-user">
					<span class="avatar">{avatarFor($auth.user)}</span>
					<div class="who">
						<strong>{$auth.user.display}</strong>
						<span>{$auth.user.email}</span>
						<span class="meta">{roleLabel($auth.user.role)} · {$auth.user.space_id}</span>
					</div>
				</div>

				<div class="account-actions">
					<button type="button" class="ghost" on:click={() => (showProfileEditor = !showProfileEditor)}>
						{showProfileEditor ? 'Close profile edit' : 'Edit profile'}
					</button>
					<button
						type="button"
						class="ghost"
						on:click={() => {
							showPasswordEditor = !showPasswordEditor;
							passwordError = '';
							passwordMessage = '';
						}}
					>
						{showPasswordEditor ? 'Close password edit' : 'Change password'}
					</button>
					<button type="button" class="ghost danger" data-testid="auth-signout" on:click={signOut}>
						Sign out
					</button>
				</div>

				{#if showProfileEditor}
					<div class="profile-editor">
						<label>
							Display
							<input type="text" bind:value={profileDisplay} />
						</label>
						<label>
							Icon
							<input type="text" placeholder="emoji or initials" maxlength="4" bind:value={profileIcon} />
						</label>
						<button
							type="button"
							class="primary"
							on:click={saveProfile}
							disabled={profileBusy || !profileDisplay.trim()}
						>
							{profileBusy ? 'Saving...' : 'Save profile'}
						</button>
						{#if profileMessage}
							<p class="ok">{profileMessage}</p>
						{/if}
						{#if profileError}
							<p class="error">{profileError}</p>
						{/if}
					</div>
				{/if}

				{#if showPasswordEditor}
					<div class="profile-editor">
						<label>
							Current password
							<input type="password" autocomplete="current-password" bind:value={currentPasswordDraft} />
						</label>
						<label>
							New password
							<input
								type="password"
								placeholder="min 8 chars"
								autocomplete="new-password"
								bind:value={newPasswordDraft}
							/>
						</label>
						<label>
							Confirm new password
							<input
								type="password"
								placeholder="repeat new password"
								autocomplete="new-password"
								bind:value={confirmPasswordDraft}
							/>
						</label>
						<button
							type="button"
							class="primary"
							on:click={savePassword}
							disabled={passwordBusy || !currentPasswordDraft.trim() || !newPasswordDraft.trim()}
						>
							{passwordBusy ? 'Updating...' : 'Update password'}
						</button>
						{#if passwordMessage}
							<p class="ok">{passwordMessage}</p>
						{/if}
						{#if passwordError}
							<p class="error">{passwordError}</p>
						{/if}
					</div>
				{/if}
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
	</div>
</nav>

<style>
	.sidebar {
		width: 100%;
		max-width: 264px;
		background:
			radial-gradient(circle at 10% 10%, rgba(29, 78, 216, 0.16), transparent 48%),
			linear-gradient(180deg, #0a0f1c 0%, #090d18 100%);
		border-right: 1px solid #13203a;
		color: #cbd5e1;
		padding: 14px 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		height: 100vh;
		position: sticky;
		top: 0;
		overflow-y: auto;
		box-sizing: border-box;
	}

	.sidebar-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sidebar-bottom {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 10px;
		border-top: 1px solid rgba(71, 85, 105, 0.35);
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}

	.app-title {
		font-weight: 800;
		letter-spacing: -0.03em;
		color: #e2e8f0;
		font-size: 24px;
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
		color: #6b7a95;
		margin: 6px 6px 2px;
		letter-spacing: 0.08em;
	}

	.section-label.muted {
		color: #55617a;
	}

	a {
		display: grid;
		grid-template-columns: 26px 1fr auto;
		align-items: center;
		gap: 8px;
		color: #cbd5e1;
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 10px;
		transition: background 120ms ease, color 120ms ease;
	}

	a:hover {
		background: #111c31;
	}

	a.selected {
		background: linear-gradient(90deg, rgba(37, 99, 235, 0.3), rgba(15, 23, 42, 0.8));
		color: #f1f5f9;
	}

	.list-sort {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 6px 6px;
		font-size: 11px;
		color: #93a4bf;
	}

	.list-sort select {
		background: #0f172a;
		border: 1px solid #243148;
		color: #d4e2f3;
		border-radius: 999px;
		padding: 3px 8px;
		font-size: 11px;
	}

	.icon {
		font-size: 15px;
	}

	.count {
		font-size: 12px;
		color: #94a3b8;
	}

	.section-toggle {
		color: #e2e8f0;
		background: #111a2d;
		border: 1px solid #23314f;
		border-radius: 10px;
		padding: 8px 10px;
		text-align: left;
		cursor: pointer;
	}

	.card {
		border: 1px solid #21314f;
		border-radius: 12px;
		padding: 10px;
		background: linear-gradient(180deg, #0c1426, #0b1221);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.card input,
	.card select {
		width: 100%;
		max-width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}

	.manager label,
	.account label,
	.team label,
	.sound label,
	.profile-editor label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #d0deef;
	}

	input,
	select {
		background: #0f172a;
		border: 1px solid #243148;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 7px 9px;
	}

	button.primary {
		background: linear-gradient(180deg, #2563eb, #1d4ed8);
		border: none;
		color: #fff;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
		font-weight: 600;
	}

	button.ghost {
		background: #0b1221;
		border: 1px solid #27344f;
		color: #cbd5e1;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	button.ghost.danger {
		border-color: #7f1d1d;
		color: #fecaca;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.manager .row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(74px, 86px);
		gap: 6px;
		align-items: start;
	}

	.manager .row .name-input {
		grid-column: 1 / -1;
	}

	.manager .row .icon-input {
		width: 100%;
	}

	.manager .row .row-actions {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 6px;
	}

	.manager .row .row-actions button {
		min-width: 0;
		padding: 7px 8px;
	}

	.manager .row .row-actions .tiny {
		width: 28px;
		padding: 6px 0;
	}

	.manager .existing {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}

	.team .create-member {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		border: 1px solid #25344f;
		border-radius: 10px;
		background: rgba(11, 19, 36, 0.7);
		overflow: hidden;
	}

	.team .create-member .field-row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 7px;
		min-width: 0;
	}

	.team .create-member label {
		min-width: 0;
	}

	.team-helper {
		margin: 0;
		font-size: 11px;
		color: #8fa1bc;
		line-height: 1.3;
	}

	.member-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.member-row {
		border: 1px solid #25344f;
		background: rgba(9, 15, 28, 0.75);
		border-radius: 10px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.member-head {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.member-head strong {
		color: #e2e8f0;
		font-size: 13px;
	}

	.member-head span {
		color: #94a3b8;
		font-size: 11px;
	}

	.member-head .role-chip {
		color: #bfdbfe;
		font-size: 10px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		border: 1px solid #32507e;
		background: rgba(37, 99, 235, 0.22);
		padding: 4px 6px;
		border-radius: 999px;
	}

	.member-tools {
		display: flex;
		justify-content: flex-end;
	}

	.grant-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 6px;
	}

	.grant-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 10px;
		border: 1px solid #25344f;
		border-radius: 10px;
		padding: 7px 10px;
		font-size: 12px;
		color: #bfd0e7;
		background: #0b1324;
	}

	.grant-row.on {
		border-color: #2563eb;
		background: rgba(37, 99, 235, 0.18);
		color: #dbeafe;
	}

	.grant-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.grant-controls {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.grant-state {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
		min-width: 24px;
		text-align: right;
	}

	.grant-row.on .grant-state {
		color: #dbeafe;
	}

	.grant-row input {
		margin: 0;
		accent-color: #3b82f6;
	}

	.account .user-head {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 10px;
		align-items: center;
	}

	.avatar {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: linear-gradient(180deg, #1d4ed8, #1e3a8a);
		color: white;
		font-size: 16px;
		font-weight: 700;
		border: 1px solid rgba(191, 219, 254, 0.45);
	}

	.avatar.small {
		width: 28px;
		height: 28px;
		font-size: 13px;
	}

	.account .who {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.account .who strong {
		color: #eef2ff;
		line-height: 1.2;
	}

	.account .who span {
		color: #9fb0c8;
		font-size: 12px;
		line-height: 1.2;
	}

	.account .meta {
		color: #7c94b3;
		font-size: 11px;
	}

	.account-actions {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}

	button.ghost.tiny {
		padding: 6px 8px;
		font-size: 12px;
	}

	.profile-editor {
		border-top: 1px solid #23314b;
		padding-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.sound .toggle {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	.sound .sound-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.sound .sound-library {
		display: grid;
		gap: 6px;
	}

	.sound .sound-item {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
		background: #0b1221;
		border: 1px solid #1f2937;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.sound .sound-name {
		color: #cbd5e1;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sound .sound-item-actions {
		display: inline-flex;
		gap: 4px;
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

	.muted-note {
		margin: 0;
		color: #94a3b8;
		font-size: 12px;
	}

	.error {
		color: #fda4af;
		font-size: 12px;
		margin: 0;
	}

	.ok {
		color: #86efac;
		font-size: 12px;
		margin: 0;
	}

	@media (max-width: 900px) {
		.sidebar {
			max-width: none;
			padding: 12px 10px;
		}

		.app-title {
			font-size: 30px;
		}

		a {
			padding: 7px 8px;
			gap: 6px;
			font-size: 13px;
		}

		.team .create-member {
			padding: 7px;
		}
	}
</style>
