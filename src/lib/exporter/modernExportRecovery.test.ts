import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ANNOTATION_STYLE } from "@/components/video-editor/types";
import {
	exportMp4WithRecovery,
	type Mp4Exporter,
	type Mp4ExporterFactory,
	selectMp4Recovery,
} from "./modernExportRecovery";
import { ModernExportSession } from "./modernExportSession";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import { getEncoderCandidates } from "./modernWebCodecsBackend";
import type { ExportResult } from "./types";

const config: VideoExporterConfig = {
	videoUrl: "file:///recording.mp4",
	width: 2560,
	height: 1630,
	frameRate: 60,
	bitrate: 45_070_000,
	encodingMode: "balanced",
	codec: "avc1.640034",
	preferredEncoderPath: { codec: "avc1.640034", hardwareAcceleration: "prefer-hardware" },
	wallpaper: "linear-gradient(90deg, #123456, #abcdef)",
	zoomRegions: [{ id: "zoom", startMs: 100, endMs: 600, depth: 2, focus: { cx: 0.4, cy: 0.6 } }],
	zoomClassicMode: true,
	cursorClickEffect: "echo",
	cursorClickEffectColor: "#abcdef",
	cursorClickEffectScale: 1.7,
	cursorClickEffectOpacity: 0.8,
	cursorClickEffectDurationMs: 500,
	showShadow: true,
	shadowIntensity: 0.3,
	backgroundBlur: 2,
	padding: { top: 10, bottom: 20, left: 10, right: 10, linked: false },
	cropRegion: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
	trimRegions: [{ id: "trim", startMs: 100, endMs: 200 }],
	speedRegions: [{ id: "speed", startMs: 300, endMs: 400, speed: 1.5 }],
	clipRegions: [{ id: "clip", startMs: 0, endMs: 1000, speed: 1, muted: true }],
	audioRegions: [{ id: "audio", startMs: 0, endMs: 500, audioPath: "sidecar.wav", volume: 0.6 }],
	sourceAudioFallbackPaths: ["companion.wav"],
	sourceAudioFallbackStartDelayMsByPath: { "companion.wav": 150 },
	sourceAudioTrackSettings: { "companion.wav": { volume: 0.7, normalize: true } },
	annotationRegions: [
		{
			id: "private",
			type: "blur",
			startMs: 0,
			endMs: 1000,
			content: "",
			position: { x: 30, y: 40 },
			size: { width: 15, height: 10 },
			style: DEFAULT_ANNOTATION_STYLE,
			zIndex: 1,
		},
	],
};
const rendererFailure: ExportResult = {
	success: false,
	error: "Lightning export failed.\nReason: WebGL texture upload failed\nSuggested actions:\nCheck source file permissions",
	failureStage: "renderer",
};
const hardwareFailure: ExportResult = {
	success: false,
	error: "Hardware encoder failed",
	failureStage: "encoder",
	metrics: {
		totalElapsedMs: 10,
		encodeBackend: "webcodecs",
		encoderName: "avc1.640034/prefer-hardware/quality",
	},
};
const success: ExportResult = { success: true, blob: new Blob(["mp4"]) };
function exporter(result: ExportResult): Mp4Exporter {
	return { export: vi.fn(async () => result), cancel: vi.fn() };
}
function options(createExporter: Mp4ExporterFactory) {
	return {
		config,
		pipelineModel: "modern" as const,
		isCancelled: () => false,
		setActiveExporter: vi.fn(),
		createExporter,
	};
}

