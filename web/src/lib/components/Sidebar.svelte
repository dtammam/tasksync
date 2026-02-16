<script lang="ts">
// @ts-nocheck
import { page } from '$app/stores';
import { createEventDispatcher } from 'svelte';
import { lists } from '$lib/stores/lists';
import { listCounts, myDayPending } from '$lib/stores/tasks';
import { soundSettings, soundThemes } from '$lib/stores/settings';
import { uiPreferences } from '$lib/stores/preferences';
import { auth } from '$lib/stores/auth';
import { members } from '$lib/stores/members';
import { api } from '$lib/api/client';
import { playCompletion } from '$lib/sound/sound';
import { BACKUP_SCHEMA_V1 } from '$shared/types/backup';

export let navPinned = false;

const dispatch = createEventDispatcher();

let newListName = '';
let newListIcon = '';
let newListColor = '#3b82f6';
let renameDraft = {};
let iconDraft = {};
let colorDraft = {};
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

let showSettingsModal = false;
let activeSettingsPanel = 'account';
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
let backupBusy = false;
let backupError = '';
let backupMessage = '';
const appThemes = [
	{ value: 'default', label: 'Default Blue' },
	{ value: 'light', label: 'Light' },
	{ value: 'dark', label: 'Dark' },
	{ value: 'demo-theme', label: 'Demo Theme' },
	{ value: 'shades-of-coffee', label: 'Shades of Coffee' },
	{ value: 'miami-beach', label: 'Miami Beach' },
	{ value: 'simple-dark', label: 'Simple Dark' },
	{ value: 'matrix', label: 'Matrix' },
	{ value: 'black-gold', label: 'Black Gold' },
	{ value: 'okabe-ito', label: 'Okabe Ito' },
	{ value: 'theme-from-1970', label: 'Theme from 1970' },
	{ value: 'shades-of-gray-light', label: 'Shades of Gray (light)' },
	{ value: 'catppuccin-latte', label: 'Catppuccin Latte' },
	{ value: 'catppuccin-frappe', label: 'Catppuccin Frappé' },
	{ value: 'catppuccin-macchiato', label: 'Catppuccin Macchiato' },
	{ value: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
	{ value: 'you-need-a-dark-mode', label: 'You Need A Dark Mode' },
	{ value: 'butterfly', label: 'Butterfly' }
];

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

const readAsText = (file) =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(new Error('Could not read backup file.'));
		reader.readAsText(file);
	});

const uploadCustomSound = async (event) => {
	const input = event.currentTarget;
	const files = Array.from(input?.files ?? []);
	if (!files.length) return;
	if (files.length > 8) {
		soundError = 'Please upload up to 8 sounds at a time.';
		soundMessage = '';
		input.value = '';
		return;
	}
	for (const file of files) {
		if (!/\.(mp3|wav)$/i.test(file.name)) {
			soundError = 'Please upload MP3 or WAV files only.';
			soundMessage = '';
			input.value = '';
			return;
		}
		if (file.size > 2 * 1024 * 1024) {
			soundError = 'Sound file is too large (max 2MB each).';
			soundMessage = '';
			input.value = '';
			return;
		}
	}
	soundBusy = true;
	soundError = '';
	soundMessage = '';
	try {
		const payload = await Promise.all(
			files.map(async (file) => ({
				dataUrl: await readAsDataUrl(file),
				fileName: file.name
			}))
		);
		soundSettings.setCustomSounds(payload);
		soundMessage =
			payload.length === 1
				? `Custom sound loaded: ${payload[0].fileName}`
				: `${payload.length} custom sounds loaded. Playback will randomize.`;
	} catch (err) {
		soundError = err instanceof Error ? err.message : String(err);
	} finally {
		soundBusy = false;
		input.value = '';
	}
};

const clearCustomSound = () => {
	soundSettings.clearCustomSound();
	soundError = '';
	soundMessage = 'Custom sound removed.';
};

