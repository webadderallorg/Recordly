import { describe, expect, it } from "vitest";
import type { ExportProgress } from "@/lib/exporter";
import { resolveExportProgressUpdate, resolveSavingExportProgress } from "./exportProgressState";

function progress(overrides: Partial<ExportProgress> = {}): ExportProgress {
	return {
		currentFrame: 24,
		totalFrames: 120,
		percentage: 20,
		estimatedTimeRemaining: 12,
		...overrides,
	};
}

describe("resolveExportProgressUpdate", () => {
	it("never rewinds when a backend or export stage reports a lower percentage", () => {
		let previous: ExportProgress | null = null;
		const percentages = [
			progress({ phase: "preparing", percentage: 40 }),
			progress({ phase: "extracting", percentage: 10 }),
			progress({ phase: "extracting", percentage: 7 }),
			progress({ phase: "extracting", percentage: 98 }),
			progress({ phase: "finalizing", percentage: 0, audioProgress: 0 }),
			progress({ phase: "finalizing", percentage: 95, audioProgress: 0.9 }),
			progress({ phase: "saving", percentage: 100 }),
		].map((next) => {
			previous = resolveExportProgressUpdate(previous, next);
			return previous?.percentage;
		});
		expect(percentages).toEqual([0, 10, 10, 98, 98, 98, 100]);
		expect(previous).toMatchObject({ phase: "saving" });
	});

	it("clears the high-water mark so the next export starts from zero", () => {
		const reset = resolveExportProgressUpdate(progress({ percentage: 90 }), null);
		expect(reset).toBeNull();
		expect(resolveExportProgressUpdate(reset, progress({ phase: "preparing" }))).toMatchObject({
			percentage: 0,
		});
		expect(resolveExportProgressUpdate(reset, progress({ percentage: 3 }))).toMatchObject({
			percentage: 3,
		});
	});

	it.each([
		NaN,
		Infinity,
		-10,
	])("ignores an invalid or negative percentage (%s)", (percentage) => {
		expect(resolveExportProgressUpdate(progress(), progress({ percentage }))).toMatchObject({
			percentage: 20,
		});
	});
});

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
