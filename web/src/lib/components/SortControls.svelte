<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let mode = 'created';
	export let direction = 'asc';

	const dispatch = createEventDispatcher<{ change: { mode: string; direction: string } }>();

	const onModeChange = (event: Event & { currentTarget: HTMLSelectElement }) => {
		mode = event.currentTarget.value;
		dispatch('change', { mode, direction });
	};

	const onDirectionChange = (event: Event & { currentTarget: HTMLSelectElement }) => {
		direction = event.currentTarget.value;
		dispatch('change', { mode, direction });
	};
</script>

<div class="sorter">
	<label>
		<span>Sort</span>
		<select value={mode} aria-label="Sort tasks" on:change={onModeChange}>
			<option value="created">Creation</option>
			<option value="alpha">Alphabetical</option>
		</select>
	</label>
	<label class="order-control">
		<span>Order</span>
		<select value={direction} aria-label="Sort direction" on:change={onDirectionChange}>
			<option value="asc">Ascending</option>
			<option value="desc">Descending</option>
		</select>
	</label>
</div>

<style>
	.sorter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--app-text);
	}

	.sorter label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.sorter select {
		background: linear-gradient(180deg, var(--surface-1), color-mix(in oklab, var(--surface-1) 88%, black 12%));
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: var(--ring-shadow);
	}

	.sorter span {
		font-size: 11px;
		color: var(--app-muted);
	}

	@media (max-width: 900px) {
		.order-control {
			display: none;
		}
	}
</style>