const customSoundNames = (settings) => {
	const raw = settings?.customSoundFilesJson;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed
					.map((entry) => (entry && typeof entry === 'object' ? String(entry.name ?? '').trim() : ''))
					.filter((name) => !!name)
					.slice(0, 8);
			}
		} catch {
			// Fall back to legacy single-file naming below.
		}
	}
	return settings?.customSoundFileName ? [settings.customSoundFileName] : [];
};

const previewSound = async () => {
	await playCompletion(soundSettings.get());
};

const normalizeListIcon = (raw) => {
	const trimmed = String(raw ?? '').trim();
	if (!trimmed) return undefined;
	if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		const first = Array.from(segmenter.segment(trimmed), (entry) => entry.segment)
			.slice(0, 2)
			.join('');
		return first || undefined;
	}
	return Array.from(trimmed).slice(0, 4).join('') || undefined;
};

const openSettingsModal = (panel = 'account') => {
	showSettingsModal = true;
	activeSettingsPanel = panel;
};

const closeSettingsModal = () => {
	showSettingsModal = false;
};

const selectSettingsPanel = (panel) => {
	activeSettingsPanel = panel;
	uiPreferences.setPanel(panel, true);
};

const backupFileName = (spaceId, exportedAtTs) => {
	const date = new Date(exportedAtTs * 1000);
	const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
		date.getDate()
	).padStart(2, '0')}-${String(date.getHours()).padStart(2, '0')}${String(
		date.getMinutes()
	).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
	return `tasksync-backup-${spaceId}-${stamp}.json`;
};

