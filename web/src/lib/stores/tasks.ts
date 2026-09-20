import { derived, get, readable, writable } from 'svelte/store';
import type { Task } from '$shared/types/task';
import { repo } from '$lib/data/repo';
export { setDbScope } from '$lib/data/idb';
import { playCompletion } from '$lib/sound/sound';
import { soundSettings } from '$lib/stores/settings';
import { auth } from '$lib/stores/auth';
import { lists } from '$lib/stores/lists';
import { api } from '$lib/api/client';
import { streak } from '$lib/stores/streak';
import {
	nextDueForRecurrence,
	prevDueForRecurrence,
	toLocalIsoDate
} from '$lib/tasks/recurrence';

const tasksStore = writable<Task[]>([]);

// ── Quick-delete grace window (feat-quick-task-delete-undo) ──────────────────
// A soft-deleted task STAYS in tasksStore (so a sync pull that lands during the
// grace window can't resurrect it) but is filtered out of every derived view via
// `visibleTasks`. One grace window at a time — it holds a SET of ids so a bulk
// delete stages many tasks under a single window/timer; starting a new window
// commits the previous one. Commit calls the real `deleteRemote` per id; undo
// just clears the flag(s), so undo is instant and makes no server call. A single
// delete is simply a batch of one. See the fix plan for the rationale.
const GRACE_DELETE_MS = 5000;
const pendingDeleteIds = writable<Set<string>>(new Set());
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null = null;

/** Tasks minus those in the soft-delete grace window — what every view renders. */
const visibleTasks = derived([tasksStore, pendingDeleteIds], ([$tasks, $pending]) =>
	$pending.size === 0 ? $tasks : $tasks.filter((task) => !$pending.has(task.id))
);

/**
 * The single task in its grace window when EXACTLY one is staged (drives the
 * single-task undo toast), or null. A batch of two or more uses `pendingDeleteBatch`.
 */
export const pendingDelete = derived([tasksStore, pendingDeleteIds], ([$tasks, $pending]) => {
	if ($pending.size !== 1) return null;
	const [id] = $pending;
	return $tasks.find((task) => task.id === id) ?? null;
});

/** The batched grace window when TWO OR MORE are staged (drives the "N deleted" toast), else null. */
export const pendingDeleteBatch = derived(pendingDeleteIds, ($pending) =>
	$pending.size >= 2 ? { count: $pending.size } : null
);

function clearPendingDeleteTimer() {
	if (pendingDeleteTimer !== null) {
		clearTimeout(pendingDeleteTimer);
		pendingDeleteTimer = null;
	}
}

// Un-stage one id from the grace window once its real delete resolves. Guarded so
// a newer soft-delete window (which replaced the set) is never disturbed.
function unstageCommitted(id: string) {
	pendingDeleteIds.update((current) => {
		if (!current.has(id)) return current;
		const next = new Set(current);
		next.delete(id);
		return next;
	});
}

// Fire the real delete for every task in the grace window (if any). Called by the
// grace timer, when a new window starts, or explicitly (e.g. on navigation).
function commitPendingDelete() {
	const ids = get(pendingDeleteIds);
	if (ids.size === 0) return;
	clearPendingDeleteTimer();
	// Keep each task filtered (its id still staged) until deleteRemote has actually
	// removed it — otherwise a synced task, whose delete awaits a network round-trip,
	// would flash back into view mid-commit. Un-stage per id, and only if it's still
	// staged (a newer window may have taken over the set).
	for (const id of ids) {
		void tasks
			.deleteRemote(id)
			.catch((err: unknown) => console.error('deleteRemote failed', err))
			.finally(() => unstageCommitted(id));
	}
}

