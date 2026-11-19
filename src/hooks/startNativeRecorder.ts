import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { RecorderContext } from "./recorderContext";
export async function startNativeRecorder(
	context: Pick<
		RecorderContext,
		| "systemAudioEnabled"
		| "microphoneEnabled"
		| "microphoneDeviceId"
		| "nativeScreenRecording"
		| "nativeWindowsRecording"
		| "nativeWarmStartActive"
		| "discardActiveNativeCapture"
		| "cleanupCapturedMedia"
		| "stopWebcamRecorder"
		| "logNativeCaptureDiagnostics"
		| "hasShownNativeWindowsFallbackToast"
		| "setRecording"
		| "setCountdownActive"
		| "countdownDelay"
		| "microphoneFallback"
		| "beginWebcamCapture"
		| "resetRecordingClock"
		| "webcamTimeOffsetMs"
		| "webcamStartTime"
		| "stopMicFallbackRecorder"
	>,
	{
		selectedSource,
		useNativeWindowsCapture,
		micLabel,
		shouldWarmStartNativeCapture,
		startWasCancelled,
	}: {
		selectedSource: ProcessedDesktopSource;
		useNativeWindowsCapture: boolean;
		micLabel?: string;
		shouldWarmStartNativeCapture: boolean;
		startWasCancelled: () => boolean;
	},
) {
	const {
		systemAudioEnabled,
		microphoneEnabled,
		microphoneDeviceId,
		nativeScreenRecording,
		nativeWindowsRecording,
		nativeWarmStartActive,
		discardActiveNativeCapture,
		cleanupCapturedMedia,
		stopWebcamRecorder,
		logNativeCaptureDiagnostics,
		hasShownNativeWindowsFallbackToast,
		setRecording,
		setCountdownActive,
		countdownDelay,
		microphoneFallback,
		beginWebcamCapture,
		resetRecordingClock,
		webcamTimeOffsetMs,
		webcamStartTime,
		stopMicFallbackRecorder,
	} = context;

	const nativeResult = await window.electronAPI.startNativeScreenRecording(selectedSource, {
		capturesSystemAudio: systemAudioEnabled,
		capturesMicrophone: microphoneEnabled,
		microphoneDeviceId,
		microphoneLabel: micLabel,
	});
	if (nativeResult.success && startWasCancelled()) {
		nativeScreenRecording.current = true;
		nativeWindowsRecording.current = useNativeWindowsCapture;
		nativeWarmStartActive.current = shouldWarmStartNativeCapture;
		await discardActiveNativeCapture();
		cleanupCapturedMedia();
		await stopWebcamRecorder();
		return "finished";
	}
	if (!nativeResult.success) {
		if (useNativeWindowsCapture) {
			console.warn(
				"Native Windows capture failed, falling back to browser capture:",
				nativeResult.error ?? nativeResult.message,
			);
			void logNativeCaptureDiagnostics("start-native-screen-recording");
			if (!hasShownNativeWindowsFallbackToast.current) {
				hasShownNativeWindowsFallbackToast.current = true;
				toast.warning(
					translate(
						"notifications.windowsStartFailed",
						"Native Windows capture failed to start. Falling back to browser capture.",
					),
				);
			}
		} else if (!nativeResult.userNotified) {
			throw new Error(
				nativeResult.error ??
					nativeResult.message ??
					"Failed to start native screen recording",
			);
		} else {
			setRecording(false);
			cleanupCapturedMedia();
			await stopWebcamRecorder();
			return "finished";
		}
	}

	if (nativeResult.success) {
		nativeScreenRecording.current = true;
		nativeWindowsRecording.current = useNativeWindowsCapture;
		if (shouldWarmStartNativeCapture) {
			nativeWarmStartActive.current = true;
			const pauseResult = await window.electronAPI.pauseNativeScreenRecording();
			if (startWasCancelled()) {
				return "finished";
			}
			if (!pauseResult.success) {
				throw new Error(
					pauseResult.error ??
						pauseResult.message ??
						"Failed to pause native capture before countdown",
				);
			}

			setCountdownActive(true);
			try {
				const countdownResult = await window.electronAPI.startCountdown(countdownDelay);
				if (!countdownResult.success || countdownResult.cancelled || startWasCancelled()) {
					if (!startWasCancelled()) {
						await discardActiveNativeCapture();
					}
					cleanupCapturedMedia();
					await stopWebcamRecorder();
					return "finished";
				}
			} finally {
				setCountdownActive(false);
			}

			const resumeResult = await window.electronAPI.resumeNativeScreenRecording();
			if (startWasCancelled()) {
				return "finished";
			}
			if (!resumeResult.success) {
				throw new Error(
					resumeResult.error ??
						resumeResult.message ??
						"Failed to resume native capture after countdown",
				);
			}
			nativeWarmStartActive.current = false;
		}
		if (startWasCancelled()) {
			return "finished";
		}

		const mainStartedAt = Date.now();
		microphoneFallback.resetStartDelay();
		beginWebcamCapture();
		resetRecordingClock(mainStartedAt);
		webcamTimeOffsetMs.current =
			webcamStartTime.current === null ? 0 : webcamStartTime.current - mainStartedAt;

		// When native mic capture is unavailable or explicitly bypassed,
		// record mic via browser getUserMedia as a sidecar file.
		if (nativeResult.microphoneFallbackRequired && microphoneEnabled) {
			void logNativeCaptureDiagnostics("start-browser-microphone-fallback");
			console.info("Using browser microphone processing for this recording.");
			const microphoneStarted = await microphoneFallback.start({
				microphoneDeviceId,
				mainStartedAt,
				startWasCancelled,
			});
			if (!microphoneStarted) return "finished";
		}
		if (startWasCancelled()) {
			await stopMicFallbackRecorder();
			await stopWebcamRecorder();
			cleanupCapturedMedia();
			return "finished";
		}

		setRecording(true);
		try {
			await window.electronAPI?.setRecordingState(true);
		} catch (stateError) {
			console.warn(
				"Failed to notify main process that native recording started:",
				stateError,
			);
		}

		return "finished";
	}

	return "browser-fallback";
}
