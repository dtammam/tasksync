<script lang="ts">
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import { tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';

	export let task;

	const dispatch = createEventDispatcher();
	let editing = false;
	let titleDraft = task.title;

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
</script>

<div
	class="task"
	data-testid="task-row"
	title={`Created ${new Date(task.created_ts).toLocaleString()}\nUpdated ${new Date(task.updated_ts).toLocaleString()}`}
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
			<span>{badge}</span>
			{#if task.due_date}
				<span class="chip subtle">Due {task.due_date}</span>
			{/if}
			{#if task.recurrence_id}
				<span class="chip subtle">{task.recurrence_id}</span>
			{/if}
			<label class="chip toggle">
				<input type="checkbox" checked={task.my_day} on:change={toggleMyDay} />
				My Day
			</label>
			<span class="chip subtle">
				List:
				<select on:change={updateList} title="Move task to list">
					{#each $lists as list}
						<option value={list.id} selected={list.id === task.list_id}>{list.name}</option>
					{/each}
				</select>
			</span>
			<span class={`chip ${task.dirty ? 'pending' : 'synced'}`} aria-live="polite">
				{task.dirty ? 'Pending sync' : justSaved ? 'Saved' : 'Synced'}
			</span>
			<button class="chip ghost" type="button" on:click={openDetail}>Details</button>
		</div>
	</div>
</div>

<style>
	.task {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 10px;
		background: #0f172a;
		border: 1px solid #1f2937;
		border-radius: 12px;
		padding: 10px 12px;
		align-items: center;
	}

	.status {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 1px solid #334155;
		background: #0b1221;
		color: #e2e8f0;
		cursor: pointer;
	}

	.meta .title {
		font-weight: 600;
		color: #e2e8f0;
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.sub {
		display: flex;
		gap: 8px;
		color: #94a3b8;
		font-size: 12px;
		margin-top: 4px;
		align-items: center;
	}

	.chip {
		padding: 2px 6px;
		border-radius: 8px;
		background: #1f2937;
		color: #cbd5e1;
	}

	.chip.subtle {
		background: #0b1221;
		border: 1px solid #1e293b;
		color: #94a3b8;
	}

	.chip.toggle {
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}

	.chip.pending {
		background: #92400e;
		border: 1px solid #f59e0b;
		color: #ffedd5;
	}

	.chip.synced {
		background: #0b3a2a;
		border: 1px solid #10b981;
		color: #d1fae5;
	}

	select {
		background: #0b1221;
		border: 1px solid #1e293b;
		color: #e2e8f0;
		border-radius: 6px;
		padding: 2px 6px;
	}

	input[type='checkbox'] {
		accent-color: #1d4ed8;
		cursor: pointer;
	}

	.tags {
		color: #c7d2fe;
		font-size: 13px;
	}

	.hint {
		color: #94a3b8;
		font-size: 12px;
		margin: 4px 0 0;
	}

	.left {
		display: flex;
		align-items: flex-start;
	}

	.task {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		background: #0f172a;
		border: 1px solid #1f2937;
		border-radius: 12px;
		padding: 10px 12px;
		align-items: start;
	}

	@media (max-width: 960px) {
		.task {
			grid-template-columns: auto 1fr;
			gap: 10px;
		}
	}

	.icon-btn {
		background: none;
		border: none;
		color: #94a3b8;
		cursor: pointer;
		padding: 4px;
		border-radius: 6px;
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
		min-width: 200px;
	}

	.title-text.link {
		color: #60a5fa;
		text-decoration: underline;
	}
</style>
