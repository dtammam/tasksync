<script lang="ts">
	// @ts-nocheck
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { auth } from '$lib/stores/auth';
	import { myDayCompleted, myDayMissed, myDayPending, tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { getTask } from '$lib/stores/tasks';
	import { myDaySuggestions } from '$lib/stores/tasks';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
	import { onDestroy } from 'svelte';

	const listsStore = lists;
	let quickTitle = '';
	let sortMode = 'created';
	let sortDirection = 'asc';
	let sortLoaded = false;
	let detailId = null;
	let showSuggestions = false;
	let missedActionError = '';
	let deletingMissedId = '';
	const MY_DAY_SORT_KEY = 'tasksync:sort:myday';
	const MY_DAY_SORT_DIRECTION_KEY = 'tasksync:sort:myday:direction';
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

	const sortTasks = (arr, mode = sortMode, direction = sortDirection) => {
		const copy = [...arr];
		const isAscending = direction !== 'desc';
		if (mode === 'alpha') {
			copy.sort((a, b) => {
				const byTitle = compareAlpha(a.title, b.title);
				if (byTitle === 0) {
					return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
				}
				return isAscending ? byTitle : byTitle * -1;
			});
		} else if (mode === 'created') {
			copy.sort((a, b) => (isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts));
		}
		return copy;
	};

	$: sortedPending = sortTasks($myDayPending ?? [], sortMode, sortDirection);
	$: sortedMissed = sortTasks($myDayMissed ?? [], sortMode, sortDirection);
	$: sortedCompleted = sortTasks($myDayCompleted ?? [], sortMode, sortDirection);
	$: copyLines = [
		...sortedMissed.map((task) => `- [ ] ${task.title}`),
		...sortedPending.map((task) => `- [ ] ${task.title}`),
		...sortedCompleted.map((task) => `- [x] ${task.title}`)
	];
	const copyProvider = () => copyLines;

	$: if (typeof window !== 'undefined' && !sortLoaded) {
		const saved = localStorage.getItem(MY_DAY_SORT_KEY);
		const savedDirection = localStorage.getItem(MY_DAY_SORT_DIRECTION_KEY);
		if (saved === 'alpha' || saved === 'created') {
			sortMode = saved;
		}
		if (savedDirection === 'asc' || savedDirection === 'desc') {
			sortDirection = savedDirection;
		}
		sortLoaded = true;
	}

	$: if (typeof window !== 'undefined' && sortLoaded) {
		localStorage.setItem(MY_DAY_SORT_KEY, sortMode);
		localStorage.setItem(MY_DAY_SORT_DIRECTION_KEY, sortDirection);
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

	$: if (typeof window !== 'undefined') {
		Reflect.set(window, '__copyTasksAsJoplin', copyProvider);
	}

	onDestroy(() => {
		if (typeof window !== 'undefined' && Reflect.get(window, '__copyTasksAsJoplin') === copyProvider) {
			Reflect.deleteProperty(window, '__copyTasksAsJoplin');
		}
	});
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
				<label>
					<span>Order</span>
					<select bind:value={sortDirection} aria-label="Sort direction">
						<option value="asc">Ascending</option>
						<option value="desc">Descending</option>
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
	.page-content { padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 128px); }

	.page-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 12px;
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
		font-size: 34px;
		line-height: 1.02;
		letter-spacing: -0.04em;
		font-weight: 640;
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

	.actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-left: auto; }
	.actions .sorter { display: flex; flex-direction: column; gap: 4px; }
	.sorter label { display: inline-flex; align-items: center; gap: 8px; }
	.sorter span { font-size: 11px; color: var(--app-muted); }
	.sorter select {
		background: var(--surface-1);
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: var(--ring-shadow);
	}

	.block {
		margin-top: 14px;
		padding: 12px;
		border-radius: 16px;
		border: 1px solid var(--border-1);
		background: var(--surface-1);
		box-shadow: var(--soft-shadow);
	}

	.section-title { color: var(--app-muted); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px; }
	.missed-block .section-title { color: #fbbf24; }
	.stack { display: grid; gap: 10px; }

	.missed-item {
		display: grid;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--border-1);
		border-radius: 12px;
		background: linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 92%, #f59e0b 8%), var(--surface-2));
	}

	.missed-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid color-mix(in oklab, #f59e0b 30%, var(--border-1));
		border-radius: 14px;
		background: color-mix(in oklab, var(--surface-2) 88%, #f59e0b 12%);
	}

	.missed-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
	.missed-actions button,
	.suggestions-toggle,
	.panel-head .ghost.tiny {
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
		border-radius: 999px;
		padding: 6px 11px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.missed-actions button:hover,
	.suggestions-toggle:hover,
	.panel-head .ghost.tiny:hover,
	.suggestion button:hover,
	.mobile-add button:hover {
		transform: translateY(-1px);
		filter: brightness(1.11);
	}

	.missed-actions button.ghost {
		color: var(--app-muted);
	}

	.missed-actions button.danger { border-color: #7f1d1d; color: #fecaca; }
	.missed-actions button:disabled { opacity: 0.6; cursor: not-allowed; }
	.missed-error { margin: 0; color: #fda4af; font-size: 12px; }

	.suggestions { display: grid; gap: 10px; }
	.suggestion {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		background: color-mix(in oklab, var(--surface-1) 95%, white 5%);
		border: 1px solid var(--border-1);
		border-radius: 12px;
		padding: 10px 12px;
		box-shadow: var(--ring-shadow);
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
		box-shadow: var(--soft-shadow);
	}

	.suggestions-panel {
		width: min(430px, calc(100vw - 28px));
		max-height: min(50vh, 430px);
		overflow: auto;
		background: color-mix(in oklab, var(--surface-2) 95%, white 3%);
		border: 1px solid var(--border-2);
		border-radius: 13px;
		padding: 12px;
		box-shadow: var(--soft-shadow);
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
		border: 1px solid var(--border-2);
		border-radius: 18px;
		padding: 12px;
		box-shadow: var(--soft-shadow);
	}

	.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; color: var(--app-text); }
	.suggestion .title { margin: 0; font-weight: 650; }
	.suggestion .meta { margin: 2px 0 0; color: var(--app-muted); font-size: 13px; }

	.suggestion .meta {
		margin: 2px 0 0;
		color: var(--app-muted);
		font-size: 13px;
	}

	.suggestion button,
	.mobile-add button {
		background: linear-gradient(180deg, #1e40af, #1d4ed8);
		color: white;
		border: 1px solid rgba(147, 197, 253, 0.4);
		padding: 10px 12px;
		border-radius: 11px;
		cursor: pointer;
		box-shadow: 0 8px 20px rgba(37, 99, 235, 0.28);
	}

	.empty {
		color: var(--app-muted);
		margin: 0;
		padding: 14px;
		background: linear-gradient(180deg, var(--surface-2), color-mix(in oklab, var(--surface-2) 88%, black 12%));
		border: 1px dashed var(--border-1);
		border-radius: 12px;
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
		background: linear-gradient(180deg, var(--surface-1), color-mix(in oklab, var(--surface-1) 88%, black 12%));
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: var(--ring-shadow);
	}

	.sorter span {
		font-size: 11px;
		color: var(--app-muted);
	}
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
		white-space: nowrap;
		min-width: 92px;
		height: 46px;
		font-weight: 600;
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
			font-size: 28px;
		}
	}
</style>
