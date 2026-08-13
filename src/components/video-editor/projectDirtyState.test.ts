import { describe, expect, it } from "vitest";

import { hasUnsavedProjectChanges } from "./projectDirtyState";
import type { EditorProjectData } from "./projectPersistence";

function createProjectData(overrides: Partial<EditorProjectData> = {}): EditorProjectData {
	return {
		version: 1,
		projectId: "project-1",
		videoPath: "file:///recording.mp4",
		editor: {
			wallpaper: "#ffffff",
			zoomRegions: [],
			trimRegions: [],
			clipRegions: [],
			speedRegions: [],
			annotationRegions: [],
			audioRegions: [],
			autoCaptions: [],
		},
		...overrides,
	};
}

describe("hasUnsavedProjectChanges", () => {
	it("does not report changes before a project snapshot exists", () => {
		expect(hasUnsavedProjectChanges(null, createProjectData())).toBe(false);
	});

	it("reports changes when there is no saved baseline", () => {
		expect(hasUnsavedProjectChanges(createProjectData(), null)).toBe(true);
	});

	it("treats deeply equal snapshots as unchanged", () => {
		expect(hasUnsavedProjectChanges(createProjectData(), createProjectData())).toBe(false);
	});

	it("detects nested editor changes", () => {
		const current = createProjectData({
			editor: {
				...createProjectData().editor,
				zoomRegions: [
					{
						id: "zoom-1",
						startMs: 100,
						endMs: 500,
						focus: { cx: 0.4, cy: 0.6 },
						depth: 2,
					},
				],
			},
		});

		expect(hasUnsavedProjectChanges(current, createProjectData())).toBe(true);
	});

	it("detects array length changes", () => {
		const current = createProjectData({
			editor: {
				...createProjectData().editor,
				autoCaptions: [{ id: "caption-1", startMs: 0, endMs: 1_000, text: "hello" }],
			},
		});

		expect(hasUnsavedProjectChanges(current, createProjectData())).toBe(true);
	});

	it("ignores transient webcam media attachment changes", () => {
		const saved = createProjectData({
			editor: {
				...createProjectData().editor,
				webcam: {
					enabled: false,
					sourcePath: null,
					timeOffsetMs: 0,
					size: 28,
				},
			},
		});
		const current = createProjectData({
			editor: {
				...createProjectData().editor,
				webcam: {
					enabled: true,
					sourcePath: "/Users/test/webcam.mp4",
					timeOffsetMs: 125,
					size: 28,
				},
			},
		});

		expect(hasUnsavedProjectChanges(current, saved)).toBe(false);
	});

	it("detects persistent webcam presentation changes", () => {
		const saved = createProjectData({
			editor: {
				...createProjectData().editor,
				webcam: {
					enabled: true,
					sourcePath: "/Users/test/webcam.mp4",
					timeOffsetMs: 0,
					size: 28,
				},
			},
		});
		const current = createProjectData({
			editor: {
				...createProjectData().editor,
				webcam: {
					enabled: true,
					sourcePath: "/Users/test/webcam.mp4",
					timeOffsetMs: 0,
					size: 36,
				},
			},
		});

		expect(hasUnsavedProjectChanges(current, saved)).toBe(true);
	});
});
