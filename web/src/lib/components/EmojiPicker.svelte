<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { tagPalette } from '$lib/stores/tagPalette';

	export let value: string | undefined = undefined;

	const dispatch = createEventDispatcher<{ change: string | undefined }>();

	const pick = (emoji: string) => {
		// Selecting the already-active tag clears it — the same gesture doubles as "remove".
		value = value === emoji ? undefined : emoji;
		dispatch('change', value);
	};
</script>

<div class="picker" role="radiogroup" aria-label="Tag">
	{#each $tagPalette as group}
		<div class="section">
			<span class="section-label">{group.section}</span>
			<div class="grid">
				{#each group.entries as entry}
					<button
						type="button"
						class="tag-swatch"
						class:selected={value === entry.emoji}
						aria-label={entry.label}
						aria-checked={value === entry.emoji}
						role="radio"
						title={entry.label}
						on:click={() => pick(entry.emoji)}
					>
						{entry.emoji}
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 280px;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.section-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--app-muted, #94a3b8);
	}

	.grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-swatch {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 2px solid transparent;
		background: var(--surface-2, #1e293b);
		cursor: pointer;
		padding: 0;
		font-size: 16px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s;
	}

	.tag-swatch:hover {
		border-color: var(--app-muted, #94a3b8);
	}

	.tag-swatch.selected {
		border-color: var(--app-text, #fff);
		box-shadow: 0 0 0 2px var(--surface-3, #334155);
	}
</style>
