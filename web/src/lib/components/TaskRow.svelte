<script lang="ts">
	// @ts-nocheck
import { createEventDispatcher, onDestroy } from 'svelte';
import { tasks } from '$lib/stores/tasks';
import { lists } from '$lib/stores/lists';
import { members } from '$lib/stores/members';
import { auth } from '$lib/stores/auth';
import {
	isRecurrenceRule,
	nextDueForRecurrence,
	recurrenceRuleLabels
} from '$lib/tasks/recurrence';

export let task;
export let completedContext = false;

const dispatch = createEventDispatcher();
let editing = false;
let titleDraft = task.title;
let showActions = false;
let deleting = false;
let actionError = '';
let statusAck = false;
let toggleTimer = null;

/** @param {Event & { target: HTMLSelectElement }} event */
const updateList = (event) => {
	if (!canEditTask) return;
	const select = event.target;
	tasks.moveToList(task.id, select.value);
};

/** @param {Event & { target: HTMLInputElement }} event */
const toggleMyDay = (event) => {
	if ($auth.user?.role === 'contributor') return;
	const input = event.target;
	tasks.setMyDay(task.id, input.checked);
};

const badge = task.priority > 1 ? '🔥' : '•';

let justSaved = false;

const saveTitle = () => {
	if (!canEditTask) return;
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

const addTomorrow = () => {
	if (!canEditTask) return;
	tasks.setDueDate(task.id, tomorrowIso());
};
const addNextWeek = () => {
	if (!canEditTask) return;
	tasks.setDueDate(task.id, nextWeekIso());
};

const isTodayTs = (ts) => {
	if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
	const now = new Date();
	const value = new Date(ts);
	return (
		now.getFullYear() === value.getFullYear() &&
		now.getMonth() === value.getMonth() &&
		now.getDate() === value.getDate()
	);
};

const recurrencePreview = (taskValue, count = 2) => {
	if (!taskValue?.recurrence_id || !taskValue?.due_date) return '';
	const nextDates = [];
	let cursor = taskValue.due_date;
	for (let index = 0; index < count; index += 1) {
		const next = nextDueForRecurrence(cursor, taskValue.recurrence_id);
		if (!next) break;
		nextDates.push(next);
		cursor = next;
	}
	if (!nextDates.length) return '';
	return `Next: ${nextDates.join(', ')}`;
};

const handleToggleStatus = () => {
	if (!canToggleStatus || toggleTimer) return;
	if (isRecurringCompletedToday) {
		tasks.undoRecurringCompletion(task.id);
		return;
	}
	if (task.status === 'done') {
		tasks.toggle(task.id);
		return;
	}
	statusAck = true;
	toggleTimer = window.setTimeout(() => {
		statusAck = false;
		toggleTimer = null;
		tasks.toggle(task.id);
	}, 300);
};

onDestroy(() => {
	if (toggleTimer) {
		window.clearTimeout(toggleTimer);
		toggleTimer = null;
	}
});

const toggleStar = () => {
	if (!canEditTask) return;
	tasks.setPriority(task.id, task.priority > 0 ? 0 : 1);
};

const closeActions = () => (showActions = false);

const deleteTask = async () => {
	if (!canEditTask || deleting) return;
	if (!confirm('Delete this task?')) return;
	deleting = true;
	actionError = '';
	try {
		await tasks.deleteRemote(task.id);
		showActions = false;
	} catch (err) {
		actionError = err instanceof Error ? err.message : String(err);
	} finally {
		deleting = false;
	}
};

const openDetailFromMenu = () => {
	openDetail();
	showActions = false;
};

const toRgba = (hex, alpha) => {
	if (!hex || typeof hex !== 'string') return '';
	const clean = hex.trim().replace('#', '');
	const normalized =
		clean.length === 3
			? clean
					.split('')
					.map((ch) => ch + ch)
					.join('')
			: clean;
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '';
	const value = Number.parseInt(normalized, 16);
	const r = (value >> 16) & 255;
	const g = (value >> 8) & 255;
	const b = value & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

$: assigneeMember = task.assignee_user_id ? members.find(task.assignee_user_id) : null;
$: assigneeDisplay = assigneeMember?.display ?? task.assignee_user_id;
$: assigneeIcon = assigneeMember?.avatar_icon?.trim()
	? assigneeMember.avatar_icon.slice(0, 4)
		: assigneeDisplay?.trim()
			? assigneeDisplay.trim().charAt(0).toUpperCase()
			: '?';
$: isContributor = $auth.user?.role === 'contributor';
$: isOwner = !!$auth.user?.user_id && task.created_by_user_id === $auth.user.user_id;
$: canEditTask = !isContributor || isOwner;
$: canToggleStatus = canEditTask;
$: taskList = $lists.find((list) => list.id === task.list_id);
$: listColor = taskList?.color?.trim() || '#334155';
$: listColorSoft = toRgba(listColor, 0.18) || 'rgba(51,65,85,0.18)';
$: recurPreview = recurrencePreview(task);
$: isRecurringCompletedToday =
	completedContext && !!task.recurrence_id && task.status !== 'done' && isTodayTs(task.completed_ts);
$: recurLabel =
	typeof task.recurrence_id === 'string' && isRecurrenceRule(task.recurrence_id)
		? recurrenceRuleLabels[task.recurrence_id]
		: task.recurrence_id;
</script>

<div
	class="task"
	data-testid="task-row"
	title={`Created ${new Date(task.created_ts).toLocaleString()}\nUpdated ${new Date(task.updated_ts).toLocaleString()}`}
	role="group"
	style={`--list-accent:${listColor};--list-accent-soft:${listColorSoft};`}
>
	<div class="left">
		<button
			class={`status ${statusAck ? 'ack' : ''}`}
			aria-label="toggle task"
			on:click={handleToggleStatus}
			data-testid="task-toggle"
			data-acknowledged={statusAck ? 'true' : 'false'}
			disabled={!canToggleStatus}
		>
			{statusAck ? '✓' : task.status === 'done' || isRecurringCompletedToday ? '✔' : '○'}
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
				{#if canEditTask}
					<button class="icon-btn" type="button" title="Rename task" on:click={() => (editing = true)}>
						✎
					</button>
				{/if}
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
				<span class="chip subtle recur-chip">{recurLabel}</span>
			{/if}
			{#if recurPreview}
				<span class="chip subtle recur-next-chip">{recurPreview}</span>
			{/if}
			{#if assigneeDisplay}
				<span class="chip subtle assignee-chip">To: {assigneeIcon} {assigneeDisplay}</span>
			{/if}
			<label class="chip toggle day-chip">
				<input
					type="checkbox"
					checked={task.my_day}
					on:change={toggleMyDay}
					disabled={isContributor}
				/>
				My Day
			</label>
			<span class="chip subtle list-chip">
				List:
				<select on:change={updateList} title="Move task to list" disabled={!canEditTask}>
					{#each $lists as list}
						<option value={list.id} selected={list.id === task.list_id}>{list.name}</option>
					{/each}
				</select>
			</span>
			<span class={`chip sync-chip ${task.dirty ? 'pending' : 'synced'}`} aria-live="polite">
				{task.dirty ? 'Pending sync' : justSaved ? 'Saved' : 'Synced'}
			</span>
			<button class="chip ghost actions-chip" type="button" on:click={() => (showActions = !showActions)}>⋯</button>
		</div>
	</div>
		{#if showActions}
			<div class="quick">
				<button type="button" on:click={openDetailFromMenu}>Details</button>
				{#if canEditTask}
					<button type="button" on:click={addTomorrow}>Tomorrow</button>
					<button type="button" on:click={addNextWeek}>Next week</button>
					<button type="button" on:click={toggleStar}>{task.priority > 0 ? 'Unstar' : 'Star'}</button>
					<button class="danger" type="button" on:click={deleteTask} disabled={deleting}>
						{deleting ? 'Deleting...' : 'Delete'}
					</button>
				{/if}
				<button class="ghost" type="button" on:click={closeActions}>Close</button>
			</div>
			{#if actionError}
				<p class="error">{actionError}</p>
			{/if}
		{/if}
	</div>

<style>
	.task {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		padding: 12px;
		align-items: start;
		border-radius: 14px;
		border: 1px solid var(--list-accent, var(--border-1));
		background: var(--surface-1);
		box-shadow: inset 3px 0 0 var(--list-accent, #334155), 0 6px 18px rgba(2, 6, 23, 0.28);
	}

	.left { display: flex; align-items: flex-start; padding-top: 1px; }

	.status {
		width: 40px;
		height: 40px;
		min-width: 40px;
		min-height: 40px;
		border-radius: 50%;
		border: 1px solid var(--border-2);
		background: var(--surface-1);
		color: var(--app-text);
		cursor: pointer;
		font-size: 16px;
		line-height: 1;
		transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
	}
	.status:hover { transform: translateY(-1px); }
	.status.ack {
		color: #22c55e;
		border-color: #22c55e;
		box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
		transform: scale(1.06);
	}
	.status:disabled { cursor: not-allowed; opacity: 0.6; }

	.meta { min-width: 0; }
	.meta .title { font-weight: 650; color: var(--app-text); display: flex; gap: 8px; align-items: center; min-width: 0; }
	.title-text { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.sub { display: flex; flex-wrap: wrap; gap: 7px; color: var(--app-muted); font-size: 12px; margin-top: 6px; align-items: center; }
	.badge-dot { color: #64748b; font-size: 14px; line-height: 1; }

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 9px;
		border-radius: 999px;
		background: var(--surface-3);
		color: var(--app-text);
		border: 1px solid transparent;
		white-space: nowrap;
	}
	.chip.subtle { background: var(--surface-2); border-color: var(--border-1); color: var(--app-muted); }
	.chip.toggle { cursor: pointer; }
	.chip.pending { background: #92400e; border-color: #f59e0b; color: #ffedd5; }
	.chip.synced { background: #0b3a2a; border-color: #10b981; color: #d1fae5; }

	.list-chip { border-color: var(--list-accent, #334155); background: var(--list-accent-soft, var(--surface-2)); }
	.list-chip select { background: transparent; border: none; color: inherit; padding: 0 2px; max-width: 124px; }
	.list-chip select:focus-visible { outline: none; }

	input[type='checkbox'] { accent-color: #38bdf8; cursor: pointer; }
	input[type='checkbox']:disabled,
	.list-chip select:disabled { cursor: not-allowed; opacity: 0.65; }

	.tags { color: #c7d2fe; font-size: 13px; }

	.quick {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		margin-top: 6px;
	}
	.quick button {
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 10px;
		padding: 8px 10px;
		cursor: pointer;
	}
	.quick button:hover { background: var(--surface-3); transform: translateY(-1px); }
	.quick button.ghost { border-color: var(--border-2); }
	.quick button.danger { border-color: #7f1d1d; color: #fecaca; }

	.icon-btn { background: none; border: none; color: var(--app-muted); cursor: pointer; padding: 4px; border-radius: 6px; min-width: 28px; min-height: 28px; }
	.icon-btn:hover { background: var(--surface-3); color: var(--app-text); }

	.title-input { background: var(--surface-1); border: 1px solid var(--border-1); color: var(--app-text); border-radius: 8px; padding: 6px 8px; min-width: 180px; }
	.title-text.link { color: #60a5fa; text-decoration: underline; }
	.error { grid-column: 1 / -1; margin: 0; color: #fda4af; font-size: 12px; }

	:global(html[data-ui-theme='light']) .task {
		background: #ffffff;
		border-color: #bfd0ec;
		box-shadow: inset 3px 0 0 var(--list-accent, #3b82f6), 0 8px 18px rgba(15, 23, 42, 0.08);
	}
	:global(html[data-ui-theme='light']) .task .title-text,
	:global(html[data-ui-theme='light']) .task .meta .title { color: #0f172a; }
	:global(html[data-ui-theme='light']) .task .chip { background: #e8efff; color: #1e293b; }
	:global(html[data-ui-theme='light']) .task .chip.subtle { background: #f8fbff; border-color: #cbd5e1; color: #334155; }
	:global(html[data-ui-theme='light']) .task .status,
	:global(html[data-ui-theme='light']) .task .quick button,
	:global(html[data-ui-theme='light']) .task .title-input { background: #ffffff; border-color: #94a3b8; color: #0f172a; }

	@media (max-width: 900px) {
		.task {
			padding: 8px 9px;
			gap: 8px;
			border-radius: 11px;
		}

		.left { padding-top: 0; }

		.status {
			width: 34px;
			height: 34px;
			min-width: 34px;
			min-height: 34px;
			font-size: 14px;
		}

		.meta .title {
			gap: 6px;
			font-size: 0.98rem;
		}

		.sub {
			gap: 6px;
			margin-top: 4px;
			font-size: 11px;
		}

		.chip {
			padding: 3px 8px;
			font-size: 11px;
		}

		.badge-dot,
		.tags,
		.icon-btn,
		.assignee-chip,
		.list-chip,
		.sync-chip {
			display: none;
		}
	}
</style>
