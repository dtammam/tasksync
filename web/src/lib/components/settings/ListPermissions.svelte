<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { SpaceMember, ListGrant } from '$shared/types/auth';
	import type { List } from '$shared/types/list';

	export let lists: List[] = [];
	export let members: SpaceMember[] = [];
	export let grants: ListGrant[] = [];
	export let busy = false;

	const dispatch = createEventDispatcher<{
		grantChange: { userId: string; listId: string; granted: boolean };
	}>();

	const hasGrant = (userId: string, listId: string): boolean =>
		grants.some((grant) => grant.user_id === userId && grant.list_id === listId);

	$: contributors = members.filter((m) => m.role === 'contributor');
</script>

{#each contributors as member}
	<div class="grant-grid">
		{#each lists as list}
			<label
				class={`grant-row ${hasGrant(member.user_id, list.id) ? 'on' : ''}`}
			>
				<span class="grant-name">{list.icon ?? '•'} {list.name}</span>
				<input
					type="checkbox"
					class="grant-checkbox"
					checked={hasGrant(member.user_id, list.id)}
					disabled={busy}
					on:change={(e) =>
						dispatch('grantChange', { userId: member.user_id, listId: list.id, granted: e.currentTarget.checked })}
				/>
			</label>
		{/each}
	</div>
{/each}

<style>
	.grant-grid {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 6px;
		border-top: 1px solid var(--border-1);
	}

	.grant-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 6px;
		border-radius: 6px;
		font-size: 13px;
		color: var(--app-text);
		cursor: pointer;
	}

	.grant-row.on {
		background: color-mix(in oklab, var(--surface-accent) 15%, transparent);
	}

	.grant-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.grant-checkbox {
		flex-shrink: 0;
		accent-color: var(--surface-accent);
	}
</style>
