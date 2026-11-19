import { afterEach, expect, it, vi } from "vitest";
import { useRecorderSubscriptions } from "./useRecorderSubscriptions";
const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock("react", () => ({
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
}));
vi.mock("@/components/ui/toast", () => ({ toast: { error: vi.fn() } }));
afterEach(() => {
	effects.splice(0);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it.each([
	false,
	true,
])("preserves interrupted microphone chunks/timing until recovery stores them (state IPC rejected: %s)", async (stateFails) => {
	let interrupted!: (state: { message: string; reason: string }) => void;
	let finishMicrophone!: (blob: Blob) => void;
	const microphone = new Promise<Blob>((resolve) => {
		finishMicrophone = resolve;
	});
	let metadataAlive = true;
	const recover = vi.fn(async (blob: Promise<Blob | null>, delay: number) => {
		expect(await blob).toBeInstanceOf(Blob);
		expect(delay).toBe(273);
		expect(metadataAlive).toBe(true);
		return "/recordings/recovered.mp4";
	});
	const cleanup = vi.fn(() => {
		metadataAlive = false;
	});
	const stopMic = vi.fn(() => microphone);
	const stopWebcam = vi.fn().mockResolvedValue(null);
	vi.stubGlobal("window", {
		electronAPI: {
			onRecordingInterrupted: (listener: typeof interrupted) => {
				interrupted = listener;
				return vi.fn();
			},
			setRecordingState: vi.fn().mockImplementation(async () => {
				if (stateFails) throw new Error("IPC lost");
			}),
			openSourceSelector: vi.fn(),
		},
	});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	const context = {
		stopRecording: { current: vi.fn() },
		setRecording: vi.fn(),
		recordingStartGeneration: { current: 1 },
		nativeScreenRecording: { current: true },
		nativeWindowsRecording: { current: false },
		nativeWarmStartActive: { current: false },
		cleanupCapturedMedia: cleanup,
		recoverNativeRecordingSession: recover,
		hasPromptedForReselect: { current: false },
		nativeStopRequestInFlight: { current: false },
		discardActiveNativeCapture: vi.fn(),
		pendingNativeCleanupPath: { current: null },
		mediaRecorder: { current: null },
		stopMicFallbackRecorder: stopMic,
		stopWebcamRecorder: stopWebcam,
		microphoneFallback: { startDelayMs: 273 },
	};
	useRecorderSubscriptions(context as unknown as Parameters<typeof useRecorderSubscriptions>[0]);
	effects.splice(0).forEach((effect) => effect());
	interrupted({ message: "Capture interrupted", reason: "window-unavailable" });
	expect(stopMic).toHaveBeenCalledOnce();
	expect(cleanup).not.toHaveBeenCalled();
	finishMicrophone(new Blob(["retained microphone tail"]));
	await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
	expect(recover).toHaveBeenCalledOnce();
	expect(stopWebcam).toHaveBeenCalledOnce();
	expect(window.electronAPI.openSourceSelector).not.toHaveBeenCalled();
});
