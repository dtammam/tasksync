<script lang="ts">
// @ts-nocheck
import { createEventDispatcher, onMount } from 'svelte';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import { auth } from '$lib/stores/auth';
import { members } from '$lib/stores/members';
import { recurrenceRuleLabels, recurrenceRules, toLocalIsoDate } from '$lib/tasks/recurrence';

export let task = null;
export let open = false;

const dispatch = createEventDispatcher();

let title = '';
let due = '';
let recur = '';
let url = '';
let notes = '';
let priority = 0;
let myDay = false;
let listId = '';
let assigneeUserId = '';
const recurrenceOptions = recurrenceRules.map((rule) => ({
	value: rule,
	label: recurrenceRuleLabels[rule]
}));

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
	priority = t.priority ?? 0;
	myDay = t.my_day ?? false;
	listId = t.list_id;
	assigneeUserId = t.assignee_user_id ?? '';
}

const close = () => dispatch('close');
$: isContributor = $auth.user?.role === 'contributor';
$: isOwner = !!$auth.user?.user_id && task?.created_by_user_id === $auth.user.user_id;
$: canEditTask = !isContributor || isOwner;
$: canEditMyDay = !isContributor;
$: canEditAssignee = !isContributor;
$: todayKey = toLocalIsoDate(new Date());
$: showPuntedArrivalIndicator =
	task?.status === 'pending' &&
	task?.due_date === todayKey &&
	!!task?.punted_from_due_date &&
	!!task?.punted_on_date &&
	task.punted_on_date < todayKey;
$: showPuntedTodayIndicator =
	task?.status === 'pending' &&
	!!task?.due_date &&
	task.due_date > todayKey &&
	task.punted_on_date === todayKey &&
	!!task?.punted_from_due_date;
$: canPunt =
	canEditTask &&
	task?.status === 'pending' &&
	task?.recurrence_id !== 'daily' &&
	task?.due_date === todayKey;
$: showPuntedBadge = showPuntedArrivalIndicator || showPuntedTodayIndicator;

const save = () => {
	if (!task || !canEditTask) return;
	tasks.saveFromDetails(task.id, {
		title,
		due_date: due || undefined,
		recurrence_id: recur || undefined,
		url: url || undefined,
		notes,
		priority,
		my_day: canEditMyDay ? myDay : (task.my_day ?? false),
		list_id: listId,
		assignee_user_id: canEditAssignee ? assigneeUserId || undefined : task.assignee_user_id
	});
	close();
};

const toggleStatus = () => {
	if (!task || !canEditTask) return;
	tasks.toggle(task.id);
};

const toggleStar = () => {
	if (!canEditTask) return;
	priority = priority > 0 ? 0 : 1;
};

const toggleMyDay = () => {
	if (!canEditMyDay) return;
	myDay = !myDay;
};

const punt = () => {
	if (!task || !canPunt) return;
	tasks.punt(task.id);
};

const skip = () => {
	if (!task || !canEditTask) return;
	tasks.skip(task.id);
};

const memberAvatar = (member) => {
	const icon = member?.avatar_icon?.trim();
	if (icon) return icon.slice(0, 4);
	const source = (member?.display ?? member?.email ?? '').trim();
	return source ? source.charAt(0).toUpperCase() : '?';
};
</script>

