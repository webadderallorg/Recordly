import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui/toast";
import { useRecorderControls } from "./useRecorderControls";
import { useRecorderMediaCleanup } from "./useRecorderMediaCleanup";
import { useRecorderSubscriptions } from "./useRecorderSubscriptions";
import { useRecorderWebcam } from "./useRecorderWebcam";
import { acquireWebcamCapture } from "./webcamCapture";

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
const setWebcamFailure = vi.hoisted(() => vi.fn());
vi.mock("react", () => ({
	useCallback: <T>(callback: T) => callback,
	useEffect: (effect: () => void | (() => void)) => effects.push(effect),
	useRef: <T>(current: T) => ({ current }),
	useState: <T>(initial: T) => [initial, setWebcamFailure],
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
			isMacOS: false,
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
		vi.spyOn(console, "info").mockImplementation(() => {});
	});

	afterEach(() => {
		effects.length = 0;
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("does not open the camera on macOS when its permission has not been granted", async () => {
		window.electronAPI.getMediaPermissionStatus = vi.fn().mockResolvedValue({
			success: true,
			camera: "not-determined",
		});
		const webcam = createWebcam({ isMacOS: true });
		await webcam.prepareWebcamRecorder();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(FakeMediaRecorder.instances).toHaveLength(0);
	});

	it("forgets a stored failure once the webcam is turned off, so turning it back on retries", () => {
		createWebcam();
		for (const effect of effects) effect();
		expect(setWebcamFailure).not.toHaveBeenCalled();

		effects.length = 0;
		createWebcam({ webcamEnabled: false });
		for (const effect of effects) effect();
		expect(setWebcamFailure).toHaveBeenCalledExactlyOnceWith(null);
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

	it("releases a late camera after cancellation without starting a recorder", async () => {
		let resolveCamera!: (stream: MediaStream) => void;
		getUserMedia.mockReturnValueOnce(
			new Promise<MediaStream>((resolve) => {
				resolveCamera = resolve;
			}),
		);
		const webcam = createWebcam();
		const preparation = webcam.prepareWebcamRecorder();
		webcam.releaseWebcamCapture();
		resolveCamera(stream);
		await preparation;
		expect(track.stop).toHaveBeenCalledOnce();
		expect(webcam.webcamRecorder.current).toBeNull();
	});

	it.each([
		false,
		true,
	])("records with the open or opening preview (opening: %s) without reopening the camera", async (opening) => {
		let resolveCamera!: (stream: MediaStream) => void;
		const camera = new Promise<MediaStream>((resolve) => {
			resolveCamera = resolve;
		});
		getUserMedia
			.mockReturnValueOnce(camera)
			.mockRejectedValue(new DOMException("Camera already open", "NotReadableError"));
		const previewPending = acquireWebcamCapture("camera-1");
		const webcam = createWebcam({ webcamDeviceId: "camera-1" });
		if (!opening) {
			resolveCamera(stream);
			await previewPending;
		}
		const preparation = webcam.prepareWebcamRecorder();
		if (opening) resolveCamera(stream);
		const preview = await previewPending;
		try {
			await preparation;
			webcam.beginWebcamCapture();
			expect(recorder().stream).toBe(preview.stream);
			expect(recorder().state).toBe("recording");
			expect(getUserMedia).toHaveBeenCalledOnce();
			await expect(webcam.stopWebcamRecorder()).resolves.toBe("/recording-1000-webcam.webm");
			expect(track.stop).not.toHaveBeenCalled();
		} finally {
			webcam.releaseWebcamCapture();
			preview.release();
		}
		expect(track.stop).toHaveBeenCalledOnce();
	});

	it.each([
		false,
		true,
	])("prepares the default camera and waits for main capture (macOS: %s)", async (isMacOS) => {
		if (isMacOS) {
			window.electronAPI.getMediaPermissionStatus = vi.fn().mockResolvedValue({
				success: true,
				camera: "granted",
			});
		}
		const webcam = createWebcam({ isMacOS });
		await webcam.prepareWebcamRecorder();
		expect(getUserMedia).toHaveBeenCalledWith({
			video: {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 60, max: 60 },
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

	it("keeps cameras that negotiate a lower frame rate usable and reports the actual rate", async () => {
		const settings = { frameRate: 30, width: 1280, height: 720 };
		stream.getVideoTracks = () => [{ getSettings: () => settings }] as MediaStreamTrack[];
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		expect(FakeMediaRecorder.instances).toHaveLength(1);
		expect(console.info).toHaveBeenCalledWith("[Recorder] Webcam capture settings", {
			requestedFrameRate: 60,
			...settings,
		});
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
		expect(track.stop).toHaveBeenCalledOnce();
	});

	it("continues without a sidecar when the prepared webcam fails to start", async () => {
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		const pending = webcam.pendingWebcamPathPromise.current;
		recorder().start.mockImplementationOnce(() => {
			throw new DOMException("Camera disconnected", "NotSupportedError");
		});

		expect(() => webcam.beginWebcamCapture()).not.toThrow();
		await expect(pending).resolves.toBeNull();
		await expect(webcam.stopWebcamRecorder()).resolves.toBeNull();
		expect(webcam.webcamStartTime.current).toBeNull();
		expect(webcam.webcamRecorder.current).toBeNull();
		expect(webcam.webcamWriter.current).toBeNull();
		expect(track.stop).toHaveBeenCalledOnce();
		expect(setWebcamFailure).toHaveBeenLastCalledWith({
			deviceId: undefined,
			message: "Camera disconnected",
		});
		expect(toast.warning).toHaveBeenCalledWith("Webcam unavailable", expect.anything());
		expect(openRecordingFileStream).not.toHaveBeenCalled();
	});

	it.each([
		"recording",
		"paused",
	] as const)("flushes a %s webcam's final chunk after the controls unmount", async (state) => {
		const webcam = createWebcam();
		effects.length = 0;
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		recorder().state = state;
		const pending = webcam.pendingWebcamPathPromise.current;
		const screenStop = vi.fn();
		const media = useRecorderMediaCleanup({
			stream: { current: null },
			screenStream: { current: null },
			microphoneStream: { current: null },
			releaseWebcamCapture: webcam.releaseWebcamCapture,
			mixingContext: { current: null },
			cleanupMicFallbackRecorder: vi.fn(),
		});
		useRecorderSubscriptions({
			...media,
			stopRecording: { current: vi.fn() },
			stopMicFallbackRecorder: vi.fn(),
			stopWebcamRecorder: webcam.stopWebcamRecorder,
			microphoneFallback: { startDelayMs: 0 },
			setRecording: vi.fn(),
			recordingStartGeneration: { current: 1 },
			nativeScreenRecording: { current: false },
			nativeWindowsRecording: { current: false },
			nativeWarmStartActive: { current: false },
			recoverNativeRecordingSession: vi.fn(),
			hasPromptedForReselect: { current: false },
			nativeStopRequestInFlight: { current: false },
			discardActiveNativeCapture: vi.fn(),
			pendingNativeCleanupPath: { current: null },
			mediaRecorder: { current: { state, stop: screenStop } as unknown as MediaRecorder },
		} as Parameters<typeof useRecorderSubscriptions>[0]);
		const dispose = effects.shift()?.();
		dispose?.();

		expect(screenStop).toHaveBeenCalledOnce();
		expect(recorder().stop).toHaveBeenCalledOnce();
		expect(track.stop).toHaveBeenCalledOnce();
		await expect(pending).resolves.toBe("/recording-1000-webcam.webm");
		const data = appendRecordingFileStream.mock.calls[0][1] as ArrayBuffer;
		expect(new TextDecoder().decode(data)).toBe("tail");
		expect(closeRecordingFileStream).toHaveBeenCalledOnce();
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
	it("settles a canceled take's webcam promise before another capture starts", async () => {
		const webcam = createWebcam();
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		const cancelledTake = webcam.webcamStopPromise.current;
		Object.assign(window.electronAPI, {
			setRecordingState: vi.fn().mockResolvedValue({ success: true }),
		});
		const controls = useRecorderControls({
			...webcam,
			screenWriter: { current: null },
			recordingActive: { current: true },
			recordingStartGeneration: { current: 1 },
			nativeScreenRecording: { current: false },
			mediaRecorder: { current: null },
			cleanupCapturedMedia: vi.fn(),
			setPaused: vi.fn(),
			markRecordingResumed: vi.fn(),
			setRecording: vi.fn(),
		} as unknown as Parameters<typeof useRecorderControls>[0]);
		await expect(controls.cancelRecording()).resolves.toBe(true);
		await expect(cancelledTake).resolves.toBeNull();
		expect(webcam.webcamStopPromise.current).toBeNull();
		await webcam.prepareWebcamRecorder();
		webcam.beginWebcamCapture();
		await expect(webcam.stopWebcamRecorder()).resolves.toBe("/recording-1000-webcam.webm");
	});
});
