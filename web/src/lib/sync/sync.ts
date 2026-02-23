import { api, apiErrorStatus } from '$lib/api/client';
import { lists } from '$lib/stores/lists';
import { tasks } from '$lib/stores/tasks';
import { repo } from '$lib/data/repo';
import { syncStatus } from './status';
import type { Task } from '$shared/types/task';
import type { List } from '$shared/types/list';
import type { ApiTask } from '$lib/api/client';
import type { SyncDeletedTask, SyncPushChange, SyncPushRejected, SyncTask } from '$shared/types/sync';

const isServerId = (id: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const requestIdForLocalTask = (id: string): string | undefined => {
	if (isServerId(id)) return id;
	const localPrefix = 'local-';
	if (id.startsWith(localPrefix)) {
		const maybeUuid = id.slice(localPrefix.length);
		if (isServerId(maybeUuid)) return maybeUuid;
	}
	return undefined;
};

const toTaskPriority = (value?: number): Task['priority'] => {
	if (value === 1 || value === 2 || value === 3) return value;
	return 0;
};

let lastPullCursorTs: number | undefined;

export const resetSyncCursor = () => {
	lastPullCursorTs = undefined;
};

const bumpSyncCursor = (cursorTs?: number) => {
	if (typeof cursorTs !== 'number' || !Number.isFinite(cursorTs)) return;
	lastPullCursorTs = Math.max(lastPullCursorTs ?? 0, cursorTs);
};

const mapApiTask = (t: ApiTask | SyncTask): Task => ({
	id: t.id,
	title: t.title,
	status: t.status as Task['status'],
	list_id: t.list_id,
	my_day: t.my_day === 1,
	dirty: false,
	local: false,
	priority: toTaskPriority(typeof t.priority === 'number' ? t.priority : undefined),
	tags: [],
	checklist: [],
	order: t.order,
	url: t.url ?? undefined,
	recurrence_id: t.recur_rule ?? undefined,
	due_date: t.due_date ?? undefined,
	punted_from_due_date: t.punted_from_due_date ?? undefined,
	punted_on_date: t.punted_on_date ?? undefined,
	occurrences_completed: t.occurrences_completed ?? 0,
	completed_ts: t.completed_ts ?? undefined,
	notes: t.notes ?? undefined,
	assignee_user_id: t.assignee_user_id ?? undefined,
	created_by_user_id: t.created_by_user_id ?? undefined,
	created_ts: t.created_ts,
	updated_ts: t.updated_ts
});

interface PendingPushOp {
	op_id: string;
	kind: SyncPushChange['kind'];
	localTaskId: string;
	sent: Task;
}

const toPushChange = (
	task: Task,
	index: number
): {
	change: SyncPushChange;
	op: PendingPushOp;
} => {
	const op_id = `${task.local ? 'create' : 'update'}-${index}`;
	if (task.local) {
		return {
			change: {
				kind: 'create_task',
				op_id,
				body: {
					id: requestIdForLocalTask(task.id),
					title: task.title,
					list_id: task.list_id,
					order: task.order,
					my_day: task.my_day ?? false,
					priority: task.priority,
					url: task.url,
					recur_rule: task.recurrence_id,
					due_date: task.due_date,
					punted_from_due_date: task.punted_from_due_date,
					punted_on_date: task.punted_on_date,
					notes: task.notes,
					assignee_user_id: task.assignee_user_id
				}
			},
			op: { op_id, kind: 'create_task', localTaskId: task.id, sent: task }
		};
	}

	return {
		change: {
			kind: 'update_task',
			op_id,
			task_id: task.id,
			body: {
				title: task.title,
				status: task.status,
				list_id: task.list_id,
				my_day: task.my_day ?? false,
				priority: task.priority,
				url: task.url,
				recur_rule: task.recurrence_id,
				due_date: task.due_date,
				punted_from_due_date: task.punted_from_due_date,
				punted_on_date: task.punted_on_date,
				notes: task.notes,
				occurrences_completed: task.occurrences_completed,
				assignee_user_id: task.assignee_user_id,
				...(typeof task.completed_ts === 'number'
					? { completed_ts: task.completed_ts }
					: {})
			}
		},
		op: { op_id, kind: 'update_task', localTaskId: task.id, sent: task }
	};
};

const rejectMessage = (rejected: SyncPushRejected) =>
	(() => {
		if (rejected.status === 403) {
			return 'Sync update was denied (403). Your access changed; local edit was cleared.';
		}
		if (rejected.status === 404) {
			return 'Sync target no longer exists (404). Local stale copy was removed.';
		}
		if (rejected.status >= 500) {
			return `Sync push failed due to server error (${rejected.status}).`;
		}
		return `Sync push rejected (${rejected.status}): ${rejected.error}`;
	})();

const isLikelyNetworkError = (err: unknown) =>
	/failed to fetch|networkerror|network request failed/i.test(
		err instanceof Error ? err.message : String(err)
	);

const formatSyncRuntimeError = (err: unknown, phase: 'pull' | 'push') => {
	const code = apiErrorStatus(err);
	if (code === 401 || code === 403) {
		return 'Sync authorization failed. Please sign in again.';
	}
	if (code === 404) {
		return 'Sync endpoint not found (404). Check client/server version compatibility.';
	}
	if (code && code >= 500) {
		return `Server sync is unavailable (${code}). Local changes are preserved and will retry.`;
	}
	if (isLikelyNetworkError(err)) {
		return 'Cannot reach the server. Local changes are safe and will retry automatically.';
	}
	const message = err instanceof Error ? err.message : String(err);
	return `Sync ${phase} failed: ${message}`;
};

export const syncFromServer = async () => {
	syncStatus.setPull('running');
	try {
		const pull = await api.syncPull({
			since_ts: typeof lastPullCursorTs === 'number' ? lastPullCursorTs : undefined
		});
		const toTasks: Task[] = pull.tasks.map(mapApiTask);

		const toLists: List[] = pull.lists.map((l) => ({
			id: l.id,
			name: l.name,
			icon: l.icon ?? undefined,
			color: l.color ?? undefined,
			order: l.order
		}));
		const deletedTasks: SyncDeletedTask[] = pull.deleted_tasks ?? [];

		lists.setAll(toLists);
		tasks.mergeRemote(toTasks);
		tasks.applyRemoteDeletes(deletedTasks);
		bumpSyncCursor(pull.cursor_ts);
		await repo.saveTasks(tasks.getAll());
		syncStatus.setQueueDepth(tasks.getAll().filter((t) => t.dirty).length);
		syncStatus.setPull('idle');
		return { lists: toLists.length, tasks: toTasks.length };
	} catch (err) {
		console.warn('sync failed', err);
		syncStatus.setPull('error', formatSyncRuntimeError(err, 'pull'));
		return { lists: 0, tasks: 0, error: true };
	}
};

export const pushPendingToServer = async () => {
	syncStatus.setPush('running');
	const dirtySnapshot = tasks.getAll().filter((t) => t.dirty);
	syncStatus.setQueueDepth(dirtySnapshot.length);
	if (!dirtySnapshot.length) {
		syncStatus.setPush('idle');
		return { pushed: 0, created: 0, rejected: 0 };
	}

	const syncable: Task[] = [];
	for (const task of dirtySnapshot) {
		if (!task.local && !isServerId(task.id)) {
			// Drop legacy seed IDs that were never created on the server.
			tasks.remove(task.id);
			continue;
		}
		syncable.push(task);
	}

	if (syncable.length !== dirtySnapshot.length) {
		await repo.saveTasks(tasks.getAll());
		syncStatus.setQueueDepth(syncable.length);
	}

	if (!syncable.length) {
		syncStatus.setPush('idle');
		syncStatus.setQueueDepth(0);
		return { pushed: 0, created: 0, rejected: 0 };
	}

	const pendingOps = syncable.map((task, index) => toPushChange(task, index));
	const opById = new Map<string, PendingPushOp>(pendingOps.map((entry) => [entry.op.op_id, entry.op]));

	let pushed = 0;
	let created = 0;
	try {
		const response = await api.syncPush({ changes: pendingOps.map((entry) => entry.change) });
		bumpSyncCursor(response.cursor_ts);

		const rejectedById = new Map(response.rejected.map((item) => [item.op_id, item]));
		let appliedIndex = 0;
		for (const entry of pendingOps) {
			if (rejectedById.has(entry.op.op_id)) continue;
			const remoteTask = response.applied[appliedIndex];
			appliedIndex += 1;
			if (!remoteTask) continue;
			tasks.replaceWithRemote(entry.op.localTaskId, mapApiTask(remoteTask), entry.op.sent);
			pushed += 1;
			if (entry.op.kind === 'create_task') {
				created += 1;
			}
		}

		let firstUnhandledError: string | undefined;
		for (const rejected of response.rejected) {
			const op = opById.get(rejected.op_id);
			if (!op) {
				if (!firstUnhandledError) firstUnhandledError = rejectMessage(rejected);
				continue;
			}
			if (rejected.status === 404) {
				tasks.remove(op.localTaskId);
				continue;
			}
			if (rejected.status === 403 && op.kind !== 'create_task') {
				// Clear forbidden updates so re-pull can restore canonical server state.
				tasks.clearDirty(op.localTaskId);
			}
			if (!firstUnhandledError) firstUnhandledError = rejectMessage(rejected);
		}

		await repo.saveTasks(tasks.getAll());
		const remainingDirty = tasks.getAll().filter((task) => task.dirty).length;
		syncStatus.setQueueDepth(remainingDirty);
		if (remainingDirty === 0 || pushed > 0 || response.rejected.length > 0) {
			syncStatus.markReplay();
		}
		if (firstUnhandledError) {
			syncStatus.setPush('error', firstUnhandledError);
			return { pushed, created, rejected: response.rejected.length, error: true };
		}

		syncStatus.setPush('idle');
		return { pushed, created, rejected: response.rejected.length };
	} catch (err) {
		console.warn('push failed', err);
		const msg = formatSyncRuntimeError(err, 'push');
		syncStatus.setPush('error', msg);
		syncStatus.setQueueDepth(tasks.getAll().filter((task) => task.dirty).length);
		return { pushed, created, rejected: 0, error: true };
	}
};
