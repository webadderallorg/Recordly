import { afterEach, expect, it, vi } from "vitest";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
import { createProjectData, normalizeProjectEditor } from "../projectPersistence";
import { clipsToTrims } from "../types";
import { startProjectAutosave } from "./projectAutosave";
import { buildPersistedEditorState } from "./useProjectSnapshotModel";

afterEach(() => vi.useRealTimers());

it("opening a legacy project does not autosave runtime bookkeeping into its original", async () => {
	vi.useFakeTimers();
	const loaded = normalizeProjectEditor({
		clipRegions: [{ id: "clip-1", startMs: 500, endMs: 3000, speed: 1 }],
		defaultSourceAudioTrackSettings: { mixed: { volume: 0.7, normalize: false } },
		wallpaper: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
		zoomInDurationMs: 200,
		zoomInOverlapMs: 500,
		webcam: { enabled: true, sourcePath: "/webcam.mp4", roundness: 69 } as never,
		zoomRegions: [
			{ id: "zoom-1", startMs: 300, endMs: 1300, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
		],
		autoCaptions: [
			{
				id: "caption-1",
				startMs: 500,
				endMs: 1700,
				text: "Migration verification",
				words: [{ text: "Migration", startMs: 500, endMs: 900 }],
			},
		],
		audioRegions: [
			{ id: "music", startMs: 0, endMs: 2500, audioPath: "/music.wav", volume: 0.25 },
		],
	});
	const baseline = createProjectData("/source.mp4", buildPersistedEditorState(loaded), "v14");
	// The live snapshot assembles persisted controls, not these two runtime refs.
	const { autoFullTrackClipId: _id, autoFullTrackClipEndMs: _end, ...controls } = loaded;
	const current = createProjectData(
		"/source.mp4",
		buildPersistedEditorState({
			...controls,
			trimRegions: clipsToTrims(loaded.clipRegions, 4000),
		}),
		"v14",
	);
	const saveOriginal = vi.fn();
	const stop = startProjectAutosave(() =>
		hasUnsavedProjectChanges(current, baseline) ? saveOriginal() : undefined,
	);
	await vi.advanceTimersByTimeAsync(1200);
	expect(saveOriginal).not.toHaveBeenCalled();
	expect(current.editor.clipRegions?.[0]).toMatchObject({ startMs: 0, sourceStartMs: 500 });
	expect(current.editor.defaultSourceAudioTrackSettings?.mixed.volume).toBe(0.7);
	const edited = { ...current, editor: { ...current.editor, shadowIntensity: 0.8 } };
	expect(hasUnsavedProjectChanges(edited, baseline)).toBe(true);
	const trimmed = {
		...current,
		editor: { ...current.editor, clipRegions: [{ ...loaded.clipRegions[0], endMs: 2000 }] },
	};
	expect(hasUnsavedProjectChanges(trimmed, baseline)).toBe(true);
	stop();
});
