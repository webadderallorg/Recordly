import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportProgress, ExportResult } from "@/lib/exporter/types";
import type { ExportBranchContext } from "./exportBranchContext";
import { runGifExport } from "./runGifExport";
import { runMp4Export } from "./runMp4Export";

const mocks = vi.hoisted(() => ({
	modernExport: vi.fn(),
	modernConstruct: vi.fn(),
	legacyExport: vi.fn(),
	legacyConstruct: vi.fn(),
	saveBlob: vi.fn(),
	streamBlob: vi.fn(),
	gifExport: vi.fn(),
}));
vi.mock("@/lib/exporter/gifExporter", () => ({
	GifExporter: class {
		export = mocks.gifExport;
		cancel() {}
	},
}));
vi.mock("@/components/ui/toast", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));
vi.mock("@/lib/exporter/modernVideoExporter", () => ({
	ModernVideoExporter: class {
		constructor(config: unknown) {
			mocks.modernConstruct(config);
		}
		export = mocks.modernExport;
		cancel() {}
	},
}));
vi.mock("@/lib/exporter/videoExporter", () => ({
	VideoExporter: class {
		constructor(config: unknown) {
			mocks.legacyConstruct(config);
		}
		export = mocks.legacyExport;
		cancel() {}
	},
}));
vi.mock("./buildExportRenderOptions", () => ({
	buildExportRenderOptions: () => ({
		wallpaper: "#101010",
		zoomRegions: [],
		showShadow: false,
		shadowIntensity: 0,
		backgroundBlur: 0,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	}),
}));
vi.mock("./exportPersistence", () => ({
	saveExportBlob: mocks.saveBlob,
	streamExportBlobToTempFile: mocks.streamBlob,
	writeSmokeExportReport: vi.fn(),
}));
vi.mock("./exportRunnerSupport", () => ({ showExportErrorToast: vi.fn() }));