describe("bounded MP4 recovery policy", () => {
	it("uses the actual failure reason rather than guidance or old backend attempts", () => {
		expect(selectMp4Recovery(rendererFailure)?.route).toBe("compatibility");
		expect(selectMp4Recovery(hardwareFailure)?.route).toBe("software");
	});
	it.each([
		"Export cancelled",
		"AbortError: interrupted",
		"SecurityError: canvas is tainted",
		"[VIDEO_CODEC_UNSUPPORTED] VideoDecoder failure",
		"Failed to load source file",
		"Video seeking timed out",
		"Invalid crop dimensions",
		"Redaction geometry is invalid",
		"Redaction blur strength is invalid",
		"Source redaction canvas is unavailable",
		"Cannot redact an empty source frame",
		"ENOSPC: output disk is full",
		"EACCES: permission denied",
		"No supported Pixi modern renderer was available. Attempted: webgl, webgpu",
	])("does not replay a shared input/resource/privacy failure: %s", (error) => {
		expect(selectMp4Recovery({ ...rendererFailure, error })).toBeNull();
	});
	it("does not retry an unclassified, decoder, already-software or native encoder failure", () => {
		expect(selectMp4Recovery({ ...rendererFailure, failureStage: "pipeline" })).toBeNull();
		expect(
			selectMp4Recovery({
				...hardwareFailure,
				metrics: {
					totalElapsedMs: 1,
					encodeBackend: "webcodecs",
					encoderName: "avc1/prefer-software/quality",
				},
			}),
		).toBeNull();
		expect(
			selectMp4Recovery({
				...hardwareFailure,
				metrics: { totalElapsedMs: 1, encodeBackend: "ffmpeg", encoderName: "libx264" },
			}),
		).toBeNull();
	});
});

describe("sequential MP4 recovery ownership", () => {
	it("starts a fresh compatibility owner only after the failed attempt finishes, preserving edits/output", async () => {
		const events: string[] = [];
		const primary = exporter(rendererFailure);
		vi.mocked(primary.export).mockImplementation(async () => {
			events.push("primary finally cleanup");
			return rendererFailure;
		});
		const compatibility = exporter(success);
		const create = vi.fn<Mp4ExporterFactory>(async (route) => {
			events.push(route);
			return route === "modern" ? primary : compatibility;
		});
		const settings = options(create);
		const ledger = vi.fn();
		const result = await exportMp4WithRecovery({ ...settings, onAttemptResult: ledger });
		expect(events).toEqual(["modern", "primary finally cleanup", "compatibility"]);
		expect(result).toMatchObject({
			result: success,
			pipelineModel: "legacy",
			recovery: { route: "compatibility", initialError: rendererFailure.error },
		});
		expect(create).toHaveBeenCalledTimes(2);
		expect(create.mock.calls[1][1]).toEqual({
			...config,
			experimentalNativeExport: false,
			experimentalNvidiaCudaExport: false,
			backendPreference: "webcodecs",
			preferredRenderBackend: "webgl",
		});
		expect(create.mock.calls[1][1].annotationRegions).toBe(config.annotationRegions);
		expect(create.mock.calls[1][1].clipRegions).toBe(config.clipRegions);
		expect(create.mock.calls[1][1].audioRegions).toBe(config.audioRegions);
		expect(settings.setActiveExporter.mock.calls.map(([owner]) => owner)).toEqual([
			primary,
			compatibility,
		]);
		expect(ledger.mock.calls).toEqual([
			["modern", rendererFailure],
			["compatibility", success],
		]);
	});
	it("switches hardware encoding to software without reducing output quality or re-entering native export", async () => {
		const create = vi.fn<Mp4ExporterFactory>(async (route) =>
			exporter(route === "modern" ? hardwareFailure : success),
		);
		const result = await exportMp4WithRecovery(options(create));
		expect(result.recovery?.route).toBe("software");
		expect(result.pipelineModel).toBe("modern");
		expect(create.mock.calls[1]).toEqual([
			"software",
			{
				...config,
				experimentalNativeExport: false,
				experimentalNvidiaCudaExport: false,
				backendPreference: "webcodecs",
				forceSoftwareEncoding: true,
				preferredEncoderPath: null,
			},
		]);
		const candidates = getEncoderCandidates(
			new ModernExportSession({ ...config, forceSoftwareEncoding: true }),
			{},
		);
		expect(candidates.length).toBeGreaterThan(0);
		expect(
			candidates.every((candidate) => candidate.hardwareAcceleration === "prefer-software"),
		).toBe(true);
	});
	it("returns both failures after the single recovery, even when the second is also recoverable", async () => {
		const create = vi.fn<Mp4ExporterFactory>(async () => exporter(rendererFailure));
		const result = await exportMp4WithRecovery(options(create));
		expect(create).toHaveBeenCalledTimes(2);
		expect(result.result.success).toBe(false);
		expect(result.result.error).toContain(`Lightning export failed:\n${rendererFailure.error}`);
		expect(result.result.error).toContain(
			`Compatibility pipeline retry failed:\n${rendererFailure.error}`,
		);
	});
	it("discards temporary output from a failed recovery before returning both failures", async () => {
		const create = vi.fn<Mp4ExporterFactory>(async (route) =>
			exporter({
				...rendererFailure,
				tempFilePath: `/tmp/${route}.mp4`,
			}),
		);
		const discard = vi.fn(async () => {});
		const result = await exportMp4WithRecovery({
			...options(create),
			discardTempFile: discard,
		});
		expect(discard.mock.calls).toEqual([["/tmp/modern.mp4"], ["/tmp/compatibility.mp4"]]);
		expect(result.result.success).toBe(false);
		expect(create).toHaveBeenCalledTimes(2);
	});
	it.each([
		success,
		{ ...rendererFailure, failureStage: "pipeline" as const },
	])("keeps a successful or ineligible primary result without another factory", async (initial) => {
		const create = vi.fn<Mp4ExporterFactory>(async () => exporter(initial));
		const result = await exportMp4WithRecovery(options(create));
		expect(create).toHaveBeenCalledOnce();
		expect(result.result).toBe(initial);
	});
	it("does not add recovery to a user-selected legacy export", async () => {
		const create = vi.fn<Mp4ExporterFactory>(async () => exporter(rendererFailure));
		await exportMp4WithRecovery({ ...options(create), pipelineModel: "legacy" });
		expect(create).toHaveBeenCalledOnce();
	});
	it("discards a failed temporary output before creating the next attempt", async () => {
		const events: string[] = [];
		const create = vi.fn<Mp4ExporterFactory>(async (route) => {
			events.push(route);
			return exporter(
				route === "modern"
					? { ...rendererFailure, tempFilePath: "/tmp/failed.mp4" }
					: success,
			);
		});
		await exportMp4WithRecovery({
			...options(create),
			discardTempFile: async (file) => {
				events.push(`discard ${file}`);
			},
		});
		expect(events).toEqual(["modern", "discard /tmp/failed.mp4", "compatibility"]);
	});
});

