<script lang="ts">
	// @ts-nocheck
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { myDayCompleted, myDayPending, tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { getTask } from '$lib/stores/tasks';
	import { myDaySuggestions } from '$lib/stores/tasks';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';

	const listsStore = lists;
	let quickTitle = '';
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

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskMyDay', () => quickAdd());
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
		<div class="sorter">
			<label>
				<span>Sort</span>
				<select bind:value={sortMode} aria-label="Sort tasks">
					<option value="created">Creation</option>
					<option value="alpha">Alphabetical</option>
				</select>
			</label>
		</div>
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

{#if $myDaySuggestions?.length}
	<section class="block">
		<div class="section-title">Suggestions</div>
		<div class="suggestions">
			{#each $myDaySuggestions as suggestion (suggestion.id)}
				<div class="suggestion">
					<div>
						<p class="title">{suggestion.title}</p>
						<p class="meta">
							{#if suggestion.due_date}
								Due {suggestion.due_date}
							{:else}
								No due date
							{/if}
						</p>
					</div>
					<button type="button" on:click={() => tasks.setMyDay(suggestion.id, true)}>Add to My Day</button>
				</div>
			{/each}
		</div>
	</section>
{/if}

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

	.actions {
		display: flex;
		gap: 6px;
		align-items: center;
		justify-content: flex-end;
		margin-left: auto;
		margin-top: 2px;
	}

	.actions .sorter {
		display: flex;
		flex-direction: column;
		gap: 4px;
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

	.suggestions {
		display: grid;
		gap: 10px;
	}

	.suggestion {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		background: #0f172a;
		border: 1px solid #1f2937;
		border-radius: 12px;
		padding: 10px 12px;
	}

	.suggestion .title {
		margin: 0;
		font-weight: 600;
	}

	.suggestion .meta {
		margin: 2px 0 0;
		color: #94a3b8;
		font-size: 13px;
	}

	.suggestion button {
		background: #16a34a;
		color: white;
		border: none;
		padding: 10px 12px;
		border-radius: 10px;
		cursor: pointer;
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
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
	}

	.sorter span {
		font-size: 11px;
		color: #94a3b8;
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
		background: #1d4ed8;
		color: white;
		border: none;
		border-radius: 10px;
		padding: 10px 12px;
		cursor: pointer;
	}

	@media (max-width: 900px) {
		.page-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}

		.actions {
			width: 100%;
			justify-content: flex-start;
		}

		.stack {
			padding-bottom: 86px;
		}

		.suggestion {
			grid-template-columns: 1fr;
			gap: 8px;
		}
	}
</style>
