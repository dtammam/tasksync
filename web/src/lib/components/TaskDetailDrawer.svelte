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
let statusValue = 'pending';
let recurringCompletionAck = false;
let puntedFromDrawer = false;
let lastHydratedTaskId = '';
const recurrenceOptions = recurrenceRules.map((rule) => ({
	value: rule,
	label: recurrenceRuleLabels[rule]
}));

onMount(() => {
	if (open && task) hydrate(task);
});

$: if (task) hydrate(task);

function hydrate(t) {
	if (t.id === lastHydratedTaskId) {
		// Same task is already loaded — do not overwrite user edits in progress.
		return;
	}
	puntedFromDrawer = false;
	lastHydratedTaskId = t.id;
	title = t.title ?? '';
	due = t.due_date ?? '';
	recur = t.recurrence_id ?? '';
	url = t.url ?? '';
	notes = t.notes ?? '';
	priority = t.priority ?? 0;
	myDay = t.my_day ?? false;
	listId = t.list_id;
	assigneeUserId = t.assignee_user_id ?? '';
	statusValue = t.status ?? 'pending';
	recurringCompletionAck =
		!!t.recurrence_id && statusValue === 'pending' && isTodayTs(t.completed_ts);
}

const close = () => {
	puntedFromDrawer = false;
	lastHydratedTaskId = '';
	dispatch('close');
};
const isTodayTs = (ts) =>
	typeof ts === 'number' && Number.isFinite(ts) && toLocalIsoDate(new Date(ts)) === todayKey;
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
$: isRecurringCompletedToday =
	!!task?.recurrence_id && statusValue === 'pending' && recurringCompletionAck;
