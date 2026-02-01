<script lang="ts">
	import { findListName } from '$lib/stores/lists';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { tasks, tasksByList } from '$lib/stores/tasks';
	import { parseMarkdownTasks } from '$lib/markdown/import';

	export let data;

	const listStore = tasksByList(data.listId);

	let newTitle = '';
	let markdown = '';

	const addTask = () => {
		if (!newTitle.trim()) return;
		tasks.createLocal(newTitle, data.listId, { my_day: false });
		newTitle = '';
	};

	const importMarkdown = () => {
		const parsed = parseMarkdownTasks(markdown, data.listId);
		for (const p of parsed) {
			tasks.createLocalWithOptions(p.title, p.list_id ?? data.listId, {
				status: p.status,
				my_day: p.my_day ?? false
			});
		}
		markdown = '';
	};

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskList', () => addTask());
	}

	$: pending = ($listStore ?? []).filter((t) => t.status === 'pending');
	$: completed = ($listStore ?? []).filter((t) => t.status === 'done');
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">List</p>
		<h1>{findListName(data.listId)}</h1>
		<p class="sub">{pending.length} pending • {completed.length} completed</p>
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

<details class="importer">
	<summary>Import tasks (markdown)</summary>
	<p class="hint">Format: <code>- [ ] Task title #list-id @myday</code> (use [x] for done)</p>
	<textarea bind:value={markdown} rows="4" placeholder="- [ ] Write proposal #tasks @myday"></textarea>
	<button type="button" on:click={importMarkdown} disabled={!markdown.trim()}>Import</button>
</details>

<section class="block">
	<div class="section-title">Pending</div>
	<div class="stack">
		{#if pending.length}
			{#each pending as task (task.id)}
				<TaskRow {task} />
			{/each}
		{:else}
			<p class="empty">All caught up in this list.</p>
		{/if}
	</div>
</section>

<section class="block">
	<div class="section-title">Completed ({completed.length})</div>
	<div class="stack" data-testid="completed-section">
		{#if completed.length}
			{#each completed as task (task.id)}
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

	.importer {
		margin: 12px 0;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 10px 12px;
		background: #0b1221;
		color: #cbd5e1;
	}

	.importer summary {
		cursor: pointer;
		font-weight: 600;
	}

	.importer textarea {
		width: 100%;
		margin-top: 8px;
		background: #0f172a;
		color: #e2e8f0;
		border: 1px solid #1f2937;
		border-radius: 8px;
		padding: 10px;
		font-family: monospace;
	}

	.importer .hint {
		color: #94a3b8;
		font-size: 12px;
	}
</style>
