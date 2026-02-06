<script lang="ts">
	// @ts-nocheck
import { createEventDispatcher } from 'svelte';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import { members } from '$lib/stores/members';

export let task;

const dispatch = createEventDispatcher();
let editing = false;
let titleDraft = task.title;
let showActions = false;
let pressTimer = null;

/** @param {Event & { target: HTMLSelectElement }} event */
const updateList = (event) => {
	const select = event.target;
	tasks.moveToList(task.id, select.value);
};

/** @param {Event & { target: HTMLInputElement }} event */
const toggleMyDay = (event) => {
	const input = event.target;
	tasks.setMyDay(task.id, input.checked);
};

const badge = task.priority > 1 ? '🔥' : '•';

let justSaved = false;

const saveTitle = () => {
	if (!titleDraft.trim()) return;
	tasks.rename(task.id, titleDraft);
	editing = false;
	justSaved = true;
	setTimeout(() => (justSaved = false), 1200);
};

const openDetail = () => dispatch('openDetail', { id: task.id });

const tomorrowIso = () => {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	return d.toISOString().slice(0, 10);
};

const nextWeekIso = () => {
	const d = new Date();
	d.setDate(d.getDate() + 7);
	return d.toISOString().slice(0, 10);
};

const addTomorrow = () => tasks.setDueDate(task.id, tomorrowIso());
const addNextWeek = () => tasks.setDueDate(task.id, nextWeekIso());
const toggleStar = () => tasks.setPriority(task.id, task.priority > 0 ? 0 : 1);

const startPress = () => {
	pressTimer = setTimeout(() => {
		showActions = true;
	}, 400);
};

const endPress = () => {
	if (pressTimer) clearTimeout(pressTimer);
};

const closeActions = () => (showActions = false);

$: assigneeDisplay =
	task.assignee_user_id && members.find(task.assignee_user_id)
		? members.find(task.assignee_user_id).display
		: task.assignee_user_id;
</script>

<div
	class="task"
	data-testid="task-row"
	title={`Created ${new Date(task.created_ts).toLocaleString()}\nUpdated ${new Date(task.updated_ts).toLocaleString()}`}
	role="group"
	on:pointerdown={startPress}
	on:pointerup={endPress}
	on:pointerleave={endPress}
