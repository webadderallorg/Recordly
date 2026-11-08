import { describe, expect, it } from "vitest";

import {
	areEditorHistorySnapshotsEqual,
	cloneEditorHistorySnapshot,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "./editorHistory";

function createSnapshot(id: string | null): EditorHistorySnapshot {
	return {
		zoomRegions: [],
		clipRegions: [],
		speedRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [],
		sourceAudioTrackSettingsByClip: {},
		defaultSourceAudioTrackSettings: {},
		selectedZoomId: id,
		selectedClipId: id ? `clip-${id}` : null,
		selectedAnnotationId: null,
		selectedAudioId: null,
	};
}

describe("editorHistory", () => {
	it("initializes without adding undo history", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("first");

		expect(recordEditorHistorySnapshot(stack, snapshot)).toBe("initialized");

		expect(stack.current).toEqual(snapshot);
		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("does not record unchanged snapshots", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("same");

		recordEditorHistorySnapshot(stack, snapshot);
		expect(recordEditorHistorySnapshot(stack, createSnapshot("same"))).toBe("unchanged");

		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("records changes and clears redo history", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		stack.future.push(createSnapshot("future"));

		expect(recordEditorHistorySnapshot(stack, createSnapshot("third"))).toBe("recorded");

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first", "second"]);
		expect(stack.current?.selectedZoomId).toBe("third");
		expect(stack.future).toEqual([]);
	});

	it("moves snapshots through undo and redo stacks", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		const second = createSnapshot("second");

		recordEditorHistorySnapshot(stack, first);
		recordEditorHistorySnapshot(stack, second);

		expect(undoEditorHistoryStack(stack, second)?.selectedZoomId).toBe("first");
		expect(stack.current?.selectedZoomId).toBe("first");
		expect(stack.future.map((snapshot) => snapshot.selectedZoomId)).toEqual(["second"]);

		expect(redoEditorHistoryStack(stack, first)?.selectedZoomId).toBe("second");
		expect(stack.current?.selectedZoomId).toBe("second");
		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first"]);
	});

	it("updates the current snapshot while applying history without recording a new entry", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		expect(
			recordEditorHistorySnapshot(stack, createSnapshot("applied"), {
				applyingHistory: true,
			}),
		).toBe("applied");

		expect(stack.current?.selectedZoomId).toBe("applied");
		expect(stack.past).toEqual([]);
	});

	it("caps the past stack at the configured history depth", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("0"));
		recordEditorHistorySnapshot(stack, createSnapshot("1"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("2"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("3"), { maxEntries: 2 });

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["1", "2"]);
	});

	it("retains the latest 3000 steps and can undo and redo every retained step", () => {
		const stack = createEditorHistoryStack();
		for (let index = 0; index <= 3001; index++) {
			recordEditorHistorySnapshot(stack, createSnapshot(String(index)));
		}
		expect(stack.past).toHaveLength(3000);
		for (let index = 3000; index >= 1; index--) {
			expect(undoEditorHistoryStack(stack, createSnapshot(null))?.selectedZoomId).toBe(
				String(index),
			);
		}
		expect(undoEditorHistoryStack(stack, createSnapshot(null))).toBeNull();
		for (let index = 2; index <= 3001; index++) {
			expect(redoEditorHistoryStack(stack, createSnapshot(null))?.selectedZoomId).toBe(
				String(index),
			);
		}
		expect(redoEditorHistoryStack(stack, createSnapshot(null))).toBeNull();
		expect(stack.past).toHaveLength(3000);
	});

	it("shares unchanged history data while detaching edits from live caption objects", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot(null);
		snapshot.autoCaptions = [
			{
				id: "a",
				startMs: 0,
				endMs: 500,
				text: "First",
				words: [{ text: "First", startMs: 0, endMs: 500 }],
			},
			{ id: "b", startMs: 500, endMs: 1000, text: "Second" },
		];
		recordEditorHistorySnapshot(stack, snapshot);
		const original = stack.current!;
		snapshot.autoCaptions[0].text = "Edited";
		snapshot.autoCaptions[0].words![0].text = "Edited";
		recordEditorHistorySnapshot(stack, snapshot);
		expect(stack.current!.zoomRegions).toBe(original.zoomRegions);
		expect(stack.current!.autoCaptions[1]).toBe(original.autoCaptions[1]);
		expect(original.autoCaptions[0].text).toBe("First");
		expect(original.autoCaptions[0].words![0].text).toBe("First");
		snapshot.autoCaptions[0].words![0].text = "Changed after recording";
		snapshot.autoCaptions[1].text = "Also changed after recording";
		expect(stack.current!.autoCaptions[0].words![0].text).toBe("Edited");
		expect(stack.current!.autoCaptions[1].text).toBe("Second");
	});

	it("reuses unchanged image data and styles when moving an image annotation", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot(null);
		snapshot.annotationRegions = [
			{
				id: "image",
				startMs: 0,
				endMs: 1000,
				type: "image",
				content: "",
				imageContent: "data:image/png;base64," + "A".repeat(1024 * 1024),
				position: { x: 10, y: 20 },
				size: { width: 100, height: 100 },
				style: {
					fontSize: 24,
					color: "#ffffff",
					backgroundColor: "transparent",
					borderRadius: 0,
					fontFamily: "Arial",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					textAlign: "left",
				},
				zIndex: 1,
			},
		];
		recordEditorHistorySnapshot(stack, snapshot);
		const original = stack.current!.annotationRegions[0];
		snapshot.annotationRegions[0].position = { x: 30, y: 40 };
		recordEditorHistorySnapshot(stack, snapshot);
		const moved = stack.current!.annotationRegions[0];
		expect(moved.style).toBe(original.style);
		expect(moved.size).toBe(original.size);
		expect(moved.imageContent).toBe(original.imageContent);
		expect(original.position).toEqual({ x: 10, y: 20 });
		expect(moved.position).toEqual({ x: 30, y: 40 });
	});

	it("keeps undo and redo results detached from the stored history", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot(null);
		snapshot.autoCaptions = [{ id: "a", startMs: 0, endMs: 1000, text: "First" }];
		recordEditorHistorySnapshot(stack, snapshot);
		snapshot.autoCaptions[0].text = "Second";
		recordEditorHistorySnapshot(stack, snapshot);
		undoEditorHistoryStack(stack, snapshot)!.autoCaptions[0].text = "Mutated undo result";
		expect(stack.current!.autoCaptions[0].text).toBe("First");
		redoEditorHistoryStack(stack, snapshot)!.autoCaptions[0].text = "Mutated redo result";
		expect(stack.current!.autoCaptions[0].text).toBe("Second");
		expect(undoEditorHistoryStack(stack, snapshot)!.autoCaptions[0].text).toBe("First");
		expect(redoEditorHistoryStack(stack, snapshot)!.autoCaptions[0].text).toBe("Second");
	});

	it("detaches changed source audio settings while sharing unchanged history data", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot(null);
		snapshot.sourceAudioTrackSettingsByClip = {
			"clip-1": { mic: { volume: 1, normalize: false } },
		};
		snapshot.defaultSourceAudioTrackSettings = { system: { volume: 1, normalize: false } };
		recordEditorHistorySnapshot(stack, snapshot);
		const initial = stack.current!;
		snapshot.sourceAudioTrackSettingsByClip["clip-1"].mic.volume = 0;
		recordEditorHistorySnapshot(stack, snapshot);
		expect(stack.current!.defaultSourceAudioTrackSettings).toBe(
			initial.defaultSourceAudioTrackSettings,
		);
		expect(initial.sourceAudioTrackSettingsByClip["clip-1"].mic.volume).toBe(1);
		snapshot.sourceAudioTrackSettingsByClip["clip-1"].mic.volume = 0.5;
		expect(stack.current!.sourceAudioTrackSettingsByClip["clip-1"].mic.volume).toBe(0);
		snapshot.defaultSourceAudioTrackSettings.system.normalize = true;
		recordEditorHistorySnapshot(stack, snapshot);
		snapshot.defaultSourceAudioTrackSettings.system.normalize = false;
		expect(stack.current!.defaultSourceAudioTrackSettings.system.normalize).toBe(true);
		expect(initial.defaultSourceAudioTrackSettings.system.normalize).toBe(false);
	});

	it("preserves caption identity across reordering and removal without restoring stale data", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot(null);
		snapshot.autoCaptions = [
			{ id: "a", startMs: 0, endMs: 500, text: "First" },
			{ id: "b", startMs: 500, endMs: 1000, text: "Second" },
		];
		recordEditorHistorySnapshot(stack, snapshot);
		const original = stack.current!;
		snapshot.autoCaptions.reverse();
		recordEditorHistorySnapshot(stack, snapshot);
		expect(stack.current!.autoCaptions[0]).toBe(original.autoCaptions[1]);
		expect(stack.current!.autoCaptions[1]).toBe(original.autoCaptions[0]);
		snapshot.autoCaptions = [{ ...snapshot.autoCaptions[0], text: "Edited second" }];
		recordEditorHistorySnapshot(stack, snapshot);
		expect(stack.current!.autoCaptions.map((cue) => cue.text)).toEqual(["Edited second"]);
		expect(
			undoEditorHistoryStack(stack, snapshot)!.autoCaptions.map((cue) => cue.text),
		).toEqual(["Second", "First"]);
	});

	it("resets all history stacks", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		undoEditorHistoryStack(stack, createSnapshot("second"));
		resetEditorHistoryStack(stack);

		expect(stack).toEqual(createEditorHistoryStack());
	});

	it("clones snapshots before storing them", () => {
		const snapshot = createSnapshot("first");
		const cloned = cloneEditorHistorySnapshot(snapshot);

		cloned.selectedZoomId = "changed";

		expect(snapshot.selectedZoomId).toBe("first");
		expect(areEditorHistorySnapshotsEqual(snapshot, createSnapshot("first"))).toBe(true);
	});
});

