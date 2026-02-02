<script lang="ts">
	// @ts-nocheck
	import { page } from '$app/stores';
import TaskRow from '$lib/components/TaskRow.svelte';
import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
import { tasks, tasksByList, getTask } from '$lib/stores/tasks';
import { findListName } from '$lib/stores/lists';

let newTitle = '';
let detailId = null;
$: listId = $page.params.id;
let listTasks = tasksByList(listId);
$: listTasks = tasksByList(listId);
$: listName = findListName(listId);

	const addTask = () => {
		if (!newTitle.trim()) return;
		tasks.createLocal(newTitle, listId);
		newTitle = '';
	};

	const openDetail = (event) => (detailId = event.detail.id);
	const closeDetail = () => (detailId = null);
	$: detailTask = detailId ? getTask(detailId) : null;

	const sortTasks = (arr) => [...arr].sort((a, b) => a.created_ts - b.created_ts);
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">List</p>
		<h1>{listName}</h1>
		<p class="sub">Tasks in this list.</p>
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
	<div class="section-title">Pending</div>
	<div class="stack">
		{#if sortTasks($listTasks?.filter((t) => t.status === 'pending') ?? []).length}
			{#each sortTasks($listTasks.filter((t) => t.status === 'pending')) as task (task.id)}
				<TaskRow {task} on:openDetail={openDetail} />
			{/each}
		{:else}
			<p class="empty">No pending tasks.</p>
		{/if}
	</div>
</section>

<section class="block">
	<div class="section-title">Completed</div>
	<div class="stack" data-testid="completed-section">
		{#if sortTasks($listTasks?.filter((t) => t.status === 'done') ?? []).length}
			{#each sortTasks($listTasks.filter((t) => t.status === 'done')) as task (task.id)}
				<TaskRow {task} on:openDetail={openDetail} />
			{/each}
		{:else}
			<p class="empty subtle">No completed tasks yet.</p>
		{/if}
	</div>
</section>

<TaskDetailDrawer task={detailTask} open={!!detailTask} on:close={closeDetail} />

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

	@media (max-width: 900px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}

		.actions {
			width: 100%;
		}

		.add {
			width: 100%;
		}

		.add input,
		.actions button {
			width: 100%;
		}
	}
</style>
