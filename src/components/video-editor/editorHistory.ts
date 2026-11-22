import type { SourceAudioTrackSettings } from "./audio/audioTypes";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	SpeedRegion,
	ZoomRegion,
} from "./types";

export type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
	defaultSourceAudioTrackSettings: SourceAudioTrackSettings;
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

export type EditorHistoryStack = {
	past: EditorHistorySnapshot[];
	current: EditorHistorySnapshot | null;
	future: EditorHistorySnapshot[];
};

export type EditorHistoryRecordResult = "initialized" | "applied" | "recorded" | "unchanged";

export const MAX_EDITOR_HISTORY_ENTRIES = 3000;

export function createEditorHistoryStack(): EditorHistoryStack {
	return {
		past: [],
		current: null,
		future: [],
	};
}

export function resetEditorHistoryStack(stack: EditorHistoryStack): void {
	stack.past = [];
	stack.current = null;
	stack.future = [];
}

export function cloneEditorHistorySnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
	return globalThis.structuredClone(snapshot);
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		return left.every((value, index) => areDeepEqual(value, right[index]));
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => key in right && areDeepEqual(left[key], right[key]));
}

export function areEditorHistorySnapshotsEqual(
	left: EditorHistorySnapshot,
	right: EditorHistorySnapshot,
): boolean {
	return areDeepEqual(left, right);
}

// History owns these objects. Reuse unchanged data between entries, while
// detaching changed data from the mutable editor state and undo/redo results.
function captureHistoryCollection<T extends { id: string }>(items: T[], previous: T[]): T[] {
	if (areDeepEqual(items, previous)) return previous;
	const previousById = new Map(previous.map((item) => [item.id, item]));
	return items.map((item) => {
		const previousItem = previousById.get(item.id);
		if (!previousItem) return globalThis.structuredClone(item);
		if (areDeepEqual(item, previousItem)) return previousItem;
		const captured = { ...item };
		for (const key of Object.keys(item) as (keyof T)[]) {
			captured[key] = areDeepEqual(item[key], previousItem[key])
				? previousItem[key]
				: globalThis.structuredClone(item[key]);
		}
		return captured;
	});
}

function captureHistorySnapshot(
	snapshot: EditorHistorySnapshot,
	previous: EditorHistorySnapshot,
): EditorHistorySnapshot {
	return {
		...snapshot,
		zoomRegions: captureHistoryCollection(snapshot.zoomRegions, previous.zoomRegions),
		clipRegions: captureHistoryCollection(snapshot.clipRegions, previous.clipRegions),
		speedRegions: captureHistoryCollection(snapshot.speedRegions, previous.speedRegions),
		annotationRegions: captureHistoryCollection(
			snapshot.annotationRegions,
			previous.annotationRegions,
		),
		audioRegions: captureHistoryCollection(snapshot.audioRegions, previous.audioRegions),
		autoCaptions: captureHistoryCollection(snapshot.autoCaptions, previous.autoCaptions),
		sourceAudioTrackSettingsByClip: areDeepEqual(
			snapshot.sourceAudioTrackSettingsByClip,
			previous.sourceAudioTrackSettingsByClip,
		)
			? previous.sourceAudioTrackSettingsByClip
			: globalThis.structuredClone(snapshot.sourceAudioTrackSettingsByClip),
		defaultSourceAudioTrackSettings: areDeepEqual(
			snapshot.defaultSourceAudioTrackSettings,
			previous.defaultSourceAudioTrackSettings,
		)
			? previous.defaultSourceAudioTrackSettings
			: globalThis.structuredClone(snapshot.defaultSourceAudioTrackSettings),
	};
}

export function recordEditorHistorySnapshot(
	stack: EditorHistoryStack,
	snapshot: EditorHistorySnapshot,
	options: {
		applyingHistory?: boolean;
		maxEntries?: number;
		ignoreSelectionOnly?: boolean;
		coalesce?: boolean;
	} = {},
): EditorHistoryRecordResult {
	if (!stack.current) {
		stack.current = cloneEditorHistorySnapshot(snapshot);
		return "initialized";
	}

	const capturedSnapshot = captureHistorySnapshot(snapshot, stack.current);
	if (options.applyingHistory) {
		stack.current = capturedSnapshot;
		return "applied";
	}

	if (areEditorHistorySnapshotsEqual(stack.current, capturedSnapshot)) {
		return "unchanged";
	}

	if (
		options.ignoreSelectionOnly &&
		areEditorHistorySnapshotsEqual(stack.current, {
			...capturedSnapshot,
			selectedZoomId: stack.current.selectedZoomId,
			selectedClipId: stack.current.selectedClipId,
			selectedAnnotationId: stack.current.selectedAnnotationId,
			selectedAudioId: stack.current.selectedAudioId,
		})
	) {
		stack.current = capturedSnapshot;
		return "unchanged";
	}

	if (!options.coalesce) stack.past.push(stack.current);
	const maxEntries = options.maxEntries ?? MAX_EDITOR_HISTORY_ENTRIES;
	if (stack.past.length > maxEntries) {
		stack.past.shift();
	}

	stack.current = capturedSnapshot;
	stack.future = [];
	return "recorded";
}

export function undoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.past.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const previous = stack.past.pop();
	if (!previous) {
		return null;
	}

	stack.future.push(current);
	stack.current = previous;
	return cloneEditorHistorySnapshot(previous);
}

export function redoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.future.length === 0) {
		return null;
	}

	const current = stack.current ?? cloneEditorHistorySnapshot(fallbackCurrent);
	const next = stack.future.pop();
	if (!next) {
		return null;
	}

	stack.past.push(current);
	stack.current = next;
	return cloneEditorHistorySnapshot(next);
}