const isServerId = (id: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const todayIso = () => toLocalIsoDate(new Date());

export interface TaskImportInput {
	title: string;
	status?: Task['status'];
	list_id?: string;
	my_day?: boolean;
}

export interface TaskImportResult {
	created: number;
	skipped: number;
	reactivated: number;
}

const makeLocalTask = (
	title: string,
	list_id: string,
	opts?: {
		my_day?: boolean;
		status?: Task['status'];
		priority?: Task['priority'];
		due_date?: string;
		recurrence_id?: string;
		url?: string;
		notes?: string;
		assignee_user_id?: string;
		emoji?: string;
	}
) => {
	const nowTs = Date.now();
	// Mint a BARE UUID (no `local-` prefix) so the task's id is stable through the
	// create→sync-ack lifecycle: the server accepts this id verbatim and acks it
	// back unchanged, so replaceWithRemote's `id: remote.id` is a same-value no-op
	// and the Svelte {#each (task.id)} rows + the details-drawer detailId lookup
	// never lose their key mid-edit. Optimistic state lives in `local`/`dirty`,
	// not the id shape (see fix-add-task-details-reload plan). The non-crypto
	// fallback keeps a `local-` id — a degenerate path that never syncs anyway.
	const id = crypto.randomUUID ? crypto.randomUUID() : `local-${nowTs.toString(36)}`;
	const order = `local-${nowTs}`;
	const currentUserId = auth.get().user?.user_id;
	const task: Task = {
		id,
		title,
		priority: opts?.priority ?? 0,
		status: opts?.status ?? 'pending',
		list_id,
		my_day: opts?.my_day ?? false,
		emoji: opts?.emoji,
		checklist: [],
		order,
		due_date: opts?.due_date,
		recurrence_id: opts?.recurrence_id,
		url: opts?.url,
		notes: opts?.notes,
		assignee_user_id: opts?.assignee_user_id ?? currentUserId,
		created_by_user_id: currentUserId,
		occurrences_completed: 0,
		completed_ts: undefined,
		created_ts: nowTs,
		updated_ts: nowTs,
		dirty: true,
		local: true
	};
	return task;
};

const normalizedImportKey = (title: string, listId: string) =>
	`${listId.trim().toLowerCase()}::${title.trim().replace(/\s+/g, ' ').toLowerCase()}`;

const hasChangesSinceCreate = (current: Task, sent: Task) =>
	current.title !== sent.title ||
	current.status !== sent.status ||
	current.list_id !== sent.list_id ||
	current.my_day !== sent.my_day ||
	current.priority !== sent.priority ||
	current.order !== sent.order ||
	current.url !== sent.url ||
	current.recurrence_id !== sent.recurrence_id ||
	current.due_date !== sent.due_date ||
	(current.completed_ts ?? 0) !== (sent.completed_ts ?? 0) ||
	current.notes !== sent.notes ||
	current.assignee_user_id !== sent.assignee_user_id ||
	(current.occurrences_completed ?? 0) !== (sent.occurrences_completed ?? 0) ||
	current.punted_from_due_date !== sent.punted_from_due_date ||
	current.punted_on_date !== sent.punted_on_date ||
	current.emoji !== sent.emoji;

const clearPuntState = (task: Task) => ({
	...task,
	punted_from_due_date: undefined,
	punted_on_date: undefined
});

// Strip punt state from a task received from the server when it is stale.
// Punt state is valid only when due_date === punted_on_date + 1 calendar day.
// If due_date has advanced further, the task was completed and rolled to the
// next occurrence but punt fields were not cleared (the server-side COALESCE
// bug). Sanitizing here prevents the stale state from re-entering the local cache.
const sanitizeIncomingPuntState = (task: Task): Task => {
	if (!task.punted_on_date || !task.punted_from_due_date || !task.due_date) return task;
	const expectedDue = nextDueForRecurrence(task.punted_on_date, 'daily');
	if (task.due_date === expectedDue) return task;
	return { ...task, punted_from_due_date: undefined, punted_on_date: undefined };
};

const nextRecurringDueAfterCurrent = (task: Task) => {
	const anchor = task.punted_from_due_date ?? task.due_date;
	let next = nextDueForRecurrence(anchor, task.recurrence_id);
	if (!next) return task.due_date;
	while (task.due_date && next <= task.due_date) {
		const candidate = nextDueForRecurrence(next, task.recurrence_id);
		if (!candidate || candidate === next) break;
		next = candidate;
	}
	return next;
};

const nextRecurringDueAfterToday = (task: Task) => {
	const today = todayIso();
	const anchor = task.punted_from_due_date ?? task.due_date;
	let next = nextDueForRecurrence(anchor, task.recurrence_id);
	if (!next) return task.due_date;
	while (next <= today) {
		const candidate = nextDueForRecurrence(next, task.recurrence_id);
		if (!candidate || candidate === next) break;
		next = candidate;
	}
	return next;
};

const preservePuntState = (incoming: Task, existing?: Task) => {
	if (
		!existing?.punted_from_due_date &&
		!existing?.punted_on_date
	) {
		return incoming;
	}
	if (
		existing.recurrence_id !== incoming.recurrence_id ||
		existing.status !== 'pending' ||
		incoming.status !== 'pending' ||
		existing.due_date !== incoming.due_date
	) {
		return incoming;
	}
	// Only preserve punt state that satisfies the invariant: due_date must equal
	// punted_on_date + 1 calendar day. If existing has stale punt (due_date has
	// advanced further, meaning the task was completed and rolled to the next
	// occurrence without clearing punt fields), do not copy it onto incoming.
	const expectedDue = nextDueForRecurrence(existing.punted_on_date, 'daily');
	if (existing.due_date !== expectedDue) {
		return incoming;
	}
	return {
		...incoming,
		punted_from_due_date: existing.punted_from_due_date,
		punted_on_date: existing.punted_on_date
	};
};

const updateAndPersist = (fn: (list: Task[]) => Task[]) => {
	tasksStore.update(fn);
	void repo.saveTasks(get(tasksStore)).catch((err: unknown) => console.error('[repo] saveTasks failed', err));
};

export const tasks = {
	// Components see VISIBLE tasks (a soft-deleted task is hidden during its grace
	// window); internal methods use get(tasksStore) for the raw list.
	subscribe: visibleTasks.subscribe,
	add(task: Task) {
		updateAndPersist((list) => [...list, task]);
	},
	createLocalWithOptions(
		title: string,
		list_id: string,
		opts?: {
			my_day?: boolean;
			status?: Task['status'];
			priority?: Task['priority'];
			assignee_user_id?: string;
			due_date?: string;
			emoji?: string;
		}
	) {
		const trimmed = title.trim();
		if (!trimmed) return;
		// A list's default tag (D10) only applies when the caller didn't already
		// pick one. `|| undefined` (not `??`) because clearing a list's default
		// via the icon/color-style "send empty string" idiom (Sidebar.svelte)
		// stores literal '' server-side, not null -- an empty string is never a
		// valid tag (D2 requires at least one grapheme), so treat it as absent.
		const defaultEmoji = get(lists).find((l) => l.id === list_id)?.default_emoji || undefined;
		const task = makeLocalTask(trimmed, list_id, {
			...opts,
			emoji: opts?.emoji ?? defaultEmoji
		});
		updateAndPersist((list) => [...list, task]);
		return task;
	},
	importBatch(
		items: TaskImportInput[],
		fallbackListId: string,
		opts?: { ownerUserId?: string }
	): TaskImportResult {
		const existingByKey = new Map(
			get(tasksStore).map((task) => [normalizedImportKey(task.title, task.list_id), task])
		);
		const batchKeys = new Set<string>();
		let created = 0;
		let skipped = 0;
		let reactivated = 0;
		const currentUserId = auth.get().user?.user_id;
		const ownerUserId = opts?.ownerUserId;
		// See the comment in createLocalWithOptions -- '' (cleared via the
		// icon/color idiom) must be treated the same as "no default", not as a
		// literal empty tag.
		const defaultEmojiByListId = new Map(get(lists).map((l) => [l.id, l.default_emoji || undefined]));

		updateAndPersist((list) => {
			const next = [...list];
			for (const item of items) {
				const title = item.title?.trim();
				if (!title) continue;
				const list_id = (item.list_id ?? fallbackListId ?? '').trim() || fallbackListId;
				const key = normalizedImportKey(title, list_id);
				const existing = existingByKey.get(key);
				if (existing) {
					const canEditExisting =
						!ownerUserId || !existing.created_by_user_id || existing.created_by_user_id === ownerUserId;
					if (canEditExisting && existing.status === 'done') {
						const updated = {
							...existing,
							status: 'pending' as Task['status'],
							completed_ts: undefined,
							updated_ts: Date.now(),
							dirty: true
						};
						const index = next.findIndex((task) => task.id === existing.id);
						if (index >= 0) {
							next[index] = updated;
						}
						existingByKey.set(key, updated);
						reactivated += 1;
					}
					skipped += 1;
					continue;
				}
				if (batchKeys.has(key)) {
					skipped += 1;
					continue;
				}
				const task = makeLocalTask(title, list_id, {
					status: item.status === 'done' ? 'done' : 'pending',
					my_day: !!item.my_day,
					emoji: defaultEmojiByListId.get(list_id)
				});
				if (task.status === 'done') {
					task.completed_ts = task.updated_ts;
				}
				if (!task.assignee_user_id) {
					task.assignee_user_id = currentUserId;
				}
				next.push(task);
				batchKeys.add(key);
				existingByKey.set(key, task);
				created += 1;
			}
			return next;
		});
		return { created, skipped, reactivated };
	},
	uncheckAllInList(listId: string, opts?: { ownerUserId?: string }): number {
		const now = Date.now();
		let changed = 0;
		tasksStore.update((list) =>
			list.map((task) => {
				if (task.list_id !== listId || task.status !== 'done') return task;
				if (opts?.ownerUserId && task.created_by_user_id !== opts.ownerUserId) return task;
				changed += 1;
				return {
					...task,
					status: 'pending',
					completed_ts: undefined,
					updated_ts: now,
					dirty: true
				};
			})
		);
		if (changed > 0) {
			void repo.saveTasks(get(tasksStore)).catch((err: unknown) => console.error('[repo] saveTasks failed', err));
		}
		return changed;
	},
	/**
	 * Bulk-complete a list's pending tasks (the mirror of uncheckAllInList).
	 * A recurring task advances one occurrence exactly like a single toggle
	 * (status stays pending, due date rolls forward). Contributor-scoped
	 * identically. Side effects are batched: streak accounting is silent
	 * (no per-task overlay/announcer), and the day-complete check + at most one
	 * completion sound fire once for the whole action.
	 */
	checkAllInList(listId: string, opts?: { ownerUserId?: string }): number {
		const now = Date.now();
		const completedIds: string[] = [];
		const recurringIds = new Set<string>();
		tasksStore.update((list) =>
			list.map((task) => {
				if (task.list_id !== listId || task.status !== 'pending') return task;
				if (opts?.ownerUserId && task.created_by_user_id !== opts.ownerUserId) return task;
				if (task.recurrence_id) {
					// A recurring task already advanced today is "done for today" — don't
					// advance it a second occurrence (that would skip an occurrence).
					if (wasRecurringCompletedToday(task)) return task;
					recurringIds.add(task.id);
					completedIds.push(task.id);
					return {
						...clearPuntState(task),
						status: 'pending',
						due_date: nextRecurringDueAfterCurrent(task),
						occurrences_completed: (task.occurrences_completed ?? 0) + 1,
						completed_ts: now,
						updated_ts: now,
						dirty: true
					};
				}
				completedIds.push(task.id);
				return {
					...task,
					status: 'done',
					punted_from_due_date: undefined,
					punted_on_date: undefined,
					completed_ts: now,
					updated_ts: now,
					dirty: true
				};
			})
		);
		if (completedIds.length === 0) return 0;
		void repo.saveTasks(get(tasksStore)).catch((err: unknown) => console.error('[repo] saveTasks failed', err));
		for (const id of completedIds) {
			// Silent: keep streak accounting, suppress per-task overlay/announcer.
			streak.increment(id, { silent: true });
			// Recurring reuses its id across occurrences — undo the count so the next
			// occurrence can still count, exactly like toggle().
			if (recurringIds.has(id)) streak.undoCompletion(id);
		}
		// One day-complete evaluation + at most one completion sound for the batch.
		const isLastMyDayTask = get(myDayPending).length === 0 && get(myDayCompleted).length > 0;
		const willDayComplete = isLastMyDayTask && streak.triggerDayComplete();
		if (!willDayComplete) {
			void playCompletion(soundSettings.get());
		}
		return completedIds.length;
	},
	setAll(next: Task[]) {
		tasksStore.set(next);
		void repo.saveTasks(next).catch((err: unknown) => console.error('[repo] saveTasks failed', err));
	},
	mergeRemote(remote: Task[]) {
		updateAndPersist((current) => {
			// Sync pull is incremental, so start with local cache and layer remote deltas on top.
			const merged = new Map<string, Task>();
			for (const task of current) {
				merged.set(task.id, task);
			}
			for (const task of remote) {
				const existing = merged.get(task.id);
				if (existing?.dirty) continue;
				merged.set(task.id, preservePuntState(sanitizeIncomingPuntState(task), existing));
			}
			return Array.from(merged.values());
		});
	},
	applyRemoteDeletes(deleted: { id: string; deleted_ts: number }[]) {
		if (!deleted.length) return;
		const deletedTsById = new Map<string, number>();
		for (const tombstone of deleted) {
			const prior = deletedTsById.get(tombstone.id);
			if (prior === undefined || tombstone.deleted_ts > prior) {
				deletedTsById.set(tombstone.id, tombstone.deleted_ts);
			}
		}
		updateAndPersist((current) =>
			current.filter((task) => {
				const deletedTs = deletedTsById.get(task.id);
				if (deletedTs === undefined) return true;
				// Keep only clean tasks that are newer than the tombstone (recreate-after-delete case).
				if (!task.dirty && task.updated_ts > deletedTs) return true;
				return false;
			})
		);
	},
	toggle(id: string) {
		let shouldPlayCompletion = false;
		let didComplete = false;
		let didUncomplete = false;
		let isRecurring = false;
		updateAndPersist((list) =>
			list.map((task) =>
				task.id === id
					? (() => {
							const now = Date.now();
							if (task.recurrence_id && task.status !== 'done') {
								shouldPlayCompletion = true;
								didComplete = true;
								isRecurring = true;
								const next = nextRecurringDueAfterCurrent(task);
								return {
									...clearPuntState(task),
									status: 'pending',
									due_date: next,
									occurrences_completed: (task.occurrences_completed ?? 0) + 1,
									completed_ts: now,
									updated_ts: now,
									dirty: true
								};
							}
							const nextStatus = task.status === 'done' ? 'pending' : 'done';
							if (nextStatus === 'done') {
								shouldPlayCompletion = true;
								didComplete = true;
							} else {
								didUncomplete = true;
							}
							return {
								...task,
								status: nextStatus,
								punted_from_due_date: undefined,
								punted_on_date: undefined,
								completed_ts: nextStatus === 'done' ? now : undefined,
								updated_ts: now,
								dirty: true
							};
						})()
					: task
			)
		);
		if (didComplete) {
			const willAnnounce = streak.increment(id);
			// Recurring tasks reuse the same ID for every occurrence — remove it from
			// countedTaskIds so the NEXT occurrence can count too.
			if (isRecurring) {
				streak.undoCompletion(id);
			}
			// Check if this was the final pending My Day task → day-complete celebration.
			// myDayPending is a derived store that already reflects the post-toggle state.
			const isLastMyDayTask =
				get(myDayPending).length === 0 &&
				get(myDayCompleted).length > 0;
			const willDayComplete = isLastMyDayTask && streak.triggerDayComplete();
			// Announcer or day-complete takes over audio duty; skip the regular sound.
			if (shouldPlayCompletion && !willAnnounce && !willDayComplete) {
				void playCompletion(soundSettings.get());
			}
		} else if (didUncomplete) {
			streak.undoCompletion(id);
		}
	},
	getAll() {
		return get(tasksStore);
	},
	clearDirty(id: string) {
		updateAndPersist((list) =>
			list.map((task) => (task.id === id ? { ...task, dirty: false } : task))
		);
	},
	remove(id: string) {
		updateAndPersist((list) => list.filter((t) => t.id !== id));
	},
	async deleteRemote(id: string) {
		const existing = tasks.getAll().find((task) => task.id === id);
		if (!existing) return;
		if (existing.local || !isServerId(existing.id)) {
			tasks.remove(id);
			return;
		}
		await api.deleteTask(existing.id);
		tasks.remove(id);
	},
	/**
	 * Soft-delete one task with an undo grace window: hide it from all views now,
	 * but defer the real delete until the window commits. A batch of one — a new
	 * soft-delete commits any previous window. No-op if the id isn't a known task.
	 */
	softDelete(id: string) {
		tasks.softDeleteMany([id]);
	},
	/**
	 * Soft-delete many tasks under a SINGLE grace window: hide them all now, defer
	 * the real per-task delete until commit, and restore them all together on undo.
	 * Starting this window commits any previous one. Unknown/duplicate ids are
	 * dropped; a no-op if none are known tasks.
	 */
	softDeleteMany(ids: string[]) {
		commitPendingDelete();
		const known = get(tasksStore);
		const staged = new Set(ids.filter((id) => known.some((task) => task.id === id)));
		if (staged.size === 0) return;
		pendingDeleteIds.set(staged);
		pendingDeleteTimer = setTimeout(commitPendingDelete, GRACE_DELETE_MS);
	},
	/**
	 * Cancel the pending grace window if `id` is staged in it (every staged task
	 * reappears; no server call). Wired to the single-task undo toast, which only
	 * shows at window size 1, so in practice this cancels exactly that one task;
	 * `undoDeleteAll` is the size-agnostic form used by the batched toast.
	 */
	undoDelete(id: string) {
		if (!get(pendingDeleteIds).has(id)) return;
		clearPendingDeleteTimer();
		pendingDeleteIds.set(new Set());
	},
	/** Cancel the entire pending grace window (every staged task reappears; no server call). */
	undoDeleteAll() {
		if (get(pendingDeleteIds).size === 0) return;
		clearPendingDeleteTimer();
		pendingDeleteIds.set(new Set());
	},
	/** Commit any in-flight soft-delete immediately (e.g. on navigation/unload). */
	commitDelete() {
		commitPendingDelete();
	},
	async clearListRemote(listId: string): Promise<number> {
		const { deleted_count } = await api.clearListTasks(listId);
		updateAndPersist((list) => list.filter((t) => t.list_id !== listId));
		return deleted_count;
	},
	moveToList(id: string, list_id: string) {
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							list_id,
							dirty: true,
							updated_ts: Date.now()
						}
					: t
			)
		);
	},
	rename(id: string, title: string) {
		const trimmed = title.trim();
		if (!trimmed) return;
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							title: trimmed,
							updated_ts: now,
							dirty: true
						}
					: t
			)
		);
	},
	setDueToday(id: string) {
		const today = todayIso();
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? { ...clearPuntState(t), due_date: today, my_day: false, dirty: true, updated_ts: now }
					: t
			)
		);
	},
	setDueDate(id: string, due_date?: string) {
		const now = Date.now();
		const isFutureOrToday = !!due_date && due_date >= todayIso();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...clearPuntState(t),
							due_date,
							...(isFutureOrToday ? { my_day: false } : {}),
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
	},
	catchUp(id: string) {
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((task) => {
				if (task.id !== id) return task;
				if (!task.recurrence_id || !task.due_date) return task;
				const next = nextRecurringDueAfterToday(task);
				if (!next || next === task.due_date) return task;
				return { ...clearPuntState(task), due_date: next, dirty: true, updated_ts: now };
			})
		);
	},
	setPriority(id: string, priority: Task['priority']) {
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							priority,
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
	},
	setEmoji(id: string, emoji?: string) {
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							emoji,
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
	},
	setAssignee(id: string, assignee_user_id?: string) {
		const now = Date.now();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							assignee_user_id,
							dirty: true,
							updated_ts: now
						}
					: t
			)
		);
	},
	skip(id: string) {
		const now = Date.now();
		let didSkip = false;
		updateAndPersist((list) =>
			list.map((t) => {
				if (t.id === id && !!t.recurrence_id) {
					didSkip = true;
					return {
						...clearPuntState(t),
						due_date: nextRecurringDueAfterToday(t),
						updated_ts: now,
						dirty: true
					};
				}
				return t;
			})
		);
		if (didSkip) {
			streak.break();
		}
	},
	punt(id: string) {
		const now = Date.now();
		const today = todayIso();
		let didPunt = false;
		updateAndPersist((list) =>
			list.map((task) => {
				if (
					task.id !== id ||
					task.status !== 'pending' ||
					task.due_date !== today
				) {
					return task;
				}
				// Daily recurrence already lands on tomorrow by design; punting is a no-op.
				if (task.recurrence_id === 'daily') return task;
				const tomorrow = nextDueForRecurrence(task.due_date, 'daily');
				if (!tomorrow) return task;
				didPunt = true;
				return {
					...task,
					my_day: false,
					due_date: tomorrow,
					punted_from_due_date: task.punted_from_due_date ?? task.due_date,
					punted_on_date: today,
					updated_ts: now,
					dirty: true
				};
			})
		);
		if (didPunt) {
			streak.break();
		}
	},
	undoRecurringCompletion(id: string) {
		const now = Date.now();
		const isCompletionFromToday = (ts?: number) =>
			typeof ts === 'number' && Number.isFinite(ts) && toLocalIsoDate(new Date(ts)) === todayIso();
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id &&
				!!t.recurrence_id &&
				t.status === 'pending' &&
				isCompletionFromToday(t.completed_ts)
					? {
							...t,
							due_date: prevDueForRecurrence(t.due_date, t.recurrence_id),
							occurrences_completed: Math.max(0, (t.occurrences_completed ?? 0) - 1),
							completed_ts: undefined,
							updated_ts: now,
							dirty: true
						}
					: t
			)
		);
	},
	saveFromDetails(
		id: string,
		details: {
			title: string;
			url?: string;
			recurrence_id?: string;
			due_date?: string;
			notes: string;
			priority: Task['priority'];
			my_day: boolean;
			list_id: string;
			assignee_user_id?: string;
			emoji?: string;
		}
	) {
		const now = Date.now();
		const trimmedTitle = details.title.trim();
		updateAndPersist((list) =>
			list.map((t) => {
				if (t.id !== id) return t;
				const clearsPuntState =
					details.due_date !== t.due_date || details.recurrence_id !== t.recurrence_id;
				return {
					...t,
					title: trimmedTitle || t.title,
					url: details.url,
					recurrence_id: details.recurrence_id,
					due_date: details.due_date,
					notes: details.notes,
					priority: details.priority,
					my_day: details.my_day,
					list_id: details.list_id || t.list_id,
					assignee_user_id: details.assignee_user_id,
					emoji: details.emoji,
					...(clearsPuntState
						? { punted_from_due_date: undefined, punted_on_date: undefined }
						: {}),
					updated_ts: now,
					dirty: true
				};
			})
		);
	},
	updateDetails(
		id: string,
		details: {
			url?: string;
			recurrence_id?: string;
			due_date?: string;
			notes?: string;
			occurrences_completed?: number;
			completed_ts?: number;
		}
	) {
		const clearsPuntState = details.due_date !== undefined || details.recurrence_id !== undefined;
		updateAndPersist((list) =>
			list.map((t) =>
				t.id === id
					? {
							...t,
							url: details.url ?? t.url,
							recurrence_id: details.recurrence_id ?? t.recurrence_id,
							due_date: details.due_date ?? t.due_date,
							notes: details.notes ?? t.notes,
							occurrences_completed:
								details.occurrences_completed ?? t.occurrences_completed ?? 0,
							completed_ts: details.completed_ts ?? t.completed_ts,
							...(clearsPuntState
								? { punted_from_due_date: undefined, punted_on_date: undefined }
								: {}),
							updated_ts: Date.now(),
							dirty: true
						}
					: t
			)
		);
	},
	replaceWithRemote(localId: string, remote: Task, sent?: Task) {
		updateAndPersist((list) =>
			list.map((task) =>
				task.id === localId
					? sent && hasChangesSinceCreate(task, sent)
						? {
								...task,
								id: remote.id,
								local: false,
								dirty: true
							}
						: preservePuntState(sanitizeIncomingPuntState({ ...remote, dirty: false, local: false }), task)
					: task
			)
		);
	},
	async hydrateFromDb() {
		const { tasks: stored } = await repo.loadAll();
		tasksStore.set(stored);
	}
};

