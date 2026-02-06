<script lang="ts">
	// @ts-nocheck
	import { page } from '$app/stores';
import TaskRow from '$lib/components/TaskRow.svelte';
import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
import { tasks, tasksByList, getTask } from '$lib/stores/tasks';
import { findListName } from '$lib/stores/lists';

let quickTitle = '';
let detailId = null;
$: listId = $page.params.id;
let listTasks = tasksByList(listId);
$: listTasks = tasksByList(listId);
$: listName = findListName(listId);

const quickAdd = () => {
	if (!quickTitle.trim()) return;
	const activeList = listId || (typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : '');
	if (!activeList) return;
	tasks.createLocal(quickTitle, activeList);
	quickTitle = '';
};

if (typeof window !== 'undefined') {
	Reflect.set(window, '__addTaskList', () => quickAdd());
	Reflect.set(window, '__addTaskListWithTitle', (title) => {
		const activeList = listId || window.location.pathname.split('/').pop();
		if (!activeList) return;
		tasks.createLocal(title, activeList);
	});
}

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

<div class="mobile-add" aria-label="Quick add">
	<div class="bar">
		<input
			type="text"
			placeholder={`Add a task to ${listName}`}
			bind:value={quickTitle}
			autocomplete="off"
			data-testid="new-task-input"
			on:keydown={(e) => e.key === 'Enter' && quickAdd()}
		/>
		<button type="button" data-testid="new-task-submit" on:click={quickAdd}>Add</button>
	</div>
</div>

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

	.block {
		margin-top: 14px;
	}

	.section-title {
		color: #94a3b8;
		font-size: 13px;
		margin-bottom: 6px;
	}

	.stack {
		display: grid;
		gap: 10px;
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

	.mobile-add {
		display: block;
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
		padding: 0 14px;
		z-index: 15;
	}

	.mobile-add .bar {
		background: rgba(15, 23, 42, 0.96);
		border: 1px solid #1f2937;
		border-radius: 16px;
		padding: 7px;
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
		max-width: 720px;
		margin: 0 auto;
	}

	.mobile-add input {
		width: 100%;
		background: #0b1221;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 10px;
		padding: 10px 12px;
	}

	.mobile-add button {
		background: #2563eb;
		color: white;
		border: none;
		border-radius: 11px;
		padding: 10px 14px;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.page-header {
			margin-bottom: 12px;
		}

		.stack {
			padding-bottom: 88px;
		}

		h1 {
			font-size: 24px;
		}
	}
</style>