const downloadBackup = async () => {
	if (!adminMode || $auth.status !== 'authenticated') return;
	backupBusy = true;
	backupError = '';
	backupMessage = '';
	try {
		const backup = await api.getSpaceBackup();
		const blob = new Blob([JSON.stringify(backup, null, 2)], {
			type: 'application/json'
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = backupFileName(backup.space.id, backup.exported_at_ts);
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		backupMessage = `Backup downloaded (${backup.lists.length} lists, ${backup.tasks.length} tasks).`;
	} catch (err) {
		backupError = err instanceof Error ? err.message : String(err);
	} finally {
		backupBusy = false;
	}
};

const restoreBackup = async (event) => {
	if (!adminMode || $auth.status !== 'authenticated') return;
	const input = event.currentTarget;
	const file = input?.files?.[0];
	if (!file) return;

	backupBusy = true;
	backupError = '';
	backupMessage = '';
	try {
		const raw = await readAsText(file);
		const parsed = JSON.parse(raw);
		if (!parsed || parsed.schema !== BACKUP_SCHEMA_V1) {
			throw new Error('Invalid backup file schema.');
		}
		if (!parsed.space?.id || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.lists)) {
			throw new Error('Backup file is missing required fields.');
		}
		const confirmRestore = confirm(
			`Restore backup for space "${parsed.space.id}"? This will replace current space data.`
		);
		if (!confirmRestore) {
			return;
		}
		const result = await api.restoreSpaceBackup(parsed);
		backupMessage = `Restore complete: ${result.lists} lists, ${result.tasks} tasks. Reloading…`;
		if (typeof window !== 'undefined') {
			window.setTimeout(() => window.location.reload(), 300);
		}
	} catch (err) {
		backupError = err instanceof Error ? err.message : String(err);
	} finally {
		backupBusy = false;
		input.value = '';
	}
};

const resetDrafts = () => {
	renameDraft = {};
	iconDraft = {};
	colorDraft = {};
	newListName = '';
	newListIcon = '';
	newListColor = '#3b82f6';
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
		await lists.createRemote(name, normalizeListIcon(newListIcon), newListColor || undefined);
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
	const colorInput = colorDraft[id];
	const icon = typeof iconInput === 'string' ? normalizeListIcon(iconInput) : undefined;
	const color =
		typeof colorInput === 'string'
			? colorInput.trim()
			: undefined;
	if (!name && typeof iconInput !== 'string' && typeof colorInput !== 'string') return;
	busy = true;
	listError = '';
	try {
		await lists.updateRemote(id, {
			name: name || undefined,
			icon: typeof iconInput === 'string' ? icon || '' : undefined,
			color: typeof colorInput === 'string' ? color || '' : undefined
		});
		renameDraft = { ...renameDraft, [id]: '' };
		iconDraft = { ...iconDraft, [id]: '' };
		colorDraft = { ...colorDraft, [id]: '' };
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

const canDeleteMember = (member) =>
	adminMode &&
	$auth.user &&
	member.user_id !== $auth.user.user_id;

const deleteMember = async (member) => {
	if (!canDeleteMember(member) || teamBusy) return;
	const confirmed = confirm(`Delete ${member.display} from this space?`);
	if (!confirmed) return;
	teamBusy = true;
	teamError = '';
	teamMessage = '';
	try {
		await api.deleteMember(member.user_id);
		await Promise.all([members.hydrateFromServer(), loadGrants()]);
		teamMessage = `Removed ${member.display}.`;
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
	teamMessage = '';
}

$: loadedCustomSoundNames = customSoundNames($soundSettings);
$: hasCustomSounds =
	loadedCustomSoundNames.length > 0 ||
	!!$soundSettings.customSoundDataUrl ||
	!!$soundSettings.customSoundFilesJson;

$: teamMembers = ($members ?? []).filter((member) => member.user_id !== $auth.user?.user_id);
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


	</div>

	<div class="sidebar-bottom">
		<button
			type="button"
			class="settings-launch"
			data-testid="open-settings"
			on:click={() => openSettingsModal('account')}
		>
			Settings
		</button>
	</div>

	{#if showSettingsModal}
		<div class="settings-overlay" role="presentation" on:click={(e) => e.target === e.currentTarget && closeSettingsModal()}>
			<div class="settings-modal" role="dialog" aria-modal="true" aria-label="Preferences" data-testid="settings-modal">
				<div class="settings-header">
					<h2>Preferences</h2>
					<button type="button" class="ghost tiny" data-testid="close-settings" on:click={closeSettingsModal}>Close</button>
				</div>
				<div class="settings-content">
					<nav class="settings-nav" aria-label="Settings panels">
						<button type="button" class:active={activeSettingsPanel === 'account'} on:click={() => selectSettingsPanel('account')}>Account</button>
						<button type="button" class:active={activeSettingsPanel === 'sound'} on:click={() => selectSettingsPanel('sound')}>Sound</button>
						{#if adminMode}
							<button type="button" class:active={activeSettingsPanel === 'lists'} on:click={() => selectSettingsPanel('lists')}>Lists</button>
							<button type="button" class:active={activeSettingsPanel === 'members'} on:click={() => selectSettingsPanel('members')}>Members</button>
							<button type="button" class:active={activeSettingsPanel === 'backups'} on:click={() => selectSettingsPanel('backups')}>Backups</button>
						{/if}
					</nav>
					<section class="settings-panel">
						{#if activeSettingsPanel === 'lists' && adminMode}
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
							maxlength="24"
							autocapitalize="off"
							spellcheck="false"
							bind:value={newListIcon}
							on:keydown={(e) => e.key === 'Enter' && createList()}
						/>
					</label>
					<label>
						Color (optional)
						<input type="color" bind:value={newListColor} />
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
									maxlength="24"
									autocapitalize="off"
									spellcheck="false"
									bind:value={iconDraft[list.id]}
									on:keydown={(e) => e.key === 'Enter' && renameList(list.id)}
								/>
								<input
									class="color-input"
									type="color"
									value={colorDraft[list.id] ?? list.color ?? '#3b82f6'}
									on:input={(e) => (colorDraft[list.id] = e.currentTarget.value)}
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
						{:else if activeSettingsPanel === 'members' && adminMode}
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
							{#if teamMembers.length}
								{#each teamMembers as member}
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
											<button
												type="button"
												class="ghost tiny danger"
												disabled={!canDeleteMember(member) || teamBusy}
												on:click={() => deleteMember(member)}
											>
												Delete member
											</button>
										</div>
										{#if member.role === 'contributor'}
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
										{/if}
									</div>
								{/each}
							{:else}
								<p class="muted-note">No other members yet. Add one above.</p>
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
						{:else if activeSettingsPanel === 'sound'}
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
					Custom sounds (mp3/wav)
					<input
						type="file"
						accept=".mp3,.wav,audio/mpeg,audio/wav"
						multiple
						on:change={uploadCustomSound}
						disabled={soundBusy}
					/>
				</label>
				<div class="sound-actions">
					<button type="button" class="ghost tiny" on:click={previewSound}>
						Test sound
					</button>
					<button
						type="button"
						class="ghost tiny"
						on:click={clearCustomSound}
						disabled={!hasCustomSounds}
					>
						Clear custom
					</button>
				</div>
				{#if loadedCustomSoundNames.length}
					<p class="muted-note">
						Loaded:
						{loadedCustomSoundNames.join(', ')}
					</p>
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
							style={`--range-pct:${$soundSettings.volume}%`}
							on:input={(e) => soundSettings.setVolume(Number(e.target.value))}
						/>
						<span>{$soundSettings.volume}%</span>
					</div>
				</label>
			</div>
						{:else if activeSettingsPanel === 'backups' && adminMode && $auth.status === 'authenticated'}
				<div class="card backup" data-testid="backup-panel">
					<p class="muted-note">Download a full JSON snapshot of this space, then restore it if needed.</p>
					<div class="backup-actions">
						<button type="button" class="ghost" on:click={downloadBackup} disabled={backupBusy}>
							{backupBusy ? 'Working…' : 'Download backup'}
						</button>
						<label class="file-btn">
							<span>{backupBusy ? 'Working…' : 'Restore backup JSON'}</span>
							<input
								type="file"
								accept=".json,application/json"
								on:change={restoreBackup}
								disabled={backupBusy}
							/>
						</label>
					</div>
					{#if backupMessage}
						<p class="ok">{backupMessage}</p>
					{/if}
					{#if backupError}
						<p class="error">{backupError}</p>
					{/if}
				</div>
						{:else}
			<div class="card account" data-testid="auth-panel">
				<label>
					App theme
					<select
						data-testid="ui-theme"
						value={$uiPreferences.theme}
						on:change={(e) => uiPreferences.setTheme(e.target.value)}
					>
						{#each appThemes as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>
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
						{/if}
					</section>
				</div>
			</div>
		</div>
	{/if}
</nav>

<style>
	.sidebar {
		width: 100%;
		max-width: 264px;
		background: var(--surface-2);
		border-right: 1px solid var(--border-1);
		color: var(--app-text);
		padding: 14px 12px calc(14px + env(safe-area-inset-bottom) + 92px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		height: 100vh;
		position: sticky;
		top: 0;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
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
		padding-bottom: calc(env(safe-area-inset-bottom) + 28px);
		border-top: 1px solid rgba(71, 85, 105, 0.35);
	}

	.settings-launch {
		width: 100%;
		border-radius: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border-1);
		background: var(--surface-1);
		color: var(--app-text);
		font-weight: 600;
	}

	.settings-overlay {
		position: fixed;
		inset: 0;
		background: rgb(15 23 42 / 56%);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		z-index: 40;
	}

	.settings-modal {
		width: min(980px, 100%);
		max-height: min(90vh, 920px);
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		border-radius: 14px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.settings-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-1);
	}

	.settings-header h2 {
		margin: 0;
		font-size: 1.25rem;
	}

	.settings-content {
		display: grid;
		grid-template-columns: 220px minmax(0, 1fr);
		flex: 1;
		min-height: 0;
	}

	.settings-nav {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 10px;
		border-right: 1px solid var(--border-1);
		overflow-y: auto;
	}

	.settings-nav button {
		text-align: left;
		padding: 8px 10px;
		border-radius: 8px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--app-text);
	}

	.settings-nav button.active {
		background: var(--surface-2);
		border-color: var(--border-1);
	}

	.settings-panel {
		padding: 12px;
		overflow-y: auto;
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
		color: var(--app-text);
		font-size: 24px;
		line-height: 1.1;
	}

	.pin {
		background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
		border: 1px solid var(--border-1);
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
		color: var(--app-text);
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 10px;
		transition: background 120ms ease, color 120ms ease, transform 120ms ease;
	}

	a:hover {
		background: #111c31;
		transform: translateX(2px);
	}

	a.selected {
		background: linear-gradient(90deg, rgba(37, 99, 235, 0.42), rgba(15, 23, 42, 0.9));
		color: #f1f5f9;
		box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.25);
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
		color: var(--app-text);
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		border-radius: 10px;
		padding: 8px 10px;
		text-align: left;
		cursor: pointer;
	}

	.card {
		border: 1px solid var(--border-1);
		border-radius: 14px;
		padding: 10px;
		background: color-mix(in oklab, var(--surface-1) 93%, white 7%);
		box-shadow: 0 6px 16px rgba(2,6,23,0.24);
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
		color: var(--app-text);
	}

	input,
	select {
		background: linear-gradient(180deg, var(--surface-1), var(--surface-2));
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 7px 9px;
	}

	button.primary {
		background: #0f1622;
		border: none;
		color: #fff;
		padding: 8px 10px;
		border-radius: 10px;
		cursor: pointer;
		font-weight: 650;
		box-shadow: 0 8px 22px rgba(29, 78, 216, 0.35);
	}

	button.ghost {
		background: var(--surface-2);
		border: 1px solid var(--border-1);
		color: var(--app-text);
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
		grid-template-columns: minmax(0, 1fr) minmax(74px, 86px) 44px;
		gap: 6px;
		align-items: start;
	}

	.manager .row .name-input {
		grid-column: 1 / -1;
	}

	.manager .row .icon-input {
		width: 100%;
	}

	.manager .row .color-input {
		width: 44px;
		height: 36px;
		padding: 3px;
		border-radius: 8px;
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
		background: #0f1622;
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

	.sound input[type='checkbox'] {
		accent-color: #1d4ed8;
	}

	.sound .volume {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.sound .volume input[type='range'] {
		appearance: none;
		-webkit-appearance: none;
		width: 100%;
		height: 8px;
		border-radius: 999px;
		border: 1px solid #334155;
		background: #0f1622;
		padding: 0;
	}

	.sound .volume input[type='range']::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #f8fafc;
		border: 1px solid #1d4ed8;
		cursor: pointer;
	}

	.sound .volume input[type='range']::-moz-range-thumb {
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #f8fafc;
		border: 1px solid #1d4ed8;
		cursor: pointer;
	}

	.sound .volume span {
		color: #94a3b8;
		font-size: 12px;
		min-width: 38px;
		text-align: right;
	}

	.backup .backup-actions {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}

	.backup .file-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #0b1221;
		border: 1px solid #27344f;
		color: #cbd5e1;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
	}

	.backup .file-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.backup .file-btn input:disabled {
		cursor: not-allowed;
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
		.settings-overlay {
			padding: 0;
		}

		.settings-modal {
			width: 100%;
			height: 100%;
			max-height: none;
			border-radius: 0;
		}

		.settings-content {
			grid-template-columns: 1fr;
		}

		.settings-nav {
			border-right: 0;
			border-bottom: 1px solid var(--border-1);
			flex-direction: row;
			overflow-x: auto;
		}

		.settings-nav button {
			white-space: nowrap;
		}

		.settings-panel {
			padding: 12px;
		}
	}

	@media (max-width: 900px) {
		.sidebar {
			max-width: none;
			padding: 12px 10px calc(12px + env(safe-area-inset-bottom) + 96px);
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
