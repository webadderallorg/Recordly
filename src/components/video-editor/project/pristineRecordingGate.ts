import { hasUnsavedProjectChanges } from "../projectDirtyState";
import type { EditorProjectData } from "../projectPersistence";

export const SETTLE_STABLE_MS = 1500;
export const SETTLE_GIVE_UP_MS = 20_000;

export function createPristineRecordingGate(now: () => number = Date.now) {
	const startedAt = now();
	let baseline: EditorProjectData | null = null;
	let last: EditorProjectData | null = null;
	let changedAt = startedAt;

	return {
		observe(snapshot: EditorProjectData | null, pipelineBusy: boolean) {
			if (!snapshot || baseline) return;
			if (!last || hasUnsavedProjectChanges(snapshot, last)) {
				last = snapshot;
				changedAt = now();
			}
			if (!pipelineBusy && now() - changedAt >= SETTLE_STABLE_MS) baseline = last;
		},
		isPristine(snapshot: EditorProjectData | null) {
			if (!baseline) return now() - startedAt < SETTLE_GIVE_UP_MS;
			return !hasUnsavedProjectChanges(snapshot, baseline);
		},
	};
}