const isToday = (date?: string) => date && date === todayIso();
const isBeforeToday = (date?: string) => !!date && date < todayIso();
const isTodayTs = (ts?: number) =>
	typeof ts === 'number' && Number.isFinite(ts) && toLocalIsoDate(new Date(ts)) === todayIso();
const myDayDateKey = readable(todayIso(), (set) => {
	if (typeof window === 'undefined') return;
	let lastSeenDay = todayIso();
	const tick = () => {
		const nextDay = todayIso();
		if (nextDay === lastSeenDay) return;
		lastSeenDay = nextDay;
		set(nextDay);
	};
	const intervalId = window.setInterval(tick, 60 * 1000);
	return () => {
		window.clearInterval(intervalId);
	};
});
// TODO: implement per-user permission filtering (tech debt #005)
const isAssignedToUser = (task: Task, userId?: string | null) => {
	if (!userId) return true;
	return (task.assignee_user_id ?? task.created_by_user_id) === userId;
};

const inMyDay = (task: Task) => {
	if (task.my_day) return true;
	return isToday(task.due_date);
};

const isMissedTask = (task: Task) => task.status === 'pending' && isBeforeToday(task.due_date);
const wasRecurringCompletedToday = (task: Task) =>
	!!task.recurrence_id && task.status === 'pending' && isTodayTs(task.completed_ts);
