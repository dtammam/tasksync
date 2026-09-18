<script lang="ts">
	import { onMount } from 'svelte';
	import { tagPalette, currentTagPalette } from '$lib/stores/tagPalette';
	import { ApiError } from '$lib/api/client';
	import type { TagPaletteSection } from '$shared/types/tags';

	const clonePalette = (sections: TagPaletteSection[]): TagPaletteSection[] =>
		JSON.parse(JSON.stringify(sections));

	let draft: TagPaletteSection[] = clonePalette(currentTagPalette());
	let dirty = false;
	let busy = false;
	let error = '';
	let message = '';

	let draggedSectionIndex: number | null = null;
	let draggedEntry: { sectionIndex: number; entryIndex: number } | null = null;

	onMount(() => {
		draft = clonePalette(currentTagPalette());
	});

	const markDirty = () => {
		dirty = true;
		message = '';
	};

	const addSection = () => {
		draft = [...draft, { section: '', entries: [] }];
		markDirty();
	};

	const deleteSection = (index: number) => {
		const section = draft[index];
		if (section.entries.length > 0) {
			const count = section.entries.length;
			const ok = confirm(
				`Delete "${section.section || 'this section'}" and its ${count} tag${count === 1 ? '' : 's'}? Tasks already using these tags keep them regardless.`
			);
			if (!ok) return;
		}
		draft = draft.filter((_, i) => i !== index);
		markDirty();
	};

	const moveSection = (index: number, direction: number) => {
		const next = index + direction;
		if (next < 0 || next >= draft.length) return;
		const reordered = [...draft];
		const [moving] = reordered.splice(index, 1);
		reordered.splice(next, 0, moving);
		draft = reordered;
		markDirty();
	};

	const addEntry = (sectionIndex: number) => {
		draft = draft.map((s, i) =>
			i === sectionIndex ? { ...s, entries: [...s.entries, { emoji: '', label: '' }] } : s
		);
		markDirty();
	};

	const deleteEntry = (sectionIndex: number, entryIndex: number) => {
		draft = draft.map((s, i) =>
			i === sectionIndex ? { ...s, entries: s.entries.filter((_, ei) => ei !== entryIndex) } : s
		);
		markDirty();
	};

	const moveEntry = (sectionIndex: number, entryIndex: number, direction: number) => {
		const section = draft[sectionIndex];
		const next = entryIndex + direction;
		if (next < 0 || next >= section.entries.length) return;
		const reordered = [...section.entries];
		const [moving] = reordered.splice(entryIndex, 1);
		reordered.splice(next, 0, moving);
		draft = draft.map((s, i) => (i === sectionIndex ? { ...s, entries: reordered } : s));
		markDirty();
	};

	const handleSectionDragStart = (index: number) => {
		draggedSectionIndex = index;
	};

	const handleSectionDrop = (event: DragEvent, targetIndex: number) => {
		event.preventDefault();
		if (draggedSectionIndex === null || draggedSectionIndex === targetIndex) {
			draggedSectionIndex = null;
			return;
		}
		const reordered = [...draft];
		const [moving] = reordered.splice(draggedSectionIndex, 1);
		reordered.splice(targetIndex, 0, moving);
		draft = reordered;
		draggedSectionIndex = null;
		markDirty();
	};

	// Cross-section drag isn't supported -- reordering across sections is
	// already covered by the up/down move buttons plus edit-in-place, and
	// scoping drag to "within a section" avoids ambiguous drop targets.
	const handleEntryDragStart = (sectionIndex: number, entryIndex: number) => {
		draggedEntry = { sectionIndex, entryIndex };
	};

	const handleEntryDrop = (event: DragEvent, sectionIndex: number, targetEntryIndex: number) => {
		event.preventDefault();
		if (!draggedEntry || draggedEntry.sectionIndex !== sectionIndex) {
			draggedEntry = null;
			return;
		}
		if (draggedEntry.entryIndex === targetEntryIndex) {
			draggedEntry = null;
			return;
		}
		const section = draft[sectionIndex];
		const reordered = [...section.entries];
		const [moving] = reordered.splice(draggedEntry.entryIndex, 1);
		reordered.splice(targetEntryIndex, 0, moving);
		draft = draft.map((s, i) => (i === sectionIndex ? { ...s, entries: reordered } : s));
		draggedEntry = null;
		markDirty();
	};

	const validate = (): string | null => {
		const seenEmoji = new Set<string>();
		for (const section of draft) {
			if (!section.section.trim()) return 'Every section needs a name.';
			for (const entry of section.entries) {
				if (!entry.emoji.trim()) return 'Every tag needs an emoji.';
				if (!entry.label.trim()) return 'Every tag needs a label.';
				if (seenEmoji.has(entry.emoji)) {
					return `"${entry.emoji}" is used more than once -- each tag's emoji must be unique.`;
				}
				seenEmoji.add(entry.emoji);
			}
		}
		return null;
	};

	const save = async () => {
		const validationError = validate();
		if (validationError) {
			error = validationError;
			message = '';
			return;
		}
		busy = true;
		error = '';
		message = '';
		try {
			const saved = await tagPalette.save(draft);
			draft = clonePalette(saved);
			dirty = false;
			message = 'Saved.';
		} catch (err) {
			error =
				err instanceof ApiError
					? (err.detail ?? err.message)
					: err instanceof Error
						? err.message
						: String(err);
		} finally {
			busy = false;
		}
	};
