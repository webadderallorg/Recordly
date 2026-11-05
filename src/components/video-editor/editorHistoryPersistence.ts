import {
	areEditorHistorySnapshotsEqual,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	type EditorHistoryStack,
	MAX_EDITOR_HISTORY_ENTRIES,
	recordEditorHistorySnapshot,
} from "./editorHistory";
import { normalizeProjectEditor } from "./projectPersistence";
import type { ProjectEditorState } from "./projectPersistenceTypes";

const collections = [
	"zoomRegions",
	"clipRegions",
	"speedRegions",
	"annotationRegions",
	"audioRegions",
	"autoCaptions",
] as const;
const settings = ["sourceAudioTrackSettingsByClip", "defaultSourceAudioTrackSettings"] as const;
const selections = [
	"selectedZoomId",
	"selectedClipId",
	"selectedAnnotationId",
	"selectedAudioId",
] as const;
type StoredSnapshot = Record<(typeof collections)[number], number[]> &
	Record<(typeof settings)[number], number> &
	Record<(typeof selections)[number], string | null>;

/** Pool shared region/caption objects so 3000 edits do not duplicate all project media. */
export type PersistedEditorHistory = {
	version: 1;
	values: unknown[];
	past: StoredSnapshot[];
	current: StoredSnapshot;
	future: StoredSnapshot[];
};

export function createProjectHistorySnapshot(
	editor: Partial<ProjectEditorState>,
): EditorHistorySnapshot {
	return {
		zoomRegions: editor.zoomRegions ?? [],
		clipRegions: editor.clipRegions ?? [],
		speedRegions: editor.speedRegions ?? [],
		annotationRegions: editor.annotationRegions ?? [],
		audioRegions: editor.audioRegions ?? [],
		autoCaptions: editor.autoCaptions ?? [],
		sourceAudioTrackSettingsByClip: editor.sourceAudioTrackSettingsByClip ?? {},
		defaultSourceAudioTrackSettings: editor.defaultSourceAudioTrackSettings ?? {},
		selectedZoomId: null,
		selectedClipId: null,
		selectedAnnotationId: null,
		selectedAudioId: null,
	};
}

export function persistEditorHistory(
	stack: EditorHistoryStack,
): PersistedEditorHistory | undefined {
	if (!stack.current || (!stack.past.length && !stack.future.length)) return undefined;
	const values: unknown[] = [];
	const ids = new Map<unknown, number>();
	const intern = (value: unknown) => {
		let id = ids.get(value);
		if (id === undefined) {
			id = values.length;
			ids.set(value, id);
			values.push(value);
		}
		return id;
	};
	const encode = (snapshot: EditorHistorySnapshot): StoredSnapshot => {
		const result = {} as StoredSnapshot;
		for (const key of collections) result[key] = snapshot[key].map(intern);
		for (const key of settings) result[key] = intern(snapshot[key]);
		for (const key of selections) result[key] = snapshot[key];
		return result;
	};
	return {
		version: 1,
		past: stack.past.slice(-MAX_EDITOR_HISTORY_ENTRIES).map(encode),
		current: encode(stack.current),
		future: stack.future.slice(-MAX_EDITOR_HISTORY_ENTRIES).map(encode),
		values,
	};
}

/** Invalid or stale history never prevents opening the saved project itself. */
export function restoreEditorHistory(
	candidate: unknown,
	editor: ProjectEditorState,
): EditorHistoryStack {
	const empty = createEditorHistoryStack();
	if (!candidate || typeof candidate !== "object") return empty;
	const saved = candidate as PersistedEditorHistory;
	if (
		saved.version !== 1 ||
		!Array.isArray(saved.values) ||
		!Array.isArray(saved.past) ||
		!Array.isArray(saved.future)
	)
		return empty;
	try {
		const shared = createEditorHistoryStack();
		const read = (id: number) => {
			if (!Number.isInteger(id) || id < 0 || id >= saved.values.length)
				throw new Error("Invalid history reference");
			const value = saved.values[id];
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw new Error("Invalid history value");
			return value;
		};
		const decode = (snapshot: StoredSnapshot) => {
			const data: Record<string, unknown> = {};
			for (const key of collections) {
				if (!Array.isArray(snapshot[key])) throw new Error("Invalid history collection");
				data[key] = snapshot[key].map(read);
			}
			for (const key of settings) data[key] = read(snapshot[key]);
			const normalized = createProjectHistorySnapshot(normalizeProjectEditor(data));
			for (const key of selections)
				normalized[key] = typeof snapshot[key] === "string" ? snapshot[key] : null;
			recordEditorHistorySnapshot(shared, normalized, { applyingHistory: true });
			return shared.current!;
		};
		const current = decode(saved.current);
		const baseline = createProjectHistorySnapshot(editor);
		const withoutSelection = { ...current };
		for (const key of selections) withoutSelection[key] = null;
		if (!areEditorHistorySnapshotsEqual(withoutSelection, baseline)) return empty;
		const past = saved.past.slice(-MAX_EDITOR_HISTORY_ENTRIES).map(decode);
		recordEditorHistorySnapshot(shared, baseline, { applyingHistory: true });
		const restoredCurrent = shared.current;
		const future = saved.future
			.slice(-MAX_EDITOR_HISTORY_ENTRIES)
			.reverse()
			.map(decode)
			.reverse();
		return { past, current: restoredCurrent, future };
	} catch {
		return empty;
	}
}
