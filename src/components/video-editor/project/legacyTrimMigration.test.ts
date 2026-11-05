import { expect, it, vi } from "vitest";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
import { createProjectData, normalizeProjectEditor } from "../projectPersistence";
import { clipsToTrims } from "../types";
import { migrateLegacyTrimOnlyProject } from "./legacyTrimMigration";
import { buildPersistedEditorState } from "./useProjectSnapshotModel";

const legacy = () => normalizeProjectEditor({
	trimRegions: [{ id: "trim-1", startMs: 1000, endMs: 1500 }],
	zoomRegions: [{ id: "zoom-1", startMs: 2000, endMs: 3000, depth: 2, focus: { cx: 0.5, cy: 0.5 } }],
	audioRegions: [{ id: "music", startMs: 2000, endMs: 3000, audioPath: "/music.wav", volume: 0.7 }],
	defaultSourceAudioTrackSettings: { mixed: { volume: 0.7, normalize: false } },
});

it("migrates trim-only footage and anchors before establishing a clean editable baseline", async () => {
	const loaded = await migrateLegacyTrimOnlyProject(legacy(), false, async () => 4000);
	expect(loaded.clipRegions).toMatchObject([
		{ startMs: 0, endMs: 1000 },
		{ startMs: 1000, endMs: 3500, sourceStartMs: 1500 },
	]);
	expect(loaded.zoomRegions[0]).toMatchObject({ startMs: 1500, endMs: 2500 });
	expect(loaded.audioRegions[0]).toMatchObject({ startMs: 1500, endMs: 2500 });
	expect(loaded.defaultSourceAudioTrackSettings?.mixed.volume).toBe(0.7);
	const baseline = createProjectData("/source.mp4", buildPersistedEditorState(loaded));
	const projected = createProjectData("/source.mp4", buildPersistedEditorState({
		...loaded, trimRegions: clipsToTrims(loaded.clipRegions, 4000),
	}));
	expect(hasUnsavedProjectChanges(projected, baseline)).toBe(false);
	const edited = { ...projected, editor: { ...projected.editor, clipRegions: loaded.clipRegions.slice(1) } };
	expect(hasUnsavedProjectChanges(edited, baseline)).toBe(true);
});

it("preserves explicit empty sequences and does not probe current projects", async () => {
	const probe = vi.fn();
	const editor = legacy();
	await expect(migrateLegacyTrimOnlyProject(editor, true, probe)).resolves.toBe(editor);
	expect(probe).not.toHaveBeenCalled();
});

it("fails before replacing the current edit and leaves the original payload unchanged", async () => {
	const editor = legacy();
	const original = structuredClone(editor);
	const replaceEdit = vi.fn();
	await expect((async () => {
		const migrated = await migrateLegacyTrimOnlyProject(editor, false, async () => { throw new Error("Offline media"); });
		replaceEdit(migrated);
	})()).rejects.toThrow("Offline media");
	expect(replaceEdit).not.toHaveBeenCalled();
	expect(editor).toEqual(original);
	await expect(migrateLegacyTrimOnlyProject(editor, false, async () => Number.NaN)).rejects.toThrow("duration");
});
