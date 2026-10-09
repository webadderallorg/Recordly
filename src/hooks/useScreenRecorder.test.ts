import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	createBrowserRecordingOptions,
	createProcessedMicrophoneConstraints,
	createRemoteStopTracker,
	handleRemoteRecordingCommand,
	normalizeBrowserMicrophoneProfile,
	persistFinalizedRecording,
	type RemoteActionOutcome,
	type RemoteRecorderState,
	resolveBrowserCaptureCursorPolicy,
	resolveCountdownBlock,
	resolveHideOverlayCursor,
	resolveStartPreflight,
	START_BLOCK_MESSAGES,
	shouldUseNativeWindowsCaptureForSource,
	stopAndDiscardNativeCapture,
} from "./useScreenRecorder";

type RecordingState = "inactive" | "recording" | "paused";

function createMockMediaRecorder(initialState: RecordingState = "inactive") {
	let _state: RecordingState = initialState;
	return {
		get state() {
			return _state;
		},
		pause: vi.fn(() => {
			if (_state === "recording") _state = "paused";
		}),
		resume: vi.fn(() => {
			if (_state === "paused") _state = "recording";
		}),
		requestData: vi.fn(),
		stop: vi.fn(() => {
			_state = "inactive";
		}),
		start: vi.fn(() => {
			_state = "recording";
		}),
	};
}

describe("createProcessedMicrophoneConstraints", () => {
	it("requests browser voice processing with AGC for the default microphone", () => {
		expect(createProcessedMicrophoneConstraints()).toEqual({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("keeps default voice processing when a specific microphone is selected", () => {
		expect(createProcessedMicrophoneConstraints("device-123")).toMatchObject({
			audio: {
				deviceId: { exact: "device-123" },
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
				channelCount: { ideal: 1 },
				sampleRate: { ideal: 48000 },
			},
			video: false,
		});
	});

	it("can request the legacy browser processed profile for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "processed")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can disable AGC for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-agc")).toMatchObject({
			audio: {
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("can disable echo cancellation for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "no-echo")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: true,
				autoGainControl: true,
			},
			video: false,
		});
	});

	it("can request a raw browser microphone stream for lab comparisons", () => {
		expect(createProcessedMicrophoneConstraints(undefined, "raw")).toMatchObject({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
			video: false,
		});
	});

	it("normalizes invalid lab microphone profiles to production voice processing", () => {
		expect(normalizeBrowserMicrophoneProfile("RAW")).toBe("raw");
		expect(normalizeBrowserMicrophoneProfile("unknown")).toBe("processed");
		expect(normalizeBrowserMicrophoneProfile(null)).toBe("processed");
	});
});

describe("createBrowserRecordingOptions", () => {
	it("sets an aggregate bitrate target for browser screen recordings", () => {
		expect(
			createBrowserRecordingOptions({
				audioBitsPerSecond: 128_000,
				mimeType: "video/webm;codecs=vp9",
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			audioBitsPerSecond: 128_000,
			bitsPerSecond: 30_728_000,
			mimeType: "video/webm;codecs=vp9",
			videoBitsPerSecond: 30_600_000,
		});
	});

	it("keeps video-only recordings on the requested video budget", () => {
		expect(
			createBrowserRecordingOptions({
				videoBitsPerSecond: 30_600_000,
			}),
		).toEqual({
			bitsPerSecond: 30_600_000,
			videoBitsPerSecond: 30_600_000,
		});
	});
});

describe("resolveBrowserCaptureCursorPolicy", () => {
	it("preserves the existing hidden-cursor browser policy by default", () => {
		expect(resolveBrowserCaptureCursorPolicy()).toEqual({
			streamCursor: "never",
			hideOsCursorBeforeRecording: true,
			hideEditorOverlayCursorByDefault: true,
		});
	});

	it("uses the browser captured cursor after native Windows capture fails to start", () => {
		expect(
			resolveBrowserCaptureCursorPolicy({ nativeWindowsCaptureStartFailed: true }),
		).toEqual({
			streamCursor: "always",
			hideOsCursorBeforeRecording: false,
			hideEditorOverlayCursorByDefault: true,
		});
	});
});

describe("shouldUseNativeWindowsCaptureForSource", () => {
	it("keeps native Windows capture on screen sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "screen:101:0" })).toBe(true);
	});

	it("keeps native Windows capture on window sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "window:123456:0" })).toBe(true);
	});

	it("keeps browser capture for non-desktop sources", () => {
		expect(shouldUseNativeWindowsCaptureForSource({ id: "browser-tab:abc" })).toBe(false);
	});
});

describe("stopAndDiscardNativeCapture", () => {
	it("deletes the partial recording after a successful warm-start stop", async () => {
		const deleteRecordingFile = vi.fn().mockResolvedValue(undefined);

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: true,
					path: "C:\\Recordly\\warm-start.mp4",
				}),
				deleteRecordingFile,
			}),
		).resolves.toEqual({
			stopSucceeded: true,
			deleteSucceeded: true,
			path: "C:\\Recordly\\warm-start.mp4",
		});
		expect(deleteRecordingFile).toHaveBeenCalledWith("C:\\Recordly\\warm-start.mp4");
	});

	it("reports an unsuccessful stop without deleting or confirming cleanup", async () => {
		const deleteRecordingFile = vi.fn();

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: false,
					error: "helper still running",
				}),
				deleteRecordingFile,
			}),
		).resolves.toEqual({
			stopSucceeded: false,
			deleteSucceeded: false,
			error: "helper still running",
		});
		expect(deleteRecordingFile).not.toHaveBeenCalled();
	});

	it("keeps the stopped path available when deletion fails so cleanup can retry", async () => {
		const deleteError = new Error("file locked");

		await expect(
			stopAndDiscardNativeCapture({
				stopNativeScreenRecording: vi.fn().mockResolvedValue({
					success: true,
					path: "C:\\Recordly\\warm-start.mp4",
				}),
				deleteRecordingFile: vi.fn().mockRejectedValue(deleteError),
			}),
		).resolves.toEqual({
			stopSucceeded: true,
			deleteSucceeded: false,
			path: "C:\\Recordly\\warm-start.mp4",
			error: deleteError,
		});
	});
});

function stopRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
) {
	if (isNativeRecording) {
		if (webcamRecorder && webcamRecorder.state !== "inactive") {
			webcamRecorder.stop();
		}
		return { stopped: true, wasNative: true };
	}

	const recorderState = recorder.state;
	if (recorderState === "recording" || recorderState === "paused") {
		if (recorderState === "paused") {
			try {
				recorder.resume();
			} catch {
				// Stopping a paused recorder is still valid; mirror the hook's fallback path.
			}
		}
		if (webcamRecorder && webcamRecorder.state !== "inactive") {
			webcamRecorder.stop();
		}
		try {
			recorder.requestData();
		} catch {
			// Stopping should continue even if the browser refuses an explicit flush.
		}
		recorder.stop();
		return { stopped: true, wasNative: false };
	}
	return { stopped: false, wasNative: false };
}

function pauseRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "recording") {
			webcamRecorder.pause();
		}
		if (micFallbackRecorder?.state === "recording") {
			micFallbackRecorder.requestData();
			micFallbackRecorder.pause();
		}
		return true;
	}
	if (recorder.state === "recording") {
		recorder.pause();
		if (webcamRecorder?.state === "recording") {
			webcamRecorder.pause();
		}
		return true;
	}
	return false;
}

function resumeRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	recording: boolean,
	paused: boolean,
	isNativeRecording: boolean,
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): boolean {
	if (!recording || !paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "paused") {
			webcamRecorder.resume();
		}
		if (micFallbackRecorder?.state === "paused") {
			micFallbackRecorder.resume();
		}
		return true;
	}
	if (recorder.state === "paused") {
		recorder.resume();
		if (webcamRecorder?.state === "paused") {
			webcamRecorder.resume();
		}
		return true;
	}
	return false;
}

