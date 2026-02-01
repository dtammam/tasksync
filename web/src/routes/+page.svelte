<script lang="ts">
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { myDayCompleted, myDayPending, tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';

	const listsStore = lists;
	let newTitle = '';

	$: defaultListId =
		($listsStore ?? []).find((l) => l.id !== 'my-day')?.id ?? ($listsStore ?? [])[0]?.id ?? 'goal-management';

	const addTask = () => {
		if (!newTitle.trim()) return;
		tasks.createLocal(newTitle, defaultListId, { my_day: true });
		newTitle = '';
	};

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskMyDay', () => addTask());
	}
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">Saturday, February 1</p>
		<h1>My Day</h1>
		<p class="sub">Tasks you’ve chosen for today.</p>
	</div>
	<div class="actions">
		<div class="add">
			<input
				type="text"
				placeholder="Add a task"
				bind:value={newTitle}
				data-testid="new-task-input"
				autocomplete="off"
				on:keydown={(e) => e.key === 'Enter' && addTask()}
			/>
			<button type="button" data-testid="new-task-submit" on:click={addTask}>Add</button>
		</div>
	</div>
</header>

<section class="block">
	<div class="section-title">Planned</div>
	<div class="stack">
		{#if $myDayPending?.length}
			{#each $myDayPending as task (task.id)}
				<TaskRow {task} />
			{/each}
		{:else}
			<p class="empty">Nothing scheduled. Add a task to My Day.</p>
		{/if}
	</div>
</section>

<section class="block">
	<div class="section-title">Completed ({$myDayCompleted?.length ?? 0})</div>
	<div class="stack" data-testid="completed-section">
		{#if $myDayCompleted?.length}
			{#each $myDayCompleted as task (task.id)}
				<TaskRow {task} />
			{/each}
		{:else}
			<p class="empty subtle">No completed tasks yet.</p>
		{/if}
	</div>
</section>

<style>
	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18px;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 11px;
		color: #94a3b8;
		margin: 0;
	}

	h1 {
		margin: 4px 0;
		font-size: 28px;
		letter-spacing: -0.02em;
	}

	.sub {
		margin: 0;
		color: #94a3b8;
	}

	.actions button {
		background: #1d4ed8;
		border: none;
		color: white;
		padding: 10px 14px;
		border-radius: 10px;
		cursor: pointer;
		opacity: 1;
	}

	.block {
		margin-top: 12px;
	}

	.section-title {
		color: #94a3b8;
		font-size: 13px;
		margin-bottom: 6px;
	}

	.stack {
		display: grid;
		gap: 8px;
	}

	.empty {
		color: #94a3b8;
		margin: 0;
		padding: 12px;
		background: #0b1221;
		border: 1px dashed #1f2937;
		border-radius: 10px;
	}

	.empty.subtle {
		color: #64748b;
	}

	.add {
		display: flex;
		gap: 8px;
	}

	.add input {
		border-radius: 10px;
		border: 1px solid #1f2937;
		background: #0f172a;
		padding: 10px 12px;
		color: #e2e8f0;
		min-width: 220px;
	}
</style>
