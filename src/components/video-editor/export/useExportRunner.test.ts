import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exporter = vi.hoisted(() => ({
	result: { success: true, tempFilePath: "/tmp/recordly-export.mp4" } as Record<string, unknown>,
	config: null as Record<string, unknown> | null,
}));
vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("./exportRunnerSupport", () => ({
	showExportErrorToast: vi.fn(),
	useExportSuccessToast: () => vi.fn(),
}));
vi.mock("./buildExportRenderOptions", () => ({
	buildExportRenderOptions: (input: { ranged?: unknown }) => ({ ranged: input.ranged }),
}));
vi.mock("@/lib/exporter/modernVideoExporter", () => ({
	ModernVideoExporter: class {
		constructor(config: Record<string, unknown>) {
			exporter.config = config;
		}
		export = async () => exporter.result;
		cancel() {}
	},
}));
vi.mock("@/lib/exporter/videoExporter", () => ({
	VideoExporter: class {
		export = async () => exporter.result;
		cancel() {}
	},
}));

const { useExportRunner } = await import("./useExportRunner");

type Input = Parameters<typeof useExportRunner>[0];

const api = {
	finalizeExportedVideo: vi.fn(),
	discardExportedTemp: vi.fn(async () => ({ success: true })),
};

function setup() {
	const session = {
		setIsExporting: vi.fn(),
		setExportProgress: vi.fn(),
		setExportError: vi.fn(),
		setShowExportDropdown: vi.fn(),
		setExportedFilePath: vi.fn(),
		setHasPendingExportSave: vi.fn(),
		exporterRef: { current: null },
		pendingExportSaveRef: { current: null },
		clearPendingExportSave: vi.fn(),
		markExportAsSaving: vi.fn(),
		exportRunIdRef: { current: 0 },
		cancelledExportRunIdRef: { current: null },
	};
	const input = {
		videoPath: "media://rec.mp4",
		videoPlaybackRef: {
			current: {
				video: { currentTime: 0, duration: 60 },
				containerRef: { current: null },
			},
		},
		isPlaying: false,
		appearance: { shadowIntensity: 0, padding: 0 },
		timeline: {
			audioRegions: [{ id: "r", startMs: 9_000, endMs: 11_000 }],
			annotationRegions: [],
			trimRegions: [],
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 10_000, sourceStartMs: 0, speed: 1 },
				{ id: "b", startMs: 10_000, endMs: 16_000, sourceStartMs: 20_000, speed: 2 },
			],
			selectedClipId: null,
		},
		exportSettings: {
			exportQuality: "good",
			exportEncodingMode: "balanced",
			exportBackendPreference: "auto",
			exportPipelineModel: "modern",
			mp4FrameRate: 30,
		},
		exportSession: session,
		audio: { sourceAudioFallbackPaths: [], sourceAudioFallbackStartDelayMsByPath: {} },
		smokeExportConfig: { enabled: false, outputPath: null },
		effectiveSpeedRegions: [],
		effectiveZoomRegions: [],
		effectiveCursorTelemetry: [],
		effectiveShowCursor: true,
		ensureSupportedMp4SourceDimensions: async () => ({ width: 1920, height: 1080 }),
		experimentalNvidiaCudaExport: false,
		nvidiaCudaExportAvailable: false,
		remountPreview: vi.fn(),
	} as unknown as Input;
	const { handleExport } = useExportRunner(input);
	return { handleExport, session };
}

const mp4 = { format: "mp4", quality: "good", encodingMode: "balanced" } as const;

beforeEach(() => {
	exporter.result = { success: true, tempFilePath: "/tmp/recordly-export.mp4" };
	exporter.config = null;
	vi.stubGlobal("window", { electronAPI: api, close: vi.fn() });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("handleExport outputPath", () => {
	it("saves to the given path, returns it and leaves the export popover alone", async () => {
		api.finalizeExportedVideo.mockResolvedValue({ success: true, path: "/out/a.mp4" });
		const { handleExport, session } = setup();
		await expect(
			handleExport(mp4, { destination: "download", outputPath: "/out/a.mp4" }),
		).resolves.toBe("/out/a.mp4");
		expect(api.finalizeExportedVideo).toHaveBeenCalledWith(
			expect.objectContaining({ outputPath: "/out/a.mp4" }),
		);
		expect(session.setShowExportDropdown).not.toHaveBeenCalled();
	});

	it("keeps the UI path asking for a location and closing the popover", async () => {
		api.finalizeExportedVideo.mockResolvedValue({ success: true, path: "/picked.mp4" });
		const { handleExport, session } = setup();
		await expect(handleExport(mp4, { destination: "download" })).resolves.toBe("/picked.mp4");
		expect(api.finalizeExportedVideo).toHaveBeenCalledWith(
			expect.objectContaining({ outputPath: null }),
		);
		expect(session.setShowExportDropdown).toHaveBeenCalledWith(false);
	});

	it("discards the temp file and reports the OS error when a remote save fails", async () => {
		api.finalizeExportedVideo.mockResolvedValue({
			success: false,
			message: "Failed to save exported video",
			error: "EACCES: permission denied",
		});
		const { handleExport, session } = setup();
		const onError = vi.fn();
		await expect(
			handleExport(mp4, { destination: "download", outputPath: "/out/a.mp4", onError }),
		).resolves.toBeUndefined();
		expect(onError).toHaveBeenLastCalledWith("EACCES: permission denied");
		expect(api.discardExportedTemp).toHaveBeenCalledWith("/tmp/recordly-export.mp4");
		expect(session.setHasPendingExportSave).not.toHaveBeenCalled();
	});

	it("keeps a pending Save Again entry when a UI save fails", async () => {
		api.finalizeExportedVideo.mockResolvedValue({ success: false, message: "Nope" });
		const { handleExport, session } = setup();
		await handleExport(mp4, { destination: "download" });
		expect(session.setExportError).toHaveBeenCalledWith("Nope");
		expect(session.setHasPendingExportSave).toHaveBeenCalledWith(true);
		expect(api.discardExportedTemp).not.toHaveBeenCalled();
		expect(session.setShowExportDropdown).toHaveBeenCalledWith(true);
	});
});

describe("handleExport range", () => {
	it("hands the exporter only the asked-for span, moved to the front", async () => {
		const { handleExport } = setup();
		api.finalizeExportedVideo.mockResolvedValueOnce({ success: true, path: "/out/a.mp4" });
		await handleExport(mp4, {
			outputPath: "/out/a.mp4",
			range: { fromMs: 8_000, toMs: 12_000 },
		});
		expect(exporter.config).toMatchObject({
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 2_000, sourceStartMs: 8_000, speed: 1 },
				{ id: "b", startMs: 2_000, endMs: 4_000, sourceStartMs: 20_000, speed: 2 },
			],
			audioRegions: [{ id: "r", startMs: 1_000, endMs: 3_000 }],
		});
		expect((exporter.config as { ranged?: unknown }).ranged).toBeDefined();
	});

	it("hands the exporter the whole timeline when no range is asked for", async () => {
		const { handleExport } = setup();
		api.finalizeExportedVideo.mockResolvedValueOnce({ success: true, path: "/out/a.mp4" });
		await handleExport(mp4, { outputPath: "/out/a.mp4" });
		expect(exporter.config).toMatchObject({
			clipRegions: [
				{ id: "a", startMs: 0, endMs: 10_000 },
				{ id: "b", startMs: 10_000, endMs: 16_000 },
			],
			audioRegions: [{ id: "r", startMs: 9_000, endMs: 11_000 }],
		});
		expect((exporter.config as { ranged?: unknown }).ranged).toBeUndefined();
	});
});