async function pauseNativeRecording(
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	result: { success: boolean } = { success: true },
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "recording") {
		webcamRecorder.pause();
	}
	if (micFallbackRecorder?.state === "recording") {
		micFallbackRecorder.requestData();
		micFallbackRecorder.pause();
	}

	return true;
}

async function resumeNativeRecording(
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	result: { success: boolean } = { success: true },
	micFallbackRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "paused") {
		webcamRecorder.resume();
	}
	if (micFallbackRecorder?.state === "paused") {
		micFallbackRecorder.resume();
	}

	return true;
}

async function stopNativeRecordingWithCompanions({
	getRecordingDurationMs,
	markRecordingResumed,
	now,
	stopMicFallbackRecorder,
	stopNativeScreenRecording,
	stopWebcamRecorder,
}: {
	getRecordingDurationMs: (timestampMs: number) => number;
	markRecordingResumed: (timestampMs: number) => void;
	now: () => number;
	stopMicFallbackRecorder: () => Promise<Blob | null>;
	stopNativeScreenRecording: () => Promise<{ success: boolean; path?: string }>;
	stopWebcamRecorder: () => Promise<string | null>;
}) {
	const stoppedAtMs = now();
	markRecordingResumed(stoppedAtMs);
	const expectedDurationMs = getRecordingDurationMs(stoppedAtMs);
	const micFallbackBlobPromise = stopMicFallbackRecorder();
	const webcamPathPromise = stopWebcamRecorder();
	const result = await stopNativeScreenRecording();
	const webcamPath = await webcamPathPromise;
	const micFallbackBlob = await micFallbackBlobPromise;

	return { expectedDurationMs, micFallbackBlob, result, webcamPath };
}

function cancelRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
	chunks: { current: Blob[] },
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	webcamChunks?: { current: Blob[] },
	stopMicFallbackRecorder?: () => Promise<Blob | null>,
) {
	if (webcamChunks) webcamChunks.current = [];
	if (webcamRecorder && webcamRecorder.state !== "inactive") {
		webcamRecorder.stop();
	}

	if (isNativeRecording) {
		void stopMicFallbackRecorder?.();
		return { cancelled: true, wasNative: true };
	}

	chunks.current = [];
	if (recorder.state !== "inactive") {
		recorder.stop();
	}
	return { cancelled: true, wasNative: false };
}

