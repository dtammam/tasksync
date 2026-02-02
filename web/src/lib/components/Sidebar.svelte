<script lang="ts">
// @ts-nocheck
import { page } from '$app/stores';
import { lists } from '$lib/stores/lists';
import { listCounts, myDayPending } from '$lib/stores/tasks';

let showManager = false;
let newListName = '';
let newListIcon = '';
let renameDraft = {};
let listError = '';
let busy = false;

const resetDrafts = () => {
	renameDraft = {};
	newListName = '';
	newListIcon = '';
	listError = '';
};

const createList = async () => {
	const name = newListName.trim();
	if (!name) return;
	busy = true;
	listError = '';
	try {
		await lists.createRemote(name, newListIcon || undefined);
		resetDrafts();
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const renameList = async (id) => {
	const name = (renameDraft[id] ?? '').trim();
	if (!name) return;
	busy = true;
	listError = '';
	try {
		await lists.updateRemote(id, { name });
		renameDraft = { ...renameDraft, [id]: '' };
	} catch (err) {
		listError = err instanceof Error ? err.message : String(err);
	} finally {
		busy = false;
	}
};

const deleteList = async (id) => {
	if (!confirm('Delete this list? Tasks within cannot be deleted yet.')) return;
	busy = true;
	listError = '';
	try {
		await lists.deleteRemote(id);
	} catch (err) {
		listError =
			err instanceof Error && err.message.includes('409')
				? 'Cannot delete: list still has tasks.'
				: err instanceof Error
					? err.message
					: String(err);
	} finally {
		busy = false;
	}
};
</script>

<nav class="sidebar">
	<div class="app-title">tasksync</div>
	<div class="section-label">Today</div>
	{#if $lists}
		{#each [...$lists].sort((a, b) => (a.id === 'my-day' ? -1 : b.id === 'my-day' ? 1 : (a.order ?? '').localeCompare(b.order ?? ''))) as list}
			{#if list.id === 'my-day'}
				<a class:selected={$page.url.pathname === '/'} href="/">
					<span class="icon">🌅</span>
					<span>{list.name}</span>
					<span class="count">{$myDayPending?.length ?? 0}</span>
				</a>
			{:else}
				<a
					class:selected={$page.url.pathname === `/list/${list.id}`}
					href={`/list/${list.id}`}
				>
					<span class="icon">{list.icon ?? '•'}</span>
					<span>{list.name}</span>
					<span class="count">{$listCounts?.[list.id]?.pending ?? 0}</span>
				</a>
			{/if}
		{/each}
	{/if}
	<div class="section-label muted">Collections</div>
	<button class="add" type="button" on:click={() => (showManager = !showManager)}>
		{showManager ? 'Close list manager' : '+ New list'}
	</button>
	{#if showManager}
		<div class="manager">
			<label>
				Name
				<input
					type="text"
					placeholder="List name"
					bind:value={newListName}
					on:keydown={(e) => e.key === 'Enter' && createList()}
				/>
			</label>
			<label>
				Icon (optional)
				<input
					type="text"
					placeholder="emoji"
					maxlength="3"
					bind:value={newListIcon}
					on:keydown={(e) => e.key === 'Enter' && createList()}
				/>
			</label>
			<button type="button" class="primary" on:click={createList} disabled={busy || !newListName.trim()}>
				Create list
			</button>
			{#if listError}
				<p class="error">{listError}</p>
			{/if}
			<div class="existing">
				{#each $lists.filter((l) => l.id !== 'my-day') as list}
					<div class="row">
						<input
							type="text"
							placeholder={list.name}
							bind:value={renameDraft[list.id]}
							on:keydown={(e) => e.key === 'Enter' && renameList(list.id)}
						/>
						<button type="button" on:click={() => renameList(list.id)} disabled={busy}>
							Rename
						</button>
						<button type="button" class="ghost" on:click={() => deleteList(list.id)} disabled={busy}>
							Delete
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</nav>

<style>
	.sidebar {
		width: 240px;
		background: #0a0f1c;
		border-right: 1px solid #131a2d;
		color: #cbd5e1;
		padding: 16px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100vh;
		position: sticky;
		top: 0;
		overflow-y: auto;
	}

	.app-title {
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #e2e8f0;
		margin-bottom: 8px;
	}

	.section-label {
		text-transform: uppercase;
		font-size: 11px;
		color: #64748b;
		margin: 6px 6px 2px;
	}

	.section-label.muted {
		color: #475569;
	}

	a {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		align-items: center;
		gap: 8px;
		color: #cbd5e1;
		text-decoration: none;
		padding: 8px 10px;
		border-radius: 10px;
		transition: background 120ms ease, color 120ms ease;
	}

	a:hover {
		background: #11192b;
	}

	a.selected {
		background: linear-gradient(90deg, #1f2a44, #182135);
		color: #e2e8f0;
	}

	.icon {
		font-size: 15px;
	}

	.count {
		font-size: 12px;
		color: #94a3b8;
	}

	.add {
		color: #e2e8f0;
		background: #11192b;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 8px 10px;
		text-align: left;
		cursor: pointer;
	}

	.manager {
		margin-top: 8px;
		border: 1px solid #1f2937;
		border-radius: 10px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: #0c1322;
	}

	.manager label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #cbd5e1;
	}

	.manager input {
		background: #0f172a;
		border: 1px solid #1f2937;
		color: #e2e8f0;
		border-radius: 8px;
		padding: 6px 8px;
	}

	.manager .row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 6px;
		align-items: center;
	}

	.manager button.primary {
		background: #1d4ed8;
		border: none;
		color: #fff;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.manager button.ghost {
		background: #0b1221;
		border: 1px solid #1f2937;
		color: #cbd5e1;
		padding: 8px 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.manager .existing {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 6px;
	}

	.error {
		color: #ef4444;
		font-size: 12px;
	}
</style>
