<script lang="ts">
// @ts-nocheck
import { createEventDispatcher, onMount } from 'svelte';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import { auth } from '$lib/stores/auth';
import { members } from '$lib/stores/members';

export let task = null;
export let open = false;

const dispatch = createEventDispatcher();

let title = '';
let due = '';
let recur = '';
let url = '';
let notes = '';
let attachments = [];
let myDay = false;
let listId = '';
let assigneeUserId = '';

onMount(() => {
	if (open && task) hydrate(task);
});

$: if (task) hydrate(task);

function hydrate(t) {
	title = t.title ?? '';
	due = t.due_date ?? '';
	recur = t.recurrence_id ?? '';
	url = t.url ?? '';
	notes = t.notes ?? '';
	attachments = t.attachments ?? [];
	myDay = t.my_day ?? false;
	listId = t.list_id;
	assigneeUserId = t.assignee_user_id ?? '';
}

const close = () => dispatch('close');
$: isContributor = $auth.user?.role === 'contributor';

const save = () => {
	if (!task || isContributor) return;
	tasks.rename(task.id, title);
	tasks.updateDetails(task.id, {
		due_date: due || undefined,
		recurrence_id: recur || undefined,
		url: url || undefined,
		notes,
		attachments
	});
	tasks.setMyDay(task.id, myDay);
	tasks.moveToList(task.id, listId);
	if (assigneeUserId !== (task.assignee_user_id ?? '')) {
		tasks.setAssignee(task.id, assigneeUserId || undefined);
	}
};

const toggleStatus = () => {
	if (!task || isContributor) return;
	tasks.toggle(task.id);
};

let newAttachment = '';
const addAttachment = () => {
	if (!newAttachment.trim() || !task || isContributor) return;
	const name = newAttachment.split('/').filter(Boolean).pop() ?? 'attachment';
	const ref = {
		id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
		name,
		size: 0,
		mime: 'text/uri-list',
		hash: '',
		path: newAttachment.trim()
	};
	attachments = [...attachments, ref];
	newAttachment = '';
};

const skip = () => {
	if (!task || isContributor) return;
	tasks.skip(task.id);
};
</script>

{#if open && task}
	<button class="backdrop" type="button" aria-label="Close details" on:click={close} on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && close()}></button>
	<div class="drawer" role="dialog" aria-modal="true" aria-label="Task details">
		<header>
			<div>
				<p class="eyebrow">Details</p>
				<h2>{title}</h2>
				<p class="muted">
					Created {new Date(task.created_ts).toLocaleString()} • Updated {new Date(task.updated_ts).toLocaleString()}
				</p>
			</div>
			<button class="ghost" on:click={close}>×</button>
		</header>

		<div class="form">
			<label>
				Title
				<input type="text" bind:value={title} disabled={isContributor} />
			</label>

			<div class="row">
				<label>
					Status
					<button class="status" type="button" on:click={toggleStatus} disabled={isContributor}>
						{task.status === 'done' ? 'Mark pending' : 'Mark done'}
					</button>
				</label>
				<label>
					My Day
					<input type="checkbox" bind:checked={myDay} disabled={isContributor} />
				</label>
			</div>

			<div class="row two">
				<label>
					Due date
					<input type="date" bind:value={due} disabled={isContributor} />
				</label>
				<label>
					Recurrence
					<select bind:value={recur} disabled={isContributor}>
						<option value=''>None</option>
						<option value='daily'>Daily</option>
						<option value='weekly'>Weekly</option>
						<option value='biweekly'>Every 2 weeks</option>
						<option value='monthly'>Monthly</option>
					</select>
				</label>
			</div>

			<label>
				List
				<select bind:value={listId} disabled={isContributor}>
					{#each $lists as list}
						<option value={list.id}>{list.name}</option>
					{/each}
				</select>
			</label>
			{#if ($auth.user?.role === 'admin' || task.local) && $members.length > 0}
				<label>
					Assignee
					<select bind:value={assigneeUserId} disabled={isContributor}>
						<option value=''>Unassigned</option>
						{#each $members as member}
							<option value={member.user_id}>{member.display}</option>
						{/each}
					</select>
				</label>
			{/if}

			<label>
				URL
				<input type="url" bind:value={url} placeholder="https://..." disabled={isContributor} />
			</label>

			<label>
				Notes
				<textarea rows="4" bind:value={notes} disabled={isContributor}></textarea>
			</label>

			<div class="row attach">
				<input
					type="url"
					placeholder="https://link-to-file"
					bind:value={newAttachment}
					on:keydown={(e) => e.key === 'Enter' && addAttachment()}
					disabled={isContributor}
				/>
				<button type="button" on:click={addAttachment} disabled={isContributor}>Add attachment</button>
			</div>
			{#if attachments?.length}
				<ul class="attachments">
					{#each attachments as att}
						<li><a href={att.path} target="_blank" rel="noreferrer">{att.name}</a></li>
					{/each}
				</ul>
			{:else}
				<p class="muted">No attachments.</p>
			{/if}

			<div class="row buttons">
				{#if isContributor}
					<p class="muted">Contributor access is add-only. Existing tasks are read-only.</p>
				{:else}
					<button class="primary" type="button" on:click={save}>Save</button>
					{#if task.recurrence_id}
						<button class="ghost" type="button" on:click={skip}>Skip occurrence</button>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		all: unset;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(2px);
		z-index: 90;
	}

	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		height: 100vh;
		width: min(420px, 92vw);
		background: #0b1221;
		border-left: 1px solid #1f2937;
		box-shadow: -10px 0 30px rgba(0, 0, 0, 0.35);
		padding: 16px;
		z-index: 99;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.eyebrow {
		text-transform: uppercase;
		color: #94a3b8;
		font-size: 11px;
		letter-spacing: 0.06em;
		margin: 0 0 2px;
	}

	h2 {
		margin: 0;
		font-size: 20px;
	}

	.muted {
		color: #94a3b8;
		margin: 4px 0 0;
		font-size: 13px;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow: auto;
		padding-bottom: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: #cbd5e1;
		font-size: 13px;
	}

	input,
	select,
	textarea {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 8px 10px;
	}

	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		align-items: center;
	}

	.row.two {
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	}

	.row.buttons {
		grid-template-columns: repeat(auto-fit, minmax(120px, auto));
	}

	.row.attach {
		grid-template-columns: 1fr auto;
	}

	button.primary {
		background: #16a34a;
		border: none;
		color: #fff;
		padding: 10px 12px;
		border-radius: 10px;
		cursor: pointer;
	}

	button.ghost {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.status {
		background: #1d4ed8;
		border: none;
		color: #fff;
		padding: 10px 12px;
		border-radius: 8px;
		cursor: pointer;
	}

	input:disabled,
	select:disabled,
	textarea:disabled,
	button:disabled {
		opacity: 0.65;
		cursor: not-allowed;
	}

	.attachments {
		margin: 0;
		padding-left: 16px;
		color: #e2e8f0;
	}
</style>