describe("annotation editing history options", () => {
	it("keeps selection synchronized without adding undo steps or discarding redo", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot(null);
		recordEditorHistorySnapshot(stack, first);
		const changed = {
			...first,
			annotationRegions: [{ id: "annotation-1" }],
		} as EditorHistorySnapshot;
		recordEditorHistorySnapshot(stack, changed);
		undoEditorHistoryStack(stack, changed);
		expect(
			recordEditorHistorySnapshot(
				stack,
				{ ...first, selectedAnnotationId: "annotation-1" },
				{ ignoreSelectionOnly: true },
			),
		).toBe("unchanged");
		expect(stack.past).toHaveLength(0);
		expect(stack.future).toHaveLength(1);
		expect(stack.current?.selectedAnnotationId).toBe("annotation-1");
	});

	it("groups live text updates into one undo step while retaining the final redo value", () => {
		const stack = createEditorHistoryStack();
		const before = createSnapshot(null);
		recordEditorHistorySnapshot(stack, before);
		const typed = {
			...before,
			annotationRegions: [{ id: "annotation-1", content: "First" }],
		} as EditorHistorySnapshot;
		recordEditorHistorySnapshot(stack, typed);
		const completed = {
			...typed,
			annotationRegions: [{ id: "annotation-1", content: "First\nSecond" }],
		} as EditorHistorySnapshot;
		recordEditorHistorySnapshot(stack, completed, { coalesce: true });
		expect(stack.past).toHaveLength(1);
		expect(undoEditorHistoryStack(stack, completed)).toEqual(before);
		expect(redoEditorHistoryStack(stack, before)).toEqual(completed);
	});
});
