import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useRecorderControls } from "./useRecorderControls";

vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), dismiss: vi.fn() },
}));

function createContext(paused: boolean) {
	return {
		recording: true,
		paused,
		recordingActive: { current: true },
		recordingStartGeneration: { current: 1 },
		nativeScreenRecording: { current: true },
		webcamRecorder: {
			current: { state: paused ? "paused" : "recording", pause: vi.fn(), resume: vi.fn() },
		},
		pauseMicFallbackRecorder: vi.fn(),
		resumeMicFallbackRecorder: vi.fn(),
		markRecordingPaused: vi.fn(),
		markRecordingResumed: vi.fn(),
		setPaused: vi.fn(),
	};
}

describe("native recorder pause and resume feedback", () => {
	const api = {
		pauseNativeScreenRecording: vi.fn(),
		resumeNativeScreenRecording: vi.fn(),
		pauseCursorCapture: vi.fn(),
		resumeCursorCapture: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		for (const call of Object.values(api)) call.mockResolvedValue({ success: true });
		vi.stubGlobal("window", { electronAPI: api });
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	for (const action of ["pause", "resume"] as const) {
		const invoke = (controls: ReturnType<typeof useRecorderControls>) =>
			action === "pause" ? controls.pauseRecording() : controls.resumeRecording();
		const nativeCall = () =>
			action === "pause" ? api.pauseNativeScreenRecording : api.resumeNativeScreenRecording;

		it.each([
			"webcam",
			"microphone",
			"both",
		] as const)(`keeps accepted native ${action} state and synchronizes other tracks after a throwing %s update`, async (failure) => {
			const context = createContext(action === "resume");
			const controls = useRecorderControls(
				context as unknown as Parameters<typeof useRecorderControls>[0],
			);
			const webcam =
				action === "pause"
					? context.webcamRecorder.current.pause
					: context.webcamRecorder.current.resume;
			const microphone =
				action === "pause"
					? context.pauseMicFallbackRecorder
					: context.resumeMicFallbackRecorder;
			if (failure !== "microphone")
				webcam.mockImplementationOnce(() => {
					throw new Error("Camera track ended");
				});
			if (failure !== "webcam")
				microphone.mockImplementationOnce(() => {
					throw new Error("Microphone track ended");
				});
			invoke(controls);
			await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
			expect(context.setPaused).toHaveBeenCalledExactlyOnceWith(action === "pause");
			const mark =
				action === "pause" ? context.markRecordingPaused : context.markRecordingResumed;
			expect(mark).toHaveBeenCalledOnce();
			expect(context.setPaused.mock.invocationCallOrder[0]).toBeLessThan(
				webcam.mock.invocationCallOrder[0],
			);
			expect(mark.mock.invocationCallOrder[0]).toBeLessThan(
				webcam.mock.invocationCallOrder[0],
			);
			expect(webcam).toHaveBeenCalledOnce();
			expect(microphone).toHaveBeenCalledOnce();
			const cursor = action === "pause" ? api.pauseCursorCapture : api.resumeCursorCapture;
			expect(cursor).toHaveBeenCalledWith(mark.mock.calls[0][0]);
			expect(toast.error).toHaveBeenCalledWith(
				action === "pause"
					? "The screen recording paused, but a camera or audio track could not pause."
					: "The screen recording resumed, but a camera or audio track could not resume.",
				{
					id: `recording-${action}-error`,
					description:
						failure === "both"
							? "Camera track ended\n\nMicrophone track ended"
							: failure === "webcam"
								? "Camera track ended"
								: "Microphone track ended",
				},
			);

			// A failed optional track update releases the native command lock for a retry.
			invoke(controls);
			await vi.waitFor(() => expect(nativeCall()).toHaveBeenCalledTimes(2));
			await vi.waitFor(() => expect(context.setPaused).toHaveBeenCalledTimes(2));
		});

		it(`does not send ${action} after capture ownership is released`, () => {
			const context = createContext(action === "resume");
			context.recordingActive.current = false;
			const controls = useRecorderControls(
				context as unknown as Parameters<typeof useRecorderControls>[0],
			);
			invoke(controls);
			expect(nativeCall()).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
		});

		it.each([
			["stopped", "success"],
			["new take", "success"],
			["native capture ended", "success"],
			["stopped", "refusal"],
			["new take", "refusal"],
			["stopped", "rejection"],
			["new take", "rejection"],
		] as const)(`ignores a late ${action} %s %s without altering the current capture`, async (change, result) => {
			let resolve!: (result: { success: boolean; error?: string }) => void;
			let reject!: (error: Error) => void;
			const pending = new Promise<{ success: boolean; error?: string }>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			nativeCall().mockReturnValueOnce(pending);
			const context = createContext(action === "resume");
			const controls = useRecorderControls(
				context as unknown as Parameters<typeof useRecorderControls>[0],
			);
			invoke(controls);
			expect(nativeCall()).toHaveBeenCalledOnce();
			if (change === "stopped") {
				context.recordingStartGeneration.current += 1;
				context.recordingActive.current = false;
			} else if (change === "new take") {
				context.recordingStartGeneration.current += 2;
				context.webcamRecorder.current = {
					state: action === "pause" ? "recording" : "paused",
					pause: vi.fn(),
					resume: vi.fn(),
				};
			} else context.nativeScreenRecording.current = false;
			if (result === "rejection") reject(new Error("Old helper disconnected"));
			else resolve({ success: result === "success", error: "Old helper disconnected" });
			await pending.catch(() => undefined);
			await Promise.resolve();
			expect(context.setPaused).not.toHaveBeenCalled();
			expect(context.markRecordingPaused).not.toHaveBeenCalled();
			expect(context.markRecordingResumed).not.toHaveBeenCalled();
			expect(context.pauseMicFallbackRecorder).not.toHaveBeenCalled();
			expect(context.resumeMicFallbackRecorder).not.toHaveBeenCalled();
			expect(context.webcamRecorder.current.pause).not.toHaveBeenCalled();
			expect(context.webcamRecorder.current.resume).not.toHaveBeenCalled();
			expect(api.pauseCursorCapture).not.toHaveBeenCalled();
			expect(api.resumeCursorCapture).not.toHaveBeenCalled();
			expect(toast.error).not.toHaveBeenCalled();
			expect(toast.dismiss).not.toHaveBeenCalled();
		});

		it(`deduplicates ${action} while pending and keeps a new take independent of an old response`, async () => {
			let finishOld!: (result: { success: boolean }) => void;
			let finishCurrent!: (result: { success: boolean }) => void;
			const old = new Promise<{ success: boolean }>((resolve) => {
				finishOld = resolve;
			});
			const current = new Promise<{ success: boolean }>((resolve) => {
				finishCurrent = resolve;
			});
			nativeCall().mockReturnValueOnce(old).mockReturnValueOnce(current);
			const context = createContext(action === "resume");
			const controls = useRecorderControls(
				context as unknown as Parameters<typeof useRecorderControls>[0],
			);
			invoke(controls);
			invoke(controls);
			expect(nativeCall()).toHaveBeenCalledOnce();
			context.recordingStartGeneration.current += 2;
			invoke(controls);
			expect(nativeCall()).toHaveBeenCalledTimes(2);
			finishOld({ success: true });
			await old;
			invoke(controls);
			expect(nativeCall()).toHaveBeenCalledTimes(2);
			expect(context.setPaused).not.toHaveBeenCalled();
			finishCurrent({ success: true });
			await current;
			expect(context.setPaused).toHaveBeenCalledExactlyOnceWith(action === "pause");
		});

		for (const failure of ["response", "rejection"] as const) {
			it(`reports ${action} ${failure} and preserves all capture timing until a retry succeeds`, async () => {
				const paused = action === "resume";
				const context = createContext(paused);
				const controls = useRecorderControls(
					context as unknown as Parameters<typeof useRecorderControls>[0],
				);
				const nativeCall =
					action === "pause"
						? api.pauseNativeScreenRecording
						: api.resumeNativeScreenRecording;
				if (failure === "response")
					nativeCall.mockResolvedValueOnce({
						success: false,
						error: "Capture helper unavailable",
					});
				else nativeCall.mockRejectedValueOnce(new Error("Capture helper unavailable"));
				const control =
					action === "pause" ? controls.pauseRecording : controls.resumeRecording;
				control();
				await vi.waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
				expect(toast.error).toHaveBeenCalledWith(
					action === "pause"
						? "Could not pause the recording"
						: "Could not resume the recording",
					{
						id: `recording-${action}-error`,
						description:
							"Try again, or stop the recording to keep what you’ve captured.\n\nCapture helper unavailable",
					},
				);
				expect(context.setPaused).not.toHaveBeenCalled();
				expect(context.markRecordingPaused).not.toHaveBeenCalled();
				expect(context.markRecordingResumed).not.toHaveBeenCalled();
				expect(context.pauseMicFallbackRecorder).not.toHaveBeenCalled();
				expect(context.resumeMicFallbackRecorder).not.toHaveBeenCalled();
				expect(context.webcamRecorder.current.pause).not.toHaveBeenCalled();
				expect(context.webcamRecorder.current.resume).not.toHaveBeenCalled();
				expect(api.pauseCursorCapture).not.toHaveBeenCalled();
				expect(api.resumeCursorCapture).not.toHaveBeenCalled();

				control();
				await vi.waitFor(() =>
					expect(context.setPaused).toHaveBeenCalledExactlyOnceWith(!paused),
				);
				expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith(`recording-${action}-error`);
				expect(toast.error).toHaveBeenCalledOnce();
				expect(
					action === "pause" ? context.markRecordingPaused : context.markRecordingResumed,
				).toHaveBeenCalledOnce();
				expect(
					action === "pause"
						? context.pauseMicFallbackRecorder
						: context.resumeMicFallbackRecorder,
				).toHaveBeenCalledOnce();
				expect(
					action === "pause"
						? context.webcamRecorder.current.pause
						: context.webcamRecorder.current.resume,
				).toHaveBeenCalledOnce();
			});
		}
	}
});