$: isStatusAcknowledged = statusValue === 'done' || isRecurringCompletedToday;
$: isPuntedControlActive = puntedFromDrawer || (showPuntedBadge && !canPunt);
$: puntGlyph = isPuntedControlActive ? '▶' : '▷';
$: starGlyph = priority > 0 ? '★' : '☆';

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
	if (task.recurrence_id && recurringCompletionAck) {
		tasks.undoRecurringCompletion(task.id);
		recurringCompletionAck = false;
		return;
	}
	tasks.toggle(task.id);
	if (task.recurrence_id) {
		recurringCompletionAck = true;
		statusValue = 'pending';
		return;
	}
	statusValue = statusValue === 'done' ? 'pending' : 'done';
	recurringCompletionAck = false;
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
	puntedFromDrawer = true;
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
				{#if showPuntedArrivalIndicator}
					<p class="punt-pill" data-testid="detail-punt-indicator"><span class="punt-glyph" aria-hidden="true">▶</span> Punted from {task.punted_from_due_date}</p>
				{/if}
				{#if showPuntedTodayIndicator}
					<p class="punt-pill" data-testid="detail-punt-indicator"><span class="punt-glyph" aria-hidden="true">▶</span> Punted today to {task.due_date}</p>
				{/if}
				<p class="muted">
					Created {new Date(task.created_ts).toLocaleString()} • Updated {new Date(task.updated_ts).toLocaleString()}
				</p>
			</div>
			<button class="ghost close-btn" on:click={close}>×</button>
		</header>

		<div class="form">
			<label>
				Title
				<input class="title-input" type="text" bind:value={title} disabled={!canEditTask} />
			</label>

			<div class="row">
				<label>
					Status
					<button
						class={`ghost detail-toggle status-toggle ${isStatusAcknowledged ? 'active' : ''}`}
						type="button"
						on:click={toggleStatus}
						disabled={!canEditTask}
					>
						{isStatusAcknowledged ? 'Marked Done' : 'Mark Done'}
					</button>
				</label>
				<label>
					My Day
					<button
						class={`ghost detail-toggle myday-toggle ${myDay ? 'active' : ''}`}
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
						class={`ghost detail-toggle star-toggle ${priority > 0 ? 'active' : ''}`}
						type="button"
						data-testid="detail-star-toggle"
						on:click={toggleStar}
						disabled={!canEditTask}
					>
						<span class="star-glyph" aria-hidden="true">{starGlyph}</span>
						{priority > 0 ? 'Starred' : 'Star'}
					</button>
				</label>
				{#if canPunt || showPuntedBadge || puntedFromDrawer}
					<label>
						Punt
						<button
							class={`ghost detail-toggle punt-toggle ${isPuntedControlActive ? 'active' : ''}`}
							type="button"
							data-testid="detail-punt-toggle"
							on:click={punt}
							disabled={!canPunt || isPuntedControlActive}
						>
							<span class="punt-glyph" aria-hidden="true">{puntGlyph}</span>
							{isPuntedControlActive ? 'Punted' : 'Punt'}
						</button>
					</label>
				{/if}
			</div>

			<div class="row two">
				<label>
					Due date
					<input class="due-input" type="date" bind:value={due} disabled={!canEditTask} />
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
				<input class="url-input" type="url" bind:value={url} placeholder="https://..." disabled={!canEditTask} />
			</label>

			<label>
				Notes
				<textarea rows="3" bind:value={notes} disabled={!canEditTask}></textarea>
			</label>

			<div class="row buttons">
				{#if !canEditTask}
					<p class="muted">This task is owned by another member and is read-only for contributors.</p>
				{:else}
					<button class="primary action-size" type="button" on:click={save}>Save</button>
					{#if task.recurrence_id}
						<button class="ghost action-size" type="button" on:click={skip}>Skip Occurrence</button>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop { all: unset; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(6px); z-index: 90; }
	.drawer {
		position: fixed; top: 0; right: 0; height: 100vh; width: min(420px, 100vw);
		box-sizing: border-box;
		background: color-mix(in oklab, var(--surface-2) 94%, white 6%);
		border-left: 1px solid var(--border-2);
		box-shadow: -20px 0 46px rgba(0, 0, 0, 0.46);
		padding: 12px; z-index: 99; display:flex; flex-direction:column; gap:8px;
	}
	@media (max-width: 640px) {
		.drawer {
			width: 100vw;
			border-left: 0;
			box-shadow: none;
		}
	}
	header { display:flex; justify-content:space-between; align-items:flex-start; }
	.eyebrow { text-transform:uppercase; color:var(--app-muted); font-size:11px; letter-spacing:0.06em; margin:0 0 2px; }
	h2 { margin:0; font-size:20px; letter-spacing:-0.01em; }
	.muted { color:var(--app-muted); margin:2px 0 0; font-size:13px; }
	.form { display:flex; flex-direction:column; gap:7px; overflow:auto; padding-bottom:6px; }
	label { display:flex; flex-direction:column; gap:3px; color:var(--app-text); font-size:13px; }
	input, select, textarea {
		background: linear-gradient(180deg, var(--surface-1), var(--surface-2)); border:1px solid var(--border-1);
		color:var(--app-text); border-radius:9px; padding:7px 10px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
		font-size: 13px;
		line-height: 1.2;
	}
	input, select {
		min-height: 36px;
		height: 36px;
	}
	textarea {
		min-height: 84px;
		resize: vertical;
	}
	.title-input {
		min-height: 32px;
		height: 32px;
	}
	.due-input,
	.url-input {
		min-height: 34px;
		height: 34px;
	}
	.row { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:6px; align-items:center; }
	.row.two { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
	.row.buttons { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
	button.primary {
		background: linear-gradient(180deg, #1d4ed8, #1e40af); border:1px solid rgba(147,197,253,0.4);
		color:#fff; border-radius:9px; cursor:pointer;
	}
	button.ghost { background:var(--surface-1); border:1px solid var(--border-1); color:var(--app-text); border-radius:9px; cursor:pointer; }
	.detail-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		min-height: 38px;
		height: 38px;
		padding: 8px 10px;
		font-size: 13px;
		font-weight: 600;
		text-align: center;
	}
	.status-toggle.active,
	button.ghost.star-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	button.ghost.punt-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	button.ghost.myday-toggle.active {
		border-color: color-mix(in oklab, var(--surface-accent) 64%, var(--border-2) 36%);
		background: color-mix(in oklab, var(--surface-accent) 20%, var(--surface-1) 80%);
	}
	.action-size {
		min-height: 40px;
		height: 40px;
		width: 100%;
		padding: 10px 12px;
		font-size: 13px;
		font-weight: 600;
	}
	.close-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		font-size: 28px;
		line-height: 1;
		border-radius: 10px;
	}
	button.primary:hover, button.ghost:hover { transform: translateY(-1px); }
	input:disabled, select:disabled, textarea:disabled, button:disabled { opacity:0.65; cursor:not-allowed; }
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
		font-weight: 800;
		font-size: 13px;
		color: color-mix(in oklab, var(--surface-accent) 64%, var(--app-text) 36%);
	}
	.star-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		font-size: 13px;
		font-weight: 700;
		color: color-mix(in oklab, var(--surface-accent) 62%, #facc15 38%);
	}
</style>
