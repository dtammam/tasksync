<script lang="ts">
	// @ts-nocheck
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { auth } from '$lib/stores/auth';
	import { myDayCompleted, myDayMissed, myDayPending, tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { getTask } from '$lib/stores/tasks';
	import { myDaySuggestions } from '$lib/stores/tasks';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';

	const listsStore = lists;
	let quickTitle = '';
	let sortMode = 'created';
	let sortLoaded = false;
	let detailId = null;
	let showSuggestions = false;
	let missedActionError = '';
	let deletingMissedId = '';
	const MY_DAY_SORT_KEY = 'tasksync:sort:myday';
	const compareAlpha = (left, right) => {
		const a = (left ?? '').trim().toLowerCase();
		const b = (right ?? '').trim().toLowerCase();
		if (a === b) return 0;
		return a < b ? -1 : 1;
	};
	$: detailTask = detailId ? getTask(detailId) : null;
	const today = new Date();
	const dateLabel = today.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	$: defaultListId =
		($listsStore ?? []).find((l) => l.id !== 'my-day')?.id ?? ($listsStore ?? [])[0]?.id ?? 'goal-management';

	const sortTasks = (arr, mode = sortMode) => {
		const copy = [...arr];
		if (mode === 'alpha') {
			copy.sort((a, b) => {
				const byTitle = compareAlpha(a.title, b.title);
				return byTitle === 0 ? a.created_ts - b.created_ts : byTitle;
			});
		} else if (mode === 'created') {
			copy.sort((a, b) => a.created_ts - b.created_ts);
		}
		return copy;
	};

	$: sortedPending = sortTasks($myDayPending ?? [], sortMode);
	$: sortedMissed = sortTasks($myDayMissed ?? [], sortMode);
	$: sortedCompleted = sortTasks($myDayCompleted ?? [], sortMode);

	$: if (typeof window !== 'undefined' && !sortLoaded) {
		const saved = localStorage.getItem(MY_DAY_SORT_KEY);
		if (saved === 'alpha' || saved === 'created') {
			sortMode = saved;
		}
		sortLoaded = true;
	}

	$: if (typeof window !== 'undefined' && sortLoaded) {
		localStorage.setItem(MY_DAY_SORT_KEY, sortMode);
	}

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
		if ($auth.user?.role === 'contributor') return;
		if (!quickTitle.trim()) return;
		tasks.createLocal(quickTitle, defaultListId, {
			my_day: true
		});
		quickTitle = '';
	};

	const addSuggestionToMyDay = (id) => {
		if ($auth.user?.role === 'contributor') return;
		tasks.setMyDay(id, true);
		showSuggestions = false;
	};

	const canResolveMissed = (task) => {
		if ($auth.user?.role !== 'contributor') return true;
		return !!$auth.user?.user_id && task.created_by_user_id === $auth.user.user_id;
	};

	const markMissedDone = (task) => {
		if (!canResolveMissed(task)) return;
		missedActionError = '';
		tasks.toggle(task.id);
	};

	const skipMissed = (task) => {
		if (!canResolveMissed(task) || !task.recurrence_id) return;
		missedActionError = '';
		tasks.skip(task.id);
	};

	const deleteMissed = async (task) => {
		if (!canResolveMissed(task) || deletingMissedId) return;
		deletingMissedId = task.id;
		missedActionError = '';
		try {
			await tasks.deleteRemote(task.id);
		} catch (err) {
			missedActionError = err instanceof Error ? err.message : String(err);
		} finally {
			deletingMissedId = '';
		}
	};

	$: if (!$myDaySuggestions?.length) {
		showSuggestions = false;
	}
</script>

