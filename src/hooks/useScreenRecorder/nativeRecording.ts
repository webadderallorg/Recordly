import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { RECORDER_TIMESLICE_MS, type ScreenRecorderRefs } from "./shared";
import { beginWebcamCapture } from "./webcamRecording";

type NativeStartOptions = {
	selectedSource: ProcessedDesktopSource;
	microphoneEnabled: boolean;
	microphoneDeviceId: string | undefined;
	systemAudioEnabled: boolean;
};

export async function resolveNativeCaptureMode(options: {
	selectedSource: ProcessedDesktopSource;
	logNativeCaptureDiagnostics: (context: string) => Promise<void>;
	hasShownNativeWindowsFallbackToast: MutableRefObject<boolean>;
}) {
	const platform = await window.electronAPI.getPlatform();
	const canCaptureSelection =
		options.selectedSource.id?.startsWith("screen:") ||
		options.selectedSource.id?.startsWith("window:");

	const useNativeMacScreenCapture =
		platform === "darwin" &&
		canCaptureSelection &&
		typeof window.electronAPI.startNativeScreenRecording === "function";

	let useNativeWindowsCapture = false;
	if (
		platform === "win32" &&
		canCaptureSelection &&
		typeof window.electronAPI.isNativeWindowsCaptureAvailable === "function"
	) {
		try {
			const nativeWindowsResult = await window.electronAPI.isNativeWindowsCaptureAvailable();
			useNativeWindowsCapture = nativeWindowsResult.available;
			if (!useNativeWindowsCapture && !options.hasShownNativeWindowsFallbackToast.current) {
				await options.logNativeCaptureDiagnostics("is-native-windows-capture-available");
				options.hasShownNativeWindowsFallbackToast.current = true;
				toast.info("Native Windows capture is unavailable. Falling back to browser capture.");
			}
		} catch {
			useNativeWindowsCapture = false;
			if (!options.hasShownNativeWindowsFallbackToast.current) {
				options.hasShownNativeWindowsFallbackToast.current = true;
				toast.info(
					"Unable to check native Windows capture. Falling back to browser capture.",
				);
			}
		}
	}

	return { platform, useNativeMacScreenCapture, useNativeWindowsCapture };
}

export async function startNativeRecording(options: NativeStartOptions) {
	let micLabel: string | undefined;
	if (options.microphoneEnabled) {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			const mic = devices.find(
				(device) =>
					device.deviceId === options.microphoneDeviceId && device.kind === "audioinput",
			);
			micLabel = mic?.label || undefined;
		} catch {
			// native process will use the default mic
		}
	}

	const nativeResult = await window.electronAPI.startNativeScreenRecording(options.selectedSource, {
		capturesSystemAudio: options.systemAudioEnabled,
		capturesMicrophone: options.microphoneEnabled,
		microphoneDeviceId: options.microphoneDeviceId,
		microphoneLabel: micLabel,
	});

	return nativeResult;
}

export async function handleSuccessfulNativeStart(options: {
	refs: ScreenRecorderRefs;
	useNativeWindowsCapture: boolean;
	microphoneEnabled: boolean;
	microphoneDeviceId: string | undefined;
	nativeResult: Awaited<ReturnType<typeof window.electronAPI.startNativeScreenRecording>>;
	setRecording: (recording: boolean) => void;
	resetRecordingClock: (startedAt: number) => void;
}) {
	const mainStartedAt = Date.now();
	beginWebcamCapture(options.refs);
	options.refs.nativeScreenRecording.current = true;
	options.refs.nativeWindowsRecording.current = options.useNativeWindowsCapture;
	options.resetRecordingClock(mainStartedAt);
	options.refs.webcamTimeOffsetMs.current =
		options.refs.webcamStartTime.current === null
			? 0
			: options.refs.webcamStartTime.current - mainStartedAt;

	if (options.nativeResult.microphoneFallbackRequired && options.microphoneEnabled) {
		try {
			const micStream = await navigator.mediaDevices.getUserMedia({
				audio: options.microphoneDeviceId
					? {
							deviceId: { exact: options.microphoneDeviceId },
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
						}
					: {
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
						},
				video: false,
			});
			options.refs.micFallbackChunks.current = [];
			const recorder = new MediaRecorder(micStream, {
				mimeType: "audio/webm;codecs=opus",
			});
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					options.refs.micFallbackChunks.current.push(event.data);
				}
			};
			recorder.start(RECORDER_TIMESLICE_MS);
			options.refs.micFallbackRecorder.current = recorder;
		} catch (micError) {
			console.warn("Browser microphone fallback failed:", micError);
		}
	}

	options.setRecording(true);
	window.electronAPI?.setRecordingState(true);
}