>
	<div class="left">
		<button
			class="status"
			aria-label="toggle task"
			on:click={() => tasks.toggle(task.id)}
			data-testid="task-toggle"
		>
			{task.status === 'done' ? '✔' : '○'}
		</button>
	</div>
	<div class="meta">
		<div class="title">
			{#if editing}
				<input
					class="title-input"
					bind:value={titleDraft}
					on:keydown={(e) => e.key === 'Enter' && saveTitle()}
					on:blur={saveTitle}
				/>
			{:else}
				{#if task.url}
					<a class="title-text link" href={task.url} target="_blank" rel="noreferrer" data-testid="task-title">{task.title}</a>
				{:else}
					<span class="title-text" data-testid="task-title">{task.title}</span>
				{/if}
				<button class="icon-btn" type="button" title="Rename task" on:click={() => (editing = true)}>
					✎
				</button>
			{/if}
			{#if task.tags.length}
				<span class="tags">{task.tags.join(', ')}</span>
			{/if}
		</div>
		<div class="sub">
			<span class="badge-dot">{badge}</span>
			{#if task.due_date}
				<span class="chip subtle due-chip">Due {task.due_date}</span>
			{/if}
			{#if task.recurrence_id}
				<span class="chip subtle recur-chip">{task.recurrence_id}</span>
			{/if}
			{#if assigneeDisplay}
				<span class="chip subtle assignee-chip">To: {assigneeDisplay}</span>
			{/if}
			<label class="chip toggle day-chip">
				<input type="checkbox" checked={task.my_day} on:change={toggleMyDay} />
				My Day
			</label>
			<span class="chip subtle list-chip">
				List:
				<select on:change={updateList} title="Move task to list">
					{#each $lists as list}
						<option value={list.id} selected={list.id === task.list_id}>{list.name}</option>
					{/each}
				</select>
			</span>
			<span class={`chip sync-chip ${task.dirty ? 'pending' : 'synced'}`} aria-live="polite">
				{task.dirty ? 'Pending sync' : justSaved ? 'Saved' : 'Synced'}
			</span>
			<button class="chip ghost details-chip" type="button" on:click={openDetail}>Details</button>
			<button class="chip ghost actions-chip" type="button" on:click={() => (showActions = !showActions)}>⋯</button>
		</div>
	</div>
	{#if showActions}
		<div class="quick">
			<button type="button" on:click={addTomorrow}>Tomorrow</button>
			<button type="button" on:click={addNextWeek}>Next week</button>
			<button type="button" on:click={toggleStar}>{task.priority > 0 ? 'Unstar' : 'Star'}</button>
			<button class="ghost" type="button" on:click={closeActions}>Close</button>
		</div>
	{/if}
</div>

<style>
	.task {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		background: linear-gradient(180deg, #0f172a, #0c1425);
		border: 1px solid #1f2937;
		border-radius: 14px;
		padding: 11px 12px;
		align-items: start;
	}

	.left {
		display: flex;
		align-items: flex-start;
		padding-top: 1px;
	}

	.status {
		width: 40px;
		height: 40px;
		min-width: 40px;
		min-height: 40px;
		border-radius: 50%;
		border: 1px solid #334155;
		background: #0b1221;
		color: #e2e8f0;
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
	}

	.meta {
		min-width: 0;
	}

	.meta .title {
		font-weight: 600;
		color: #e2e8f0;
		display: flex;
		gap: 8px;
		align-items: center;
		min-width: 0;
	}

	.title-text {
		display: block;
		min-width: 0;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sub {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		color: #94a3b8;
		font-size: 12px;
		margin-top: 6px;
		align-items: center;
	}

	.badge-dot {
		color: #64748b;
		font-size: 14px;
		line-height: 1;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 9px;
		border-radius: 999px;
		background: #1f2937;
		color: #cbd5e1;
		border: 1px solid transparent;
		white-space: nowrap;
	}

	.chip.subtle {
		background: #0b1221;
		border-color: #1e293b;
		color: #a5b4c5;
	}

	.chip.toggle {
		cursor: pointer;
	}

	.chip.pending {
		background: #92400e;
		border-color: #f59e0b;
		color: #ffedd5;
	}

	.chip.synced {
		background: #0b3a2a;
		border-color: #10b981;
		color: #d1fae5;
	}

	.list-chip select {
		background: transparent;
		border: none;
		color: inherit;
		padding: 0 2px;
		max-width: 124px;
	}

	.list-chip select:focus-visible {
		outline: none;
	}

	input[type='checkbox'] {
		accent-color: #38bdf8;
		cursor: pointer;
	}

	.tags {
		color: #c7d2fe;
		font-size: 13px;
	}

	.quick {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		margin-top: 6px;
	}

	.quick button {
		background: #0b1221;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 10px;
		padding: 8px 10px;
		cursor: pointer;
	}

	.quick button:hover {
		background: #11192b;
	}

	.quick button.ghost {
		border-color: #334155;
	}

	.icon-btn {
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		padding: 4px;
		border-radius: 6px;
		min-width: 28px;
		min-height: 28px;
	}

	.icon-btn:hover {
		background: #11192b;
		color: #e2e8f0;
	}

	.title-input {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
		min-width: 180px;
	}

	.title-text.link {
		color: #60a5fa;
		text-decoration: underline;
	}

	@media (max-width: 900px) {
		.task {
			padding: 10px;
			gap: 10px;
			border-radius: 12px;
		}

		.status {
			width: 36px;
			height: 36px;
			min-width: 36px;
			min-height: 36px;
			font-size: 15px;
		}

		.sub {
			gap: 6px;
			margin-top: 5px;
		}

		.chip {
			font-size: 11px;
			padding: 3px 8px;
		}

		.list-chip,
		.sync-chip {
			display: none;
		}

		.icon-btn {
			display: none;
		}

		.quick {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.quick button {
			font-size: 12px;
			padding: 8px 9px;
		}
	}
</style>