const wasPuntedToday = (task: Task) =>
	task.status === 'pending' && task.punted_on_date === todayIso() && !!task.punted_from_due_date;

const wasCompletedToday = (task: Task) => {
	if (task.status !== 'done') return false;
	return isTodayTs(task.completed_ts ?? task.updated_ts);
};

export const myDayPending = derived(
	[visibleTasks, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		return $tasks.filter(
			(task) =>
				isAssignedToUser(task, $auth.user?.user_id) &&
				inMyDay(task) &&
				!isMissedTask(task) &&
				task.status === 'pending'
		);
	}
);

export const myDayMissed = derived([visibleTasks, auth, myDayDateKey], ([$tasks, $auth, _myDayDateKey]) => {
	void _myDayDateKey;
	return $tasks
		.filter(
			(task) =>
				isAssignedToUser(task, $auth.user?.user_id) &&
				isMissedTask(task)
		)
		.sort((a, b) => {
			const dueA = a.due_date ?? '';
			const dueB = b.due_date ?? '';
			if (dueA !== dueB) return dueA < dueB ? -1 : 1;
			if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
			return a.created_ts - b.created_ts;
		});
});

export const myDayCompleted = derived(
	[visibleTasks, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		return $tasks.filter(
			(task) =>
				isAssignedToUser(task, $auth.user?.user_id) &&
				((inMyDay(task) && wasCompletedToday(task)) ||
					wasRecurringCompletedToday(task) ||
					wasPuntedToday(task))
		);
	}
);

