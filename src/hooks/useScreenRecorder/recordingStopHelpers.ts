import { stopMicFallbackRecorder, stopWebcamRecorder } from "./webcamRecording";
import type { ScreenRecorderRefs } from "./shared";

type StopRecordingOptions = {
	refs: ScreenRecorderRefs;
	setPaused: (paused: boolean) => void;
	setRecording: (recording: boolean) => void;
	isMacOS: boolean;
	markRecordingResumed: (resumedAt: number) => void;
	showRecordingFinalizationToast: (message?: string) => void;
	logNativeCaptureDiagnostics: (context: string) => Promise<void>;
	recoverNativeRecordingSession: (micFallbackBlobPromise?: Promise<Blob | null> | null) => Promise<string | null>;
	buildNativeCaptureFailureMessage: (context: string, fallbackMessage: string) => Promise<string>;
	notifyRecordingFinalizationFailure: (message: string) => Promise<void>;
	storeMicrophoneSidecar: (
		micFallbackBlobPromise: Promise<Blob | null> | null | undefined,
		finalPath: string,
	) => Promise<void>;
	finalizeRecordingSession: (videoPath: string, webcamPath: string | null) => Promise<void>;
	cleanupCapturedMedia: () => Promise<void>;
};

export async function stopNativeRecordingSession(options: StopRecordingOptions) {
	options.refs.nativeScreenRecording.current = false;
	options.setRecording(false);
	options.showRecordingFinalizationToast();

	const micFallbackBlobPromise = stopMicFallbackRecorder(options.refs);
	const webcamPath = await stopWebcamRecorder(options.refs);
	const isNativeWindows = options.refs.nativeWindowsRecording.current;
	options.markRecordingResumed(Date.now());
	const pauseSegments = options.refs.pauseSegmentsRef.current.slice();
	options.refs.nativeWindowsRecording.current = false;

	const result = await window.electronAPI.stopNativeScreenRecording();
	await window.electronAPI?.setRecordingState(false);

	if (!result.success || !result.path) {
		console.error("Failed to stop native screen recording:", result.error ?? result.message);
		await options.logNativeCaptureDiagnostics("stop-native-screen-recording");
		try {
			const recoveredPath = await options.recoverNativeRecordingSession(micFallbackBlobPromise);
			if (recoveredPath) {
				return true;
			}
		} catch (recoveryError) {
			console.error("Failed to recover native screen recording:", recoveryError);
		}

		const failureMessage = await options.buildNativeCaptureFailureMessage(
			"stop-native-screen-recording",
			options.isMacOS
				? "Failed to finish the macOS recording, so the editor was not opened."
				: "Failed to finish the recording, so the editor was not opened.",
		);
		await options.notifyRecordingFinalizationFailure(failureMessage);
		return true;
	}

	let finalPath = result.path;
	if (isNativeWindows) {
		const muxResult = await window.electronAPI.muxNativeWindowsRecording(pauseSegments);
		if (!muxResult?.success) {
			await options.logNativeCaptureDiagnostics("mux-native-windows-recording");
		}
		finalPath = muxResult?.path ?? result.path;
	}

	await options.storeMicrophoneSidecar(micFallbackBlobPromise, finalPath);
	await options.finalizeRecordingSession(finalPath, webcamPath);
	return true;
}

export async function stopBrowserRecordingSession(options: StopRecordingOptions) {
	const recorder = options.refs.mediaRecorder.current;
	const recorderState = recorder?.state;
	if (!recorder || (recorderState !== "recording" && recorderState !== "paused")) {
		return false;
	}

	if (recorderState === "paused") {
		try {
			recorder.resume();
			options.markRecordingResumed(Date.now());
		} catch (error) {
			console.warn("Failed to resume recorder before stopping:", error);
		}
	}

	options.refs.pendingWebcamPathPromise.current = stopWebcamRecorder(options.refs);
	await options.cleanupCapturedMedia();
	recorder.stop();
	options.setRecording(false);
	window.electronAPI?.setRecordingState(false);
	return true;
}