describe("useScreenRecorder state machine", () => {
	let recorder: ReturnType<typeof createMockMediaRecorder>;

	beforeEach(() => {
		recorder = createMockMediaRecorder("recording");
	});

	describe("stopRecording", () => {
		it("stops from recording state", () => {
			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.resume).not.toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resumes then stops from paused state", () => {
			recorder.pause();
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("resume is called before stop when paused", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "stop"]);
		});

		it("flushes the current recorder data before stopping", () => {
			const callOrder: string[] = [];
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["requestData", "stop"]);
		});

		it("resumes, flushes, then stops from paused state", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			stopRecording(recorder, false);

			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when the explicit data flush fails", () => {
			recorder.requestData.mockImplementation(() => {
				throw new Error("flush failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
		});

		it("still stops from paused state when the explicit data flush fails", () => {
			recorder.pause();
			const callOrder: string[] = [];
			recorder.resume.mockImplementation(() => {
				callOrder.push("resume");
			});
			recorder.requestData.mockImplementation(() => {
				callOrder.push("requestData");
				throw new Error("flush failed");
			});
			recorder.stop.mockImplementation(() => {
				callOrder.push("stop");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(callOrder).toEqual(["resume", "requestData", "stop"]);
		});

		it("still stops when resume throws from paused state", () => {
			recorder.pause();
			recorder.resume.mockImplementation(() => {
				throw new Error("resume failed");
			});

			const result = stopRecording(recorder, false);

			expect(result.stopped).toBe(true);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("does nothing when already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");

			const result = stopRecording(inactiveRecorder, false);

			expect(result.stopped).toBe(false);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});

		it("delegates to native path for native recordings", () => {
			const result = stopRecording(recorder, true);

			expect(result.stopped).toBe(true);
			expect(result.wasNative).toBe(true);
			expect(recorder.stop).not.toHaveBeenCalled();
		});

		it("stops webcam when stopping browser recording", () => {
			const webcam = createMockMediaRecorder("recording");

			stopRecording(recorder, false, webcam);

			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});

		it("stops webcam when stopping native recording", () => {
			const webcam = createMockMediaRecorder("recording");

			stopRecording(recorder, true, webcam);

			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});
	});

	describe("pauseRecording", () => {
		it("pauses an active recording", () => {
			const result = pauseRecording(recorder, true, false, false);

			expect(result).toBe(true);
			expect(recorder.pause).toHaveBeenCalled();
			expect(recorder.state).toBe("paused");
		});

		it("does nothing when already paused", () => {
			recorder.pause();
			recorder.pause.mockClear();

			const result = pauseRecording(recorder, true, true, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = pauseRecording(recorder, false, false, false);

			expect(result).toBe(false);
			expect(recorder.pause).not.toHaveBeenCalled();
		});

		it("allows pause for native recordings", () => {
			const result = pauseRecording(recorder, true, false, true);

			expect(result).toBe(true);
		});

		it("pauses webcam alongside browser recording", () => {
			const webcam = createMockMediaRecorder("recording");

			pauseRecording(recorder, true, false, false, webcam);

			expect(recorder.state).toBe("paused");
			expect(webcam.state).toBe("paused");
		});

		it("pauses webcam during native recording pause", () => {
			const webcam = createMockMediaRecorder("recording");

			const result = pauseRecording(recorder, true, false, true, webcam);

			expect(result).toBe(true);
			expect(webcam.state).toBe("paused");
		});

		it("pauses browser mic fallback during native recording pause", () => {
			const micFallback = createMockMediaRecorder("recording");

			const result = pauseRecording(recorder, true, false, true, null, micFallback);

			expect(result).toBe(true);
			expect(micFallback.requestData).toHaveBeenCalled();
			expect(micFallback.state).toBe("paused");
		});

		it("skips webcam pause when webcam is not recording", () => {
			const webcam = createMockMediaRecorder("inactive");

			pauseRecording(recorder, true, false, false, webcam);

			expect(webcam.pause).not.toHaveBeenCalled();
		});
	});

	describe("resumeRecording", () => {
		it("resumes a paused recording", () => {
			recorder.pause();

			const result = resumeRecording(recorder, true, true, false);

			expect(result).toBe(true);
			expect(recorder.resume).toHaveBeenCalled();
			expect(recorder.state).toBe("recording");
		});

		it("does nothing when not paused", () => {
			const result = resumeRecording(recorder, true, false, false);

			expect(result).toBe(false);
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("does nothing when not recording", () => {
			const result = resumeRecording(recorder, false, true, false);

			expect(result).toBe(false);
		});

		it("resumes webcam alongside browser recording", () => {
			const webcam = createMockMediaRecorder("recording");
			recorder.pause();
			webcam.pause();

			resumeRecording(recorder, true, true, false, webcam);

			expect(recorder.state).toBe("recording");
			expect(webcam.state).toBe("recording");
		});

		it("resumes webcam during native recording resume", () => {
			const webcam = createMockMediaRecorder("recording");
			webcam.pause();

			const result = resumeRecording(recorder, true, true, true, webcam);

			expect(result).toBe(true);
			expect(webcam.state).toBe("recording");
		});

		it("resumes browser mic fallback during native recording resume", () => {
			const micFallback = createMockMediaRecorder("recording");
			micFallback.pause();

			const result = resumeRecording(recorder, true, true, true, null, micFallback);

			expect(result).toBe(true);
			expect(micFallback.state).toBe("recording");
		});

		it("skips webcam resume when webcam is not paused", () => {
			recorder.pause();
			const webcam = createMockMediaRecorder("inactive");

			resumeRecording(recorder, true, true, false, webcam);

			expect(webcam.resume).not.toHaveBeenCalled();
		});
	});

	describe("cancelRecording", () => {
		it("clears chunks and stops browser recording", () => {
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(recorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(result.wasNative).toBe(false);
			expect(chunks.current).toEqual([]);
			expect(recorder.stop).toHaveBeenCalled();
			expect(recorder.state).toBe("inactive");
		});

		it("clears webcam chunks and stops webcam on cancel", () => {
			const chunks = { current: [new Blob(["data"])] };
			const webcamChunks = { current: [new Blob(["cam"])] };
			const webcam = createMockMediaRecorder("recording");

			cancelRecording(recorder, false, chunks, webcam, webcamChunks);

			expect(webcamChunks.current).toEqual([]);
			expect(webcam.stop).toHaveBeenCalled();
			expect(webcam.state).toBe("inactive");
		});

		it("stops webcam when cancelling native recording", () => {
			const chunks = { current: [] as Blob[] };
			const webcam = createMockMediaRecorder("recording");

			const result = cancelRecording(recorder, true, chunks, webcam);

			expect(result.wasNative).toBe(true);
			expect(webcam.stop).toHaveBeenCalled();
			expect(recorder.stop).not.toHaveBeenCalled();
		});

		it("stops the mic fallback recorder when cancelling native recording", () => {
			const chunks = { current: [] as Blob[] };
			const stopMicFallbackRecorder = vi.fn(() => Promise.resolve(null));

			const result = cancelRecording(
				recorder,
				true,
				chunks,
				null,
				undefined,
				stopMicFallbackRecorder,
			);

			expect(result.wasNative).toBe(true);
			expect(stopMicFallbackRecorder).toHaveBeenCalled();
		});

		it("handles cancel when recorder is already inactive", () => {
			const inactiveRecorder = createMockMediaRecorder("inactive");
			const chunks = { current: [new Blob(["data"])] };

			const result = cancelRecording(inactiveRecorder, false, chunks);

			expect(result.cancelled).toBe(true);
			expect(chunks.current).toEqual([]);
			expect(inactiveRecorder.stop).not.toHaveBeenCalled();
		});

		it("handles cancel when webcam is already inactive", () => {
			const chunks = { current: [] as Blob[] };
			const webcam = createMockMediaRecorder("inactive");

			cancelRecording(recorder, false, chunks, webcam);

			expect(webcam.stop).not.toHaveBeenCalled();
		});
	});

	describe("pause → stop → editor flow", () => {
		it("record → pause → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});

		it("record → pause → resume → stop completes cleanly", () => {
			expect(recorder.state).toBe("recording");

			pauseRecording(recorder, true, false, false);
			expect(recorder.state).toBe("paused");

			resumeRecording(recorder, true, true, false);
			expect(recorder.state).toBe("recording");

			const result = stopRecording(recorder, false);
			expect(result.stopped).toBe(true);
			expect(recorder.state).toBe("inactive");
		});

		it("webcam stays in sync through full pause/resume/stop cycle", () => {
			const webcam = createMockMediaRecorder("recording");

			pauseRecording(recorder, true, false, false, webcam);
			expect(recorder.state).toBe("paused");
			expect(webcam.state).toBe("paused");

			resumeRecording(recorder, true, true, false, webcam);
			expect(recorder.state).toBe("recording");
			expect(webcam.state).toBe("recording");

			stopRecording(recorder, false, webcam);
			expect(recorder.state).toBe("inactive");
			expect(webcam.state).toBe("inactive");
		});

		it("native recording pauses webcam only after native pause succeeds", async () => {
			const webcam = createMockMediaRecorder("recording");
			const micFallback = createMockMediaRecorder("recording");

			const pausedResult = await pauseNativeRecording(webcam, { success: true }, micFallback);
			expect(pausedResult).toBe(true);
			expect(webcam.state).toBe("paused");
			expect(micFallback.requestData).toHaveBeenCalled();
			expect(micFallback.state).toBe("paused");
			expect(recorder.pause).not.toHaveBeenCalled();

			const resumedResult = await resumeNativeRecording(
				webcam,
				{ success: true },
				micFallback,
			);
			expect(resumedResult).toBe(true);
			expect(webcam.state).toBe("recording");
			expect(micFallback.state).toBe("recording");
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("native recording leaves webcam state alone when native pause fails", async () => {
			const webcam = createMockMediaRecorder("recording");
			const micFallback = createMockMediaRecorder("recording");

			const pausedResult = await pauseNativeRecording(
				webcam,
				{ success: false },
				micFallback,
			);

			expect(pausedResult).toBe(false);
			expect(webcam.state).toBe("recording");
			expect(webcam.pause).not.toHaveBeenCalled();
			expect(micFallback.state).toBe("recording");
			expect(micFallback.pause).not.toHaveBeenCalled();
		});

		it("stops native capture before awaiting webcam finalization", async () => {
			const callOrder: string[] = [];
			let resolveWebcam: (path: string | null) => void = () => {};
			const webcamPathPromise = new Promise<string | null>((resolve) => {
				resolveWebcam = resolve;
			});
			const stopWebcamRecorder = vi.fn(() => {
				callOrder.push("stop-webcam-started");
				return webcamPathPromise;
			});
			const stopNativeScreenRecording = vi.fn(async () => {
				callOrder.push("stop-native");
				return { success: true, path: "screen.mp4" };
			});
			const markRecordingResumed = vi.fn((timestampMs: number) => {
				callOrder.push(`mark-resumed-${timestampMs}`);
			});
			const getRecordingDurationMs = vi.fn((timestampMs: number) => {
				callOrder.push(`duration-${timestampMs}`);
				return 35000;
			});

			let finalized = false;
			const stopped = stopNativeRecordingWithCompanions({
				getRecordingDurationMs,
				markRecordingResumed,
				now: () => 123456,
				stopMicFallbackRecorder: vi.fn(async () => null),
				stopNativeScreenRecording,
				stopWebcamRecorder,
			}).then((result) => {
				finalized = true;
				return result;
			});

			await Promise.resolve();
			expect(callOrder).toEqual([
				"mark-resumed-123456",
				"duration-123456",
				"stop-webcam-started",
				"stop-native",
			]);
			expect(finalized).toBe(false);

			resolveWebcam("webcam.webm");
			await expect(stopped).resolves.toMatchObject({
				expectedDurationMs: 35000,
				webcamPath: "webcam.webm",
			});
		});

		it("cancel discards both screen and webcam recordings", () => {
			const webcam = createMockMediaRecorder("recording");
			const chunks = { current: [new Blob(["screen"])] };
			const webcamChunks = { current: [new Blob(["cam"])] };

			cancelRecording(recorder, false, chunks, webcam, webcamChunks);

			expect(chunks.current).toEqual([]);
			expect(webcamChunks.current).toEqual([]);
			expect(recorder.state).toBe("inactive");
			expect(webcam.state).toBe("inactive");
		});
	});
});

describe("handleRemoteRecordingCommand", () => {
	const idle: RemoteRecorderState = {
		recording: false,
		paused: false,
		starting: false,
		countdownActive: false,
		finalizing: false,
		startInFlight: false,
	};
	const recording: RemoteRecorderState = { ...idle, recording: true };

	function run(
		action: RemoteRecordingAction,
		state: RemoteRecorderState,
		overrides: {
			pause?: Promise<RemoteActionOutcome>;
			resume?: Promise<RemoteActionOutcome>;
		} = {},
		extra: Partial<RemoteRecordingCommand> = {},
	) {
		const actions = {
			reply: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			pause: vi.fn(() => overrides.pause ?? Promise.resolve({ ok: true })),
			resume: vi.fn(() => overrides.resume ?? Promise.resolve({ ok: true })),
			cancel: vi.fn(),
		};
		handleRemoteRecordingCommand(
			{ id: "cmd", action, expiresAt: 2000, ...extra },
			state,
			actions,
			1000,
		);
		return actions;
	}

	it("starts with the command id and countdown override when idle", () => {
		const actions = run("start", idle, {}, { countdownSeconds: 0 });
		expect(actions.start).toHaveBeenCalledWith({ remoteCommandId: "cmd", countdownSeconds: 0 });
		expect(actions.reply).not.toHaveBeenCalled();
	});

	it("passes the hide-cursor request through to the start path", () => {
		const hidden = run("start", idle, {}, { hideCursor: true } as never);
		expect(hidden.start).toHaveBeenCalledWith(expect.objectContaining({ hideCursor: true }));
		const plain = run("start", idle);
		expect(plain.start.mock.calls[0][0].hideCursor).toBeUndefined();
	});

	it("hides the composited cursor when either the policy or the agent asks", () => {
		expect(resolveHideOverlayCursor(false, false)).toBe(false);
		expect(resolveHideOverlayCursor(false, true)).toBe(true);
		expect(resolveHideOverlayCursor(true, false)).toBe(true);
	});

	it.each([
		"recording",
		"starting",
		"countdownActive",
		"finalizing",
		"startInFlight",
	] as const)("refuses start while %s", (flag) => {
		const actions = run("start", { ...idle, [flag]: true });
		expect(actions.start).not.toHaveBeenCalled();
		expect(actions.reply).toHaveBeenCalledWith({
			id: "cmd",
			ok: false,
			error: "Recordly is already recording or starting.",
		});
	});

	it("refuses an expired command without acting on it", () => {
		const actions = run("stop", recording, {}, { expiresAt: 999 });
		expect(actions.stop).not.toHaveBeenCalled();
		expect(actions.reply).toHaveBeenCalledWith({
			id: "cmd",
			ok: false,
			error: "The command expired before Recordly could handle it.",
		});
	});

	it("stops only while recording, leaving the ack to the save outcome", () => {
		const idleStop = run("stop", idle);
		expect(idleStop.stop).not.toHaveBeenCalled();
		expect(idleStop.reply).toHaveBeenCalledWith({
			id: "cmd",
			ok: false,
			error: "Recordly is not recording.",
		});
		const stop = run("stop", recording);
		expect(stop.stop).toHaveBeenCalledWith("cmd");
		expect(stop.reply).not.toHaveBeenCalled();
	});

	it("acks pause only after it settles", async () => {
		let finish!: (outcome: RemoteActionOutcome) => void;
		const actions = run("pause", recording, {
			pause: new Promise((resolve) => {
				finish = resolve;
			}),
		});
		await Promise.resolve();
		expect(actions.reply).not.toHaveBeenCalled();
		finish({ ok: true });
		await vi.waitFor(() =>
			expect(actions.reply).toHaveBeenCalledWith({ id: "cmd", ok: true, error: undefined }),
		);
	});

	it("carries the native pause and resume failure reasons", async () => {
		const pause = run("pause", recording, {
			pause: Promise.resolve({ ok: false, error: "helper not running" }),
		});
		const resume = run(
			"resume",
			{ ...recording, paused: true },
			{
				resume: Promise.reject(new Error("IPC closed")),
			},
		);
		await vi.waitFor(() => {
			expect(pause.reply).toHaveBeenCalledWith({
				id: "cmd",
				ok: false,
				error: "Recordly could not pause the recording. helper not running",
			});
			expect(resume.reply).toHaveBeenCalledWith({
				id: "cmd",
				ok: false,
				error: "Recordly could not resume the recording. IPC closed",
			});
		});
	});

	it("refuses pause and resume in the wrong state", () => {
		expect(run("pause", { ...recording, paused: true }).pause).not.toHaveBeenCalled();
		expect(run("resume", recording).resume).not.toHaveBeenCalled();
		expect(run("pause", idle).reply).toHaveBeenCalledWith(
			expect.objectContaining({ ok: false }),
		);
	});

	it("cancels only while recording", () => {
		const cancel = run("cancel", recording);
		expect(cancel.cancel).toHaveBeenCalledOnce();
		expect(cancel.reply).toHaveBeenCalledWith({ id: "cmd", ok: true, error: undefined });
		const idleCancel = run("cancel", idle);
		expect(idleCancel.cancel).not.toHaveBeenCalled();
		expect(idleCancel.reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
	});
});

describe("remote stop failure acks", () => {
	it("acks a failed stop once, e.g. when no video data was captured", () => {
		const send = vi.fn();
		const tracker = createRemoteStopTracker(send);
		tracker.fail("ignored: no remote stop pending");
		tracker.begin("stop-1");
		tracker.fail("The recording captured no video data, so nothing was saved.");
		tracker.fail("a second failure is not sent");
		expect(send).toHaveBeenCalledOnce();
		expect(send).toHaveBeenCalledWith({
			id: "stop-1",
			ok: false,
			error: "The recording captured no video data, so nothing was saved.",
		});
	});

	it("sends nothing after the save succeeded", () => {
		const send = vi.fn();
		const tracker = createRemoteStopTracker(send);
		tracker.begin("stop-1");
		tracker.settle();
		tracker.fail("late UI failure");
		expect(send).not.toHaveBeenCalled();
	});

	const session = {
		videoPath: "/rec/a.mp4",
		webcamPath: null,
		timeOffsetMs: 0,
		hideOverlayCursorByDefault: false,
	};

	it("reports a finalize failure when the session and the fallback path both fail", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const api = {
			setCurrentRecordingSession: vi.fn(async () => {
				throw new Error("manifest write failed");
			}),
			setCurrentVideoPath: vi.fn(async () => {
				throw new Error("disk full");
			}),
		};
		await expect(
			persistFinalizedRecording(api, { ...session, webcamPath: "/rec/a-webcam.webm" }),
		).resolves.toBe("Failed to save the recording. disk full");
		expect(api.setCurrentVideoPath).toHaveBeenCalledWith("/rec/a.mp4", {
			hideOverlayCursorByDefault: false,
		});
	});

	it("succeeds through the fallback path", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const api = {
			setCurrentRecordingSession: vi.fn(async () => {
				throw new Error("manifest write failed");
			}),
			setCurrentVideoPath: vi.fn(async () => ({ success: true, webcamPath: null })),
		};
		await expect(
			persistFinalizedRecording(api, { ...session, webcamPath: "/rec/a-webcam.webm" }),
		).resolves.toBeNull();
		await expect(persistFinalizedRecording(api, session)).resolves.toBeNull();
		expect(api.setCurrentVideoPath).toHaveBeenCalledTimes(2);
	});
});

describe("resolveStartPreflight", () => {
	it("explains a missing source", () => {
		expect(resolveStartPreflight({ inFlight: false, hasSource: false })).toBe(
			START_BLOCK_MESSAGES.noSource,
		);
	});

	it("explains a start that is already in flight before anything else", () => {
		expect(resolveStartPreflight({ inFlight: true, hasSource: false })).toBe(
			START_BLOCK_MESSAGES.alreadyStarting,
		);
	});

	it("passes when ready", () => {
		expect(resolveStartPreflight({ inFlight: false, hasSource: true })).toBeNull();
	});
});

describe("resolveCountdownBlock", () => {
	it("gives a reason for a cancelled countdown, even when it also reports failure", () => {
		expect(resolveCountdownBlock({ success: true, cancelled: true })).toBe(
			START_BLOCK_MESSAGES.countdownCancelled,
		);
		expect(resolveCountdownBlock({ success: false, cancelled: true })).toBe(
			START_BLOCK_MESSAGES.countdownCancelled,
		);
	});

	it("gives a reason for a countdown that failed to run", () => {
		expect(resolveCountdownBlock({ success: false })).toBe(
			START_BLOCK_MESSAGES.countdownFailed,
		);
	});

	it("lets a finished countdown through", () => {
		expect(resolveCountdownBlock({ success: true })).toBeNull();
		expect(resolveCountdownBlock({ success: true, cancelled: false })).toBeNull();
	});
});
