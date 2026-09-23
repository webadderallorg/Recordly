import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
} from "./projectPersistence";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
	type EditorHistorySnapshot,
} from "./editorHistory";
import { ADVANCED_VERTICAL_PADDING_MAX } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("resolveVideoUrl", () => {
	it("does not send an already renderable URL through the local-path IPC", async () => {
		const getLocalMediaUrl = vi.fn();
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await expect(resolveVideoUrl("http://127.0.0.1:1234/video?path=test")).resolves.toBe(
			"http://127.0.0.1:1234/video?path=test",
		);
		expect(getLocalMediaUrl).not.toHaveBeenCalled();
	});

	it("normalizes a file URL before requesting a local media URL", async () => {
		const getLocalMediaUrl = vi.fn().mockResolvedValue({
			success: true,
			url: "http://127.0.0.1:1234/video?path=clip",
		});
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await resolveVideoUrl("file:///Users/demo/My%20Clip.mp4");
		expect(getLocalMediaUrl).toHaveBeenCalledWith("/Users/demo/My Clip.mp4");
	});
});

describe("normalizeProjectEditor", () => {
	it("ignores retired temporal blur fields when opening an older project", () => {
		const savedEditor = {
			zoomMotionBlur: 0.6,
			zoomTemporalMotionBlur: 0.35,
			zoomMotionBlurSampleCount: 13,
			zoomMotionBlurShutterFraction: 0.94,
		};
		const normalized = normalizeProjectEditor(savedEditor);
		expect(normalized.zoomMotionBlur).toBe(0.6);
		for (const field of [
			"zoomTemporalMotionBlur",
			"zoomMotionBlurSampleCount",
			"zoomMotionBlurShutterFraction",
		]) {
			expect(normalized).not.toHaveProperty(field);
		}
	});
	it("defaults to 8% on macOS and square corners elsewhere", () => {
		expect(getDefaultBorderRadiusPercent("MacIntel")).toBe(8);
		expect(getDefaultBorderRadiusPercent("Win32")).toBe(0);
		expect(getDefaultBorderRadiusPercent("Linux x86_64")).toBe(0);
	});

	it("clamps radius percentages", () => {
		expect(normalizeProjectEditor({ borderRadius: 75 }).borderRadius).toBe(50);
	});

	it("converts legacy 1080p-relative radius pixels to percentages", () => {
		expect(legacyBorderRadiusPixelsToPercent(54)).toBe(5);
	});

	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("migrates legacy webcam radius pixels to percentage roundness", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				width: 40,
				height: 40,
			} as never,
		});

		expect(editor.webcam.roundness).toBeCloseTo(17.36, 1);
		expect(editor.webcam.cornerRadius).toBeUndefined();
	});

	it("migrates the legacy caption bottom offset to X/Y positioning", () => {
		const editor = normalizeProjectEditor({
			autoCaptionSettings: { bottomOffset: 12 } as never,
		});

		expect(editor.autoCaptionSettings.positionX).toBe(50);
		expect(editor.autoCaptionSettings.positionY).toBe(88);
	});

	it("preserves and clamps saved caption X/Y positions", () => {
		const editor = normalizeProjectEditor({
			autoCaptionSettings: { positionX: -20, positionY: 140 } as never,
		});

		expect(editor.autoCaptionSettings.positionX).toBe(0);
		expect(editor.autoCaptionSettings.positionY).toBe(100);
	});

	it("uses the legacy webcam size when migrating radius pixels", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				size: 80,
			} as never,
		});

		expect(editor.webcam.width).toBe(80);
		expect(editor.webcam.height).toBe(80);
		expect(editor.webcam.roundness).toBeCloseTo(4.34, 1);
	});
});

