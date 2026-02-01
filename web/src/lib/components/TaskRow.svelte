<script lang="ts">
	import { tasks } from '$lib/stores/tasks';

	export let task;

	const toggle = () => {
		tasks.toggle(task.id);
	};
	const badge = task.priority > 1 ? '🔥' : '•';
</script>

<article class="task" data-testid="task-row">
	<button class="status" aria-label="toggle task" on:click|stopPropagation={toggle} data-testid="task-toggle">
		{task.status === 'done' ? '✔' : '○'}
	</button>
	<div class="meta">
		<div class="title">
			<span class="title-text" data-testid="task-title">{task.title}</span>
			{#if task.tags.length}
				<span class="tags">{task.tags.join(', ')}</span>
			{/if}
		</div>
		<div class="sub">
			<span>{badge}</span>
			{#if task.my_day}
				<span class="chip">My Day</span>
			{/if}
			<span class="chip subtle">List: {task.list_id}</span>
		</div>
	</div>
</article>

<style>
	.task {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		background: #0f172a;
		border: 1px solid #1f2937;
		border-radius: 12px;
		padding: 10px 12px;
		align-items: center;
	}

	.status {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid #334155;
		background: #0b1221;
		color: #e2e8f0;
		cursor: pointer;
	}

	.meta .title {
		font-weight: 600;
		color: #e2e8f0;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.sub {
		display: flex;
		gap: 8px;
		color: #94a3b8;
		font-size: 12px;
		margin-top: 4px;
		align-items: center;
	}

	.chip {
		padding: 2px 6px;
		border-radius: 8px;
		background: #1f2937;
		color: #cbd5e1;
	}

	.chip.subtle {
		background: #0b1221;
		border: 1px solid #1e293b;
		color: #94a3b8;
	}

	.tags {
		color: #c7d2fe;
		font-size: 13px;
	}
</style>
