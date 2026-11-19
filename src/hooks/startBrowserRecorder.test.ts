import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBrowserRecorder } from "./startBrowserRecorder";

const writer = vi.hoisted(() => ({
	isCancelled: false,
	write: vi.fn(),
	discard: vi.fn(),
	finish: vi.fn(),
}));
vi.mock("./recordingFileWriter", () => ({
	RecordingFileWriter: class {
		constructor() {
			return writer;
		}
	},
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
class TestMediaRecorder {
	state = "inactive";
	mimeType = "video/webm";
	onstop: (() => Promise<void>) | null = null;
	start() {
		this.state = "recording";
	}
	stop() {
		this.state = "inactive";
	}
}
function createContext() {
	return {
		selectMimeType: () => "video/webm",
		stream: { current: { getAudioTracks: () => [] } },
		recordingSessionTimestamp: { current: 1 },
		screenWriter: { current: null },
		mediaRecorder: { current: null as unknown as TestMediaRecorder },
		browserFinalizing: { current: false },
		setFinalizing: vi.fn(),
		openLoadingEditor: vi.fn(),
		setRecording: vi.fn(),
		cleanupCapturedMedia: vi.fn(),
		getRecordingDurationMs: () => 1000,
		notifyRecordingFinalizationFailure: vi.fn(),
		finalizeRecordingSession: vi.fn(),
		pendingWebcamPathPromise: { current: null },
		resolvedWebcamPath: { current: null },
		webcamTimeOffsetMs: { current: 0 },
		hideEditorOverlayCursorByDefault: { current: false },
		beginWebcamCapture: vi.fn(),
		resetRecordingClock: vi.fn(),
		webcamStartTime: { current: null },
	};
}
async function start() {
	const context = createContext();
	await startBrowserRecorder(context as unknown as Parameters<typeof startBrowserRecorder>[0], {
		videoTrack: {
			getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
		} as MediaStreamTrack,
		systemAudioIncluded: false,
		startWasCancelled: () => false,
	});
	return context;
}
beforeEach(() => {
	vi.clearAllMocks();
	writer.isCancelled = false;
	writer.finish.mockResolvedValue({ success: true, path: "/recordings/completed.webm" });
	vi.stubGlobal("MediaRecorder", TestMediaRecorder);
	vi.stubGlobal("window", {
		electronAPI: {
			setRecordingState: vi.fn().mockResolvedValue(undefined),
			hudOverlayClose: vi.fn(),
		},
	});
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
describe("browser recording editor boundary", () => {
	it("does not start a webcam companion or recording clock when stream acquisition finished after cancellation", async () => {
		const context = createContext();
		context.webcamTimeOffsetMs.current = 123;
		await startBrowserRecorder(
			context as unknown as Parameters<typeof startBrowserRecorder>[0],
			{
				videoTrack: {
					getSettings: () => ({ width: 1920, height: 1080 }),
				} as MediaStreamTrack,
				systemAudioIncluded: false,
				startWasCancelled: () => true,
			},
		);
		expect(context.beginWebcamCapture).not.toHaveBeenCalled();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		expect(context.webcamTimeOffsetMs.current).toBe(123);
		expect(context.mediaRecorder.current.state).toBe("inactive");
		expect(context.setRecording).not.toHaveBeenCalled();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
	});
	it("opens the loading editor while file persistence is still pending", async () => {
		let resolve!: (result: { success: boolean; path: string }) => void;
		writer.finish.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const context = await start();
		const stopped = context.mediaRecorder.current.onstop!();
		await vi.waitFor(() => expect(writer.finish).toHaveBeenCalledOnce());
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(context.setFinalizing).toHaveBeenCalledWith(true);
		resolve({ success: true, path: "/recordings/completed.webm" });
		await stopped;
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(context.finalizeRecordingSession).toHaveBeenCalledExactlyOnceWith(
			"/recordings/completed.webm",
			null,
		);
		expect(context.setFinalizing).toHaveBeenLastCalledWith(false);
	});
	it.each([
		"failed",
		"empty",
		"rejected",
	])("reports %s persistence to the loading editor without publishing invalid media", async (failure) => {
		if (failure === "rejected") writer.finish.mockRejectedValue(new Error("Disk unavailable"));
		else
			writer.finish.mockResolvedValue(
				failure === "empty" ? { success: true } : { success: false, message: "No frames" },
			);
		const context = await start();
		await context.mediaRecorder.current.onstop!();
		expect(context.notifyRecordingFinalizationFailure).toHaveBeenCalledOnce();
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		expect(context.setFinalizing).toHaveBeenLastCalledWith(false);
		expect(context.browserFinalizing.current).toBe(false);
	});
	it("discards canceled browser capture without opening or finalizing an editor session", async () => {
		const context = await start();
		writer.isCancelled = true;
		await context.mediaRecorder.current.onstop!();
		expect(writer.discard).toHaveBeenCalledOnce();
		expect(writer.finish).not.toHaveBeenCalled();
		expect(context.openLoadingEditor).not.toHaveBeenCalled();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		expect(context.setFinalizing).toHaveBeenLastCalledWith(false);
	});
});