describe("MP4 recovery cancellation", () => {
	it("does not create a pipeline after cancellation", async () => {
		const create = vi.fn<Mp4ExporterFactory>(async () => exporter(success));
		const result = await exportMp4WithRecovery({ ...options(create), isCancelled: () => true });
		expect(create).not.toHaveBeenCalled();
		expect(result.result.error).toBe("Export cancelled");
	});
	it("does not start recovery after cancellation as the first attempt settles", async () => {
		let cancelled = false;
		const create = vi.fn<Mp4ExporterFactory>(async () => exporter(rendererFailure));
		await exportMp4WithRecovery({
			...options(create),
			isCancelled: () => cancelled,
			onAttemptResult: () => {
				cancelled = true;
			},
		});
		expect(create).toHaveBeenCalledOnce();
	});
	it("cancels a recovery owner created after its asynchronous factory was cancelled", async () => {
		let cancelled = false;
		const secondary = exporter(success);
		const create = vi.fn<Mp4ExporterFactory>(async (route) => {
			if (route !== "modern") cancelled = true;
			return route === "modern" ? exporter(rendererFailure) : secondary;
		});
		const result = await exportMp4WithRecovery({
			...options(create),
			isCancelled: () => cancelled,
		});
		expect(secondary.cancel).toHaveBeenCalledOnce();
		expect(secondary.export).not.toHaveBeenCalled();
		expect(result.result.error).toBe("Export cancelled");
	});
	it("discards output if cancellation arrives while recovery is finishing", async () => {
		let cancelled = false;
		const create = vi.fn<Mp4ExporterFactory>(async (route) =>
			exporter(
				route === "modern"
					? rendererFailure
					: { success: true, tempFilePath: "/tmp/cancelled.mp4" },
			),
		);
		const discard = vi.fn(async () => {});
		const result = await exportMp4WithRecovery({
			...options(create),
			isCancelled: () => cancelled,
			discardTempFile: discard,
			onAttemptResult: (route) => {
				if (route === "compatibility") cancelled = true;
			},
		});
		expect(discard).toHaveBeenCalledWith("/tmp/cancelled.mp4");
		expect(result.result).toMatchObject({ success: false, error: "Export cancelled" });
	});
});
