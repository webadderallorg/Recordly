import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseCaptionSidecarPayload,
	serializeSrt,
	serializeVtt,
	withCaptionSidecarMessage,
	writeCaptionSidecarsBestEffort,
} from "./exportCaptionSidecars";

describe("exportCaptionSidecars", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serializes SRT cues with stable numbering and timestamps", () => {
		expect(
			serializeSrt([
				{
					startMs: 1234,
					endMs: 5678,
					text: "Hello\nworld",
				},
			]),
		).toBe("1\n00:00:01,234 --> 00:00:05,678\nHello\nworld");
	});

	it("serializes VTT cues with header and dot timestamps", () => {
		expect(
			serializeVtt([
				{
					startMs: 0,
					endMs: 2000,
					text: "Caption",
				},
			]),
		).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nCaption");
	});

	it("drops malformed cues when parsing sidecar payloads", () => {
		expect(
			parseCaptionSidecarPayload({
				format: "both",
				cues: [
					{ startMs: 0, endMs: 1000, text: "ok" },
					{ startMs: 2000, endMs: 1000, text: "bad range" },
					{ startMs: 1000, endMs: 2000, text: "   " },
				],
			}),
		).toEqual({
			format: "both",
			cues: [{ startMs: 0, endMs: 1000, text: "ok" }],
		});
	});

	it("returns a warning result instead of throwing when sidecar writes fail", async () => {
		const writeFileSpy = vi.spyOn(fs, "writeFile").mockRejectedValueOnce(new Error("disk full"));

		await expect(
			writeCaptionSidecarsBestEffort("/tmp/export.mp4", {
				format: "srt",
				cues: [{ startMs: 0, endMs: 1000, text: "Caption" }],
			}),
		).resolves.toEqual({
			wroteAny: false,
			error: "disk full",
		});

		expect(writeFileSpy).toHaveBeenCalledTimes(1);
	});

	it("writes requested caption sidecars when the filesystem succeeds", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-sidecar-test-"));
		const videoPath = path.join(tempDir, "clip.mp4");

		try {
			await expect(
				writeCaptionSidecarsBestEffort(videoPath, {
					format: "both",
					cues: [{ startMs: 0, endMs: 1000, text: "Caption" }],
				}),
			).resolves.toEqual({ wroteAny: true, error: null });

			await expect(fs.readFile(path.join(tempDir, "clip.srt"), "utf8")).resolves.toContain(
				"00:00:00,000 --> 00:00:01,000",
			);
			await expect(fs.readFile(path.join(tempDir, "clip.vtt"), "utf8")).resolves.toContain(
				"WEBVTT",
			);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("appends a non-fatal caption warning only when sidecar writes fail", () => {
		expect(
			withCaptionSidecarMessage("Video exported successfully", {
				wroteAny: false,
				error: "disk full",
			}),
		).toBe("Video exported successfully Captions could not be saved alongside the video.");

		expect(
			withCaptionSidecarMessage("Video exported successfully", {
				wroteAny: true,
				error: null,
			}),
		).toBe("Video exported successfully");
	});
});