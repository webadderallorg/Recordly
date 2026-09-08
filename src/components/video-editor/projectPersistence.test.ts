import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getDefaultBorderRadiusPercent,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
} from "./projectPersistence";
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

describe("mobile project provenance", () => {
	it("preserves validated metadata through snapshots and Save As without overriding user choices", async () => {
		const { createProjectData } = await import("./projectPersistence");
		const metadata = {
			version: 1,
			sourceKind: "ios-device",
			mode: "passthrough",
			format: {
				codedWidth: 100,
				codedHeight: 200,
				displayWidth: 100,
				displayHeight: 200,
				codec: "h264",
				colorPrimaries: null,
				transferFunction: null,
				ycbcrMatrix: null,
				fullRange: null,
				transform: [1, 0, 0, 1, 0, 0],
				observedFrameRate: 30,
				fingerprint: "f",
			},
			deviceAudioRecorded: false,
			narrationRecorded: false,
			stopReason: "user-stop",
			interrupted: false,
		};
		const saved = createProjectData(
			"/source.mov",
			{ showCursor: true, aspectRatio: "16:9", borderRadius: 12 },
			"first",
			metadata,
		);
		const copy = createProjectData(
			saved.videoPath,
			saved.editor,
			"second",
			saved.captureMetadata,
		);
		expect(copy.version).toBe(2);
		expect(copy.captureMetadata).toEqual(metadata);
		expect(copy.editor.showCursor).toBe(true);
		expect(copy.editor.aspectRatio).toBe("16:9");
		expect(
			createProjectData("/source.mov", {}, null, { ...metadata, recoveryPath: "/secret" })
				.captureMetadata,
		).toBeUndefined();
	});
});
