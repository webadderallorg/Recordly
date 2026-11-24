import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startNativeRecorder } from "./startNativeRecorder";

vi.mock("@/components/ui/toast", () => ({ toast: { warning: vi.fn() } }));
vi.mock("@/i18n/runtime", () => ({ translate: (_key: string, fallback: string) => fallback }));

type Context = Parameters<typeof startNativeRecorder>[0];

function createContext(): Context {
	return {
		systemAudioEnabled: false,
		microphoneEnabled: false,
		microphoneDeviceId: undefined,
		nativeScreenRecording: { current: false },
		nativeWindowsRecording: { current: false },
		nativeWarmStartActive: { current: false },
		discardActiveNativeCapture: vi.fn().mockResolvedValue(true),
		cleanupCapturedMedia: vi.fn(),
		stopWebcamRecorder: vi.fn().mockResolvedValue(null),
		logNativeCaptureDiagnostics: vi.fn(),
		hasShownNativeWindowsFallbackToast: { current: false },
		setRecording: vi.fn(),
		setCountdownActive: vi.fn(),
		countdownDelay: 3,
		microphoneFallback: { resetStartDelay: vi.fn(), start: vi.fn() },
		beginWebcamCapture: vi.fn(),
		resetRecordingClock: vi.fn(),
		webcamTimeOffsetMs: { current: 0 },
		webcamStartTime: { current: null },
		stopMicFallbackRecorder: vi.fn().mockResolvedValue(null),
	} as unknown as Context;
}

describe("startNativeRecorder countdown overlap", () => {
	let api: Record<string, ReturnType<typeof vi.fn>>;
	let resolveNative!: (value: unknown) => void;
	let resolveCountdown!: (value: unknown) => void;
	const options = {
		selectedSource: { id: "screen:1:0" } as ProcessedDesktopSource,
		useNativeWindowsCapture: false,
		shouldWarmStartNativeCapture: true,
		startWasCancelled: () => false,
	};

	beforeEach(() => {
		api = {
			startNativeScreenRecording: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveNative = resolve;
					}),
			),
			startCountdown: vi.fn(
				() =>
					new Promise((resolve) => {
						resolveCountdown = resolve;
					}),
			),
			cancelCountdown: vi.fn(async () => {
				resolveCountdown({ success: false, cancelled: true });
				return { success: true };
			}),
			pauseNativeScreenRecording: vi.fn().mockResolvedValue({ success: true }),
			resumeNativeScreenRecording: vi.fn().mockResolvedValue({ success: true }),
			setRecordingState: vi.fn().mockResolvedValue(undefined),
		};
		vi.stubGlobal("window", { electronAPI: api });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("shows the countdown while capture warms up and records only after it ends", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, options);
		expect(api.startCountdown).toHaveBeenCalledWith(3);
		expect(context.setCountdownActive).toHaveBeenCalledWith(true);

		resolveNative({ success: true });
		await vi.waitFor(() => expect(api.pauseNativeScreenRecording).toHaveBeenCalled());
		expect(api.resumeNativeScreenRecording).not.toHaveBeenCalled();

		resolveCountdown({ success: true });
		await expect(started).resolves.toBe("finished");
		expect(api.resumeNativeScreenRecording).toHaveBeenCalledOnce();
		expect(context.setRecording).toHaveBeenCalledWith(true);
		expect(api.cancelCountdown).not.toHaveBeenCalled();
	});

	it("cancels the running countdown when capture fails to start", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, options);
		resolveNative({ success: false, error: "helper crashed" });
		await expect(started).rejects.toThrow("helper crashed");
		expect(api.cancelCountdown).toHaveBeenCalledOnce();
		expect(context.setCountdownActive).toHaveBeenLastCalledWith(false);
	});

	it("does not start a countdown when none is configured", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, {
			...options,
			shouldWarmStartNativeCapture: false,
		});
		resolveNative({ success: true });
		await expect(started).resolves.toBe("finished");
		expect(api.startCountdown).not.toHaveBeenCalled();
		expect(api.pauseNativeScreenRecording).not.toHaveBeenCalled();
	});
});
