<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Task } from '$shared/types/task';

	export let suggestions: Task[] = [];
	export let disabled = false;

	let showPanel = false;

	const dispatch = createEventDispatcher<{ add: { id: string } }>();

	$: if (!suggestions.length) {
		showPanel = false;
	}
</script>

{#if suggestions.length}
	<div class="suggestions-flyout">
		{#if showPanel}
			<div class="suggestions-panel">
				<div class="panel-head">
					<strong>Suggestions</strong>
					<button type="button" class="ghost tiny" on:click={() => (showPanel = false)}>Close</button>
				</div>
				<div class="suggestions">
					{#each suggestions as suggestion (suggestion.id)}
						<div class="suggestion">
							<div>
								<p class="title">{suggestion.title}</p>
								<p class="meta">
									{#if suggestion.due_date}
										Due {suggestion.due_date}
									{:else}
										No due date
									{/if}
								</p>
							</div>
							<button
								type="button"
								on:click={() => dispatch('add', { id: suggestion.id })}
								{disabled}
							>
								Add
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		<button class="suggestions-toggle" type="button" on:click={() => (showPanel = !showPanel)}>
			Suggestions {suggestions.length}
		</button>
	</div>
{/if}

<style>
	.suggestions { display: grid; gap: 10px; }
	.suggestion {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		background: color-mix(in oklab, var(--surface-1) 95%, white 5%);
		border: 1px solid var(--border-1);
		border-radius: 12px;
		padding: 10px 12px;
		box-shadow: var(--ring-shadow);
	}

	.suggestions-flyout {
		position: fixed;
		right: 14px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		display: grid;
		gap: 10px;
		justify-items: end;
		z-index: 16;
	}

	.suggestions-toggle {
		background: var(--surface-1);
		color: var(--app-text);
		border: 1px solid var(--border-2);
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--soft-shadow);
	}

	.suggestions-toggle:hover {
		transform: translateY(-1px);
		filter: brightness(1.11);
	}

	.suggestions-panel {
		width: min(430px, calc(100vw - 28px));
		max-height: min(50vh, 430px);
		overflow: auto;
		background: color-mix(in oklab, var(--surface-2) 95%, white 3%);
		border: 1px solid var(--border-2);
		border-radius: 13px;
		padding: 12px;
		box-shadow: var(--soft-shadow);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
		color: var(--app-text);
	}

	.panel-head .ghost.tiny {
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
		border-radius: 999px;
		padding: 6px 11px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.panel-head .ghost.tiny:hover {
		transform: translateY(-1px);
		filter: brightness(1.11);
	}

	.suggestion .title { margin: 0; font-weight: 650; }
	.suggestion .meta { margin: 2px 0 0; color: var(--app-muted); font-size: 13px; }

	.suggestion button {
		background: linear-gradient(180deg, #1e40af, #1d4ed8);
		color: white;
		border: 1px solid rgba(147, 197, 253, 0.4);
		padding: 10px 12px;
		border-radius: 11px;
		cursor: pointer;
		box-shadow: 0 8px 20px rgba(37, 99, 235, 0.28);
	}

	.suggestion button:hover {
		transform: translateY(-1px);
		filter: brightness(1.11);
	}

	@media (max-width: 900px) {
		.suggestion {
			grid-template-columns: 1fr;
			gap: 8px;
		}

		.suggestions-flyout {
			right: 10px;
			left: auto;
			bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		}
	}
</style>
