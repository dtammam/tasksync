<script lang="ts">
	// @ts-nocheck
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { myDayCompleted, myDayPending, tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { getTask } from '$lib/stores/tasks';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
	import { parseMarkdownTasks } from '$lib/markdown/import';

	const listsStore = lists;
	let newTitle = '';
	let quickTitle = '';
	let markdown = '';
	let sortMode = 'created';
	let detailId = null;
	$: detailTask = detailId ? getTask(detailId) : null;
	const today = new Date();
	const dateLabel = today.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	$: defaultListId =
		($listsStore ?? []).find((l) => l.id !== 'my-day')?.id ?? ($listsStore ?? [])[0]?.id ?? 'goal-management';

	const sortTasks = (arr) => {
		const copy = [...arr];
		if (sortMode === 'alpha') {
			copy.sort((a, b) => a.title.localeCompare(b.title));
		} else if (sortMode === 'created') {
			copy.sort((a, b) => a.created_ts - b.created_ts);
		}
		return copy;
	};

	const addTask = () => {
		if (!newTitle.trim()) return;
		tasks.createLocal(newTitle, defaultListId, { my_day: true });
		newTitle = '';
	};

	const importMarkdown = () => {
		const parsed = parseMarkdownTasks(markdown, defaultListId);
		for (const p of parsed) {
			tasks.createLocalWithOptions(p.title, p.list_id ?? defaultListId, {
				status: p.status,
				my_day: p.my_day ?? false
			});
		}
		markdown = '';
	};

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskMyDay', () => addTask());
	}

	const openDetail = (event) => {
		detailId = event.detail.id;
	};

	const closeDetail = () => {
		detailId = null;
	};

	const quickAdd = () => {
		if (!quickTitle.trim()) return;
		tasks.createLocal(quickTitle, defaultListId, { my_day: true });
		quickTitle = '';
	};
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">{dateLabel}</p>
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
		<div class="sorter">
			<span>Sort</span>
			<select bind:value={sortMode} aria-label="Sort tasks">
				<option value="created">Creation</option>
				<option value="alpha">Alphabetical</option>
			</select>
		</div>
		<details class="importer">
			<summary>Import from markdown</summary>
			<p class="hint">Format: <code>- [ ] Task title #list-id @myday</code> (use [x] for done)</p>
			<textarea bind:value={markdown} rows="4" placeholder="- [ ] Write proposal #tasks @myday"></textarea>
			<button type="button" on:click={importMarkdown} disabled={!markdown.trim()}>Import</button>
		</details>
	</div>
</header>

<section class="block">
	<div class="section-title">Planned</div>
	<div class="stack">
			{#if sortTasks($myDayPending)?.length}
			{#each sortTasks($myDayPending) as task (task.id)}
				<TaskRow {task} on:openDetail={openDetail} />
			{/each}
		{:else}
			<p class="empty">Nothing scheduled. Add a task to My Day.</p>
		{/if}
	</div>
</section>

<section class="block">
	<div class="section-title">Completed ({$myDayCompleted?.length ?? 0})</div>
	<div class="stack" data-testid="completed-section">
			{#if sortTasks($myDayCompleted)?.length}
			{#each sortTasks($myDayCompleted) as task (task.id)}
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
			placeholder="Add a task to My Day"
			bind:value={quickTitle}
			autocomplete="off"
			on:keydown={(e) => e.key === 'Enter' && quickAdd()}
		/>
		<button type="button" on:click={quickAdd}>Add</button>
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
		margin-top: 12px;
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

	.sorter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: #cbd5e1;
	}

	.sorter select {
		background: #0f172a;
		color: #e2e8f0;
		border: 1px solid #1f2937;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.mobile-add {
		display: none;
	}

	@media (max-width: 900px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}

		.actions {
			width: 100%;
			display: grid;
			grid-template-columns: 1fr;
			gap: 10px;
		}

		.add {
			width: 100%;
		}

		.add input,
		.actions button {
			width: 100%;
		}

		.importer {
			width: 100%;
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
			border-radius: 14px;
			padding: 8px 10px;
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 8px;
			box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
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
			background: #1d4ed8;
			color: white;
			border: none;
			border-radius: 10px;
			padding: 10px 12px;
			cursor: pointer;
		}

		.stack {
			padding-bottom: 86px;
		}
	}
</style>
