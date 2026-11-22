import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { getErrorMessage } from "./recordingError";
import { RecordingFileWriter } from "./recordingFileWriter";
import { getVideoExtensionForMimeType, selectWebcamRecordingMimeType } from "./recordingMimeType";
import { acquireWebcamCapture, type WebcamCapture } from "./webcamCapture";

const WEBCAM_BITRATE = 8_000_000;
const RECORDER_TIMESLICE_MS = 250;
const RECORDING_FILE_PREFIX = "recording-";
const WEBCAM_SUFFIX = "-webcam";

type RecorderWebcamOptions = {
	isMacOS: boolean;
	webcamEnabled: boolean;
	webcamDeviceId: string | undefined;
	recordingSessionTimestamp: MutableRefObject<number | null>;
	getRecordingDurationMs: (stoppedAt: number) => number;
};

/** Owns the webcam sidecar lifecycle while the main recorder controls capture timing. */
export function useRecorderWebcam({
	isMacOS,
	webcamEnabled,
	webcamDeviceId,
	recordingSessionTimestamp,
	getRecordingDurationMs,
}: RecorderWebcamOptions) {
	const webcamRecorder = useRef<MediaRecorder | null>(null);
	const webcamCapture = useRef<WebcamCapture | null>(null);
	const webcamCaptureGeneration = useRef(0);
	const webcamWriter = useRef<RecordingFileWriter | null>(null);
	const webcamStartTime = useRef<number | null>(null);
	const webcamTimeOffsetMs = useRef(0);
	const pendingWebcamPathPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopResolver = useRef<((path: string | null) => void) | null>(null);
	const resolvedWebcamPath = useRef<string | null>(null);
	const [webcamFailure, setWebcamFailure] = useState<{
		deviceId: string | undefined;
		message: string;
	} | null>(null);
	useEffect(() => {
		// Turning the webcam off is the user's retry; forget the last take's failure.
		if (!webcamEnabled) setWebcamFailure(null);
	}, [webcamEnabled]);
	const markWebcamUnavailable = useCallback(
		(error: unknown) =>
			setWebcamFailure({ deviceId: webcamDeviceId, message: getErrorMessage(error) }),
		[webcamDeviceId],
	);

	const releaseWebcamCapture = useCallback(() => {
		webcamCaptureGeneration.current++;
		webcamCapture.current?.release();
		webcamCapture.current = null;
	}, []);

	const releaseUnavailableWebcam = useCallback(
		(error: unknown) => {
			console.warn(
				"Failed to start webcam recording; continuing without webcam layer:",
				error,
			);
			markWebcamUnavailable(error);
			webcamStopResolver.current?.(null);
			webcamStopResolver.current = null;
			resolvedWebcamPath.current = null;
			const unavailablePath = Promise.resolve(null);
			pendingWebcamPathPromise.current = unavailablePath;
			webcamStopPromise.current = unavailablePath;
			webcamRecorder.current = null;
			webcamWriter.current = null;
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			releaseWebcamCapture();
			toast.warning(translate("notifications.webcamUnavailable", "Webcam unavailable"), {
				id: "recording-webcam-unavailable",
				duration: Infinity,
				description: translate(
					"notifications.webcamUnavailableDescription",
					"Your webcam could not start. Check your camera selection and permissions before the next take.",
				),
			});
		},
		[markWebcamUnavailable, releaseWebcamCapture],
	);

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
			releaseWebcamCapture();
		}

		const result = pending ? await pending : resolvedWebcamPath.current;
		if (webcamStopPromise.current === pending) {
			webcamStopPromise.current = null;
			pendingWebcamPathPromise.current = null;
			resolvedWebcamPath.current = result ?? null;
		}
		if (webcamRecorder.current === recorder) webcamRecorder.current = null;
		return result ?? null;
	}, [releaseWebcamCapture]);

	/** Acquire and prepare the webcam; begin capture only after the main recording starts. */
	const prepareWebcamRecorder = useCallback(async () => {
		setWebcamFailure(null);
		if (!webcamEnabled) {
			toast.dismiss("recording-webcam-unavailable");
			resolvedWebcamPath.current = null;
			pendingWebcamPathPromise.current = Promise.resolve(null);
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			return;
		}

		const generation = webcamCaptureGeneration.current;
		try {
			if (isMacOS) {
				const permission = await window.electronAPI.getMediaPermissionStatus();
				if (!permission.success || permission.camera !== "granted")
					throw new Error("Camera access must be granted in Camera settings.");
			}
			const capture = await acquireWebcamCapture(webcamDeviceId);
			if (generation !== webcamCaptureGeneration.current) {
				capture.release();
				return;
			}
			webcamCapture.current = capture;

			const settings = capture.stream.getVideoTracks?.()[0]?.getSettings?.();
			console.info("[Recorder] Webcam capture settings", {
				requestedFrameRate: 60,
				frameRate: settings?.frameRate ?? null,
				width: settings?.width ?? null,
				height: settings?.height ?? null,
			});

			const mimeType = selectWebcamRecordingMimeType();
			if (!mimeType) throw new Error("This browser cannot safely record the webcam as WebM.");

			resolvedWebcamPath.current = null;
			webcamStopPromise.current = new Promise((resolve) => {
				webcamStopResolver.current = resolve;
			});
			pendingWebcamPathPromise.current = webcamStopPromise.current;

			const recorder = new MediaRecorder(capture.stream, {
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
					markWebcamUnavailable(message);
					toast.error(`Webcam recording stopped: ${message}`);
					if (recorder.state !== "inactive") recorder.stop();
				},
			);
			webcamWriter.current = writer;
			const resolveWebcam = webcamStopResolver.current;
			webcamRecorder.current = recorder;
			recorder.ondataavailable = (event) => writer.write(event.data);
			recorder.onerror = (event) => {
				markWebcamUnavailable(
					"error" in event ? event.error : "The webcam recorder failed.",
				);
				toast.error("The webcam recorder failed. The partial recording will be preserved.");
			};
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
						releaseWebcamCapture();
					}
				}
			};
			toast.dismiss("recording-webcam-unavailable");
		} catch (error) {
			if (generation === webcamCaptureGeneration.current) releaseUnavailableWebcam(error);
		}
	}, [
		getRecordingDurationMs,
		isMacOS,
		markWebcamUnavailable,
		recordingSessionTimestamp,
		releaseWebcamCapture,
		releaseUnavailableWebcam,
		webcamDeviceId,
		webcamEnabled,
	]);

	/** Start the prepared webcam MediaRecorder after the main recording begins. */
	const beginWebcamCapture = useCallback(() => {
		const recorder = webcamRecorder.current;
		if (!recorder || recorder.state !== "inactive") return;
		const startedAt = Date.now();
		try {
			recorder.start(RECORDER_TIMESLICE_MS);
			webcamStartTime.current = startedAt;
		} catch (error) {
			releaseUnavailableWebcam(error);
		}
	}, [releaseUnavailableWebcam]);

	return {
		webcamRecordingError:
			webcamEnabled && webcamFailure?.deviceId === webcamDeviceId
				? (webcamFailure?.message ?? null)
				: null,
		webcamRecorder,
		releaseWebcamCapture,
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
