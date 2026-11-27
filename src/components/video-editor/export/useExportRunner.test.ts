import { afterEach, describe, expect, it, vi } from "vitest";
import { runMp4Export } from "./runMp4Export";
import { useExportRunner } from "./useExportRunner";

vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@/components/billing/BillingProvider", () => ({ useOptionalBilling: () => null }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/feedback/exportDiagnostics", () => ({
	createExportDiagnostics: () => ({
		record: vi.fn(),
		complete: vi.fn(),
		stage: vi.fn(),
		block: vi.fn(),
	}),
}));
vi.mock("./exportRunnerSupport", () => ({ showExportErrorToast: vi.fn() }));
vi.mock("./gifEstimateCache", () => ({ stopGifSizeEstimates: async () => {} }));
vi.mock("./runGifExport", () => ({ runGifExport: vi.fn() }));
vi.mock("./runMp4Export", () => ({ runMp4Export: vi.fn() }));
vi.mock("./useGifSizeEstimate", () => ({ useGifSizeEstimate: vi.fn() }));

function setup(isPlaying: boolean) {
	const playback = {
		video: { currentTime: 2 },
		isPlaying,
		play: vi.fn(async () => {}),
		pause: vi.fn(),
		regenerateFrame: vi.fn(),
	};
	const exportSession = {
		setIsExporting: vi.fn(),
		setExportProgress: vi.fn(),
		setExportError: vi.fn(),
		setGifOptimization: vi.fn(),
		setIsOptimizingGif: vi.fn(),
		clearPendingExportSave: vi.fn(),
		exporterRef: { current: null },
		exportRunIdRef: { current: 0 },
		cancelledExportRunIdRef: { current: null as number | null },
	};
	const videoPlaybackRef = { current: playback };
	const runner = useExportRunner({
		videoPath: "/recording.mp4",
		videoPlaybackRef,
		appearance: { shadowIntensity: 0 },
		smokeExportConfig: { enabled: false },
		exportSession,
	} as Parameters<typeof useExportRunner>[0]);
	return {
		playback,
		videoPlaybackRef,
		exportSession,
		exportRecording: () => runner.handleExport({ format: "mp4" }, { destination: "share" }),
	};
}

afterEach(() => vi.resetAllMocks());

describe("export preview recovery", () => {
	it("keeps playback running when an export returns a share file", async () => {
		vi.mocked(runMp4Export).mockResolvedValue({ exit: true, path: "/staged/export.mp4" });
		const { exportRecording, playback, exportSession } = setup(true);

		await expect(exportRecording()).resolves.toBe("/staged/export.mp4");
		expect(playback.pause).not.toHaveBeenCalled();
		expect(playback.regenerateFrame).toHaveBeenCalledOnce();
		expect(playback.play).not.toHaveBeenCalled();
		expect(exportSession.setIsExporting).toHaveBeenLastCalledWith(false);
	});

	it("redraws a paused preview after an error without rewinding timeline edits", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { exportRecording, playback, exportSession } = setup(false);
		vi.mocked(runMp4Export).mockImplementationOnce(async () => {
			playback.video.currentTime = 4;
			throw new Error("Encoder failed");
		});

		await exportRecording();
		expect(exportSession.setExportError).toHaveBeenLastCalledWith("Encoder failed");
		expect(playback.regenerateFrame).toHaveBeenCalledOnce();
		expect(playback.play).not.toHaveBeenCalled();
		expect(playback.video.currentTime).toBe(4);
	});

	it.each([
		{ name: "cancellation", nextRun: false, replaceVideo: false, regenerate: true },
		{ name: "a newer export", nextRun: true, replaceVideo: false, regenerate: false },
		{ name: "a different preview", nextRun: false, replaceVideo: true, regenerate: false },
	])("guards cleanup when export exits after $name", async ({
		nextRun,
		replaceVideo,
		regenerate,
	}) => {
		const { exportRecording, playback, videoPlaybackRef, exportSession } = setup(true);
		const replacement = { ...playback, video: { currentTime: 1 } };
		vi.mocked(runMp4Export).mockImplementationOnce(async () => {
			exportSession.cancelledExportRunIdRef.current = exportSession.exportRunIdRef.current;
			exportSession.exportRunIdRef.current += nextRun ? 2 : 1;
			if (replaceVideo) videoPlaybackRef.current = replacement;
			return { exit: true };
		});

		await exportRecording();
		expect(playback.regenerateFrame).toHaveBeenCalledTimes(Number(regenerate));
		expect(playback.play).not.toHaveBeenCalled();
		expect(exportSession.setIsExporting).not.toHaveBeenCalledWith(false);
	});
});
