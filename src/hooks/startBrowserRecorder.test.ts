import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBrowserRecorder } from "./startBrowserRecorder";

const writer = vi.hoisted(() => ({
	isCancelled: false,
	cancel: vi.fn(),
	write: vi.fn(),
	discard: vi.fn(),
	finish: vi.fn(),
}));
const createWriter = vi.hoisted(() => vi.fn());
vi.mock("./recordingFileWriter", () => ({
	RecordingFileWriter: class {
		constructor(...args: unknown[]) {
			createWriter(...args);
			return writer;
		}
	},
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
class TestMediaRecorder extends EventTarget {
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
class TestVideo extends EventTarget {
	muted = false;
	srcObject: MediaStream | null = null;
	play = vi.fn().mockResolvedValue(undefined);
}
function preparePortal(context: ReturnType<typeof createContext>, startWasCancelled = () => false) {
	const video = new TestVideo();
	const track = Object.assign(new EventTarget(), {
		readyState: "live",
		getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
	});
	vi.stubGlobal("document", { createElement: () => video });
	vi.stubGlobal("MediaStream", class {});
	const runPortalCountdown = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
	const pending = startBrowserRecorder(
		context as unknown as Parameters<typeof startBrowserRecorder>[0],
		{
			videoTrack: track as unknown as MediaStreamTrack,
			systemAudioIncluded: false,
			runPortalCountdown,
			startWasCancelled,
		},
	);
	return { pending, video, track, runPortalCountdown };
}
function createContext() {
	return {
		getMimeTypes: () => ["video/webm"],
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
		captureSourceKind: { current: "screen" as "screen" | "window" },
		beginWebcamCapture: vi.fn(),
		resetRecordingClock: vi.fn(),
		webcamStartTime: { current: null },
	};
}
async function start(context = createContext()) {
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
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
describe("browser recording editor boundary", () => {
	it.each([
		"construct",
		"start",
	])("tries another codec when the first recorder fails at %s", async (stage) => {
		const preferred = "video/webm;codecs=h264";
		const fallback = "video/webm;codecs=vp8";
		const attempts: string[] = [];
		vi.stubGlobal(
			"MediaRecorder",
			class extends TestMediaRecorder {
				constructor(_stream: MediaStream, options: MediaRecorderOptions) {
					super();
					this.mimeType = options.mimeType ?? "";
					attempts.push(this.mimeType);
					if (this.mimeType === preferred && stage === "construct") {
						throw new DOMException("Encoder unavailable", "NotSupportedError");
					}
				}
				override start() {
					if (this.mimeType === preferred && stage === "start") {
						throw new DOMException(
							"Encoder initialization failed",
							"InvalidStateError",
						);
					}
					super.start();
				}
			},
		);
		const context = createContext();
		context.getMimeTypes = () => [preferred, fallback];
		await start(context);

		expect(attempts).toEqual([preferred, fallback]);
		expect(context.mediaRecorder.current.mimeType).toBe(fallback);
		expect(context.mediaRecorder.current.state).toBe("recording");
		expect(createWriter).toHaveBeenCalledExactlyOnceWith(
			window.electronAPI,
			expect.stringMatching(/\.webm$/),
			fallback,
			expect.any(Function),
		);
		expect(context.beginWebcamCapture).toHaveBeenCalledOnce();
		expect(context.resetRecordingClock).toHaveBeenCalledOnce();
		expect(window.electronAPI.setRecordingState).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("reports a recording permission error without retrying or starting a companion", async () => {
		const denied = new DOMException("Capture access denied", "SecurityError");
		const attempt = vi.fn(() => {
			throw denied;
		});
		vi.stubGlobal(
			"MediaRecorder",
			class extends TestMediaRecorder {
				override start() {
					attempt();
				}
			},
		);
		const context = createContext();
		context.getMimeTypes = () => ["video/webm;codecs=h264", "video/webm;codecs=vp8"];

		await expect(start(context)).rejects.toBe(denied);
		expect(attempt).toHaveBeenCalledOnce();
		expect(context.mediaRecorder.current).toBeNull();
		expect(createWriter).not.toHaveBeenCalled();
		expect(context.beginWebcamCapture).not.toHaveBeenCalled();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
	});

	it("starts the portal clock when the recorder confirms it is running", async () => {
		const context = createContext();
		const { pending, video, runPortalCountdown } = preparePortal(context);
		let finishCountdown!: (keepGoing: boolean) => void;
		runPortalCountdown.mockReturnValue(
			new Promise((resolve) => {
				finishCountdown = resolve;
			}),
		);
		expect(context.mediaRecorder.current).toBeNull();
		expect(context.beginWebcamCapture).not.toHaveBeenCalled();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
		expect(runPortalCountdown).not.toHaveBeenCalled();
		video.dispatchEvent(new Event("loadeddata"));
		await vi.waitFor(() => expect(runPortalCountdown).toHaveBeenCalledOnce());
		expect(context.mediaRecorder.current).toBeNull();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		const clock = vi.spyOn(Date, "now").mockReturnValue(1500);
		finishCountdown(true);
		await vi.waitFor(() => expect(createWriter).toHaveBeenCalledOnce());
		const recorder = context.mediaRecorder.current;
		const earlyClock = context.resetRecordingClock.mock.calls.length;
		const earlyTelemetry = vi.mocked(window.electronAPI.setRecordingState).mock.calls.length;
		clock.mockReturnValue(1800);
		recorder.dispatchEvent(new Event("start"));
		await pending;
		expect(earlyClock).toBe(0);
		expect(earlyTelemetry).toBe(0);
		expect(recorder.state).toBe("recording");
		expect(context.resetRecordingClock).toHaveBeenCalledExactlyOnceWith(1800);
		expect(window.electronAPI.setRecordingState).toHaveBeenCalledExactlyOnceWith(true, 1800);
		expect(video.srcObject).toBeNull();
	});
	it.each([
		"cancelled",
		"stopped",
		"errored",
	])("discards a portal recorder %s before startup and leaves the editor closed", async (result) => {
		vi.useFakeTimers();
		const context = createContext();
		let cancelled = false;
		const { pending, video } = preparePortal(context, () => cancelled);
		const completion =
			result === "cancelled"
				? expect(pending).resolves.toBeUndefined()
				: expect(pending).rejects.toThrow(/No video frames/);
		video.dispatchEvent(new Event("loadeddata"));
		await vi.advanceTimersByTimeAsync(0);
		const recorder = context.mediaRecorder.current;
		expect(recorder.state).toBe("recording");
		if (result === "cancelled") {
			cancelled = true;
			recorder.dispatchEvent(new Event("start"));
		} else if (result === "stopped") {
			recorder.stop();
			recorder.dispatchEvent(new Event("stop"));
			await recorder.onstop?.();
		} else {
			recorder.dispatchEvent(new Event("error"));
		}
		await completion;
		expect(recorder.state).toBe("inactive");
		expect(context.mediaRecorder.current).toBeNull();
		expect(context.screenWriter.current).toBeNull();
		expect(writer.cancel).toHaveBeenCalledOnce();
		expect(writer.discard).toHaveBeenCalledOnce();
		expect(context.openLoadingEditor).not.toHaveBeenCalled();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
	});
	it("uses the request timestamp when an active portal recorder has a delayed start event", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const context = createContext();
		const { pending, video } = preparePortal(context);
		video.dispatchEvent(new Event("loadeddata"));
		await vi.advanceTimersByTimeAsync(0);
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2000);
		await pending;
		expect(context.resetRecordingClock).toHaveBeenCalledExactlyOnceWith(1000);
		expect(window.electronAPI.setRecordingState).toHaveBeenCalledExactlyOnceWith(true, 1000);
	});
	it("does not start when the portal countdown is cancelled", async () => {
		const context = createContext();
		const { pending, video, runPortalCountdown } = preparePortal(context);
		runPortalCountdown.mockResolvedValue(false);
		video.dispatchEvent(new Event("loadeddata"));
		await pending;
		expect(context.mediaRecorder.current).toBeNull();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
	});
	it("does not start when the portal track ends during the countdown", async () => {
		const context = createContext();
		const { pending, video, track, runPortalCountdown } = preparePortal(context);
		runPortalCountdown.mockImplementation(async () => {
			track.readyState = "ended";
			return true;
		});
		video.dispatchEvent(new Event("loadeddata"));
		await expect(pending).rejects.toThrow(/No video frames/);
		expect(context.mediaRecorder.current).toBeNull();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
	});
	it("does not start after cancellation even if a portal frame arrives", async () => {
		const context = createContext();
		let canceled = false;
		const { pending, video } = preparePortal(context, () => canceled);
		canceled = true;
		video.dispatchEvent(new Event("loadeddata"));
		await pending;
		expect(context.mediaRecorder.current).toBeNull();
		expect(context.resetRecordingClock).not.toHaveBeenCalled();
		expect(video.srcObject).toBeNull();
	});
	it.each([
		"ended",
		"timed out",
	])("fails a portal stream that %s before a frame", async (reason) => {
		vi.useFakeTimers();
		const context = createContext();
		const { pending, track, video } = preparePortal(context);
		const failure = expect(pending).rejects.toThrow(/No video frames/);
		if (reason === "ended") track.dispatchEvent(new Event("ended"));
		else await vi.runAllTimersAsync();
		await failure;
		expect(context.mediaRecorder.current).toBeNull();
		expect(window.electronAPI.setRecordingState).not.toHaveBeenCalled();
		expect(video.srcObject).toBeNull();
	});
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
		expect(context.mediaRecorder.current).toBeNull();
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
