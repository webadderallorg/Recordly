import { fixWebmDuration } from "@fix-webm-duration/fix";
import {
	RECORDER_TIMESLICE_MS,
	RECORDING_FILE_PREFIX,
	VIDEO_FILE_EXTENSION,
	WEBCAM_BITRATE,
	WEBCAM_FRAME_RATE,
	WEBCAM_HEIGHT,
	WEBCAM_SUFFIX,
	WEBCAM_WIDTH,
	type ScreenRecorderRefs,
} from "./shared";

type WebcamPreparationOptions = {
	refs: ScreenRecorderRefs;
	webcamEnabled: boolean;
	webcamDeviceId: string | undefined;
	getRecordingDurationMs: (endedAt: number) => number;
	selectMimeType: () => string;
};

type FinalizeRecordingSessionOptions = {
	videoPath: string;
	webcamPath: string | null;
	webcamTimeOffsetMs: number;
	clearRecordingFinalizationToast: () => void;
};

export async function finalizeRecordingSession(options: FinalizeRecordingSessionOptions) {
	try {
		if (options.webcamPath) {
			await window.electronAPI.setCurrentRecordingSession({
				videoPath: options.videoPath,
				webcamPath: options.webcamPath,
				timeOffsetMs: options.webcamTimeOffsetMs,
			});
		} else {
			await window.electronAPI.setCurrentVideoPath(options.videoPath);
		}
	} catch (error) {
		console.error("Failed to persist recording session metadata:", error);

		try {
			await window.electronAPI.setCurrentVideoPath(options.videoPath);
		} catch (fallbackError) {
			console.error("Failed to persist fallback video path:", fallbackError);
		}
	}

	options.clearRecordingFinalizationToast();
	await window.electronAPI.switchToEditor();
}

export function stopMicFallbackRecorder(refs: ScreenRecorderRefs): Promise<Blob | null> {
	return new Promise((resolve) => {
		const recorder = refs.micFallbackRecorder.current;
		if (!recorder || recorder.state === "inactive") {
			refs.micFallbackRecorder.current = null;
			resolve(null);
			return;
		}

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				refs.micFallbackChunks.current.push(event.data);
			}
		};
		recorder.onstop = () => {
			const blob =
				refs.micFallbackChunks.current.length > 0
					? new Blob(refs.micFallbackChunks.current, { type: recorder.mimeType })
					: null;
			refs.micFallbackChunks.current = [];
			recorder.stream.getTracks().forEach((track) => track.stop());
			refs.micFallbackRecorder.current = null;
			resolve(blob);
		};
		recorder.stop();
	});
}

export async function storeMicrophoneSidecar(
	micFallbackBlobPromise: Promise<Blob | null> | null | undefined,
	finalPath: string,
) {
	const micFallbackBlob = await micFallbackBlobPromise;
	if (!micFallbackBlob) {
		return;
	}

	try {
		const arrayBuffer = await micFallbackBlob.arrayBuffer();
		await window.electronAPI.storeMicrophoneSidecar(arrayBuffer, finalPath);
	} catch (error) {
		console.warn("Failed to store microphone sidecar:", error);
	}
}

export async function stopWebcamRecorder(refs: ScreenRecorderRefs) {
	const recorder = refs.webcamRecorder.current;
	const pending = refs.webcamStopPromise.current;

	if (!recorder) {
		const result = pending ? await pending : refs.resolvedWebcamPath.current;
		refs.webcamStopPromise.current = null;
		refs.pendingWebcamPathPromise.current = null;
		refs.resolvedWebcamPath.current = result ?? null;
		return result ?? null;
	}

	if (recorder.state !== "inactive") {
		recorder.stop();
	} else if (pending && refs.webcamStopResolver.current) {
		refs.webcamStopResolver.current(refs.resolvedWebcamPath.current);
		refs.webcamStopResolver.current = null;
	}

	const result = pending ? await pending : refs.resolvedWebcamPath.current;
	refs.webcamStopPromise.current = null;
	refs.pendingWebcamPathPromise.current = null;
	refs.resolvedWebcamPath.current = result ?? null;
	return result ?? null;
}

