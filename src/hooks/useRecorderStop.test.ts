import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeCaptureStopResult } from "./recordingNativeCleanup";
import { useRecorderEditorSession } from "./useRecorderEditorSession";
import { useRecorderStop } from "./useRecorderStop";

vi.mock("react", () => ({
	useRef: <T>(current: T) => ({ current }),
	useCallback: <T>(callback: T) => callback,
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
function createContext() {
	const context = {
		recordingStartGeneration: { current: 1 },
		setPaused: vi.fn(),
		nativeScreenRecording: { current: true },
		nativeWarmStartActive: { current: false },
		setRecording: vi.fn(),
		discardActiveNativeCapture: vi.fn().mockResolvedValue(true),
		cleanupCapturedMedia: vi.fn(),
		stopMicFallbackRecorder: vi.fn().mockResolvedValue(null),
		stopWebcamRecorder: vi.fn().mockResolvedValue(null),
		nativeStopRequestInFlight: { current: false },
		setFinalizing: vi.fn(),
		microphoneFallback: { startDelayMs: 0, trackSettings: null },
		markRecordingResumed: vi.fn(),
		getRecordingDurationMs: () => 1000,
		nativeWindowsRecording: { current: false },
		openLoadingEditor: vi.fn(),
		logNativeCaptureDiagnostics: vi.fn(),
		recoverNativeRecordingSession: vi.fn().mockResolvedValue(null),
		buildNativeCaptureFailureMessage: vi.fn().mockResolvedValue("Could not finish"),
		isMacOS: true,
		notifyRecordingFinalizationFailure: vi.fn().mockResolvedValue(undefined),
		finalizeRecordingSession: vi.fn().mockResolvedValue(undefined),
		webcamTimeOffsetMs: { current: 0 },
		hideEditorOverlayCursorByDefault: { current: false },
		storeMicrophoneSidecar: vi.fn().mockResolvedValue(null),
		mediaRecorder: { current: null as MediaRecorder | null },
		pendingWebcamPathPromise: { current: null as Promise<string | null> | null },
	};
	const session = useRecorderEditorSession(context);
	context.openLoadingEditor = vi.fn(session.openLoadingEditor);
	context.finalizeRecordingSession = vi.fn(session.finalizeRecordingSession);
	context.notifyRecordingFinalizationFailure = vi.fn(session.notifyRecordingFinalizationFailure);
	return context;
}
const api = {
	stopNativeScreenRecording: vi.fn(),
	setRecordingState: vi.fn(),
	setCurrentRecordingSession: vi.fn(),
	hudOverlayClose: vi.fn(),
	setCurrentVideoPath: vi.fn(),
	openLoadingRecordingEditor: vi.fn(),
	finishRecordingEditor: vi.fn(),
	switchToEditor: vi.fn(),
};
function stop(context: ReturnType<typeof createContext>) {
	useRecorderStop(
		context as unknown as Parameters<typeof useRecorderStop>[0],
	).stopRecording.current();
}
beforeEach(() => {
	vi.clearAllMocks();
	for (const call of Object.values(api)) call.mockResolvedValue({ success: true });
	vi.stubGlobal("window", { electronAPI: api });
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
describe("recording stop editor handoff", () => {
	it("opens the loading editor before native stop settles and publishes the valid session once", async () => {
		let resolve!: (result: NativeCaptureStopResult) => void;
		api.stopNativeScreenRecording.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const context = createContext();
		stop(context);
		stop(context);
		expect(context.setFinalizing).toHaveBeenCalledWith(true);
		expect(api.stopNativeScreenRecording).toHaveBeenCalledOnce();
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(api.openLoadingRecordingEditor).toHaveBeenCalledOnce();
		expect(api.finishRecordingEditor).not.toHaveBeenCalled();
		expect(api.switchToEditor).not.toHaveBeenCalled();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		resolve({ success: true, path: "/recordings/completed.mp4" });
		await vi.waitFor(() =>
			expect(context.finalizeRecordingSession).toHaveBeenCalledExactlyOnceWith(
				"/recordings/completed.mp4",
				null,
			),
		);
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(api.openLoadingRecordingEditor).toHaveBeenCalledOnce();
		expect(api.finishRecordingEditor).toHaveBeenCalledOnce();
		expect(api.setCurrentVideoPath).toHaveBeenCalledWith(
			"/recordings/completed.mp4",
			expect.any(Object),
		);
		expect(context.openLoadingEditor.mock.invocationCallOrder[0]).toBeLessThan(
			context.finalizeRecordingSession.mock.invocationCallOrder[0],
		);
		await vi.waitFor(() => expect(api.hudOverlayClose).toHaveBeenCalledOnce());
	});
	it.each([
		"failed",
		"empty",
		"rejected",
	])("surfaces %s finalization in the loading editor without publishing invalid media", async (failure) => {
		if (failure === "rejected")
			api.stopNativeScreenRecording.mockRejectedValue(new Error("Capture connection lost"));
		else
			api.stopNativeScreenRecording.mockResolvedValue(
				failure === "empty" ? { success: true } : { success: false, error: "No frames" },
			);
		const context = createContext();
		stop(context);
		await vi.waitFor(() =>
			expect(context.notifyRecordingFinalizationFailure).toHaveBeenCalledOnce(),
		);
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(api.openLoadingRecordingEditor).toHaveBeenCalledOnce();
		expect(api.finishRecordingEditor).toHaveBeenCalledExactlyOnceWith("Could not finish");
		expect(api.switchToEditor).not.toHaveBeenCalled();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		expect(api.hudOverlayClose).not.toHaveBeenCalled();
		expect(context.setFinalizing).toHaveBeenLastCalledWith(false);
		expect(context.nativeStopRequestInFlight.current).toBe(false);
		expect(api.setRecordingState).toHaveBeenCalledWith(false);
	});
	it("discards canceled native countdown warm capture without opening an editor", async () => {
		const context = createContext();
		context.nativeWarmStartActive.current = true;
		stop(context);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(false));
		expect(context.discardActiveNativeCapture).toHaveBeenCalledOnce();
		expect(context.cleanupCapturedMedia).toHaveBeenCalledOnce();
		expect(context.openLoadingEditor).not.toHaveBeenCalled();
		expect(api.openLoadingRecordingEditor).not.toHaveBeenCalled();
		expect(api.finishRecordingEditor).not.toHaveBeenCalled();
		expect(api.switchToEditor).not.toHaveBeenCalled();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		expect(api.stopNativeScreenRecording).not.toHaveBeenCalled();
	});
	it("does not open anything on idle or failed-start cleanup without a recorder", () => {
		const context = createContext();
		context.nativeScreenRecording.current = false;
		stop(context);
		expect(context.openLoadingEditor).not.toHaveBeenCalled();
		expect(api.openLoadingRecordingEditor).not.toHaveBeenCalled();
		expect(api.finishRecordingEditor).not.toHaveBeenCalled();
		expect(api.switchToEditor).not.toHaveBeenCalled();
		expect(context.finalizeRecordingSession).not.toHaveBeenCalled();
		expect(api.hudOverlayClose).not.toHaveBeenCalled();
	});
	it("opens the loading editor immediately when browser capture is stopped", () => {
		const context = createContext();
		context.nativeScreenRecording.current = false;
		const recorder = { state: "recording", requestData: vi.fn(), stop: vi.fn() };
		context.mediaRecorder.current = recorder as unknown as MediaRecorder;
		stop(context);
		expect(recorder.stop).toHaveBeenCalledOnce();
		expect(context.setFinalizing).toHaveBeenCalledWith(true);
		expect(context.openLoadingEditor).toHaveBeenCalledOnce();
		expect(api.openLoadingRecordingEditor).toHaveBeenCalledOnce();
		expect(api.finishRecordingEditor).not.toHaveBeenCalled();
		expect(api.switchToEditor).not.toHaveBeenCalled();
	});
});
