import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModernExportFramePlan } from "./modernExportAttemptTypes";
import { markWebCodecsEncoderFailure } from "./modernExportEncoderFailure";
import { ModernVideoExporter } from "./modernVideoExporter";
import { exporterInternals } from "./modernVideoExporter.testSupport";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { ExportResult } from "./types";

const stages = vi.hoisted(() => ({
	prepare: vi.fn(),
	render: vi.fn(),
	finalize: vi.fn(),
}));
vi.mock("./modernExportPrepare", () => ({ prepareExportAttempt: stages.prepare }));
vi.mock("./modernExportFrames", () => ({ renderExportFrames: stages.render }));
vi.mock("./modernExportFinalize", () => ({ finalizeExportAttempt: stages.finalize }));
const config: VideoExporterConfig = {
	videoUrl: "file:///source.mp4",
	width: 2,
	height: 2,
	frameRate: 30,
	bitrate: 1000000,
	wallpaper: "#000000",
	zoomRegions: [],
	showShadow: false,
	shadowIntensity: 0,
	backgroundBlur: 0,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	backendPreference: "webcodecs",
};
const plan: ModernExportFramePlan = {
	useNativeEncoder: false,
	nativeAudioPlan: { audioMode: "none" },
	totalFrames: 30,
	shouldUseFfmpegAudioFallback: false,
	shouldUsePitchPreservingFfmpegAudio: false,
};
function pendingFinalization() {
	let resolve!: (result: ExportResult) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<ExportResult>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	stages.finalize.mockReturnValue(promise);
	return { resolve, reject };
}
function exporter() {
	const instance = new ModernVideoExporter(config);
	const probe = instance;
	vi.spyOn(exporterInternals(probe).operations, "collectRuntimeDiagnostics").mockResolvedValue(
		{},
	);
	vi.spyOn(
		exporterInternals(probe).operations,
		"shouldRetryWithFallbackMediaSource",
	).mockReturnValue(false);
	const cleanup = vi
		.spyOn(exporterInternals(probe).session.browser, "cleanup")
		.mockImplementation(() => {});
	const buildError = vi
		.spyOn(exporterInternals(probe).operations, "buildLightningExportError")
		.mockImplementation((error) => (error instanceof Error ? error.message : String(error)));
	return { instance, cleanup, buildError };
}
beforeEach(() => {
	stages.prepare.mockResolvedValue({ kind: "frames", plan });
	stages.render.mockResolvedValue(undefined);
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.resetAllMocks();
});
describe("modern export finalization lifetime", () => {
	it("labels the terminal renderer failure before its resources are cleaned up", async () => {
		stages.render.mockImplementation(async (session, _hooks, control) => {
			control.inRendererStage = true;
			session.metrics.renderBackend = "webgl";
			throw new Error("WebGL texture upload failed");
		});
		const { instance, cleanup } = exporter();
		await expect(instance.export()).resolves.toMatchObject({
			success: false,
			failureStage: "renderer",
			error: "WebGL texture upload failed",
		});
		expect(cleanup).toHaveBeenCalledOnce();
	});
	it("distinguishes an encoder abort from user cancellation for a classified software retry", async () => {
		stages.render.mockImplementation(async (session) => {
			session.metrics.encodeBackend = "webcodecs";
			session.metrics.encoderName = "avc1.640033/prefer-hardware/quality";
			session.browser.encoderError = markWebCodecsEncoderFailure(
				new Error("Hardware encoder failed"),
			);
			session.cancelled = true;
			throw session.browser.encoderError;
		});
		const { instance, cleanup } = exporter();
		await expect(instance.export()).resolves.toMatchObject({
			success: false,
			failureStage: "encoder",
			error: "Hardware encoder failed",
			metrics: {
				encodeBackend: "webcodecs",
				encoderName: "avc1.640033/prefer-hardware/quality",
			},
		});
		expect(cleanup).toHaveBeenCalledOnce();
	});
	it("does not label a mux error carried by encoderError as a recoverable encoder failure", async () => {
		stages.render.mockImplementation(async (session) => {
			session.metrics.encodeBackend = "webcodecs";
			session.metrics.encoderName = "avc1.640033/prefer-hardware/quality";
			session.browser.encoderError = new Error("Muxer rejected the video chunk");
			session.cancelled = true;
			throw session.browser.encoderError;
		});
		const { instance, cleanup } = exporter();
		await expect(instance.export()).resolves.toMatchObject({
			success: false,
			failureStage: "pipeline",
			error: "Muxer rejected the video chunk",
		});
		expect(cleanup).toHaveBeenCalledOnce();
	});
	it("keeps resources alive until asynchronous finalization finishes", async () => {
		const pending = pendingFinalization();
		const { instance, cleanup } = exporter();
		const exportResult = instance.export();
		await vi.waitFor(() => expect(stages.finalize).toHaveBeenCalledOnce());
		expect(cleanup).not.toHaveBeenCalled();
		const result: ExportResult = { success: true, blob: new Blob(["mp4"]) };
		pending.resolve(result);
		await expect(exportResult).resolves.toBe(result);
		expect(cleanup).toHaveBeenCalledOnce();
	});
	it("returns a finalization rejection through the export result before cleanup", async () => {
		const pending = pendingFinalization();
		const { instance, cleanup, buildError } = exporter();
		const exportResult = instance.export();
		await vi.waitFor(() => expect(stages.finalize).toHaveBeenCalledOnce());
		expect(cleanup).not.toHaveBeenCalled();
		const failure = new Error("Muxer failed to finish");
		pending.reject(failure);
		await expect(exportResult).resolves.toMatchObject({
			success: false,
			error: failure.message,
		});
		expect(buildError).toHaveBeenCalledWith(failure);
		expect(cleanup).toHaveBeenCalledOnce();
	});
	it("preserves cancellation while finalization is pending and cleans up once", async () => {
		const pending = pendingFinalization();
		const { instance, cleanup, buildError } = exporter();
		const exportResult = instance.export();
		await vi.waitFor(() => expect(stages.finalize).toHaveBeenCalledOnce());
		instance.cancel();
		expect(cleanup).not.toHaveBeenCalled();
		pending.reject(new Error("Finalization interrupted"));
		await expect(exportResult).resolves.toMatchObject({
			success: false,
			error: "Export cancelled",
		});
		expect(buildError).not.toHaveBeenCalled();
		expect(stages.prepare).toHaveBeenCalledOnce();
		expect(cleanup).toHaveBeenCalledOnce();
	});
});
