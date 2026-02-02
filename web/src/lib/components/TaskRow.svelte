<script lang="ts">
	// @ts-nocheck
	import { tasks } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';

	export let task;

const toggle = () => {
	tasks.toggle(task.id);
};

	/** @param {Event & { target: HTMLSelectElement }} event */
	const updateList = (event) => {
		const select = event.target;
		if (task.local) {
			tasks.moveToList(task.id, select.value);
		}
	};

	/** @param {Event & { target: HTMLInputElement }} event */
	const toggleMyDay = (event) => {
		const input = event.target;
		tasks.setMyDay(task.id, input.checked);
	};

	const badge = task.priority > 1 ? '🔥' : '•';

let newAttachment = '';
let urlInput = task.url ?? '';
let recurrence = task.recurrence_id ?? '';
let justSaved = false;

	const addAttachment = () => {
		const trimmed = newAttachment.trim();
		if (!trimmed) return;
		const name = trimmed.split('/').filter(Boolean).pop() ?? 'attachment';
		const ref = {
			id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
			name,
			size: 0,
			mime: 'text/uri-list',
			hash: '',
			path: trimmed
		};
		const next = [...(task.attachments ?? []), ref];
		tasks.updateDetails(task.id, { attachments: next });
		newAttachment = '';
	};

const saveDetails = () => {
	tasks.updateDetails(task.id, {
		url: urlInput || undefined,
		recurrence_id: recurrence || undefined,
		attachments: task.attachments,
		due_date: task.due_date,
		notes: task.notes
	});
	justSaved = true;
	setTimeout(() => (justSaved = false), 1500);
};

const skip = () => {
	tasks.skip(task.id);
	justSaved = true;
	setTimeout(() => (justSaved = false), 1500);
};

const handleRowClick = (event) => {
	const target = event.target;
	const tag = target?.tagName?.toLowerCase?.() ?? '';
	if (['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'label'].includes(tag)) return;
	toggle();
};
</script>

<div
	class="task"
	data-testid="task-row"
	title={`Created ${new Date(task.created_ts).toLocaleString()}\nUpdated ${new Date(task.updated_ts).toLocaleString()}`}
	on:click={handleRowClick}
	on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleRowClick(e)}
	role="button"
	tabindex="0"
	aria-pressed={task.status === 'done'}
>
	<button class="status" aria-label="toggle task" on:click|stopPropagation={toggle} data-testid="task-toggle">
		{task.status === 'done' ? '✔' : '○'}
	</button>
	<div class="meta">
		<div class="title">
			{#if task.url}
				<a class="title-text link" href={task.url} target="_blank" rel="noreferrer" data-testid="task-title">{task.title}</a>
			{:else}
				<span class="title-text" data-testid="task-title">{task.title}</span>
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
				<select
					on:change={updateList}
					disabled={!task.local}
					title={!task.local ? 'List changes sync only before first push' : 'Move task to list'}
				>
					{#each $lists as list}
						<option value={list.id} selected={list.id === task.list_id}>{list.name}</option>
					{/each}
				</select>
			</span>
			<span class={`chip ${task.dirty ? 'pending' : 'synced'}`} aria-live="polite">
				{task.dirty ? 'Pending sync' : justSaved ? 'Saved' : 'Synced'}
			</span>
		</div>
	</div>
	<details class="details">
		<summary>Details</summary>
		<div class="row two-col">
			<label>
				Due date
				<input type="date" bind:value={task.due_date} on:change={(e) => tasks.updateDetails(task.id, { due_date: e.currentTarget.value })} />
			</label>
			<label>
				Recurrence
				<select bind:value={recurrence}>
					<option value=''>None</option>
					<option value='daily'>Daily</option>
					<option value='weekly'>Weekly</option>
					<option value='biweekly'>Every 2 weeks</option>
					<option value='monthly'>Monthly</option>
				</select>
			</label>
		</div>
		<div class="row">
			<span class="chip subtle">Created {new Date(task.created_ts).toLocaleDateString()}</span>
			<span class="chip subtle">Done count: {task.occurrences_completed ?? 0}</span>
		</div>
		<label>
			URL
			<input type="url" bind:value={urlInput} placeholder="https://..." />
		</label>
		<label>
			Recurrence
			<select bind:value={recurrence}>
				<option value=''>None</option>
				<option value='daily'>Daily</option>
				<option value='weekly'>Weekly</option>
				<option value='monthly'>Monthly</option>
			</select>
		</label>
		<div class="attachments">
			<div class="row">
				<input
					type="url"
					placeholder="https://link-to-file"
					bind:value={newAttachment}
					on:keydown={(e) => e.key === 'Enter' && addAttachment()}
				/>
				<button type="button" on:click={addAttachment}>Add</button>
			</div>
			{#if task.attachments?.length}
				<ul>
					{#each task.attachments as att}
						<li>
							<a href={att.path} target="_blank" rel="noreferrer">{att.name}</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">No attachments yet.</p>
			{/if}
		</div>
		<label>
			Notes
			<textarea rows="3" bind:value={task.notes} on:change={(e) => tasks.updateDetails(task.id, { notes: e.currentTarget.value })}></textarea>
		</label>
		<button class="save" type="button" on:click={saveDetails}>Save details</button>
		{#if task.recurrence_id}
			<button class="skip" type="button" on:click={skip}>Skip occurrence</button>
		{/if}
	</details>
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

	.details {
		margin-top: 8px;
		background: #0b1221;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 8px 10px;
		color: #cbd5e1;
	}

	.details summary {
		cursor: pointer;
		font-weight: 600;
	}

	.details label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
		font-size: 12px;
	}

	.details input,
	.details select {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 8px;
	}

	.attachments .row {
		display: flex;
		gap: 8px;
		margin-top: 8px;
	}

	.attachments button {
		background: #1d4ed8;
		border: none;
		color: white;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.attachments ul {
		margin: 6px 0 0;
		padding-left: 16px;
		color: #e2e8f0;
	}

	textarea {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 8px;
	}

	.hint {
		color: #94a3b8;
		font-size: 12px;
		margin: 4px 0 0;
	}

	.save {
		margin-top: 10px;
		background: #16a34a;
		border: none;
		color: white;
		padding: 8px 12px;
		border-radius: 8px;
		cursor: pointer;
	}

	.skip {
		margin-top: 8px;
		background: #92400e;
		border: none;
		color: #ffedd5;
		padding: 8px 12px;
		border-radius: 8px;
		cursor: pointer;
	}

	.row.two-col {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 8px;
		align-items: end;
	}

	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 4px;
	}

	.title-text.link {
		color: #60a5fa;
		text-decoration: underline;
	}
</style>
