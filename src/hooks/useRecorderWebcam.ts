import { type MutableRefObject, useCallback, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { getErrorMessage } from "./recordingError";
import { RecordingFileWriter } from "./recordingFileWriter";
import { getVideoExtensionForMimeType, selectWebcamRecordingMimeType } from "./recordingMimeType";

const WEBCAM_BITRATE = 8_000_000;
const WEBCAM_WIDTH = 1280;
const WEBCAM_HEIGHT = 720;
const WEBCAM_FRAME_RATE = 30;
const RECORDER_TIMESLICE_MS = 250;
const RECORDING_FILE_PREFIX = "recording-";
const WEBCAM_SUFFIX = "-webcam";

type RecorderWebcamOptions = {
	webcamEnabled: boolean;
	webcamDeviceId: string | undefined;
	recordingSessionTimestamp: MutableRefObject<number | null>;
	getRecordingDurationMs: (stoppedAt: number) => number;
};

/** Owns the webcam sidecar lifecycle while the main recorder controls capture timing. */
export function useRecorderWebcam({
	webcamEnabled,
	webcamDeviceId,
	recordingSessionTimestamp,
	getRecordingDurationMs,
}: RecorderWebcamOptions) {
	const webcamRecorder = useRef<MediaRecorder | null>(null);
	const webcamStream = useRef<MediaStream | null>(null);
	const webcamWriter = useRef<RecordingFileWriter | null>(null);
	const webcamStartTime = useRef<number | null>(null);
	const webcamTimeOffsetMs = useRef(0);
	const pendingWebcamPathPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopResolver = useRef<((path: string | null) => void) | null>(null);
	const resolvedWebcamPath = useRef<string | null>(null);

	const stopWebcamRecorder = useCallback(async () => {
		const recorder = webcamRecorder.current;
		const pending = webcamStopPromise.current;

		if (!recorder) {
			const result = pending ? await pending : resolvedWebcamPath.current;
			if (webcamStopPromise.current === pending) {
				webcamStopPromise.current = null;
				pendingWebcamPathPromise.current = null;
				resolvedWebcamPath.current = result ?? null;
			}
			return result ?? null;
		}

		if (recorder.state !== "inactive") {
			recorder.stop();
		} else if (webcamStartTime.current === null && pending && webcamStopResolver.current) {
			webcamStopResolver.current(resolvedWebcamPath.current);
			webcamStopResolver.current = null;
		}

		const result = pending ? await pending : resolvedWebcamPath.current;
		if (webcamStopPromise.current === pending) {
			webcamStopPromise.current = null;
			pendingWebcamPathPromise.current = null;
			resolvedWebcamPath.current = result ?? null;
		}
		if (webcamRecorder.current === recorder) webcamRecorder.current = null;
		return result ?? null;
	}, []);

	/** Acquire and prepare the webcam; begin capture only after the main recording starts. */
	const prepareWebcamRecorder = useCallback(async () => {
		if (!webcamEnabled) {
			toast.dismiss("recording-webcam-unavailable");
			resolvedWebcamPath.current = null;
			pendingWebcamPathPromise.current = Promise.resolve(null);
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			return;
		}

		try {
			webcamStream.current = await navigator.mediaDevices.getUserMedia({
				video: webcamDeviceId
					? {
							deviceId: { exact: webcamDeviceId },
							width: { ideal: WEBCAM_WIDTH },
							height: { ideal: WEBCAM_HEIGHT },
							frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
						}
					: {
							width: { ideal: WEBCAM_WIDTH },
							height: { ideal: WEBCAM_HEIGHT },
							frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
						},
				audio: false,
			});

			const mimeType = selectWebcamRecordingMimeType();
			if (!mimeType) throw new Error("This browser cannot safely record the webcam as WebM.");

			resolvedWebcamPath.current = null;
			webcamStopPromise.current = new Promise((resolve) => {
				webcamStopResolver.current = resolve;
			});
			pendingWebcamPathPromise.current = webcamStopPromise.current;

			const recorder = new MediaRecorder(webcamStream.current, {
				videoBitsPerSecond: WEBCAM_BITRATE,
				...(mimeType ? { mimeType } : {}),
			});

			const webcamMimeType = recorder.mimeType || mimeType;
			const sessionTimestamp = recordingSessionTimestamp.current ?? Date.now();
			const writer = new RecordingFileWriter(
				window.electronAPI,
				`${RECORDING_FILE_PREFIX}${sessionTimestamp}${WEBCAM_SUFFIX}${getVideoExtensionForMimeType(webcamMimeType)}`,
				webcamMimeType || "video/webm",
				(message) => {
					toast.error(`Webcam recording stopped: ${message}`);
					if (recorder.state !== "inactive") recorder.stop();
				},
			);
			webcamWriter.current = writer;
			const resolveWebcam = webcamStopResolver.current;
			webcamRecorder.current = recorder;
			recorder.ondataavailable = (event) => writer.write(event.data);
			recorder.onerror = () =>
				toast.error("The webcam recorder failed. The partial recording will be preserved.");
			recorder.onstop = async () => {
				try {
					const result = await writer.finish(
						Math.max(
							0,
							getRecordingDurationMs(Date.now()) - webcamTimeOffsetMs.current,
						),
					);
					if (!result.success && !writer.isCancelled)
						toast.error(
							result.message || result.error || "Failed to save webcam recording.",
						);
					resolveWebcam?.(result.success ? (result.path ?? null) : null);
				} catch (error) {
					if (!writer.isCancelled)
						toast.error(`Failed to save webcam recording: ${getErrorMessage(error)}`);
					resolveWebcam?.(null);
				} finally {
					if (webcamRecorder.current === recorder) {
						webcamStopResolver.current = null;
						webcamRecorder.current = null;
						webcamWriter.current = null;
						webcamStartTime.current = null;
						webcamStream.current?.getTracks().forEach((track) => track.stop());
						webcamStream.current = null;
					}
				}
			};
			toast.dismiss("recording-webcam-unavailable");
		} catch (error) {
			console.warn(
				"Failed to start webcam recording; continuing without webcam layer:",
				error,
			);
			resolvedWebcamPath.current = null;
			pendingWebcamPathPromise.current = Promise.resolve(null);
			webcamStopPromise.current = Promise.resolve(null);
			webcamRecorder.current = null;
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			if (webcamStream.current) {
				webcamStream.current.getTracks().forEach((track) => track.stop());
				webcamStream.current = null;
			}
			toast.warning(translate("notifications.webcamUnavailable", "Webcam unavailable"), {
				id: "recording-webcam-unavailable",
				duration: Infinity,
				description: translate(
					"notifications.webcamUnavailableDescription",
					"Your webcam could not start. Check your camera selection and permissions before the next take.",
				),
			});
		}
	}, [getRecordingDurationMs, recordingSessionTimestamp, webcamDeviceId, webcamEnabled]);

	/** Start the prepared webcam MediaRecorder after the main recording begins. */
	const beginWebcamCapture = useCallback(() => {
		const recorder = webcamRecorder.current;
		if (recorder && recorder.state === "inactive") {
			webcamStartTime.current = Date.now();
			recorder.start(RECORDER_TIMESLICE_MS);
		}
	}, []);

	return {
		webcamRecorder,
		webcamStream,
		webcamWriter,
		webcamStartTime,
		webcamTimeOffsetMs,
		pendingWebcamPathPromise,
		webcamStopPromise,
		webcamStopResolver,
		resolvedWebcamPath,
		stopWebcamRecorder,
		prepareWebcamRecorder,
		beginWebcamCapture,
	};
}
