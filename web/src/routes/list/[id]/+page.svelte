<script lang="ts">
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
	import ImportTasksModal from '$lib/components/ImportTasksModal.svelte';
	import { auth } from '$lib/stores/auth';
	import { tasks, tasksByList } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { uiPreferences } from '$lib/stores/preferences';
	import type { Task } from '$shared/types/task';

	let quickTitle = '';
	let detailId: string | null = null;
	let importOpen = false;
	let listActionMessage = '';

	$: listId = $page.params.id ?? '';
	$: listTasks = tasksByList(listId);
	$: listName = $lists.find((l) => l.id === listId)?.name ?? 'List';
	$: detailTask = detailId ? ($tasks.find((t) => t.id === detailId) ?? null) : null;

	const compareAlpha = (left: string | undefined, right: string | undefined): number => {
		const a = (left ?? '').trim().toLowerCase();
		const b = (right ?? '').trim().toLowerCase();
		if (a === b) return 0;
		return a < b ? -1 : 1;
	};

	const compareStarredFirst = (left: Task, right: Task): number => {
		const leftStarred = (left?.priority ?? 0) > 0;
		const rightStarred = (right?.priority ?? 0) > 0;
		if (leftStarred === rightStarred) return 0;
		return leftStarred ? -1 : 1;
	};

	const sortTasks = (arr: Task[], mode = 'created', direction = 'asc'): Task[] => {
		const copy = [...arr];
		const isAscending = direction !== 'desc';
		copy.sort((a, b) => {
			const starredOrder = compareStarredFirst(a, b);
			if (starredOrder !== 0) return starredOrder;

			if (mode === 'due_date') {
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
			}

			if (mode === 'alpha') {
				const byTitle = compareAlpha(a.title, b.title);
				if (byTitle === 0) {
					return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
				}
				return isAscending ? byTitle : byTitle * -1;
			}

			return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
		});
		return copy;
	};

	$: pendingTasks = sortTasks(
		($listTasks ?? []).filter((task) => task.status === 'pending'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);
	$: completedTasks = sortTasks(
		($listTasks ?? []).filter((task) => task.status === 'done'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);

	$: isContributor = $auth.user?.role === 'contributor';
	$: contributorUserId = isContributor ? $auth.user?.user_id : undefined;
	$: uncheckEligibleCount = completedTasks.filter(
		(task) => !contributorUserId || task.created_by_user_id === contributorUserId
	).length;

	$: copyLines = [...pendingTasks, ...completedTasks].map(
		(task) => `- [${task.status === 'done' ? 'x' : ' '}] ${task.title}`
	);
	const copyProvider = () => copyLines;

	const quickAdd = () => {
		const title = quickTitle.trim();
		if (!title) return;
		tasks.createLocalWithOptions(title, listId);
		quickTitle = '';
	};

	const openDetail = (event: CustomEvent<{ id: string }>) => (detailId = event.detail.id);
	const closeDetail = () => (detailId = null);

	const openImport = () => {
		importOpen = true;
		listActionMessage = '';
	};

	const uncheckAllCompleted = () => {
		listActionMessage = '';
		const changed = tasks.uncheckAllInList(listId, contributorUserId ? { ownerUserId: contributorUserId } : undefined);
		if (!changed) return;
		listActionMessage = `Unchecked ${changed} completed task${changed === 1 ? '' : 's'}.`;
	};

	const onImported = (event: CustomEvent<{ message: string }>) => {
		listActionMessage = event.detail.message;
	};

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskList', () => quickAdd());
		Reflect.set(window, '__addTaskListWithTitle', (title: unknown) => {
			const nextTitle = String(title ?? '').trim();
			if (!nextTitle) return;
			tasks.createLocalWithOptions(nextTitle, listId);
		});
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
					on:change={(event) => uiPreferences.setListSort({ mode: (event.currentTarget as HTMLSelectElement).value as import('$shared/types/settings').ListSortMode })}
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
					on:change={(event) => uiPreferences.setListSort({ direction: (event.currentTarget as HTMLSelectElement).value as import('$shared/types/settings').ListSortDirection })}
				>
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</label>
		</div>
		<div class="tools">
			<button
				type="button"
				class="ghost-pill"
				data-testid="list-import-open"
				on:click={openImport}
			>
				Import
			</button>
			<button
				type="button"
				class="ghost-pill"
				data-testid="list-uncheck-all"
				on:click={uncheckAllCompleted}
				disabled={uncheckEligibleCount === 0}
			>
				Uncheck all
			</button>
		</div>
	</div>
</header>

{#if listActionMessage}
	<p class="ok-msg" data-testid="list-action-message">{listActionMessage}</p>
{/if}

<section class="block">
	<div class="section-title">Pending</div>
	<div class="stack">
		{#if pendingTasks.length}
			{#each pendingTasks as task (task.id)}
				<div in:fly={{ y: -6, duration: 150 }} out:fade={{ duration: 150 }}>
					<TaskRow {task} on:openDetail={openDetail} />
				</div>
			{/each}
		{:else}
			<p class="empty">No pending tasks.</p>
		{/if}
	</div>
</section>

{#if $uiPreferences.showCompleted}
<section class="block">
	<div class="section-title">Completed</div>
	<div class="stack" data-testid="completed-section">
		{#if completedTasks.length}
			{#each completedTasks as task (task.id)}
				<div transition:fade={{ duration: 150 }}>
					<TaskRow {task} on:openDetail={openDetail} />
				</div>
			{/each}
		{:else}
			<p class="empty subtle">No completed tasks yet.</p>
		{/if}
	</div>
</section>
{/if}

{#if importOpen}
	<ImportTasksModal
		{listId}
		{listName}
		on:close={() => (importOpen = false)}
		on:imported={onImported}
	/>
{/if}

<TaskDetailDrawer task={detailTask} open={!!detailTask} on:close={closeDetail} />

<div class="mobile-add" aria-label="Quick add">
	<div class="bar">
		<input
			type="text"
			placeholder={`Add a task to ${listName}`}
			bind:value={quickTitle}
			autocomplete="off"
			data-testid="new-task-input"
			on:keydown={(event) => event.key === 'Enter' && quickAdd()}
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

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 10px;
		font-weight: 700;
		color: var(--app-muted);
		margin: 0;
	}

	h1 {
		margin: 4px 0;
		font-size: 32px;
		line-height: 1.04;
	}

	.sub {
		margin: 0;
		color: var(--app-muted);
	}

	.actions {
		display: flex;
		gap: 10px;
		align-items: flex-start;
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
		background: linear-gradient(
			180deg,
			var(--surface-1),
			color-mix(in oklab, var(--surface-1) 88%, black 12%)
		);
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: var(--ring-shadow);
	}

	.tools {
		display: flex;
		gap: 6px;
	}

	.ghost-pill {
		border-radius: 999px;
		padding: 8px 12px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
	}

	.ghost-pill:hover,
	.mobile-add button:hover {
		transform: translateY(-1px);
		filter: brightness(1.07);
	}

	.ghost-pill:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		filter: none;
	}

	.block {
		margin-top: 16px;
	}

	.section-title {
		color: var(--app-muted);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 700;
		margin-bottom: 8px;
	}

	.stack {
		display: grid;
		gap: 12px;
	}

	.empty {
		color: var(--app-muted);
		margin: 0;
		padding: 14px;
		background: color-mix(in oklab, var(--surface-2) 92%, black 8%);
		border: 1px dashed var(--border-1);
		border-radius: 12px;
	}

	.empty.subtle {
		color: #7285a4;
	}

	.ok-msg {
		margin: 8px 0 0;
		color: #86efac;
		font-size: 12px;
	}

	.mobile-add {
		display: block;
		position: fixed;
		left: var(--sidebar-offset, 0px);
		right: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 10px + var(--mobile-keyboard-offset, 0px));
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

	@media (max-width: 900px) {
		.page-header {
			flex-direction: column;
			align-items: stretch;
		}

		.actions {
			margin-left: 0;
			justify-content: space-between;
			align-items: center;
		}

		.order-control {
			display: none;
		}

		.tools {
			margin-left: auto;
		}

		h1 {
			font-size: 28px;
		}
	}
</style>
