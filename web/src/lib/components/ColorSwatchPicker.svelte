<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let value = '#3b82f6';

	const dispatch = createEventDispatcher<{ change: string }>();

	const swatches = [
		'#ef4444', // red
		'#f97316', // orange
		'#eab308', // yellow
		'#22c55e', // green
		'#14b8a6', // teal
		'#3b82f6', // blue (default)
		'#6366f1', // indigo
		'#a855f7', // purple
		'#ec4899', // pink
		'#64748b', // slate
		'#78716c', // stone
		'#334155', // dark slate
	];

	const pick = (color: string) => {
		value = color;
		dispatch('change', color);
	};
</script>

<div class="swatch-grid" role="radiogroup" aria-label="List color">
	{#each swatches as color}
		<button
			type="button"
			class="swatch"
			class:selected={value === color}
			style="background:{color}"
			aria-label={color}
			aria-checked={value === color}
			role="radio"
			on:click={() => pick(color)}
		></button>
	{/each}
</div>

<style>
	.swatch-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.swatch {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
		transition: border-color 0.15s;
	}

	.swatch:hover {
		border-color: var(--app-muted, #94a3b8);
	}

	.swatch.selected {
		border-color: var(--app-text, #fff);
		box-shadow: 0 0 0 2px var(--surface-3, #334155);
	}
</style>
