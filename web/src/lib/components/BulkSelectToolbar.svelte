<script lang="ts">
	import { selection, selectedCount } from '$lib/stores/selection';
	import { tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import EmojiPicker from './EmojiPicker.svelte';

	// Ids of every task in THIS view the user may act on (already scoped to what
	// they can edit). Select-all, delete and tag are confined to this set, so a bulk
	// op never touches a task the server would reject.
	export let eligibleIds: string[] = [];
	// The list these tasks currently sit in (list view). Excluded from the move
	// picker — you can't move a task to the list it's already in. Undefined on My
	// Day, whose selection can span lists, so nothing is excluded there but My Day.
	export let excludeListId: string | undefined = undefined;
	export let onDeleted: ((count: number) => void) | undefined = undefined;
	export let onTagged: ((count: number, emoji?: string) => void) | undefined = undefined;
	export let onMoved: ((count: number, listName: string) => void) | undefined = undefined;

	let showTagPicker = false;
	let showMovePicker = false;

	$: count = $selectedCount;

	// Lists a selection can be moved INTO: every real list bar the current one.
	// `my-day` is a derived view, not a real list, so it is never a move target.
	// For a contributor the server only returns granted (writable) lists, so this
	// set is already the writable set; the server's grant-check on the target is
	// the authority regardless (a rejected move degrades gracefully via sync).
	$: moveTargets = $lists.filter((l) => l.id !== 'my-day' && l.id !== excludeListId);

	// The currently-selected ids that this view is allowed to act on.
	const eligibleSelection = () => {
		const eligible = new Set(eligibleIds);
		return selection.snapshot().filter((id) => eligible.has(id));
	};

	const selectAll = () => selection.setMany(eligibleIds);
	const cancel = () => selection.exit();

	const del = () => {
		const ids = eligibleSelection();
		if (ids.length === 0) return;
		tasks.softDeleteMany(ids);
		selection.exit();
		onDeleted?.(ids.length);
	};

	// Apply (emoji) or clear (undefined) one tag across the whole selection, then
	// leave selection mode — the "apply + exit" flow the owner chose.
	const applyTag = (emoji?: string) => {
		const ids = eligibleSelection();
		if (ids.length === 0) return;
		const changed = tasks.setEmojiMany(ids, emoji);
		showTagPicker = false;
		selection.exit();
		onTagged?.(changed, emoji);
	};

	// Reattribute the selection to one target list, then leave selection mode —
	// the same "apply + exit" flow as tag. A task already in the target is a
	// no-op (not counted); the returned count is the tasks actually moved.
	const moveTo = (targetId: string, targetName: string) => {
		const ids = eligibleSelection();
		if (ids.length === 0) return;
		const moved = tasks.moveToListMany(ids, targetId);
		showMovePicker = false;
		selection.exit();
		onMoved?.(moved, targetName);
	};

	// Only one picker panel open at a time.
	const toggleTagPicker = () => {
		showTagPicker = !showTagPicker;
		if (showTagPicker) showMovePicker = false;
	};
	const toggleMovePicker = () => {
		showMovePicker = !showMovePicker;
		if (showMovePicker) showTagPicker = false;
	};
</script>

<div class="bulk-toolbar" data-testid="bulk-select-toolbar" role="region" aria-label="Bulk selection">
	<span class="count" data-testid="bulk-selected-count">{count} selected</span>
	<div class="bulk-actions">
		<button
			type="button"
			class="ghost-pill"
			data-testid="bulk-select-all"
			on:click={selectAll}
			disabled={eligibleIds.length === 0 || count === eligibleIds.length}
		>
			Select all
		</button>
		<button
			type="button"
			class="ghost-pill"
			data-testid="bulk-tag"
			aria-expanded={showTagPicker}
			on:click={toggleTagPicker}
			disabled={count === 0}
		>
			Tag
		</button>
		<button
			type="button"
			class="ghost-pill"
			data-testid="bulk-move"
			aria-expanded={showMovePicker}
			on:click={toggleMovePicker}
			disabled={count === 0 || moveTargets.length === 0}
		>
			Move
		</button>
		<button
			type="button"
			class="ghost-pill danger"
			data-testid="bulk-delete"
			on:click={del}
			disabled={count === 0}
		>
			Delete
		</button>
		<button type="button" class="ghost-pill" data-testid="bulk-cancel" on:click={cancel}>
			Cancel
		</button>
	</div>

	{#if showTagPicker && count > 0}
		<div class="tag-panel" data-testid="bulk-tag-panel">
			<span class="tag-panel-hint">Tag {count} selected</span>
			<EmojiPicker value={undefined} on:change={(e) => applyTag(e.detail)} />
			<button
				type="button"
				class="ghost-pill"
				data-testid="bulk-tag-clear"
				on:click={() => applyTag(undefined)}
			>
				Clear tag
			</button>
		</div>
	{/if}

	{#if showMovePicker && count > 0}
		<div class="tag-panel" data-testid="bulk-move-panel">
			<span class="tag-panel-hint">Move {count} selected to…</span>
			<div class="move-targets">
				{#each moveTargets as list (list.id)}
					<button
						type="button"
						class="ghost-pill"
						data-testid="bulk-move-target"
						data-list-id={list.id}
						on:click={() => moveTo(list.id, list.name)}
					>
						{#if list.icon}<span aria-hidden="true">{list.icon}</span> {/if}{list.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.bulk-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 12px;
		margin-bottom: 12px;
		border-radius: 12px;
		border: 1px solid var(--border-1);
		background: var(--surface-2);
		/* Pin to the top of the scroll area so it stays reachable while the user
		   scrolls through tasks in select mode. Sits above the sticky app-header
		   (z-index 2) and the task rows; opaque background so nothing bleeds
		   through. */
		position: sticky;
		top: 0;
		z-index: 5;
		box-shadow: var(--soft-shadow, 0 6px 18px rgba(0, 0, 0, 0.14));
	}
	.count {
		font-weight: 600;
		color: var(--app-text);
	}
	.bulk-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.ghost-pill {
		border-radius: 999px;
		padding: 7px 12px;
		font-size: 12px;
		line-height: 1.1;
		white-space: nowrap;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
	}
	.ghost-pill:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.07);
	}
	.ghost-pill.danger:not(:disabled) {
		border-color: #7f1d1d;
		color: #fecaca;
	}
	.ghost-pill:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.tag-panel {
		flex-basis: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 4px;
		padding-top: 10px;
		border-top: 1px solid var(--border-1);
	}
	.tag-panel-hint {
		font-size: 12px;
		color: var(--app-muted);
	}
	.tag-panel .ghost-pill {
		align-self: flex-start;
	}
	.move-targets {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.move-targets .ghost-pill {
		align-self: auto;
	}
</style>
