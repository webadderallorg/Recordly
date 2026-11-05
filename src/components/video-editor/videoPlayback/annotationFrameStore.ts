import type { SceneTransformState } from "./playbackTypes";

export type AnnotationFrame = { timeMs: number; transform: SceneTransformState };

/** Only the annotation overlay subscribes to per-frame camera updates. */
export function createAnnotationFrameStore() {
	let snapshot: AnnotationFrame = { timeMs: 0, transform: { scale: 1, x: 0, y: 0 } };
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => snapshot,
		hasSubscribers: () => listeners.size > 0,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		publish(frame: AnnotationFrame) {
			if (
				snapshot.timeMs === frame.timeMs &&
				snapshot.transform.scale === frame.transform.scale &&
				snapshot.transform.x === frame.transform.x &&
				snapshot.transform.y === frame.transform.y
			)
				return;
			snapshot = frame;
			for (const listener of listeners) listener();
		},
	};
}
