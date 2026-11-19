import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import {
	AUDIO_BITRATE_SYSTEM,
	AUDIO_BITRATE_VOICE,
	BITS_PER_MEGABIT,
	CODEC_ALIGNMENT,
	computeBitrate,
	createBrowserRecordingOptions,
	DEFAULT_HEIGHT,
	DEFAULT_WIDTH,
	RECORDER_TIMESLICE_MS,
	RECORDING_FILE_PREFIX,
	TARGET_FRAME_RATE,
} from "./recorderCaptureOptions";
import type { RecorderContext } from "./recorderContext";
import { RecordingFileWriter } from "./recordingFileWriter";
import { getVideoExtensionForMimeType } from "./recordingMimeType";
export async function startBrowserRecorder(
	context: Pick<
		RecorderContext,
		| "selectMimeType"
		| "stream"
		| "recordingSessionTimestamp"
		| "screenWriter"
		| "mediaRecorder"
		| "browserFinalizing"
		| "setFinalizing"
		| "openLoadingEditor"
		| "setRecording"
		| "cleanupCapturedMedia"
		| "getRecordingDurationMs"
		| "notifyRecordingFinalizationFailure"
		| "finalizeRecordingSession"
		| "pendingWebcamPathPromise"
		| "resolvedWebcamPath"
		| "webcamTimeOffsetMs"
		| "hideEditorOverlayCursorByDefault"
		| "beginWebcamCapture"
		| "resetRecordingClock"
		| "webcamStartTime"
	>,
	{
		videoTrack,
		systemAudioIncluded,
		startWasCancelled,
	}: {
		videoTrack: MediaStreamTrack;
		systemAudioIncluded: boolean;
		startWasCancelled: () => boolean;
	},
) {
	const {
		selectMimeType,
		stream,
		recordingSessionTimestamp,
		screenWriter,
		mediaRecorder,
		browserFinalizing,
		setFinalizing,
		openLoadingEditor,
		setRecording,
		cleanupCapturedMedia,
		getRecordingDurationMs,
		notifyRecordingFinalizationFailure,
		finalizeRecordingSession,
		pendingWebcamPathPromise,
		resolvedWebcamPath,
		webcamTimeOffsetMs,
		hideEditorOverlayCursorByDefault,
		beginWebcamCapture,
		resetRecordingClock,
		webcamStartTime,
	} = context;

	let {
		width = DEFAULT_WIDTH,
		height = DEFAULT_HEIGHT,
		frameRate = TARGET_FRAME_RATE,
	} = videoTrack.getSettings();

	width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
	height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;

	const videoBitsPerSecond = computeBitrate(width, height);
	const mimeType = selectMimeType();

	console.log(
		`Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType ?? "browser default"} / ${Math.round(
			videoBitsPerSecond / BITS_PER_MEGABIT,
		)} Mbps`,
	);

	const hasAudio = stream.current!.getAudioTracks().length > 0;
	const audioBitsPerSecond = hasAudio
		? systemAudioIncluded
			? AUDIO_BITRATE_SYSTEM
			: AUDIO_BITRATE_VOICE
		: undefined;
	const recorder = new MediaRecorder(
		stream.current!,
		createBrowserRecordingOptions({
			audioBitsPerSecond,
			mimeType,
			videoBitsPerSecond,
		}),
	);

	const recordingBlobType = recorder.mimeType || mimeType || "video/webm";
	const timestamp = recordingSessionTimestamp.current ?? Date.now();
	const writer = new RecordingFileWriter(
		window.electronAPI,
		`${RECORDING_FILE_PREFIX}${timestamp}${getVideoExtensionForMimeType(recordingBlobType)}`,
		recordingBlobType,
		(message) => {
			toast.error(message);
			if (recorder.state !== "inactive") recorder.stop();
		},
	);
	screenWriter.current = writer;
	mediaRecorder.current = recorder;
	recorder.ondataavailable = (event) => writer.write(event.data);
	recorder.onstop = async () => {
		// Also covers MediaRecorder stopping itself after a write/encoder failure.
		browserFinalizing.current = true;
		setFinalizing(true);
		setRecording(false);
		// Also covers a browser recorder that stops itself before its final write.
		if (!writer.isCancelled) openLoadingEditor();
		await window.electronAPI
			.setRecordingState(false)
			.catch((error) => console.warn("Could not reset recording state", error));
		cleanupCapturedMedia();
		if (writer.isCancelled) {
			try {
				await writer.discard();
			} finally {
				browserFinalizing.current = false;
				setFinalizing(false);
			}
			return;
		}
		try {
			const videoResult = await writer.finish(getRecordingDurationMs(Date.now()));
			if (!videoResult.success) {
				console.error("Failed to store video:", videoResult.message);
				await notifyRecordingFinalizationFailure(
					videoResult.message ||
						translate(
							"notifications.saveRecordingFailed",
							"Failed to save the recording.",
						),
				);
				return;
			}

			if (videoResult.path) {
				const finalVideoPath = videoResult.path;
				// 1. Launch editor immediately (Optimistic UI)
				await finalizeRecordingSession(finalVideoPath, null);

				// 2. Background webcam processing
				await (async () => {
					const webcamPath = pendingWebcamPathPromise.current
						? await pendingWebcamPathPromise.current
						: resolvedWebcamPath.current;

					try {
						if (webcamPath) {
							await window.electronAPI.setCurrentRecordingSession({
								videoPath: finalVideoPath,
								webcamPath,
								timeOffsetMs: webcamTimeOffsetMs.current,
								hideOverlayCursorByDefault:
									hideEditorOverlayCursorByDefault.current,
							});
						}
					} finally {
						// After all background tasks are done (webcam),
						// we can safely close the HUD window to release hardware and resources.
						if (typeof window.electronAPI?.hudOverlayClose === "function") {
							console.log(
								"[useScreenRecorder:browser] All background tasks finished, closing HUD",
							);
							window.electronAPI.hudOverlayClose();
						}
					}
				})();
			} else {
				await notifyRecordingFinalizationFailure(
					translate("notifications.saveRecordingFailed", "Failed to save the recording."),
				);
			}
		} catch (error) {
			console.error("Error saving recording:", error);
			const message = error instanceof Error ? error.message : String(error);
			await notifyRecordingFinalizationFailure(
				translate(
					"notifications.finalizeRecordingError",
					"Failed to finalize the recording. {{error}}",
					{ error: message },
				),
			);
		} finally {
			await pendingWebcamPathPromise.current?.catch((error) =>
				console.warn("Webcam finalization failed", error),
			);
			browserFinalizing.current = false;
			setFinalizing(false);
		}
	};
	recorder.onerror = () => {
		setRecording(false);
	};
	const mainStartedAt = Date.now();
	if (startWasCancelled()) return;
	beginWebcamCapture();
	resetRecordingClock(mainStartedAt);
	webcamTimeOffsetMs.current =
		webcamStartTime.current === null ? 0 : webcamStartTime.current - mainStartedAt;
	recorder.start(RECORDER_TIMESLICE_MS);
	setRecording(true);
	try {
		await window.electronAPI?.setRecordingState(true);
	} catch (stateError) {
		console.warn("Failed to notify main process that recording started:", stateError);
	}
}
