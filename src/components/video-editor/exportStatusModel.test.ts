import { describe, expect, it } from "vitest";
import type { ExportProgress } from "@/lib/exporter";
import { resolveExportStatusModel } from "./exportStatusModel";

function progress(overrides: Partial<ExportProgress> = {}): ExportProgress {
	return {
		currentFrame: 10,
		totalFrames: 100,
		percentage: 10,
		estimatedTimeRemaining: 30,
		...overrides,
	};
}

describe("resolveExportStatusModel", () => {
	it("marks a modern MP4 export as preparing before the first progress event", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: null,
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.isExportPreparing).toBe(true);
		expect(status.isLightningExportInProgress).toBe(true);
		expect(status.shouldSuspendPreviewRendering).toBe(true);
		expect(status.renderSpeedFps).toBeNull();
	});

	it("marks legacy MP4 progress separately from the modern path", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress(),
			exportFormat: "mp4",
			exportPipelineModel: "legacy",
		});

		expect(status.isLegacyExportInProgress).toBe(true);
		expect(status.isLightningExportInProgress).toBe(false);
		expect(status.shouldSuspendPreviewRendering).toBe(false);
	});

	it("derives finalizing progress from render progress and clamps the display value", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				phase: "finalizing",
				percentage: 96,
				renderProgress: 104.4,
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.exportFinalizingProgress).toBe(100);
		expect(status.exportFinalizingPercent).toBe(100);
		expect(status.isExportMuxingAndSaving).toBe(true);
		expect(status.isExportFinalSaveIndeterminate).toBe(true);
	});

	it("sanitizes invalid finalizing progress before rounding", () => {
		const negativeStatus = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				phase: "finalizing",
				renderProgress: -12.4,
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});
		const infiniteStatus = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				phase: "finalizing",
				renderProgress: Number.POSITIVE_INFINITY,
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});
		const nanStatus = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				phase: "finalizing",
				renderProgress: Number.NaN,
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(negativeStatus.exportFinalizingProgress).toBe(0);
		expect(negativeStatus.exportFinalizingPercent).toBe(0);
		expect(infiniteStatus.exportFinalizingProgress).toBe(0);
		expect(infiniteStatus.exportFinalizingPercent).toBe(0);
		expect(nanStatus.exportFinalizingProgress).toBe(0);
		expect(nanStatus.exportFinalizingPercent).toBe(0);
	});

	it("keeps audio finalization out of the muxing-and-saving state", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				phase: "finalizing",
				audioProgress: 0.42,
				renderProgress: 80,
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.isRenderingAudio).toBe(true);
		expect(status.isExportMuxingAndSaving).toBe(false);
		expect(status.isExportFinalSaveIndeterminate).toBe(false);
	});

	it("shows render speed only during active render progress", () => {
		const renderingStatus = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({ renderFps: 123.456 }),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});
		const finalizingStatus = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({ phase: "finalizing", renderFps: 123.456 }),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(renderingStatus.renderSpeedFps).toBe("123.5");
		expect(finalizingStatus.renderSpeedFps).toBeNull();
	});

	it("builds runtime labels from render and encode backends", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				renderBackend: "webgpu",
				encodeBackend: "ffmpeg",
				encoderName: "h264_nvenc",
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.runtimeLabel).toBe("WebGPU + Breeze (h264_nvenc)");
	});

	it("falls back to the encoder name when backend labels are unavailable", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({ encoderName: "VideoEncoder" }),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.runtimeLabel).toBe("VideoEncoder");
	});

	it("prefers multiple native skip reasons over the single legacy reason", () => {
		const status = resolveExportStatusModel({
			isExporting: true,
			exportProgress: progress({
				nativeStaticLayoutSkipReason: "legacy-reason",
				nativeStaticLayoutSkipReasons: ["timeline-edits-present", "unsupported-background"],
			}),
			exportFormat: "mp4",
			exportPipelineModel: "modern",
		});

		expect(status.nativeSkipReasons).toEqual([
			"timeline-edits-present",
			"unsupported-background",
		]);
		expect(status.nativeSkipLabel).toBe("Native skipped: timeline-edits-present (+1 more)");
	});
});
