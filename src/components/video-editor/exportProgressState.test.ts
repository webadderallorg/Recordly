import { describe, expect, it } from "vitest";
import type { ExportProgress } from "@/lib/exporter";
import { resolveSavingExportProgress } from "./exportProgressState";

function progress(overrides: Partial<ExportProgress> = {}): ExportProgress {
	return {
		currentFrame: 24,
		totalFrames: 120,
		percentage: 20,
		estimatedTimeRemaining: 12,
		...overrides,
	};
}

describe("resolveSavingExportProgress", () => {
	it("marks progress as saving while preserving runtime diagnostics", () => {
		expect(
			resolveSavingExportProgress(
				progress({
					renderFps: 144.25,
					renderBackend: "webgpu",
					encodeBackend: "ffmpeg",
					encoderName: "h264_nvenc",
				}),
			),
		).toEqual({
			currentFrame: 120,
			totalFrames: 120,
			percentage: 100,
			estimatedTimeRemaining: 0,
			renderFps: 144.25,
			renderBackend: "webgpu",
			encodeBackend: "ffmpeg",
			encoderName: "h264_nvenc",
			phase: "saving",
		});
	});

	it("preserves the existing zero-total-frame behavior", () => {
		expect(
			resolveSavingExportProgress(
				progress({
					currentFrame: 36,
					totalFrames: 0,
				}),
			),
		).toMatchObject({
			currentFrame: 0,
			totalFrames: 0,
			phase: "saving",
		});
	});

	it("uses a minimal fallback when there is no previous progress", () => {
		expect(resolveSavingExportProgress(null)).toEqual({
			currentFrame: 1,
			totalFrames: 1,
			percentage: 100,
			estimatedTimeRemaining: 0,
			renderFps: undefined,
			renderBackend: undefined,
			encodeBackend: undefined,
			encoderName: undefined,
			phase: "saving",
		});
	});
});