</script>

<div class="card tags" data-testid="tag-palette-settings">
	<p class="muted-note">
		Removing a tag or changing its emoji here never touches a task that already has it -- that
		task keeps its current emoji, it just won't show a label for it anymore.
	</p>

	{#if draft.length === 0}
		<p class="muted-note">No tags yet. Add a section below to get started.</p>
	{/if}

	<div class="sections" role="list">
		{#each draft as section, sectionIndex (sectionIndex)}
			<div
				class="section-block"
				role="listitem"
				draggable="true"
				on:dragstart={() => handleSectionDragStart(sectionIndex)}
				on:dragover={(e) => e.preventDefault()}
				on:drop={(e) => handleSectionDrop(e, sectionIndex)}
			>
				<div class="row">
					<input
						class="name-input"
						type="text"
						placeholder="Section name"
						bind:value={section.section}
						on:input={markDirty}
						aria-label="Section name"
					/>
					<button
						type="button"
						class="ghost tiny"
						aria-label="Move section up"
						title="Move section up"
						on:click={() => moveSection(sectionIndex, -1)}
						disabled={busy || sectionIndex === 0}
					>
						↑
					</button>
					<button
						type="button"
						class="ghost tiny"
						aria-label="Move section down"
						title="Move section down"
						on:click={() => moveSection(sectionIndex, 1)}
						disabled={busy || sectionIndex === draft.length - 1}
					>
						↓
					</button>
					<button
						type="button"
						class="ghost tiny danger"
						on:click={() => deleteSection(sectionIndex)}
						disabled={busy}
					>
						Delete section
					</button>
				</div>

				<div class="entries" role="list">
					{#each section.entries as entry, entryIndex (entryIndex)}
						<div
							class="row entry-row"
							role="listitem"
							draggable="true"
							on:dragstart={() => handleEntryDragStart(sectionIndex, entryIndex)}
							on:dragover={(e) => e.preventDefault()}
							on:drop={(e) => handleEntryDrop(e, sectionIndex, entryIndex)}
						>
							<input
								class="emoji-input"
								type="text"
								placeholder="🏷️"
								maxlength="16"
								autocapitalize="off"
								spellcheck="false"
								bind:value={entry.emoji}
								on:input={markDirty}
								aria-label="Tag emoji"
							/>
							<input
								class="name-input"
								type="text"
								placeholder="Label"
								bind:value={entry.label}
								on:input={markDirty}
								aria-label="Tag label"
							/>
							<button
								type="button"
								class="ghost tiny"
								aria-label="Move tag up"
								title="Move tag up"
								on:click={() => moveEntry(sectionIndex, entryIndex, -1)}
								disabled={busy || entryIndex === 0}
							>
								↑
							</button>
							<button
								type="button"
								class="ghost tiny"
								aria-label="Move tag down"
								title="Move tag down"
								on:click={() => moveEntry(sectionIndex, entryIndex, 1)}
								disabled={busy || entryIndex === section.entries.length - 1}
							>
								↓
							</button>
							<button
								type="button"
								class="ghost tiny danger"
								on:click={() => deleteEntry(sectionIndex, entryIndex)}
								disabled={busy}
							>
								Delete
							</button>
						</div>
					{/each}
				</div>
				<button
					type="button"
					class="ghost tiny"
					on:click={() => addEntry(sectionIndex)}
					disabled={busy}
				>
					+ Add tag
				</button>
			</div>
		{/each}
	</div>

	<button type="button" class="ghost tiny" on:click={addSection} disabled={busy}>
		+ Add section
	</button>

	<div class="save-row">
		<button type="button" class="primary" on:click={save} disabled={busy || !dirty}>
			{busy ? 'Saving…' : 'Save changes'}
		</button>
		{#if dirty}<span class="muted-note">Unsaved changes</span>{/if}
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}
	{#if message}
		<p class="ok">{message}</p>
	{/if}
</div>

<style>
	.tags {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.sections {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.section-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border: 1px solid var(--border-1);
		border-radius: 10px;
		background: color-mix(in oklab, var(--surface-1) 94%, white 6%);
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-left: 8px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.entry-row {
		padding: 4px;
		border-radius: 6px;
	}

	.name-input {
		flex: 1;
		min-width: 100px;
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 13px;
	}

	.emoji-input {
		width: 44px;
		text-align: center;
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 6px 4px;
		font-size: 16px;
	}

	.ghost.tiny {
		background: color-mix(in oklab, var(--surface-1) 92%, white 8%);
		border: 1px solid var(--border-1);
		color: var(--app-text);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 12px;
		cursor: pointer;
		box-shadow: var(--ring-shadow);
	}

	.ghost.tiny:hover {
		filter: brightness(1.1);
	}

	.ghost.tiny:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.ghost.tiny.danger {
		color: #fda4af;
	}

	.save-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.muted-note {
		margin: 0;
		font-size: 12px;
		color: var(--app-muted);
	}

	.ok {
		margin: 0;
		color: #86efac;
		font-size: 12px;
	}

	.error {
		margin: 0;
		color: #fda4af;
		font-size: 12px;
	}
</style>
