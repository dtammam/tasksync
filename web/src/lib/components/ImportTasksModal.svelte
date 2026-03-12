<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { tasks, tasksByList } from '$lib/stores/tasks';
	import { lists } from '$lib/stores/lists';
	import { auth } from '$lib/stores/auth';
	import { parseMarkdownTasks } from '$lib/markdown/import';

	export let listId: string;
	export let listName: string;

	const dispatch = createEventDispatcher<{ close: void; imported: { message: string } }>();

	let importText = '';
	let importError = '';
	let importLoadedFileName = '';

	const normalizeImportKey = (title: string, targetListId: string): string =>
		`${targetListId.trim().toLowerCase()}::${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;

	$: isContributor = $auth.user?.role === 'contributor';
	$: contributorUserId = isContributor ? $auth.user?.user_id : undefined;

	$: listTasks = tasksByList(listId);

	$: importCandidatesRaw = parseMarkdownTasks(importText, listId);
	$: knownListIds = new Set(($lists ?? []).map((list) => list.id));
	$: importCandidates = importCandidatesRaw.map((item) => ({
		...item,
		list_id: item.list_id && knownListIds.has(item.list_id) ? item.list_id : listId
	}));
	$: existingImportKeys = new Set(
		($listTasks ?? []).map((task) => normalizeImportKey(task.title, task.list_id))
	);
	$: importPreviewRows = (() => {
		const seen = new Set<string>();
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

	const resetImportDraft = () => {
		importText = '';
		importLoadedFileName = '';
	};

	const onImportFileChange = async (event: Event & { currentTarget: HTMLInputElement }) => {
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
		if (!importPreviewRows.length) {
			importError = 'Paste tasks or load a file first.';
			return;
		}
		const result = tasks.importBatch(
			importPreviewRows.map((item) => ({
				title: item.title,
				status: item.status,
				list_id: item.list_id,
				my_day: item.my_day
			})),
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
		const message = `${importedLabel}${reactivatedLabel}${skippedLabel}.`;
		resetImportDraft();
		dispatch('imported', { message });
		dispatch('close');
	};

	const close = () => {
		importError = '';
		importLoadedFileName = '';
		dispatch('close');
	};
</script>

<button
	type="button"
	class="import-backdrop"
	aria-label="Close import dialog"
	on:click={close}
	on:keydown={(event) => (event.key === 'Enter' || event.key === ' ') && close()}
></button>
<div class="import-modal" role="dialog" aria-modal="true" data-testid="list-import-modal">
	<header class="import-head">
		<div>
			<p class="eyebrow">Import</p>
			<h2>Import tasks into {listName}</h2>
			<p class="subtle">Supports plain text, markdown bullets, and Joplin-style checkboxes.</p>
		</div>
		<button type="button" class="ghost-pill" on:click={close}>
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

<style>
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

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 10px;
		font-weight: 700;
		color: var(--app-muted);
		margin: 0;
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
	.primary-pill:hover {
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

	.ok-msg {
		margin: 0;
		color: #86efac;
		font-size: 12px;
	}

	.error-msg {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}

	@media (max-width: 900px) {
		.import-modal {
			width: calc(100vw - 12px);
			max-height: 86vh;
			padding: 10px;
		}
	}
</style>
