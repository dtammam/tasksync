export type Phase = 'idle' | 'running' | 'error';

export interface SyncStatus {
	pull: Phase;
	push: Phase;
	lastError?: string;
}