{#if open && task}
	<button class="backdrop" type="button" aria-label="Close details" on:click={close} on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && close()}></button>
	<div class="drawer" role="dialog" aria-modal="true" aria-label="Task details">
		<header>
			<div>
				<p class="eyebrow">Details</p>
				<h2>{title}</h2>
				{#if priority > 0}
					<p class="star-pill" data-testid="detail-star-indicator">★ Starred</p>
				{/if}
				{#if showPuntedArrivalIndicator}
					<p class="punt-pill" data-testid="detail-punt-indicator"><span class="punt-glyph" aria-hidden="true">➜</span> Punted from {task.punted_from_due_date}</p>
				{/if}
				{#if showPuntedTodayIndicator}
					<p class="punt-pill" data-testid="detail-punt-indicator"><span class="punt-glyph" aria-hidden="true">➜</span> Punted today to {task.due_date}</p>
				{/if}
				<p class="muted">
					Created {new Date(task.created_ts).toLocaleString()} • Updated {new Date(task.updated_ts).toLocaleString()}
				</p>
			</div>
			<button class="ghost" on:click={close}>×</button>
		</header>

		<div class="form">
			<label>
				Title
				<input type="text" bind:value={title} disabled={!canEditTask} />
			</label>

			<div class="row">
				<label>
					Status
					<button class="status" type="button" on:click={toggleStatus} disabled={!canEditTask}>
						{task.status === 'done' ? 'Mark pending' : 'Mark done'}
					</button>
				</label>
				<label>
					My Day
					<button
						class={`ghost myday-toggle ${myDay ? 'active' : ''}`}
						type="button"
						data-testid="detail-myday-toggle"
						on:click={toggleMyDay}
						disabled={!canEditMyDay}
					>
						{myDay ? 'My Day' : 'Add to My Day'}
					</button>
				</label>
				<label>
					Starred
					<button
						class={`ghost star-toggle ${priority > 0 ? 'active' : ''}`}
						type="button"
						data-testid="detail-star-toggle"
						on:click={toggleStar}
						disabled={!canEditTask}
					>
						{priority > 0 ? '★ Starred' : '☆ Star'}
					</button>
				</label>
				{#if canPunt || showPuntedBadge}
					<label>
						Punt
						<button
							class={`ghost punt-toggle ${showPuntedBadge && !canPunt ? 'active' : ''}`}
							type="button"
							data-testid="detail-punt-toggle"
							on:click={punt}
							disabled={!canPunt}
						>
							<span class="punt-glyph" aria-hidden="true">➜</span>
							{canPunt ? 'Punt' : 'Punted'}
						</button>
					</label>
				{/if}
			</div>

			<div class="row two">
				<label>
					Due date
					<input type="date" bind:value={due} disabled={!canEditTask} />
				</label>
				<label>
					Recurrence
					<select bind:value={recur} disabled={!canEditTask}>
						<option value=''>None</option>
						{#each recurrenceOptions as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</label>
			</div>

			<label>
				List
				<select bind:value={listId} disabled={!canEditTask}>
					{#each $lists as list}
						<option value={list.id}>{list.name}</option>
					{/each}
				</select>
			</label>
			{#if ($auth.user?.role === 'admin' || task.local) && $members.length > 0}
				<label>
					Assignee
					<select bind:value={assigneeUserId} disabled={!canEditAssignee}>
						<option value=''>Unassigned</option>
						{#each $members as member}
							<option value={member.user_id}>{memberAvatar(member)} {member.display} ({member.role})</option>
						{/each}
					</select>
				</label>
			{/if}

			<label>
				URL
				<input type="url" bind:value={url} placeholder="https://..." disabled={!canEditTask} />
			</label>

			<label>
				Notes
				<textarea rows="4" bind:value={notes} disabled={!canEditTask}></textarea>
			</label>

			<div class="row buttons">
				{#if !canEditTask}
					<p class="muted">This task is owned by another member and is read-only for contributors.</p>
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
	.backdrop { all: unset; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px); z-index: 90; }
	.drawer {
		position: fixed; top: 0; right: 0; height: 100vh; width: min(420px, 92vw);
		background: color-mix(in oklab, var(--surface-2) 94%, white 6%);
		border-left: 1px solid var(--border-2); box-shadow: -20px 0 46px rgba(0, 0, 0, 0.46);
		padding: 16px; z-index: 99; display:flex; flex-direction:column; gap:12px;
	}
	header { display:flex; justify-content:space-between; align-items:flex-start; }
	.eyebrow { text-transform:uppercase; color:var(--app-muted); font-size:11px; letter-spacing:0.06em; margin:0 0 2px; }
	h2 { margin:0; font-size:20px; letter-spacing:-0.01em; }
	.muted { color:var(--app-muted); margin:4px 0 0; font-size:13px; }
	.form { display:flex; flex-direction:column; gap:10px; overflow:auto; padding-bottom:12px; }
	label { display:flex; flex-direction:column; gap:4px; color:var(--app-text); font-size:13px; }
	input, select, textarea {
		background: linear-gradient(180deg, var(--surface-1), var(--surface-2)); border:1px solid var(--border-1);
		color:var(--app-text); border-radius:9px; padding:8px 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
	}
	.row { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:8px; align-items:center; }
	.row.two { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
	.row.buttons { grid-template-columns: repeat(auto-fit, minmax(120px, auto)); }
	button.primary, .status {
		background: linear-gradient(180deg, #1d4ed8, #1e40af); border:1px solid rgba(147,197,253,0.4);
		color:#fff; padding:10px 12px; border-radius:9px; cursor:pointer; box-shadow: 0 8px 18px rgba(37,99,235,0.3);
	}
	button.ghost { background:var(--surface-1); border:1px solid var(--border-1); color:var(--app-text); padding:8px 10px; border-radius:9px; cursor:pointer; }
	button.ghost.star-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	button.ghost.punt-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	button.ghost.punt-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	button.ghost.myday-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	button.primary:hover, .status:hover, button.ghost:hover { transform: translateY(-1px); }
	input:disabled, select:disabled, textarea:disabled, button:disabled { opacity:0.65; cursor:not-allowed; }
	.star-pill {
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--app-text);
	}
	.punt-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 6px 0 0;
		font-size: 12px;
		color: var(--app-text);
	}
	.punt-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: color-mix(in oklab, var(--surface-accent) 64%, var(--app-text) 36%);
	}
</style>
