import { describe, expect, it, vi } from "vitest";
import { exportCloudVideo } from "./cloudVideoExporter";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";

const config = {
	width: 1280,
	height: 720,
	frameRate: 60,
	bitrate: 3_000_000,
	encodingMode: "fast",
	backendPreference: "webcodecs",
	experimentalNvidiaCudaExport: true,
	zoomRegions: [{ id: "zoom", startMs: 500, endMs: 1500 }],
	audioRegions: [{ id: "audio" }],
	clipRegions: [{ id: "clip" }],
} as unknown as VideoExporterConfig;

it("owns cloud encoding choices without mutating saved local export settings or edits", async () => {
	const snapshot = structuredClone(config);
	const createExporter = vi.fn(async () => ({
		export: async () => ({ success: true }),
		cancel() {},
	}));
	await exportCloudVideo({
		pipelineModel: "legacy",
		config,
		isCancelled: () => false,
		setActiveExporter() {},
		createExporter,
	});
	expect(createExporter).toHaveBeenCalledWith(
		"modern",
		expect.objectContaining({
			deliveryProfile: "cloud",
			encodingMode: "balanced",
			backendPreference: "breeze",
			experimentalNvidiaCudaExport: false,
			experimentalNativeExport: false,
			preferredEncoderPath: null,
			width: 1280,
			height: 720,
			frameRate: 60,
			zoomRegions: config.zoomRegions,
			audioRegions: config.audioRegions,
			clipRegions: config.clipRegions,
		}),
	);
	expect(config).toEqual(snapshot);
});

describe("cloud recovery", () => {
	it("retains its smaller fallback budget and all edits through renderer recovery", async () => {
		const createExporter = vi.fn(async (route: string) => ({
			export: async () =>
				route === "modern"
					? {
							success: false,
							failureStage: "renderer" as const,
							error: "WebGL texture upload failed",
						}
					: { success: true, tempFilePath: "/tmp/cloud.mp4" },
			cancel() {},
		}));
		const result = await exportCloudVideo({
			pipelineModel: "modern",
			config,
			isCancelled: () => false,
			setActiveExporter() {},
			createExporter,
		});
		expect(result.result).toMatchObject({ success: true, tempFilePath: "/tmp/cloud.mp4" });
		expect(createExporter).toHaveBeenLastCalledWith(
			"compatibility",
			expect.objectContaining({
				deliveryProfile: "cloud",
				bitrate: 3_000_000,
				frameRate: 60,
				zoomRegions: config.zoomRegions,
				audioRegions: config.audioRegions,
			}),
		);
	});
	it("does not start compression after cancellation", async () => {
		const createExporter = vi.fn();
		const result = await exportCloudVideo({
			pipelineModel: "modern",
			config,
			isCancelled: () => true,
			setActiveExporter() {},
			createExporter,
		});
		expect(result.result.success).toBe(false);
		expect(createExporter).not.toHaveBeenCalled();
	});
});