export const myDaySuggestions = derived(
	[visibleTasks, auth, myDayDateKey],
	([$tasks, $auth, _myDayDateKey]) => {
		void _myDayDateKey;
		const today = todayIso();
		const tomorrow = nextDueForRecurrence(today, 'daily') ?? today;
		return $tasks
			.filter(
				(t) =>
					isAssignedToUser(t, $auth.user?.user_id) &&
					t.status === 'pending' &&
					!t.recurrence_id &&
					!inMyDay(t) &&
					(t.due_date === today || t.due_date === tomorrow || (!t.due_date && t.priority > 0))
			)
			.sort((a, b) => {
				// Prioritize due today, then tomorrow, then priority
				const aScore = a.due_date === today ? 2 : a.due_date === tomorrow ? 1 : 0;
				const bScore = b.due_date === today ? 2 : b.due_date === tomorrow ? 1 : 0;
				if (aScore !== bScore) return bScore - aScore;
				if ((b.priority ?? 0) !== (a.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0);
				return a.created_ts - b.created_ts;
			})
			.slice(0, 6);
	}
);

export const tasksByList = (listId: string) =>
	derived([visibleTasks, auth], ([$tasks]) =>
		$tasks.filter((task) => task.list_id === listId)
	);

export const listCounts = derived([visibleTasks], ([$tasks]) => {
	return $tasks.reduce<Record<string, { pending: number; total: number }>>((acc, task) => {
		const entry = acc[task.list_id] ?? { pending: 0, total: 0 };
		entry.total += 1;
		if (task.status === 'pending') entry.pending += 1;
		acc[task.list_id] = entry;
		return acc;
	}, {});
});

export const getTask = (id: string) => {
	return get(tasksStore).find((t) => t.id === id);
};
