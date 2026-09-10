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

	it("keeps valid clip freeze frames and drops malformed or duplicate ones", () => {
		const editor = normalizeProjectEditor({
			clipRegions: [
				{
					id: "clip-1",
					startMs: 0,
					endMs: 50_000,
					speed: 1,
					freezeFrames: [
						{ id: "freeze-2", offsetMs: 8_000.4, durationMs: 60_000 },
						{ id: "freeze-1", offsetMs: 4_000, durationMs: 2_000 },
						{ id: "freeze-1", offsetMs: 5_000, durationMs: 1_000 },
						{ id: "freeze-3", offsetMs: -5, durationMs: 1_000 },
						{ id: "freeze-4", offsetMs: 4_000, durationMs: 1_000 },
						{ id: 7, offsetMs: 1_000, durationMs: 1_000 },
					],
				},
			] as never,
		});

		expect(editor.clipRegions[0].freezeFrames).toEqual([
			{ id: "freeze-1", offsetMs: 4_000, durationMs: 2_000 },
			{ id: "freeze-2", offsetMs: 8_000, durationMs: 30_000 },
		]);
	});

	it("drops freeze frames that no longer fit inside their clip", () => {
		const editor = normalizeProjectEditor({
			clipRegions: [
				{
					id: "clip-1",
					startMs: 0,
					endMs: 3_000,
					speed: 1,
					freezeFrames: [{ id: "freeze-1", offsetMs: 2_500, durationMs: 2_000 }],
				},
			],
		});

		expect(editor.clipRegions[0]).toEqual({
			id: "clip-1",
			startMs: 0,
			endMs: 3_000,
			speed: 1,
			muted: false,
			showSourceAudio: false,
		});
	});
});