describe("loaded clip sequence migration", () => {
	const saved = {
		clipRegions: [
			{ id: "a", startMs: 0, endMs: 2000, speed: 1 },
			{ id: "b", startMs: 3000, endMs: 6000, sourceStartMs: 5000, speed: 1 },
		],
		zoomRegions: [{ id: "zoom", startMs: 3500, endMs: 4500, depth: 2 }] as never,
		annotationRegions: [
			{ id: "annotation", startMs: 3500, endMs: 4500, content: "Keep", type: "text" },
		] as never,
		audioRegions: [
			{ id: "music", startMs: 3500, endMs: 7500, audioPath: "/music.wav", volume: 0.7 },
		],
		autoCaptions: [{ id: "cue", startMs: 5500, endMs: 6000, text: "Source timed" }],
		sourceAudioTrackSettingsByClip: { b: { system: { volume: 0.4, muted: false } } } as never,
	};
	it("migrates clips and connected tracks before they become editor state", () => {
		const editor = normalizeProjectEditor(saved);
		expect(editor.clipRegions[1]).toMatchObject({
			id: "b",
			startMs: 2000,
			endMs: 5000,
			sourceStartMs: 5000,
		});
		expect(editor.zoomRegions[0]).toMatchObject({ startMs: 2500, endMs: 3500 });
		expect(editor.annotationRegions[0]).toMatchObject({ startMs: 2500, endMs: 3500 });
		expect(editor.audioRegions[0]).toMatchObject({ startMs: 2500, endMs: 6500 });
		expect(editor.autoCaptions).toEqual(saved.autoCaptions);
		expect(editor.sourceAudioTrackSettingsByClip).toEqual(saved.sourceAudioTrackSettingsByClip);
		expect(normalizeProjectEditor(editor)).toMatchObject({
			clipRegions: editor.clipRegions,
			zoomRegions: editor.zoomRegions,
			annotationRegions: editor.annotationRegions,
			audioRegions: editor.audioRegions,
			autoCaptions: editor.autoCaptions,
		});
	});
	it("starts history at migrated footage, with only real edits to undo", () => {
		const editor = normalizeProjectEditor(saved);
		const snapshot = (
			value: ReturnType<typeof normalizeProjectEditor>,
		): EditorHistorySnapshot => ({
			clipRegions: value.clipRegions,
			zoomRegions: value.zoomRegions,
			annotationRegions: value.annotationRegions,
			audioRegions: value.audioRegions,
			speedRegions: value.speedRegions,
			autoCaptions: value.autoCaptions,
			selectedZoomId: null,
			selectedClipId: null,
			selectedAnnotationId: null,
			selectedAudioId: null,
		});
		const initial = snapshot(editor);
		const history = createEditorHistoryStack();
		expect(recordEditorHistorySnapshot(history, initial)).toBe("initialized");
		expect(recordEditorHistorySnapshot(history, snapshot(normalizeProjectEditor(editor)))).toBe(
			"unchanged",
		);
		expect(history.past).toEqual([]);
		const edited = { ...initial, clipRegions: [editor.clipRegions[0]] };
		expect(recordEditorHistorySnapshot(history, edited)).toBe("recorded");
		expect(undoEditorHistoryStack(history, edited)?.clipRegions).toEqual(editor.clipRegions);
		expect(history.past).toEqual([]);
	});
	it("preserves an explicit empty timeline and independent audio", () => {
		const editor = normalizeProjectEditor({ ...saved, clipRegions: [] });
		expect(editor.clipRegions).toEqual([]);
		expect(editor.audioRegions[0]).toMatchObject({ startMs: 3500, endMs: 7500 });
	});
});

it("reopens persisted local media URLs using the current server port", async () => {
	const getLocalMediaUrl = vi.fn().mockResolvedValue({
		success: true,
		url: "http://127.0.0.1:9999/video?path=%2Ftmp%2Fclip.mp4",
	});
	vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });
	await expect(
		resolveVideoUrl("http://127.0.0.1:1234/video?path=%2Ftmp%2Fclip.mp4"),
	).resolves.toContain(":9999/");
	expect(getLocalMediaUrl).toHaveBeenCalledWith("/tmp/clip.mp4");
});

describe("annotations across the canvas and imported webcam ranges", () => {
	it("preserves annotations outside the recording rectangle and webcam visibility when a project is reopened", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [
				{
					id: "outside",
					startMs: 0,
					endMs: 1000,
					type: "text",
					position: { x: -12, y: 110 },
					size: { width: 140, height: 20 },
				},
			] as never,
			webcam: {
				sourcePath: "/sequence-webcam.mp4",
				visibleRanges: [{ startMs: 1200, endMs: 2000 }],
			} as never,
		});
		expect(editor.annotationRegions[0].position).toEqual({ x: -12, y: 110 });
		expect(editor.annotationRegions[0].size.width).toBe(140);
		expect(normalizeProjectEditor(editor).annotationRegions).toEqual(editor.annotationRegions);
		expect(normalizeProjectEditor(editor).webcam.visibleRanges).toEqual([
			{ startMs: 1200, endMs: 2000 },
		]);
	});
});

it("discards inverted saved source bounds while preserving the in-point", () => {
	const editor = normalizeProjectEditor({
		clipRegions: [
			{
				id: "clip",
				startMs: 0,
				endMs: 1000,
				sourceStartMs: 5000,
				sourceMinMs: 6000,
				sourceMaxMs: 4000,
				speed: 0,
			},
		],
	});
	expect(editor.clipRegions[0]).toMatchObject({ sourceStartMs: 5000, speed: 1 });
	expect(editor.clipRegions[0].sourceMinMs).toBeUndefined();
	expect(editor.clipRegions[0].sourceMaxMs).toBeUndefined();
});
