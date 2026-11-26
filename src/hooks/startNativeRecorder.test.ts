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

	it("returns a failure when native capture has already notified the user", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, options);
		resolveNative({ success: false, userNotified: true });
		await expect(started).resolves.toBe("failed");
		expect(context.cleanupCapturedMedia).toHaveBeenCalledOnce();
		expect(api.cancelCountdown).toHaveBeenCalledOnce();
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
		expect(context.setRecording).not.toHaveBeenCalledWith(true);

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

	it("keeps the completed countdown when Windows capture falls back", async () => {
		const started = startNativeRecorder(createContext(), {
			...options,
			useNativeWindowsCapture: true,
		});
		resolveCountdown({ success: true });
		resolveNative({ success: false });
		await expect(started).resolves.toBe("browser-fallback");
		expect(api.startCountdown).toHaveBeenCalledOnce();
		expect(api.cancelCountdown).not.toHaveBeenCalled();
	});

	it("starts the fallback mic while the webcam is opening", async () => {
		const context = createContext();
		context.microphoneEnabled = true;
		vi.mocked(context.microphoneFallback.start).mockResolvedValue(true);
		let openWebcam!: () => void;
		const webcamReady = new Promise<void>((resolve) => {
			openWebcam = resolve;
		});
		const started = startNativeRecorder(context, {
			...options,
			shouldWarmStartNativeCapture: false,
			webcamReady,
		});
		resolveNative({ success: true, microphoneFallbackRequired: true });
		await vi.waitFor(() => expect(context.microphoneFallback.start).toHaveBeenCalledOnce());
		expect(context.beginWebcamCapture).not.toHaveBeenCalled();
		openWebcam();
		await expect(started).resolves.toBe("finished");
		expect(context.beginWebcamCapture).toHaveBeenCalledOnce();
	});

	it("runs Linux portal countdown only after portal selection succeeds", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, {
			...options,
			selectedSource: { id: "screen:linux-portal" } as ProcessedDesktopSource,
			shouldWarmStartNativeCapture: false,
			useNativeLinuxPortalCapture: true,
			shouldPostStartCountdown: true,
		});
		expect(api.startCountdown).not.toHaveBeenCalled();

		resolveNative({ success: true, microphoneFallbackRequired: false });
		expect(api.startNativeScreenRecording).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ startLinuxCapturePaused: true }),
		);
		expect(api.pauseNativeScreenRecording).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledExactlyOnceWith(3));
		expect(api.resumeNativeScreenRecording).not.toHaveBeenCalled();

		resolveCountdown({ success: true });
		await expect(started).resolves.toBe("finished");
		expect(api.resumeNativeScreenRecording).toHaveBeenCalledOnce();
		expect(context.setRecording).toHaveBeenCalledWith(true);
	});

	it("returns failed without browser fallback when the Linux portal dialog is cancelled", async () => {
		const context = createContext();
		const started = startNativeRecorder(context, {
			...options,
			selectedSource: { id: "screen:linux-portal" } as ProcessedDesktopSource,
			shouldWarmStartNativeCapture: false,
			useNativeLinuxPortalCapture: true,
			shouldPostStartCountdown: true,
		});
		resolveNative({ success: false, captureCancelled: true });
		await expect(started).resolves.toBe("failed");
		expect(api.startCountdown).not.toHaveBeenCalled();
		expect(context.cleanupCapturedMedia).toHaveBeenCalledOnce();
	});

	it("falls back to browser capture when Linux portal startup fails unexpectedly", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const context = createContext();
		const started = startNativeRecorder(context, {
			...options,
			selectedSource: { id: "screen:linux-portal" } as ProcessedDesktopSource,
			shouldWarmStartNativeCapture: false,
			useNativeLinuxPortalCapture: true,
			shouldPostStartCountdown: true,
		});
		resolveNative({ success: false, error: "Filesink failed: permission denied" });
		await expect(started).resolves.toBe("browser-fallback");
		expect(api.startCountdown).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
