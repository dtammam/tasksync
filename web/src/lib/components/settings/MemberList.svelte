<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import ListPermissions from '$lib/components/settings/ListPermissions.svelte';
	import type { SpaceMember, ListGrant } from '$shared/types/auth';
	import type { List } from '$shared/types/list';

	export let members: SpaceMember[] = [];
	export let grants: ListGrant[] = [];
	export let managedLists: List[] = [];
	export let busy = false;
	export let canDelete: (member: SpaceMember) => boolean = () => false;

	const dispatch = createEventDispatcher<{
		reset: { member: SpaceMember };
		delete: { member: SpaceMember };
		grantChange: { userId: string; listId: string; granted: boolean };
	}>();

	const avatarFor = (user: SpaceMember | null | undefined): string => {
		const icon = user?.avatar_icon?.trim();
		if (icon) return icon.slice(0, 4);
		const source = (user?.display ?? user?.email ?? '').trim();
		if (!source) return '?';
		return source.charAt(0).toUpperCase();
	};

	const roleLabel = (role: string): string => (role === 'admin' ? 'Admin' : 'Contributor');
</script>

<div class="member-list">
	{#if members.length}
		{#each members as member}
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
						disabled={busy}
						on:click={() => dispatch('reset', { member })}
					>
						Reset password
					</button>
					<button
						type="button"
						class="ghost tiny danger"
						disabled={!canDelete(member) || busy}
						on:click={() => dispatch('delete', { member })}
					>
						Delete member
					</button>
				</div>
				{#if member.role === 'contributor'}
					<ListPermissions
						lists={managedLists}
						members={[member]}
						{grants}
						{busy}
						on:grantChange
					/>
				{/if}
			</div>
		{/each}
	{:else}
		<p class="muted-note">No other members yet. Add one above.</p>
	{/if}
</div>

<style>
	.member-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.member-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--border-1);
		border-radius: 12px;
		background: color-mix(in oklab, var(--surface-1) 92%, white 8%);
	}

	.member-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.member-head div {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.member-head strong {
		font-size: 14px;
		color: var(--app-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.member-head span {
		font-size: 12px;
		color: var(--app-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.avatar.small {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: var(--surface-accent);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 12px;
		flex-shrink: 0;
	}

	.role-chip {
		background: var(--surface-2);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 3px 8px;
		font-size: 11px;
		color: var(--app-muted);
		white-space: nowrap;
	}

	.member-tools {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.ghost.tiny {
		background: color-mix(in oklab, var(--surface-1) 92%, white 8%);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.ghost.tiny:hover {
		filter: brightness(1.1);
	}

	.ghost.tiny:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ghost.tiny.danger {
		color: #fca5a5;
		border-color: #7f1d1d;
	}

	.muted-note {
		margin: 0;
		font-size: 12px;
		color: var(--app-muted);
	}
</style>