export async function recoverNativeRecordingSession(options: {
	refs: ScreenRecorderRefs;
	micFallbackBlobPromise?: Promise<Blob | null> | null;
	clearRecordingFinalizationToast: () => void;
}) {
	if (typeof window.electronAPI?.recoverNativeScreenRecording !== "function") {
		return null;
	}

	const result = await window.electronAPI.recoverNativeScreenRecording();
	if (!result.success || !result.path) {
		return null;
	}

	const resolvedMicFallbackBlobPromise =
		options.micFallbackBlobPromise ?? stopMicFallbackRecorder(options.refs);
	const webcamPath = await stopWebcamRecorder(options.refs);
	await storeMicrophoneSidecar(resolvedMicFallbackBlobPromise, result.path);
	await finalizeRecordingSession({
		videoPath: result.path,
		webcamPath,
		webcamTimeOffsetMs: options.refs.webcamTimeOffsetMs.current,
		clearRecordingFinalizationToast: options.clearRecordingFinalizationToast,
	});
	return result.path;
}

export async function prepareWebcamRecorder(options: WebcamPreparationOptions) {
	const { refs, webcamEnabled, webcamDeviceId, getRecordingDurationMs, selectMimeType } = options;

	if (!webcamEnabled) {
		refs.resolvedWebcamPath.current = null;
		refs.pendingWebcamPathPromise.current = Promise.resolve(null);
		refs.webcamStartTime.current = null;
		refs.webcamTimeOffsetMs.current = 0;
		return;
	}

	try {
		refs.webcamStream.current = await navigator.mediaDevices.getUserMedia({
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

		const mimeType = selectMimeType();
		refs.webcamChunks.current = [];
		refs.resolvedWebcamPath.current = null;
		refs.webcamStopPromise.current = new Promise((resolve) => {
			refs.webcamStopResolver.current = resolve;
		});
		refs.pendingWebcamPathPromise.current = refs.webcamStopPromise.current;

		const recorder = new MediaRecorder(refs.webcamStream.current, {
			mimeType,
			videoBitsPerSecond: WEBCAM_BITRATE,
		});

		refs.webcamRecorder.current = recorder;
		recorder.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) {
				refs.webcamChunks.current.push(event.data);
			}
		};
		recorder.onerror = () => {
			refs.webcamStopResolver.current?.(null);
			refs.webcamStopResolver.current = null;
		};
		recorder.onstop = async () => {
			const sessionTimestamp = refs.recordingSessionTimestamp.current ?? Date.now();
			const webcamFileName = `${RECORDING_FILE_PREFIX}${sessionTimestamp}${WEBCAM_SUFFIX}${VIDEO_FILE_EXTENSION}`;

			try {
				if (refs.webcamChunks.current.length === 0) {
					refs.webcamStopResolver.current?.(null);
					return;
				}

				const duration = Math.max(
					0,
					getRecordingDurationMs(Date.now()) - refs.webcamTimeOffsetMs.current,
				);
				const webcamBlob = new Blob(refs.webcamChunks.current, { type: mimeType });
				refs.webcamChunks.current = [];
				const fixedBlob = await fixWebmDuration(webcamBlob, duration);
				const arrayBuffer = await fixedBlob.arrayBuffer();
				const result = await window.electronAPI.storeRecordedVideo(arrayBuffer, webcamFileName);
				refs.webcamStopResolver.current?.(result.success ? (result.path ?? null) : null);
			} catch (error) {
				console.error("Error saving webcam recording:", error);
				refs.webcamStopResolver.current?.(null);
			} finally {
				refs.webcamStopResolver.current = null;
				refs.webcamRecorder.current = null;
				refs.webcamStartTime.current = null;
				if (refs.webcamStream.current) {
					refs.webcamStream.current.getTracks().forEach((track) => track.stop());
					refs.webcamStream.current = null;
				}
			}
		};
	} catch (error) {
		console.warn("Failed to start webcam recording; continuing without webcam layer:", error);
		refs.resolvedWebcamPath.current = null;
		refs.pendingWebcamPathPromise.current = Promise.resolve(null);
		refs.webcamStopPromise.current = Promise.resolve(null);
		refs.webcamRecorder.current = null;
		refs.webcamStartTime.current = null;
		refs.webcamTimeOffsetMs.current = 0;
		if (refs.webcamStream.current) {
			refs.webcamStream.current.getTracks().forEach((track) => track.stop());
			refs.webcamStream.current = null;
		}
	}
}

export function beginWebcamCapture(refs: ScreenRecorderRefs) {
	const recorder = refs.webcamRecorder.current;
	if (recorder && recorder.state === "inactive") {
		refs.webcamStartTime.current = Date.now();
		recorder.start(RECORDER_TIMESLICE_MS);
	}
}