function context(destination: "download" | "share" = "download") {
	let cancelled = false;
	const input = {
		projectName: "Product Walkthrough",
		videoPath: "file:///recording.mp4",
		appearance: {},
		timeline: { audioRegions: [], selectedClipId: null },
		audio: { sourceAudioFallbackPaths: [], activeSourceAudioTrackSettings: {} },
		smokeExportConfig: { enabled: false },
		effectiveSpeedRegions: [],
		effectiveZoomRegions: [],
		effectiveCursorTelemetry: [],
		effectiveShowCursor: false,
		ensureSupportedMp4SourceDimensions: vi.fn(async () => ({
			width: 320,
			height: 180,
			encoderPath: null,
		})),
		exportSettings: {
			exportQuality: "medium",
			exportEncodingMode: "balanced",
			exportBackendPreference: "auto",
			exportPipelineModel: "modern",
			mp4FrameRate: 30,
		},
		exportSession: {
			setExportProgress: vi.fn(),
			setExportError: vi.fn(),
			setExportedFilePath: vi.fn(),
			setHasPendingExportSave: vi.fn(),
			exporterRef: { current: null },
			pendingExportSaveRef: { current: null },
			markExportAsSaving: vi.fn(),
		},
	};
	const value = {
		input,
		settings: { format: "mp4", quality: "medium", encodingMode: "balanced", mp4FrameRate: 30 },
		options: { destination },
		billingRef: { current: null },
		exportWasCancelled: () => cancelled,
		diagnostics: { record: vi.fn(), result: vi.fn(), progress: vi.fn() },
		previewWidth: 320,
		previewHeight: 180,
		effectiveShadowIntensity: 0,
		recordSmokeProgress: vi.fn(),
		smokeExportStartedAt: null,
		discardCancelledTemp: vi.fn(async () => {}),
		smokeProgressSamples: [],
		showExportSuccessToast: vi.fn(),
		setKeepExportDialogOpen: vi.fn(),
	};
	return {
		value: value as unknown as ExportBranchContext,
		input,
		cancel: () => {
			cancelled = true;
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.modernExport.mockResolvedValue({
		success: false,
		error: "WebGL texture upload failed",
		failureStage: "renderer",
	} satisfies ExportResult);
	mocks.legacyExport.mockResolvedValue({
		success: true,
		blob: new Blob(["mp4"]),
	} satisfies ExportResult);
	mocks.saveBlob.mockResolvedValue({
		saveResult: { success: true, path: "/saved/export.mp4" },
		pendingSave: { fileName: "export.mp4" },
	});
	mocks.streamBlob.mockResolvedValue("/tmp/share.mp4");
	mocks.gifExport.mockResolvedValue({ success: true, blob: new Blob(["gif"]) });
});

describe("project-named output", () => {
	it("exports project defaults and all clip audio overrides regardless of selection", async () => {
		const { value } = context();
		const defaults = { mixed: { volume: 0.8, normalize: false } };
		const overrides = {
			a: { mixed: { volume: 0.2, normalize: false } },
			b: { mixed: { volume: 1, normalize: true } },
		};
		Object.assign(value.input.timeline, {
			defaultSourceAudioTrackSettings: defaults,
			sourceAudioTrackSettingsByClip: overrides,
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 1000, speed: 1 },
				{ id: "b", startMs: 1000, endMs: 2000, speed: 1 },
			],
		});
		for (const selectedClipId of ["a", "b", null]) {
			Object.assign(value.input.timeline, { selectedClipId });
			Object.assign(value.input.audio, {
				selectedClipSourceAudioTrackSettings: selectedClipId
					? overrides[selectedClipId as "a" | "b"]
					: defaults,
				activeSourceAudioTrackSettings: overrides.b,
			});
			await runMp4Export(value);
			for (const construct of [mocks.modernConstruct, mocks.legacyConstruct]) {
				expect(construct).toHaveBeenLastCalledWith(
					expect.objectContaining({
						sourceAudioTrackSettings: defaults,
						sourceAudioTrackSettingsByClip: overrides,
					}),
				);
			}
		}
	});

	it.each([
		"mp4",
		"gif",
	] as const)("passes the project title to the %s save dialog", async (format) => {
		const { value } = context();
		value.settings = {
			...value.settings,
			format,
			gifConfig: { width: 320, height: 180, frameRate: 15, loop: true, sizePreset: "medium" },
		};
		await (format === "mp4" ? runMp4Export(value) : runGifExport(value));
		expect(mocks.saveBlob).toHaveBeenCalledWith(
			expect.any(Blob),
			`Product Walkthrough.${format}`,
			null,
			...(format === "mp4" ? [undefined] : []),
		);
	});
	it("keeps the project filename for a canceled disk-backed MP4 save", async () => {
		const { value, input } = context();
		mocks.modernExport.mockResolvedValue({ success: true, tempFilePath: "/tmp/finished.mp4" });
		const finalize = vi.fn(async () => ({ success: false, canceled: true }));
		vi.stubGlobal("window", { electronAPI: { finalizeExportedVideo: finalize } });
		try {
			await runMp4Export(value);
			expect(finalize).toHaveBeenCalledWith(
				expect.objectContaining({ fileName: "Product Walkthrough.mp4" }),
			);
			expect(input.exportSession.pendingExportSaveRef.current).toMatchObject({
				fileName: "Product Walkthrough.mp4",
				tempFilePath: "/tmp/finished.mp4",
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("MP4 recovery has one persistence boundary", () => {
	it("preserves displayed progress while a compatibility retry prepares", async () => {
		const { value, input } = context();
		let progress: ExportProgress | null = {
			currentFrame: 42,
			totalFrames: 100,
			percentage: 42,
			estimatedTimeRemaining: 10,
			phase: "extracting",
		};
		input.exportSession.setExportProgress.mockImplementation((update) => {
			progress = typeof update === "function" ? update(progress) : update;
		});
		await runMp4Export(value);
		expect(progress).toMatchObject({ percentage: 42, phase: "preparing" });
	});
	it.each([
		"download",
		"share",
	] as const)("preserves %s bitrate through compatibility recovery", async (destination) => {
		const { value, input } = context(destination);
		input.ensureSupportedMp4SourceDimensions.mockResolvedValue({
			width: 1920,
			height: 1080,
			encoderPath: null,
		});
		await runMp4Export(value);
		expect(mocks.legacyConstruct).toHaveBeenCalledWith(
			expect.objectContaining({
				bitrate: destination === "share" ? 4_000_000 : 6_400_000,
			}),
		);
	});
	it("saves exactly once after a modern failure and compatibility success", async () => {
		const { value, input } = context();
		await expect(runMp4Export(value)).resolves.toEqual({ exit: false });
		expect(mocks.modernExport).toHaveBeenCalledOnce();
		expect(mocks.legacyExport).toHaveBeenCalledOnce();
		expect(mocks.saveBlob).toHaveBeenCalledOnce();
		expect(input.exportSession.markExportAsSaving).toHaveBeenCalledOnce();
		expect(input.exportSession.setExportedFilePath).toHaveBeenCalledWith("/saved/export.mp4");
		expect(value.diagnostics.record).toHaveBeenCalledWith("pipeline-completed", {
			pipelineModel: "legacy",
			recovery: "compatibility",
			success: true,
		});
	});
	it("prepares one share output from the successful recovery without saving the failed attempt", async () => {
		const { value } = context("share");
		await expect(runMp4Export(value)).resolves.toEqual({ exit: true, path: "/tmp/share.mp4" });
		expect(mocks.streamBlob).toHaveBeenCalledOnce();
		expect(mocks.saveBlob).not.toHaveBeenCalled();
		expect(mocks.modernExport).toHaveBeenCalledOnce();
		expect(mocks.legacyExport).toHaveBeenCalledOnce();
	});
	it("does not create another exporter or save when cancellation arrives at the recovery handoff", async () => {
		const { value, input, cancel } = context();
		input.exportSession.setExportProgress.mockImplementation(cancel);
		await expect(runMp4Export(value)).resolves.toEqual({ exit: true });
		expect(mocks.modernExport).toHaveBeenCalledOnce();
		expect(mocks.legacyConstruct).not.toHaveBeenCalled();
		expect(mocks.legacyExport).not.toHaveBeenCalled();
		expect(mocks.saveBlob).not.toHaveBeenCalled();
		expect(mocks.streamBlob).not.toHaveBeenCalled();
	});
});

describe("Cloud caption-file exports", () => {
	const sidecar = { format: "both" as const, cues: [{ startMs: 0, endMs: 1000, text: "Hello" }] };
	function withCaptionFiles(
		state: "active" | "free" | "loading" | "signed-out" | "expired" | "needs-sign-in",
	) {
		const { value } = context();
		value.settings.includeCaptionSidecar = true;
		value.input.captionSidecarPayload = sidecar;
		value.billingRef.current = {
			user: state === "signed-out" ? null : { id: "caption-user" },
			loading: state === "loading",
			needsSignIn: state === "needs-sign-in",
			status: {
				billing: {
					plan: state === "free" ? "free" : "pro",
					subscriptionStatus: state === "expired" ? "canceled" : "active",
				},
			},
		} as NonNullable<ExportBranchContext["billingRef"]["current"]>;
		return value;
	}
	it.each([
		"free",
		"loading",
		"signed-out",
		"expired",
		"needs-sign-in",
	] as const)("still saves the video but omits caption files for %s accounts with a saved opt-in", async (state) => {
		await runMp4Export(withCaptionFiles(state));
		expect(mocks.saveBlob).toHaveBeenCalledWith(
			expect.any(Blob),
			expect.any(String),
			null,
			undefined,
		);
	});
	it("passes both caption formats to the save for an active Cloud account", async () => {
		await runMp4Export(withCaptionFiles("active"));
		expect(mocks.saveBlob).toHaveBeenCalledWith(
			expect.any(Blob),
			expect.any(String),
			null,
			sidecar,
		);
	});
	it("rechecks the account after rendering and omits caption files if access changed", async () => {
		const value = withCaptionFiles("active");
		mocks.legacyExport.mockImplementationOnce(async () => {
			value.billingRef.current = null;
			return { success: true, blob: new Blob(["mp4"]) };
		});
		await runMp4Export(value);
		expect(mocks.saveBlob).toHaveBeenCalledWith(
			expect.any(Blob),
			expect.any(String),
			null,
			undefined,
		);
	});
});

it("applies the new compression profile exclusively to cloud shares", async () => {
	const download = context("download");
	await runMp4Export(download.value);
	expect(mocks.modernConstruct).toHaveBeenLastCalledWith(
		expect.not.objectContaining({ deliveryProfile: "cloud" }),
	);
	vi.clearAllMocks();
	const share = context("share");
	await runMp4Export(share.value);
	expect(mocks.modernConstruct).toHaveBeenCalledWith(
		expect.objectContaining({
			deliveryProfile: "cloud",
			encodingMode: "balanced",
			backendPreference: "breeze",
		}),
	);
	expect(share.input.ensureSupportedMp4SourceDimensions).toHaveBeenCalledWith(30, "source", 720);
});

describe("local exports without a Cloud subscription", () => {
	it.each([
		"high",
		"source",
		"custom",
	] as const)("exports %s at 4K while signed out, on Free, or while billing is loading", async (quality) => {
		for (const state of ["signed-out", "free", "loading"] as const) {
			vi.clearAllMocks();
			const { value, input } = context();
			const openPricing = vi.fn();
			value.settings.quality = quality;
			value.billingRef.current =
				state === "signed-out"
					? null
					: ({
							loading: state === "loading",
							status: { billing: { plan: "free" } },
							openPricing,
						} as unknown as NonNullable<ExportBranchContext["billingRef"]["current"]>);
			input.ensureSupportedMp4SourceDimensions.mockResolvedValue({
				width: 3840,
				height: 2160,
				encoderPath: null,
			});
			await expect(runMp4Export(value)).resolves.toEqual({ exit: false });
			expect(mocks.modernConstruct).toHaveBeenCalledWith(
				expect.objectContaining({ width: 3840, height: 2160 }),
			);
			expect(mocks.saveBlob).toHaveBeenCalledOnce();
			expect(openPricing).not.toHaveBeenCalled();
		}
	});
});
