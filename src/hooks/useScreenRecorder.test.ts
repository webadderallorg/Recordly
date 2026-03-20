import { beforeEach, describe, expect, it, vi } from "vitest";

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
		stop: vi.fn(() => {
			_state = "inactive";
		}),
		start: vi.fn(() => {
			_state = "recording";
		}),
	};
}

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
			recorder.resume();
		}
		if (webcamRecorder && webcamRecorder.state !== "inactive") {
			webcamRecorder.stop();
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
): boolean {
	if (!recording || paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "recording") {
			webcamRecorder.pause();
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
): boolean {
	if (!recording || !paused) return false;
	if (isNativeRecording) {
		if (webcamRecorder?.state === "paused") {
			webcamRecorder.resume();
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
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "recording") {
		webcamRecorder.pause();
	}

	return true;
}

async function resumeNativeRecording(
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	result: { success: boolean } = { success: true },
): Promise<boolean> {
	if (!result.success) {
		return false;
	}

	if (webcamRecorder?.state === "paused") {
		webcamRecorder.resume();
	}

	return true;
}

function cancelRecording(
	recorder: ReturnType<typeof createMockMediaRecorder>,
	isNativeRecording: boolean,
	chunks: { current: Blob[] },
	webcamRecorder?: ReturnType<typeof createMockMediaRecorder> | null,
	webcamChunks?: { current: Blob[] },
) {
	if (webcamChunks) webcamChunks.current = [];
	if (webcamRecorder && webcamRecorder.state !== "inactive") {
		webcamRecorder.stop();
	}

	if (isNativeRecording) {
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

			const pausedResult = await pauseNativeRecording(webcam);
			expect(pausedResult).toBe(true);
			expect(webcam.state).toBe("paused");
			expect(recorder.pause).not.toHaveBeenCalled();

			const resumedResult = await resumeNativeRecording(webcam);
			expect(resumedResult).toBe(true);
			expect(webcam.state).toBe("recording");
			expect(recorder.resume).not.toHaveBeenCalled();
		});

		it("native recording leaves webcam state alone when native pause fails", async () => {
			const webcam = createMockMediaRecorder("recording");

			const pausedResult = await pauseNativeRecording(webcam, { success: false });

			expect(pausedResult).toBe(false);
			expect(webcam.state).toBe("recording");
			expect(webcam.pause).not.toHaveBeenCalled();
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
