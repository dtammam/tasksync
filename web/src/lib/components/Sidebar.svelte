<script lang="ts">
import { page } from '$app/stores';
import { lists } from '$lib/stores/lists';
import { listCounts, myDayPending } from '$lib/stores/tasks';
</script>

<nav class="sidebar">
	<div class="app-title">tasksync</div>
	<div class="section-label">Today</div>
	{#if $lists}
		{#each $lists as list}
			{#if list.id === 'my-day'}
				<a class:selected={$page.url.pathname === '/'} href="/">
					<span class="icon">🌅</span>
					<span>{list.name}</span>
					<span class="count">{$myDayPending?.length ?? 0}</span>
				</a>
			{:else}
				<a
					class:selected={$page.url.pathname === `/list/${list.id}`}
					href={`/list/${list.id}`}
				>
					<span class="icon">{list.icon ?? '•'}</span>
					<span>{list.name}</span>
					<span class="count">{$listCounts?.[list.id]?.pending ?? 0}</span>
				</a>
			{/if}
		{/each}
	{/if}
	<div class="section-label muted">Collections</div>
	<button class="add" type="button" aria-disabled="true">+ New list (coming soon)</button>
</nav>

<style>
	.sidebar {
		width: 240px;
		background: #0a0f1c;
		border-right: 1px solid #131a2d;
		color: #cbd5e1;
		padding: 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100vh;
		position: sticky;
		top: 0;
	}

	.app-title {
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e2e8f0;
		margin-bottom: 8px;
	}

	.section-label {
		text-transform: uppercase;
		font-size: 11px;
		color: #64748b;
		margin: 6px 6px 2px;
	}

	.section-label.muted {
		color: #475569;
	}

	a {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		align-items: center;
		gap: 8px;
		color: #cbd5e1;
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 10px;
		transition: background 120ms ease, color 120ms ease;
	}

	a:hover {
		background: #11192b;
	}

	a.selected {
		background: linear-gradient(90deg, #1f2a44, #182135);
		color: #e2e8f0;
	}

	.icon {
		font-size: 15px;
	}

	.count {
		font-size: 12px;
		color: #94a3b8;
	}

	.add {
		color: #94a3b8;
		background: none;
		border: 1px dashed #1f2937;
		border-radius: 10px;
		padding: 8px 10px;
		text-align: left;
		cursor: not-allowed;
	}
</style>
