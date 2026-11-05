import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useRecorderWebcam } from "./useRecorderWebcam";

vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useRef: <T>(current: T) => ({ current }),
}));
vi.mock("@/components/ui/toast", () => ({
	toast: { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

class FakeMediaRecorder {
	static instances: FakeMediaRecorder[] = [];
	static supported = true;
	static constructorError: Error | null = null;
	static isTypeSupported = () => FakeMediaRecorder.supported;
	state: RecordingState = "inactive";
	mimeType: string;
	ondataavailable: ((event: BlobEvent) => void) | null = null;
	onstop: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(
		public stream: MediaStream,
		public options: MediaRecorderOptions,
	) {
		if (FakeMediaRecorder.constructorError) throw FakeMediaRecorder.constructorError;
		this.mimeType = options.mimeType ?? "video/webm";
		FakeMediaRecorder.instances.push(this);
	}

	emitChunk(content: string) {
		this.ondataavailable?.({ data: new Blob([content]) } as BlobEvent);
	}

	start = vi.fn(() => {
		this.state = "recording";
	});
	stop = vi.fn(() => {
		this.state = "inactive";
		queueMicrotask(() => {
			this.emitChunk("tail");
			this.onstop?.();
		});
	});
}

describe("recorder webcam sidecar", () => {
	let track: { stop: ReturnType<typeof vi.fn> };
	let stream: MediaStream;
	let getUserMedia: ReturnType<typeof vi.fn>;
	let openRecordingFileStream: ReturnType<typeof vi.fn>;
	let appendRecordingFileStream: ReturnType<typeof vi.fn>;
	let closeRecordingFileStream: ReturnType<typeof vi.fn>;
	let discardRecordingFileStream: ReturnType<typeof vi.fn>;
	let getRecordingDurationMs: ReturnType<typeof vi.fn>;
	const recorder = () => FakeMediaRecorder.instances[FakeMediaRecorder.instances.length - 1];
	const createWebcam = (overrides: Partial<Parameters<typeof useRecorderWebcam>[0]> = {}) =>
		useRecorderWebcam({
			webcamEnabled: true,
			webcamDeviceId: undefined,
			recordingSessionTimestamp: { current: 1_000 },
			getRecordingDurationMs,
			...overrides,
		});

	beforeEach(() => {
		vi.clearAllMocks();
		FakeMediaRecorder.instances = [];
		FakeMediaRecorder.supported = true;
		FakeMediaRecorder.constructorError = null;
		track = { stop: vi.fn() };
		stream = { getTracks: () => [track] } as unknown as MediaStream;
		getUserMedia = vi.fn().mockResolvedValue(stream);
		openRecordingFileStream = vi.fn().mockResolvedValue({
			success: true,
			streamId: "webcam-stream",
			path: "/recording-1000-webcam.webm",
		});
		appendRecordingFileStream = vi.fn().mockResolvedValue({ success: true });
		closeRecordingFileStream = vi.fn().mockResolvedValue({
			success: true,
			path: "/recording-1000-webcam.webm",
		});
		discardRecordingFileStream = vi.fn().mockResolvedValue({ success: true });
		getRecordingDurationMs = vi.fn().mockReturnValue(1_600);
		vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
		vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
		vi.stubGlobal("window", {
			electronAPI: {
				openRecordingFileStream,
				appendRecordingFileStream,
				closeRecordingFileStream,
				discardRecordingFileStream,
			},
		});
		vi.spyOn(Date, "now").mockReturnValue(2_000);
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("does not acquire or start a disabled webcam", async () => {
		const webcam = createWebcam({ webcamEnabled: false });
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		await expect(webcam.pendingWebcamPathPromise.current).resolves.toBeNull();
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(FakeMediaRecorder.instances).toHaveLength(0);
		expect(toast.warning).not.toHaveBeenCalled();
	});

	it("prepares the default camera and waits for the main capture before starting", async () => {
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		expect(getUserMedia).toHaveBeenCalledWith({
			video: {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 30, max: 30 },
			},
			audio: false,
		});
		expect(recorder().options).toEqual({
			videoBitsPerSecond: 8_000_000,
			mimeType: "video/webm;codecs=h264",
		});
		expect(recorder().start).not.toHaveBeenCalled();
		expect(webcam.webcamStartTime.current).toBeNull();
		webcam.beginWebcamCapture();
		webcam.beginWebcamCapture();
		expect(recorder().start).toHaveBeenCalledExactlyOnceWith(250);
		expect(webcam.webcamStartTime.current).toBe(2_000);
		await webcam.stopWebcamRecorder();
	});

	it("persists the final chunk with the session filename and effective webcam duration", async () => {
		const timestamp = { current: 1_000 as number | null };
		const webcam = createWebcam({
			webcamDeviceId: "camera-1",
			recordingSessionTimestamp: timestamp,
		});
		timestamp.current = 1_234;
		await webcam.prepareWebcamRecorder();
		expect(getUserMedia).toHaveBeenCalledWith(
			expect.objectContaining({
				video: expect.objectContaining({ deviceId: { exact: "camera-1" } }),
			}),
		);
		webcam.beginWebcamCapture();
		webcam.webcamTimeOffsetMs.current = 100;
		await expect(webcam.stopWebcamRecorder()).resolves.toBe("/recording-1000-webcam.webm");
		expect(openRecordingFileStream).toHaveBeenCalledWith(
			"recording-1234-webcam.webm",
			"video/webm;codecs=h264",
		);
		expect(appendRecordingFileStream).toHaveBeenCalledTimes(1);
		const data = appendRecordingFileStream.mock.calls[0][1] as ArrayBuffer;
		expect(new TextDecoder().decode(data)).toBe("tail");
		expect(getRecordingDurationMs).toHaveBeenCalledWith(2_000);
		expect(closeRecordingFileStream).toHaveBeenCalledWith("webcam-stream", 1_500);
		expect(track.stop).toHaveBeenCalledOnce();
		expect(webcam.webcamRecorder.current).toBeNull();
		expect(webcam.webcamWriter.current).toBeNull();
		expect(webcam.webcamStream.current).toBeNull();
		expect(webcam.webcamStartTime.current).toBeNull();
		expect(webcam.pendingWebcamPathPromise.current).toBeNull();
		await expect(webcam.stopWebcamRecorder()).resolves.toBe("/recording-1000-webcam.webm");
		expect(closeRecordingFileStream).toHaveBeenCalledOnce();
	});

	it("clamps a webcam duration shorter than its start offset to zero", async () => {
		const webcam = createWebcam({ recordingSessionTimestamp: { current: null } });
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		webcam.webcamTimeOffsetMs.current = 2_000;
		await webcam.stopWebcamRecorder();
		expect(openRecordingFileStream).toHaveBeenCalledWith(
			"recording-2000-webcam.webm",
			"video/webm;codecs=h264",
		);
		expect(closeRecordingFileStream).toHaveBeenCalledWith("webcam-stream", 0);
	});

	it("settles a prepared camera that was never started without requesting recorder stop", async () => {
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		const pending = webcam.pendingWebcamPathPromise.current;
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		await expect(pending).resolves.toBeNull();
		expect(recorder().stop).not.toHaveBeenCalled();
		expect(closeRecordingFileStream).not.toHaveBeenCalled();
		expect(webcam.webcamRecorder.current).toBeNull();
	});

	it.each([
		"unsupported codec",
		"recorder construction",
	])("releases the camera and continues without a sidecar after %s failure", async (failure) => {
		FakeMediaRecorder.supported = failure !== "unsupported codec";
		FakeMediaRecorder.constructorError =
			failure === "recorder construction" ? new Error("camera disconnected") : null;
		const webcam = createWebcam();
		await expect(webcam.prepareWebcamRecorder()).resolves.toBeUndefined();
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(webcam.webcamStream.current).toBeNull();
		expect(webcam.webcamRecorder.current).toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.warning).toHaveBeenCalledWith("Webcam unavailable", {
			id: "recording-webcam-unavailable",
			duration: Infinity,
			description:
				"Your webcam could not start. Check your camera selection and permissions before the next take.",
		});
	});

	it("reports denied camera access without preventing the screen recording, then clears the warning on recovery", async () => {
		getUserMedia.mockRejectedValueOnce(
			new DOMException("Camera access denied", "NotAllowedError"),
		);
		const webcam = createWebcam();
		await expect(webcam.prepareWebcamRecorder()).resolves.toBeUndefined();
		await expect(webcam.pendingWebcamPathPromise.current).resolves.toBeNull();
		expect(webcam.webcamRecorder.current).toBeNull();
		expect(toast.warning).toHaveBeenCalledOnce();
		expect(toast.dismiss).not.toHaveBeenCalled();
		expect(track.stop).not.toHaveBeenCalled();

		await webcam.prepareWebcamRecorder();
		expect(webcam.webcamRecorder.current).not.toBeNull();
		expect(toast.dismiss).toHaveBeenCalledExactlyOnceWith("recording-webcam-unavailable");
		await webcam.stopWebcamRecorder();
	});

	it("reports a save rejection and settles the sidecar while releasing the camera", async () => {
		closeRecordingFileStream.mockRejectedValueOnce(new Error("disk disconnected"));
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		expect(toast.error).toHaveBeenCalledWith(
			"Failed to save webcam recording: disk disconnected",
		);
		expect(track.stop).toHaveBeenCalledOnce();
		expect(webcam.webcamWriter.current).toBeNull();
	});

	it("automatically stops capture if storage fails while writing", async () => {
		openRecordingFileStream.mockResolvedValueOnce({ success: false, error: "disk full" });
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		recorder().emitChunk("frame");
		await expect(webcam.pendingWebcamPathPromise.current).resolves.toBeNull();
		expect(recorder().stop).toHaveBeenCalledOnce();
		expect(toast.error).toHaveBeenCalledWith("Webcam recording stopped: disk full");
		expect(track.stop).toHaveBeenCalledOnce();
	});

	it("suppresses save errors for a cancelled writer", async () => {
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		webcam.webcamWriter.current?.cancel();
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		expect(toast.error).not.toHaveBeenCalled();
		expect(track.stop).toHaveBeenCalledOnce();
	});
});
