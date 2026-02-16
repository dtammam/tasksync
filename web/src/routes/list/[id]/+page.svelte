<script lang="ts">
	// @ts-nocheck
	import { page } from '$app/stores';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
	import { tasks, tasksByList, getTask } from '$lib/stores/tasks';
	import { findListName } from '$lib/stores/lists';
	import { uiPreferences } from '$lib/stores/preferences';
	import { onDestroy } from 'svelte';

	let quickTitle = '';
	let detailId = null;
	$: listId = $page.params.id;
	let listTasks = tasksByList(listId);
	$: listTasks = tasksByList(listId);
	$: listName = findListName(listId);
	const compareAlpha = (left, right) => {
		const a = (left ?? '').trim().toLowerCase();
		const b = (right ?? '').trim().toLowerCase();
		if (a === b) return 0;
		return a < b ? -1 : 1;
	};

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

	const sortTasks = (arr, mode = 'created', direction = 'asc') => {
		const copy = [...arr];
		const isAscending = direction !== 'desc';
		if (mode === 'due_date') {
			copy.sort((a, b) => {
				const dueA = typeof a.due_date === 'string' ? a.due_date : '';
				const dueB = typeof b.due_date === 'string' ? b.due_date : '';
				const hasDueA = !!dueA;
				const hasDueB = !!dueB;
				if (hasDueA && hasDueB && dueA !== dueB) {
					return isAscending ? (dueA < dueB ? -1 : 1) : dueA > dueB ? -1 : 1;
				}
				if (hasDueA !== hasDueB) {
					// Keep undated tasks at the bottom for both ascending and descending due-date sort.
					return hasDueA ? -1 : 1;
				}
				return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
			});
		} else if (mode === 'alpha') {
			copy.sort((a, b) => {
				const byTitle = compareAlpha(a.title, b.title);
				if (byTitle === 0) {
					return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
				}
				return isAscending ? byTitle : byTitle * -1;
			});
		} else {
			copy.sort((a, b) => (isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts));
		}
		return copy;
	};
	$: pendingTasks = sortTasks(
		($listTasks ?? []).filter((t) => t.status === 'pending'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);
	$: completedTasks = sortTasks(
		($listTasks ?? []).filter((t) => t.status === 'done'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);
	$: copyLines = [...pendingTasks, ...completedTasks].map(
		(task) => `- [${task.status === 'done' ? 'x' : ' '}] ${task.title}`
	);
	const copyProvider = () => copyLines;
	$: if (typeof window !== 'undefined') {
		Reflect.set(window, '__copyTasksAsJoplin', copyProvider);
	}

	onDestroy(() => {
		if (typeof window !== 'undefined' && Reflect.get(window, '__copyTasksAsJoplin') === copyProvider) {
			Reflect.deleteProperty(window, '__copyTasksAsJoplin');
		}
	});
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">List</p>
		<h1>{listName}</h1>
		<p class="sub">Tasks in this list.</p>
	</div>
	<div class="actions">
		<div class="sorter">
			<label>
				<span>Sort</span>
				<select
					value={$uiPreferences.listSort.mode}
					data-testid="list-sort-mode"
					aria-label="Sort tasks"
					on:change={(e) => uiPreferences.setListSort({ mode: e.target.value })}
				>
					<option value="created">Creation</option>
					<option value="alpha">Alphabetical</option>
					<option value="due_date">Due date</option>
				</select>
			</label>
			<label class="order-control">
				<span>Order</span>
				<select
					value={$uiPreferences.listSort.direction}
					data-testid="list-sort-direction"
					aria-label="Sort direction"
					on:change={(e) => uiPreferences.setListSort({ direction: e.target.value })}
				>
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</label>
		</div>
	</div>
</header>

<section class="block">
	<div class="section-title">Pending</div>
	<div class="stack">
		{#if pendingTasks.length}
			{#each pendingTasks as task (task.id)}
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
		{#if completedTasks.length}
			{#each completedTasks as task (task.id)}
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
		align-items: flex-start;
		margin-bottom: 12px;
		gap: 12px;
	}

	.actions {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
	}

	.actions .sorter {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.sorter label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.sorter span {
		font-size: 11px;
		color: var(--app-muted);
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

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 11px;
		color: var(--app-muted);
		margin: 0;
	}

	h1 {
		margin: 4px 0;
		font-size: 34px;
		line-height: 1.02;
		letter-spacing: -0.04em;
		font-weight: 640;
	}

	.sub {
		margin: 0;
		color: var(--app-muted);
	}
	.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 10px; font-weight: 700; color: var(--app-muted); margin: 0; }
	h1 { margin: 4px 0; font-size: 32px; line-height: 1.04; }
	.sub { margin: 0; color: var(--app-muted); }

	.block {
		margin-top: 14px;
	}

	.section-title {
		color: var(--app-muted);
		font-size: 13px;
		margin-bottom: 6px;
	}

	.stack {
		display: grid;
		gap: 10px;
	}

	.empty {
		color: var(--app-muted);
		margin: 0;
		padding: 14px;
		background: linear-gradient(180deg, var(--surface-2), color-mix(in oklab, var(--surface-2) 88%, black 12%));
		border: 1px dashed var(--border-1);
		border-radius: 12px;
	}

	.section-title { color: var(--app-muted); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700; margin-bottom: 8px; }
	.stack { display: grid; gap: 10px; }

	.empty { color: var(--app-muted); margin: 0; padding: 14px; background: color-mix(in oklab, var(--surface-2) 92%, black 8%); border: 1px dashed var(--border-1); border-radius: 12px; }
	.empty.subtle { color: #7285a4; }

	.mobile-add {
		display: block;
		position: fixed;
		left: var(--sidebar-offset, 0px);
		right: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
		padding: 0 14px;
		z-index: 15;
		pointer-events: none;
	}

	.mobile-add .bar {
		background: color-mix(in oklab, var(--surface-1) 94%, white 6%);
		border: 1px solid var(--border-1);
		border-radius: 17px;
		padding: 6px;
		display: flex;
		gap: 6px;
		align-items: center;
		box-shadow: var(--soft-shadow);
		max-width: 720px;
		margin: 0 auto;
		pointer-events: auto;
	}

	.mobile-add input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		color: var(--app-text);
		border-radius: 10px;
		padding: 0 12px;
		height: 46px;
	}

	.mobile-add input:focus-visible {
		outline: none;
	}

	.mobile-add .bar:focus-within {
		border-color: var(--focus);
	}

	.mobile-add button {
		background: color-mix(in oklab, var(--surface-accent) 82%, var(--surface-1) 18%);
		color: var(--app-text);
		border: 1px solid color-mix(in oklab, var(--surface-accent) 58%, var(--border-2) 42%);
		border-radius: 12px;
		padding: 0 16px;
		white-space: nowrap;
		min-width: 96px;
		height: 46px;
		font-weight: 650;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.mobile-add button:hover {
		transform: translateY(-1px);
		filter: brightness(1.07);
	}
	.mobile-add button:hover { transform: translateY(-1px); filter: brightness(1.07); }

	@media (max-width: 900px) {
		.page-header {
			flex-direction: row;
			align-items: center;
			gap: 8px;
		}

		.actions {
			margin-left: 0;
		}

		.stack {
			padding-bottom: 88px;
		}

		.order-control {
			display: none;
		}

		h1 {
			font-size: 28px;
		}
	}
</style>