<div class="page-content">
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

	{#if sortedMissed.length}
		<section class="block missed-block">
			<div class="section-title">Missed ({sortedMissed.length})</div>
			<div class="stack" data-testid="missed-section">
				{#each sortedMissed as task (task.id)}
					<div class="missed-item">
						<TaskRow {task} on:openDetail={openDetail} />
						<div class="missed-actions">
							{#if task.recurrence_id}
								<button
									type="button"
									class="ghost"
									on:click={() => skipMissed(task)}
									disabled={!canResolveMissed(task)}
								>
									Skip next
								</button>
							{/if}
							<button type="button" on:click={() => markMissedDone(task)} disabled={!canResolveMissed(task)}>
								Mark done
							</button>
							<button
								type="button"
								class="danger"
								on:click={() => deleteMissed(task)}
								disabled={!canResolveMissed(task) || deletingMissedId === task.id}
							>
								{deletingMissedId === task.id ? 'Deleting…' : 'Delete'}
							</button>
						</div>
					</div>
				{/each}
				{#if missedActionError}
					<p class="missed-error">{missedActionError}</p>
				{/if}
			</div>
		</section>
	{/if}

	<section class="block">
		<div class="section-title">Planned</div>
		<div class="stack">
				{#if sortedPending.length}
				{#each sortedPending as task (task.id)}
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
				{#if sortedCompleted.length}
				{#each sortedCompleted as task (task.id)}
					<TaskRow {task} completedContext={true} on:openDetail={openDetail} />
				{/each}
			{:else}
				<p class="empty subtle">No completed tasks yet.</p>
			{/if}
		</div>
	</section>
</div>

{#if $myDaySuggestions?.length}
	<div class="suggestions-flyout">
		{#if showSuggestions}
			<div class="suggestions-panel">
				<div class="panel-head">
					<strong>Suggestions</strong>
					<button type="button" class="ghost tiny" on:click={() => (showSuggestions = false)}>Close</button>
				</div>
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
							<button
								type="button"
								on:click={() => addSuggestionToMyDay(suggestion.id)}
								disabled={$auth.user?.role === 'contributor'}
							>
								Add
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		<button class="suggestions-toggle" type="button" on:click={() => (showSuggestions = !showSuggestions)}>
			Suggestions {$myDaySuggestions.length}
		</button>
	</div>
{/if}

<TaskDetailDrawer task={detailTask} open={!!detailTask} on:close={closeDetail} />

<div class="mobile-add" aria-label="Quick add">
	<div class="bar">
		<input
			type="text"
			placeholder={$auth.user?.role === 'contributor' ? 'Contributors add tasks from lists' : 'Add a task to My Day'}
			bind:value={quickTitle}
			autocomplete="off"
			data-testid="new-task-input"
			disabled={$auth.user?.role === 'contributor'}
			on:keydown={(e) => e.key === 'Enter' && quickAdd()}
		/>
		<button type="button" data-testid="new-task-submit" on:click={quickAdd} disabled={$auth.user?.role === 'contributor'}>
			Add
		</button>
	</div>
</div>

<style>
	.page-content {
		padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 128px);
	}

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 10px;
		gap: 12px;
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
		font-size: 28px;
		letter-spacing: -0.02em;
	}

	.sub {
		margin: 0;
		color: var(--app-muted);
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

	.sorter label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.block {
		margin-top: 14px;
	}

	.missed-block .section-title {
		color: #f59e0b;
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

	.missed-item {
		display: grid;
		gap: 6px;
	}

	.missed-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.missed-actions button {
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
		border-radius: 999px;
		padding: 5px 10px;
		font-size: 12px;
		cursor: pointer;
	}

	.missed-actions button.ghost {
		color: #cbd5e1;
	}

	.missed-actions button.danger {
		border-color: #7f1d1d;
		color: #fecaca;
	}

	.missed-actions button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.missed-error {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}

	.suggestions {
		display: grid;
		gap: 10px;
	}

	.suggestion {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		border-radius: 12px;
		padding: 10px 12px;
	}

	.suggestions-flyout {
		position: fixed;
		right: 14px;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		display: grid;
		gap: 10px;
		justify-items: end;
		z-index: 16;
	}

	.suggestions-toggle {
		background: var(--surface-1);
		color: var(--app-text);
		border: 1px solid var(--border-2);
		border-radius: 999px;
		padding: 8px 14px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
	}

	.suggestions-panel {
		width: min(420px, calc(100vw - 28px));
		max-height: min(50vh, 420px);
		overflow: auto;
		background: var(--surface-2);
		border: 1px solid var(--border-2);
		border-radius: 14px;
		padding: 12px;
		box-shadow: 0 16px 30px rgba(0, 0, 0, 0.35);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
		color: var(--app-text);
	}

	.panel-head .ghost.tiny {
		background: var(--surface-1);
		color: var(--app-text);
		border: 1px solid var(--border-2);
		border-radius: 999px;
		padding: 5px 10px;
		font-size: 12px;
		cursor: pointer;
	}

	.suggestion .title {
		margin: 0;
		font-weight: 600;
	}

	.suggestion .meta {
		margin: 2px 0 0;
		color: var(--app-muted);
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
		color: var(--app-muted);
		margin: 0;
		padding: 12px;
		background: var(--surface-2);
		border: 1px dashed var(--border-1);
		border-radius: 10px;
	}

	.empty.subtle {
		color: #64748b;
	}

	.sorter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--app-text);
	}

	.sorter select {
		background: var(--surface-1);
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
	}

	.sorter span {
		font-size: 11px;
		color: var(--app-muted);
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
		background: var(--surface-1);
		border: 1px solid var(--border-1);
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
		background: var(--surface-2);
		border: 1px solid var(--border-1);
		color: var(--app-text);
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
		.page-content {
			padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 108px);
		}

		.page-header {
			flex-direction: row;
			align-items: center;
			gap: 8px;
		}

		.actions {
			margin-left: 0;
		}

		.suggestion {
			grid-template-columns: 1fr;
			gap: 8px;
		}

		.suggestions-flyout {
			right: 10px;
			left: auto;
			bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
		}

		h1 {
			font-size: 24px;
		}
	}
</style>
