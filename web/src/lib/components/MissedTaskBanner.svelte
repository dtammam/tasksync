<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import type { Task } from '$shared/types/task';

	export let tasks: Task[] = [];
	export let isMobilePwaViewport = false;
	export let canResolve: (task: Task) => boolean = () => true;
	export let deletingId = '';
	export let actionError = '';

	const dispatch = createEventDispatcher<{
		markDone: { task: Task };
		skip: { task: Task };
		delete: { task: Task };
		openDetail: { id: string };
	}>();
</script>

{#if tasks.length}
	<section class="block missed-block">
		<div class="section-title">Missed ({tasks.length})</div>
		<div class="stack" data-testid="missed-section">
			{#each tasks as task (task.id)}
				<div class="missed-item" transition:fade={{ duration: 150 }}>
					<TaskRow {task} mobileCompact={isMobilePwaViewport} inMyDayView={true} on:openDetail />
					<div class="missed-actions">
						{#if task.recurrence_id}
							<button
								type="button"
								class="ghost"
								on:click={() => dispatch('skip', { task })}
								disabled={!canResolve(task)}
							>
								Skip next
							</button>
						{/if}
						<button
							type="button"
							on:click={() => dispatch('markDone', { task })}
							disabled={!canResolve(task)}
						>
							Mark done
						</button>
						<button
							type="button"
							class="danger"
							on:click={() => dispatch('delete', { task })}
							disabled={!canResolve(task) || deletingId === task.id}
						>
							{deletingId === task.id ? 'Deleting…' : 'Delete'}
						</button>
					</div>
				</div>
			{/each}
			{#if actionError}
				<p class="missed-error">{actionError}</p>
			{/if}
		</div>
	</section>
{/if}

<style>
	.block {
		margin-top: 16px;
		padding: 12px;
		border-radius: 16px;
		border: 1px solid var(--border-1);
		background: var(--surface-1);
		box-shadow: var(--soft-shadow);
	}

	.section-title {
		color: var(--app-muted);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-bottom: 8px;
	}

	.missed-block .section-title { color: #fbbf24; }
	.stack { display: grid; gap: 12px; }

	.missed-item {
		display: grid;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--border-1);
		border-radius: 12px;
		background: linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 92%, #f59e0b 8%), var(--surface-2));
	}

	.missed-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
	.missed-actions button {
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
		border-radius: 999px;
		padding: 6px 11px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.missed-actions button:hover {
		transform: translateY(-1px);
		filter: brightness(1.11);
	}

	.missed-actions button.ghost { color: var(--app-muted); }
	.missed-actions button.danger { border-color: #7f1d1d; color: #fecaca; }
	.missed-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
	.missed-error { margin: 0; color: #fda4af; font-size: 12px; }
</style>
