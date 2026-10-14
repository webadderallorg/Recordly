import { useRef, useSyncExternalStore } from "react";

/**
 * Frame-accurate playback position (timeline seconds), kept outside React state.
 *
 * Playback advances this every animation frame. Re-rendering the editor at that
 * rate is far too expensive, so React state only receives the time while paused
 * (see `useEditorUiState`). Anything that must follow playback subscribes here,
 * ideally through `usePlaybackSelector` so it re-renders only when a value
 * derived from the time actually changes.
 */
export interface PlaybackTimeStore {
	get: () => number;
	getMs: () => number;
	set: (next: number) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createPlaybackTimeStore(initialSeconds = 0): PlaybackTimeStore {
	let timeSeconds = initialSeconds;
	const listeners = new Set<() => void>();
	return {
		get: () => timeSeconds,
		getMs: () => Math.round(timeSeconds * 1000),
		set(next) {
			if (next === timeSeconds) return;
			timeSeconds = next;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/** The editor's shared playback clock. */
export const playbackTimeStore = createPlaybackTimeStore();

export function usePlaybackTime(store: PlaybackTimeStore = playbackTimeStore): number {
	return useSyncExternalStore(store.subscribe, store.get);
}

/**
 * Subscribes to a value derived from the playback time. The component re-renders
 * only when `isEqual` says the derived value changed, not on every frame.
 * `selector` may close over props; it runs against the latest time on each store update.
 */
export function usePlaybackSelector<T>(
	store: PlaybackTimeStore,
	selector: (timeSeconds: number) => T,
	isEqual: (previous: T, next: T) => boolean = Object.is,
): T {
	const previousRef = useRef<{ value: T } | null>(null);
	const getSnapshot = () => {
		const next = selector(store.get());
		const previous = previousRef.current;
		if (previous && isEqual(previous.value, next)) return previous.value;
		previousRef.current = { value: next };
		return next;
	};
	return useSyncExternalStore(store.subscribe, getSnapshot);
}

export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((item, index) => item === b[index]);
}
