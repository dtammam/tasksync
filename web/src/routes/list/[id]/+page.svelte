<script lang="ts">
	// @ts-nocheck
	import { page } from '$app/stores';
	import { onDestroy } from 'svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import TaskDetailDrawer from '$lib/components/TaskDetailDrawer.svelte';
	import { auth } from '$lib/stores/auth';
	import { tasks, tasksByList } from '$lib/stores/tasks';
	import { lists, findListName } from '$lib/stores/lists';
	import { uiPreferences } from '$lib/stores/preferences';
	import { parseMarkdownTasks } from '$lib/markdown/import';

	let quickTitle = '';
	let detailId = null;
	let importOpen = false;
	let importText = '';
	let importMessage = '';
	let importError = '';
	let importLoadedFileName = '';
	let listActionMessage = '';

	$: listId = $page.params.id;
	let listTasks = tasksByList(listId);
	$: listTasks = tasksByList(listId);
	$: listName = findListName(listId);
	$: detailTask = detailId ? ($tasks.find((t) => t.id === detailId) ?? null) : null;

	const normalizeImportKey = (title, targetListId) =>
		`${targetListId.trim().toLowerCase()}::${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;

	const compareAlpha = (left, right) => {
		const a = (left ?? '').trim().toLowerCase();
		const b = (right ?? '').trim().toLowerCase();
		if (a === b) return 0;
		return a < b ? -1 : 1;
	};

	const compareStarredFirst = (left, right) => {
		const leftStarred = (left?.priority ?? 0) > 0;
		const rightStarred = (right?.priority ?? 0) > 0;
		if (leftStarred === rightStarred) return 0;
		return leftStarred ? -1 : 1;
	};

	const sortTasks = (arr, mode = 'created', direction = 'asc') => {
		const copy = [...arr];
		const isAscending = direction !== 'desc';
		copy.sort((a, b) => {
			const starredOrder = compareStarredFirst(a, b);
			if (starredOrder !== 0) return starredOrder;

			if (mode === 'due_date') {
				const dueA = typeof a.due_date === 'string' ? a.due_date : '';
				const dueB = typeof b.due_date === 'string' ? b.due_date : '';
				const hasDueA = !!dueA;
				const hasDueB = !!dueB;
				if (hasDueA && hasDueB && dueA !== dueB) {
					return isAscending ? (dueA < dueB ? -1 : 1) : dueA > dueB ? -1 : 1;
				}
				if (hasDueA !== hasDueB) {
					// Keep undated tasks at the bottom for both ascending and descending due-date sort.
					return hasDueA ? -1 : 1;
				}
				return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
			}

			if (mode === 'alpha') {
				const byTitle = compareAlpha(a.title, b.title);
				if (byTitle === 0) {
					return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
				}
				return isAscending ? byTitle : byTitle * -1;
			}

			return isAscending ? a.created_ts - b.created_ts : b.created_ts - a.created_ts;
		});
		return copy;
	};

	$: pendingTasks = sortTasks(
		($listTasks ?? []).filter((task) => task.status === 'pending'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);
	$: completedTasks = sortTasks(
		($listTasks ?? []).filter((task) => task.status === 'done'),
		$uiPreferences.listSort.mode,
		$uiPreferences.listSort.direction
	);

	$: isContributor = $auth.user?.role === 'contributor';
	$: contributorUserId = isContributor ? $auth.user?.user_id : undefined;
	$: uncheckEligibleCount = completedTasks.filter(
		(task) => !contributorUserId || task.created_by_user_id === contributorUserId
	).length;

	$: importCandidatesRaw = parseMarkdownTasks(importText, listId);
	$: knownListIds = new Set(($lists ?? []).map((list) => list.id));
	$: importCandidates = importCandidatesRaw.map((item) => ({
		...item,
		list_id: knownListIds.has(item.list_id) ? item.list_id : listId
	}));
	$: existingImportKeys = new Set(
		($listTasks ?? []).map((task) => normalizeImportKey(task.title, task.list_id))
	);
	$: importPreviewRows = (() => {
		const seen = new Set();
		return importCandidates.map((item) => {
			const targetListId = item.list_id ?? listId;
			const key = normalizeImportKey(item.title, targetListId);
			const duplicate = existingImportKeys.has(key) || seen.has(key);
			if (!duplicate) {
				seen.add(key);
			}
			return {
				...item,
				list_id: targetListId,
				duplicate
			};
		});
	})();
	$: importDuplicateCount = importPreviewRows.filter((item) => item.duplicate).length;
	$: importCreatableCount = importPreviewRows.length - importDuplicateCount;

	$: copyLines = [...pendingTasks, ...completedTasks].map(
		(task) => `- [${task.status === 'done' ? 'x' : ' '}] ${task.title}`
	);
	const copyProvider = () => copyLines;

	const quickAdd = () => {
		const title = quickTitle.trim();
		if (!title) return;
		tasks.createLocal(title, listId);
		quickTitle = '';
	};

	const openDetail = (event) => (detailId = event.detail.id);
	const closeDetail = () => (detailId = null);

	const openImport = () => {
		importOpen = true;
		importError = '';
		importMessage = '';
		listActionMessage = '';
	};

	const closeImport = () => {
		importOpen = false;
		importError = '';
		importMessage = '';
		importLoadedFileName = '';
	};

	const resetImportDraft = () => {
		importText = '';
		importLoadedFileName = '';
	};

	const onImportFileChange = async (event) => {
		const input = event.currentTarget;
		const file = input?.files?.[0];
		if (!file) return;
		importError = '';
		try {
			const text = await file.text();
			importText = text;
			importLoadedFileName = file.name;
		} catch {
			importError = 'Could not read import file.';
		} finally {
			input.value = '';
		}
	};

	const applyImport = () => {
		importError = '';
		importMessage = '';
		listActionMessage = '';
		if (!importPreviewRows.length) {
			importError = 'Paste tasks or load a file first.';
			return;
		}
		const result = tasks.importBatch(
			importPreviewRows.map(
				(item) => ({
					title: item.title,
					status: item.status,
					list_id: item.list_id,
					my_day: item.my_day
				})
			),
			listId,
			contributorUserId ? { ownerUserId: contributorUserId } : undefined
		);
		if (result.created === 0 && result.reactivated === 0) {
			importError = 'No new tasks imported. Everything matched existing tasks.';
			return;
		}
		const importedLabel = result.created
			? `Imported ${result.created} task${result.created === 1 ? '' : 's'}`
			: '';
		const reactivatedLabel = result.reactivated
			? `${importedLabel ? ', ' : ''}reopened ${result.reactivated} duplicate${result.reactivated === 1 ? '' : 's'}`
			: '';
		const skippedLabel = result.skipped
			? `, skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`
			: '';
		listActionMessage = `${importedLabel}${reactivatedLabel}${skippedLabel}.`;
		resetImportDraft();
		closeImport();
	};

	const uncheckAllCompleted = () => {
		listActionMessage = '';
		importMessage = '';
		importError = '';
		const changed = tasks.uncheckAllInList(listId, contributorUserId ? { ownerUserId: contributorUserId } : undefined);
		if (!changed) return;
		listActionMessage = `Unchecked ${changed} completed task${changed === 1 ? '' : 's'}.`;
	};

	if (typeof window !== 'undefined') {
		Reflect.set(window, '__addTaskList', () => quickAdd());
		Reflect.set(window, '__addTaskListWithTitle', (title) => {
			const nextTitle = String(title ?? '').trim();
			if (!nextTitle) return;
			tasks.createLocal(nextTitle, listId);
		});
		Reflect.set(window, '__copyTasksAsJoplin', copyProvider);
	}

	onDestroy(() => {
		if (typeof window !== 'undefined' && Reflect.get(window, '__copyTasksAsJoplin') === copyProvider) {
			Reflect.deleteProperty(window, '__copyTasksAsJoplin');
		}
	});
</script>

<header class="page-header">
	<div>
		<p class="eyebrow">List</p>
		<h1>{listName}</h1>
		<p class="sub">Tasks in this list.</p>
	</div>
	<div class="actions">
		<div class="sorter">
			<label>
				<span>Sort</span>
				<select
					value={$uiPreferences.listSort.mode}
					data-testid="list-sort-mode"
					aria-label="Sort tasks"
					on:change={(event) => uiPreferences.setListSort({ mode: event.target.value })}
				>
					<option value="created">Creation</option>
					<option value="alpha">Alphabetical</option>
					<option value="due_date">Due date</option>
				</select>
			</label>
			<label class="order-control">
				<span>Order</span>
				<select
					value={$uiPreferences.listSort.direction}
					data-testid="list-sort-direction"
					aria-label="Sort direction"
					on:change={(event) => uiPreferences.setListSort({ direction: event.target.value })}
				>
					<option value="asc">Ascending</option>
					<option value="desc">Descending</option>
				</select>
			</label>
		</div>
		<div class="tools">
			<button
				type="button"
				class="ghost-pill"
				data-testid="list-import-open"
				on:click={openImport}
			>
				Import
			</button>
			<button
				type="button"
				class="ghost-pill"
				data-testid="list-uncheck-all"
				on:click={uncheckAllCompleted}
				disabled={uncheckEligibleCount === 0}
			>
				Uncheck all
			</button>
		</div>
	</div>
</header>

{#if listActionMessage}
	<p class="ok-msg" data-testid="list-action-message">{listActionMessage}</p>
{/if}

<section class="block">
	<div class="section-title">Pending</div>
	<div class="stack">
		{#if pendingTasks.length}
			{#each pendingTasks as task (task.id)}
				<TaskRow {task} on:openDetail={openDetail} />
			{/each}
		{:else}
			<p class="empty">No pending tasks.</p>
		{/if}
	</div>
</section>

<section class="block">
	<div class="section-title">Completed</div>
	<div class="stack" data-testid="completed-section">
		{#if completedTasks.length}
			{#each completedTasks as task (task.id)}
				<TaskRow {task} on:openDetail={openDetail} />
			{/each}
		{:else}
			<p class="empty subtle">No completed tasks yet.</p>
		{/if}
	</div>
</section>

{#if importOpen}
	<button
		type="button"
		class="import-backdrop"
		aria-label="Close import dialog"
		on:click={closeImport}
		on:keydown={(event) => (event.key === 'Enter' || event.key === ' ') && closeImport()}
	></button>
	<div class="import-modal" role="dialog" aria-modal="true" data-testid="list-import-modal">
		<header class="import-head">
			<div>
				<p class="eyebrow">Import</p>
				<h2>Import tasks into {listName}</h2>
				<p class="subtle">Supports plain text, markdown bullets, and Joplin-style checkboxes.</p>
			</div>
			<button type="button" class="ghost-pill" on:click={closeImport}>
				Close
			</button>
		</header>

		<label class="import-input-wrap">
			<span>Paste tasks</span>
			<textarea
				rows="8"
				data-testid="list-import-input"
				bind:value={importText}
			></textarea>
		</label>

		<div class="import-controls">
			<label class="file-btn">
				Load .txt/.md
				<input
					type="file"
					accept=".txt,.md,text/plain,text/markdown"
					data-testid="list-import-file"
					on:change={onImportFileChange}
				/>
			</label>
			{#if importLoadedFileName}
				<span class="file-name">{importLoadedFileName}</span>
			{/if}
		</div>

		{#if importPreviewRows.length}
			<p class="preview-meta" data-testid="list-import-summary">
				Ready: {importCreatableCount} new task{importCreatableCount === 1 ? '' : 's'}
				{#if importDuplicateCount > 0}
					, {importDuplicateCount} duplicate{importDuplicateCount === 1 ? '' : 's'} will be skipped
				{/if}
			</p>
			<div class="import-preview" data-testid="list-import-preview">
				{#each importPreviewRows as row, index (`${row.title}-${index}`)}
					<div class={`import-row ${row.duplicate ? 'duplicate' : ''}`}>
						<span class="status-chip">{row.status === 'done' ? 'Done' : 'Pending'}</span>
						<span class="title">{row.title}</span>
						{#if row.duplicate}
							<span class="dup-chip">Duplicate</span>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if importError}
			<p class="error-msg" data-testid="list-import-error">{importError}</p>
		{/if}
		{#if importMessage}
			<p class="ok-msg" data-testid="list-import-message">{importMessage}</p>
		{/if}

		<div class="import-actions">
			<button
				type="button"
				class="primary-pill"
				data-testid="list-import-apply"
				on:click={applyImport}
				disabled={importPreviewRows.length === 0}
			>
				Import
			</button>
			<button type="button" class="ghost-pill" on:click={resetImportDraft}>
				Clear
			</button>
		</div>
	</div>
{/if}

<TaskDetailDrawer task={detailTask} open={!!detailTask} on:close={closeDetail} />

<div class="mobile-add" aria-label="Quick add">
	<div class="bar">
		<input
			type="text"
			placeholder={`Add a task to ${listName}`}
			bind:value={quickTitle}
			autocomplete="off"
			data-testid="new-task-input"
			on:keydown={(event) => event.key === 'Enter' && quickAdd()}
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
		letter-spacing: 0.12em;
		font-size: 10px;
		font-weight: 700;
		color: var(--app-muted);
		margin: 0;
	}

	h1 {
		margin: 4px 0;
		font-size: 32px;
		line-height: 1.04;
	}

	.sub {
		margin: 0;
		color: var(--app-muted);
	}

	.actions {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		justify-content: flex-end;
		margin-left: auto;
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

	.sorter span {
		font-size: 11px;
		color: var(--app-muted);
	}

	.sorter select {
		background: linear-gradient(
			180deg,
			var(--surface-1),
			color-mix(in oklab, var(--surface-1) 88%, black 12%)
		);
		color: var(--app-text);
		border: 1px solid var(--border-1);
		border-radius: 999px;
		padding: 6px 10px;
		min-height: 32px;
		font-size: 13px;
		box-shadow: var(--ring-shadow);
	}

	.tools {
		display: flex;
		gap: 6px;
	}

	.ghost-pill,
	.primary-pill {
		border-radius: 999px;
		padding: 8px 12px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.ghost-pill {
		background: var(--surface-1);
		border: 1px solid var(--border-2);
		color: var(--app-text);
	}

	.primary-pill {
		background: color-mix(in oklab, var(--surface-accent) 82%, var(--surface-1) 18%);
		color: var(--app-text);
		border: 1px solid color-mix(in oklab, var(--surface-accent) 58%, var(--border-2) 42%);
	}

	.ghost-pill:hover,
	.primary-pill:hover,
	.mobile-add button:hover {
		transform: translateY(-1px);
		filter: brightness(1.07);
	}

	.ghost-pill:disabled,
	.primary-pill:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		transform: none;
		filter: none;
	}

	.block {
		margin-top: 14px;
	}

	.section-title {
		color: var(--app-muted);
		font-size: 12px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		font-weight: 700;
		margin-bottom: 8px;
	}

	.stack {
		display: grid;
		gap: 10px;
	}

	.empty {
		color: var(--app-muted);
		margin: 0;
		padding: 14px;
		background: color-mix(in oklab, var(--surface-2) 92%, black 8%);
		border: 1px dashed var(--border-1);
		border-radius: 12px;
	}

	.empty.subtle {
		color: #7285a4;
	}

	.import-backdrop {
		all: unset;
		position: fixed;
		inset: 0;
		background: rgba(2, 6, 23, 0.62);
		backdrop-filter: blur(4px);
		z-index: 40;
	}

	.import-modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(760px, calc(100vw - 24px));
		max-height: min(78vh, 760px);
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		border-radius: 16px;
		border: 1px solid var(--border-2);
		background: color-mix(in oklab, var(--surface-2) 94%, white 6%);
		box-shadow: var(--soft-shadow);
		z-index: 41;
		overflow: auto;
	}

	.import-head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: flex-start;
	}

	h2 {
		margin: 3px 0 0;
		font-size: 22px;
		letter-spacing: -0.02em;
	}

	.subtle {
		margin: 3px 0 0;
		color: var(--app-muted);
		font-size: 12px;
	}

	.import-input-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: var(--app-muted);
	}

	.import-input-wrap textarea {
		min-height: 160px;
		padding: 10px;
		border-radius: 12px;
		border: 1px solid var(--border-1);
		background: color-mix(in oklab, var(--surface-1) 95%, white 5%);
		color: var(--app-text);
		resize: vertical;
	}

	.import-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.file-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 999px;
		padding: 8px 12px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.file-btn input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.file-name {
		font-size: 12px;
		color: var(--app-muted);
	}

	.preview-meta {
		margin: 0;
		font-size: 12px;
		color: var(--app-muted);
	}

	.import-preview {
		border: 1px solid var(--border-1);
		border-radius: 12px;
		max-height: 210px;
		overflow: auto;
		background: color-mix(in oklab, var(--surface-1) 94%, white 6%);
	}

	.import-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		border-bottom: 1px solid color-mix(in oklab, var(--border-1) 60%, transparent 40%);
	}

	.import-row:last-child {
		border-bottom: none;
	}

	.import-row.duplicate {
		opacity: 0.65;
	}

	.status-chip,
	.dup-chip {
		border-radius: 999px;
		padding: 3px 8px;
		font-size: 10px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border: 1px solid var(--border-1);
		background: var(--surface-2);
		color: var(--app-muted);
	}

	.dup-chip {
		border-color: #92400e;
		color: #fcd34d;
	}

	.import-row .title {
		font-size: 13px;
		color: var(--app-text);
		overflow-wrap: anywhere;
	}

	.import-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.ok-msg {
		margin: 8px 0 0;
		color: #86efac;
		font-size: 12px;
	}

	.error-msg {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}

	.mobile-add {
		display: block;
		position: fixed;
		left: var(--sidebar-offset, 0px);
		right: 0;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 10px + var(--mobile-keyboard-offset, 0px));
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
		background: color-mix(in oklab, var(--surface-accent) 82%, var(--surface-1) 18%);
		color: var(--app-text);
		border: 1px solid color-mix(in oklab, var(--surface-accent) 58%, var(--border-2) 42%);
		border-radius: 12px;
		padding: 0 16px;
		white-space: nowrap;
		min-width: 96px;
		height: 46px;
		font-weight: 650;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	@media (max-width: 900px) {
		.page-header {
			flex-direction: column;
			align-items: stretch;
		}

		.actions {
			margin-left: 0;
			justify-content: space-between;
			align-items: center;
		}

		.order-control {
			display: none;
		}

		.tools {
			margin-left: auto;
		}

		.import-modal {
			width: calc(100vw - 12px);
			max-height: 86vh;
			padding: 10px;
		}

		h1 {
			font-size: 28px;
		}
	}
</style>
