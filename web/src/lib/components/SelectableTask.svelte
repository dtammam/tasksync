<script lang="ts">
	import TaskRow from './TaskRow.svelte';
	import { selection, selectionMode, selectedIds } from '$lib/stores/selection';
	import type { Task } from '$shared/types/task';

	export let task: Task;
	// A row the current user can't edit (contributor, not owner) shows a disabled
	// checkbox and can't be picked — the server would reject the delete anyway.
	export let selectable = true;
	export let completedContext = false;
	export let mobileCompact = false;
	export let inMyDayView = false;

	$: selected = $selectedIds.has(task.id);
</script>

{#if $selectionMode}
	<div class="selectable" class:selected class:disabled={!selectable}>
		<label class="pick">
			<input
				type="checkbox"
				data-testid="task-select"
				checked={selected}
				disabled={!selectable}
				on:change={() => selection.toggle(task.id)}
				aria-label={`Select "${task.title}"`}
			/>
		</label>
		<div class="row">
			<TaskRow {task} {completedContext} {mobileCompact} {inMyDayView} on:openDetail />
		</div>
	</div>
{:else}
	<TaskRow {task} {completedContext} {mobileCompact} {inMyDayView} on:openDetail />
{/if}

<style>
	.selectable {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		align-items: center;
		border-radius: 14px;
	}
	.selectable.selected {
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--surface-accent) 60%, transparent);
	}
	.selectable.disabled {
		opacity: 0.55;
	}
	.pick {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-left: 4px;
	}
	.pick input {
		width: 22px;
		height: 22px;
		min-width: 22px;
		cursor: pointer;
		accent-color: var(--surface-accent, #6366f1);
	}
	.pick input:disabled {
		cursor: not-allowed;
	}
	.row {
		min-width: 0;
	}
</style>
