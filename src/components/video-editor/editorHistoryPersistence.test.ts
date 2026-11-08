import { describe, expect, it } from "vitest";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
	redoEditorHistoryStack,
} from "./editorHistory";
import {
	createProjectHistorySnapshot,
	persistEditorHistory,
	restoreEditorHistory,
} from "./editorHistoryPersistence";
import { createProjectData, normalizeProjectEditor } from "./projectPersistence";
import { hasUnsavedProjectChanges } from "./projectDirtyState";

const editor = (text: string) =>
	normalizeProjectEditor({
		clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
		autoCaptions: [{ id: "caption-1", startMs: 0, endMs: 1000, text }],
		defaultSourceAudioTrackSettings: { mixed: { volume: 0.5, normalize: false } },
	});

describe("saved editor history", () => {
	it("retains undo and redo across JSON saves, reopen, and another edit", () => {
		const stack = createEditorHistoryStack();
		for (const text of ["First", "Second", "Third"])
			recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor(text)));
		undoEditorHistoryStack(stack, stack.current!);
		const project = JSON.parse(
			JSON.stringify(
				createProjectData(
					"/source.mp4",
					editor("Second"),
					"project-A",
					persistEditorHistory(stack),
				),
			),
		);
		const restored = restoreEditorHistory(
			project.history,
			normalizeProjectEditor(project.editor),
		);
		expect(restored.past).toHaveLength(1);
		expect(restored.future).toHaveLength(1);
		expect(undoEditorHistoryStack(restored, restored.current!)?.autoCaptions[0].text).toBe(
			"First",
		);
		expect(redoEditorHistoryStack(restored, restored.current!)?.autoCaptions[0].text).toBe(
			"Second",
		);
		expect(redoEditorHistoryStack(restored, restored.current!)?.autoCaptions[0].text).toBe(
			"Third",
		);
		undoEditorHistoryStack(restored, restored.current!);
		recordEditorHistorySnapshot(restored, createProjectHistorySnapshot(editor("New branch")));
		expect(restored.future).toEqual([]);
		expect(undoEditorHistoryStack(restored, restored.current!)?.autoCaptions[0].text).toBe(
			"Second",
		);
	});

	it("does not add a phantom edit or clear redo during project hydration", () => {
		const stack = createEditorHistoryStack();
		recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor("First")));
		recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor("Second")));
		undoEditorHistoryStack(stack, stack.current!);
		const loaded = editor("First");
		const restored = restoreEditorHistory(
			JSON.parse(JSON.stringify(persistEditorHistory(stack))),
			loaded,
		);
		const saved = createProjectData("/source.mp4", loaded, "A", persistEditorHistory(restored));
		recordEditorHistorySnapshot(restored, createProjectHistorySnapshot(loaded), {
			applyingHistory: true,
		});
		const hydrated = createProjectData(
			"/source.mp4",
			loaded,
			"A",
			persistEditorHistory(restored),
		);
		expect(hasUnsavedProjectChanges(hydrated, saved)).toBe(false);
		expect(restored.past).toEqual([]);
		expect(restored.future).toHaveLength(1);
	});

	it.each([
		undefined,
		null,
		{},
		{ version: 99 },
		{ version: 1, values: [], past: [], future: [], current: {} },
	])("ignores absent or damaged history: %j", (candidate) => {
		expect(restoreEditorHistory(candidate, editor("Saved"))).toEqual(
			createEditorHistoryStack(),
		);
	});

	it("rejects stale history without replacing the project's saved edits", () => {
		const stack = createEditorHistoryStack();
		recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor("First")));
		recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor("Second")));
		expect(restoreEditorHistory(persistEditorHistory(stack), editor("External edit"))).toEqual(
			createEditorHistoryStack(),
		);
	});

	it("pools unchanged captions in saved data and shares them again after reopening", () => {
		const stack = createEditorHistoryStack();
		const initial = createProjectHistorySnapshot(editor("Unchanged"));
		recordEditorHistorySnapshot(stack, initial);
		for (let index = 1; index <= 30; index++) {
			recordEditorHistorySnapshot(stack, {
				...initial,
				defaultSourceAudioTrackSettings: {
					mixed: { volume: index / 100, normalize: false },
				},
			});
		}
		const saved = persistEditorHistory(stack)!;
		expect(
			saved.values.filter((value) => (value as { text?: string }).text === "Unchanged"),
		).toHaveLength(1);
		const loaded = normalizeProjectEditor({
			...editor("Unchanged"),
			defaultSourceAudioTrackSettings: stack.current!.defaultSourceAudioTrackSettings,
		});
		const restored = restoreEditorHistory(JSON.parse(JSON.stringify(saved)), loaded);
		expect(restored.past).toHaveLength(30);
		expect(restored.past[0].autoCaptions).toBe(restored.current!.autoCaptions);
		expect(persistEditorHistory(restored)!.values).toHaveLength(saved.values.length);
	});

	it("keeps history changes dirty even when undo returns to identical saved content", () => {
		const stack = createEditorHistoryStack();
		const initial = createProjectHistorySnapshot(editor("First"));
		recordEditorHistorySnapshot(stack, initial);
		const saved = createProjectData("/source.mp4", editor("First"), "A");
		recordEditorHistorySnapshot(stack, createProjectHistorySnapshot(editor("Second")));
		undoEditorHistoryStack(stack, initial);
		const current = createProjectData(
			"/source.mp4",
			editor("First"),
			"A",
			persistEditorHistory(stack),
		);
		expect(hasUnsavedProjectChanges(current, saved)).toBe(true);
	});
});
