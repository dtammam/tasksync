<script lang="ts">
	// @ts-nocheck
	import { page } from '$app/stores';
	import TaskRow from '$lib/components/TaskRow.svelte';
import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
import { tasks, tasksByList, getTask } from '$lib/stores/tasks';
import { findListName } from '$lib/stores/lists';
import { auth } from '$lib/stores/auth';
import { members } from '$lib/stores/members';
import { uiPreferences } from '$lib/stores/preferences';

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
	tasks.createLocal(quickTitle, activeList, { assignee_user_id: resolvedAssignee || $auth.user?.user_id });
	quickTitle = '';
};

$: quickAddMembers = $members?.length ? $members : $auth.user ? [$auth.user] : [];
const defaultAssignee = (currentUser, availableMembers) => {
	if (!currentUser) return '';
	if (currentUser.role === 'contributor') {
		return availableMembers.find((m) => m.role === 'admin')?.user_id ?? currentUser.user_id;
	}
	return currentUser.user_id;
};
$: resolvedAssignee = defaultAssignee($auth.user, quickAddMembers);

if (typeof window !== 'undefined') {
	Reflect.set(window, '__addTaskList', () => quickAdd());
	Reflect.set(window, '__addTaskListWithTitle', (title) => {
		const activeList = listId || window.location.pathname.split('/').pop();
		if (!activeList) return;
		tasks.createLocal(title, activeList, { assignee_user_id: resolvedAssignee || $auth.user?.user_id });
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
				<span>Sort by</span>
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
			<label>
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
		align-items: center;
		margin-bottom: 18px;
		gap: 12px;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
	}

	.sorter label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.sorter span {
		font-size: 11px;
		color: #94a3b8;
	}

	.sorter select {
		background: #0f172a;
		color: #e2e8f0;
		border: 1px solid #1f2937;
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
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
		left: var(--sidebar-offset, 0px);
		right: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
		padding: 0 14px;
		z-index: 15;
		pointer-events: none;
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
		pointer-events: auto;
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
			gap: 8px;
		}

		.stack {
			padding-bottom: 88px;
		}

		.sorter span {
			display: none;
		}

		h1 {
			font-size: 24px;
		}
	}
</style>
