import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireRecorderBrowserStream } from "./acquireRecorderBrowserStream";
import type { RecorderContext } from "./recorderContext";
import { startBrowserRecorder } from "./startBrowserRecorder";
import { startNativeRecorder } from "./startNativeRecorder";
import { useRecorderStartup } from "./useRecorderStartup";

vi.mock("./acquireRecorderBrowserStream", () => ({ acquireRecorderBrowserStream: vi.fn() }));
vi.mock("./startBrowserRecorder", () => ({ startBrowserRecorder: vi.fn() }));
vi.mock("./startNativeRecorder", () => ({ startNativeRecorder: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));

const source = { id: "screen:1:0", name: "Screen" } as ProcessedDesktopSource;

function createContext() {
	return {
		startInFlight: { current: false },
		recordingActive: { current: false },
		browserFinalizing: { current: false },
		recordingStartGeneration: { current: 0 },
		hasPromptedForReselect: { current: true },
		pendingStart: { current: null as Promise<void> | null },
		setStarting: vi.fn(),
		prepareRecordingStart: vi.fn().mockResolvedValue({
			selectedSource: source,
			useNativeMacScreenCapture: false,
			useNativeWindowsCapture: false,
		}),
		cleanupCapturedMedia: vi.fn(),
		stopWebcamRecorder: vi.fn().mockResolvedValue(null),
		countdownDelay: 3,
		setCountdownActive: vi.fn(),
		recordingSessionTimestamp: { current: null as number | null },
		resetRecordingClock: vi.fn(),
		setRecording: vi.fn(),
		nativeScreenRecording: { current: false },
		discardActiveNativeCapture: vi.fn().mockResolvedValue(true),
		stopMicFallbackRecorder: vi.fn().mockResolvedValue(null),
	};
}

describe("recording startup coordination", () => {
	let api: {
		reserveRecordingSession: ReturnType<typeof vi.fn>;
		releaseRecordingStartup: ReturnType<typeof vi.fn>;
		finishRecordingStartup: ReturnType<typeof vi.fn>;
		setRecordingState: ReturnType<typeof vi.fn>;
		startCountdown: ReturnType<typeof vi.fn>;
	};
	const start = (context: ReturnType<typeof createContext>) =>
		useRecorderStartup(context as unknown as RecorderContext).startRecording();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(startNativeRecorder).mockResolvedValue("finished");
		vi.mocked(acquireRecorderBrowserStream).mockResolvedValue({
			videoTrack: {} as MediaStreamTrack,
			systemAudioIncluded: false,
		});
		vi.mocked(startBrowserRecorder).mockResolvedValue(undefined);
		api = {
			reserveRecordingSession: vi.fn().mockResolvedValue({ success: true, token: "owner" }),
			releaseRecordingStartup: vi.fn(),
			finishRecordingStartup: vi.fn().mockResolvedValue(undefined),
			setRecordingState: vi.fn().mockResolvedValue(undefined),
			startCountdown: vi.fn().mockResolvedValue({ success: true }),
		};
		vi.stubGlobal("window", { electronAPI: api });
		vi.stubGlobal("alert", vi.fn());
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("releases startup state without opening capture after reservation denial", async () => {
		api.reserveRecordingSession.mockResolvedValue({ success: false, message: "Busy" });
		const context = createContext();
		await start(context);
		expect(context.prepareRecordingStart).not.toHaveBeenCalled();
		expect(api.releaseRecordingStartup).not.toHaveBeenCalled();
		expect(api.finishRecordingStartup).toHaveBeenCalledOnce();
		expect(context.startInFlight.current).toBe(false);
		expect(context.pendingStart.current).toBeNull();
		expect(context.setStarting.mock.calls).toEqual([[true], [false]]);
	});

	it("leaves native warm-start countdown ownership with the native recorder", async () => {
		const context = createContext();
		context.prepareRecordingStart.mockResolvedValue({
			selectedSource: source,
			useNativeMacScreenCapture: true,
			useNativeWindowsCapture: false,
		});
		await start(context);
		expect(startNativeRecorder).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ shouldWarmStartNativeCapture: true }),
		);
		expect(api.startCountdown).not.toHaveBeenCalled();
		expect(acquireRecorderBrowserStream).not.toHaveBeenCalled();
		expect(api.releaseRecordingStartup).toHaveBeenCalledWith("owner");
	});

	it("runs countdown after a native Windows fallback before acquiring browser capture", async () => {
		const order: string[] = [];
		const context = createContext();
		context.prepareRecordingStart.mockResolvedValue({
			selectedSource: source,
			useNativeMacScreenCapture: false,
			useNativeWindowsCapture: true,
		});
		vi.mocked(startNativeRecorder).mockImplementation(async () => {
			order.push("native");
			return "browser-fallback";
		});
		api.startCountdown.mockImplementation(async () => {
			order.push("countdown");
			return { success: true };
		});
		vi.mocked(acquireRecorderBrowserStream).mockImplementation(async () => {
			order.push("acquire");
			return { videoTrack: {} as MediaStreamTrack, systemAudioIncluded: false };
		});
		vi.mocked(startBrowserRecorder).mockImplementation(async () => {
			order.push("record");
		});
		await start(context);
		expect(order).toEqual(["native", "countdown", "acquire", "record"]);
		expect(context.setCountdownActive.mock.calls).toEqual([[true], [false]]);
		expect(acquireRecorderBrowserStream).toHaveBeenCalledWith(
			context,
			expect.objectContaining({ nativeWindowsCaptureStartFailed: true }),
		);
	});

	it("cleans canceled acquisition preparation before releasing the reservation", async () => {
		const context = createContext();
		let prepare!: (result: unknown) => void;
		context.prepareRecordingStart.mockReturnValue(
			new Promise((resolve) => {
				prepare = resolve;
			}),
		);
		const pending = start(context);
		await vi.waitFor(() => expect(context.prepareRecordingStart).toHaveBeenCalledOnce());
		const cleanupFinished = context.pendingStart.current;
		context.recordingStartGeneration.current += 1;
		prepare({ selectedSource: source });
		await pending;
		await expect(cleanupFinished).resolves.toBeUndefined();
		expect(startNativeRecorder).not.toHaveBeenCalled();
		expect(acquireRecorderBrowserStream).not.toHaveBeenCalled();
		expect(context.cleanupCapturedMedia).toHaveBeenCalled();
		expect(context.stopMicFallbackRecorder).toHaveBeenCalledOnce();
		expect(context.stopWebcamRecorder).toHaveBeenCalled();
		expect(api.setRecordingState).toHaveBeenCalledWith(false);
		expect(api.releaseRecordingStartup).toHaveBeenCalledWith("owner");
	});

	it("keeps a dismissed Wayland portal silent while completing cleanup", async () => {
		const context = createContext();
		vi.mocked(acquireRecorderBrowserStream).mockImplementation(async (_context, options) => {
			options.onPortalCapture(true);
			throw new DOMException("Cancelled", "NotAllowedError");
		});
		await start(context);
		expect(alert).not.toHaveBeenCalled();
		expect(startBrowserRecorder).not.toHaveBeenCalled();
		expect(context.cleanupCapturedMedia).toHaveBeenCalledOnce();
		expect(context.stopWebcamRecorder).toHaveBeenCalledOnce();
		expect(api.setRecordingState).toHaveBeenCalledWith(false);
		expect(api.finishRecordingStartup).toHaveBeenCalledOnce();
		expect(api.releaseRecordingStartup).toHaveBeenCalledWith("owner");
	});
});
