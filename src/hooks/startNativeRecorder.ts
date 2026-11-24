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
		webcamReady,
	}: {
		selectedSource: ProcessedDesktopSource;
		useNativeWindowsCapture: boolean;
		micLabel?: string;
		shouldWarmStartNativeCapture: boolean;
		startWasCancelled: () => boolean;
		/** Webcam opening runs while ScreenCaptureKit starts; await before beginning its capture. */
		webcamReady?: Promise<void>;
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

	const startCountdown = () => {
		setCountdownActive(true);
		return window.electronAPI
			.startCountdown(countdownDelay)
			.catch((error: unknown) => ({
				success: false,
				cancelled: false,
				error: error instanceof Error ? error.message : String(error),
			}))
			.finally(() => setCountdownActive(false));
	};
	// Show the countdown immediately and let ScreenCaptureKit warm up underneath it.
	let countdown: ReturnType<typeof startCountdown> | null = shouldWarmStartNativeCapture
		? startCountdown()
		: null;

	try {
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
				return "failed";
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

				const countdownResult = await (countdown ?? startCountdown());
				countdown = null;
				if (!countdownResult.success || countdownResult.cancelled || startWasCancelled()) {
					if (!startWasCancelled()) {
						await discardActiveNativeCapture();
					}
					cleanupCapturedMedia();
					await stopWebcamRecorder();
					return "finished";
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

			// The screen is already capturing, so stamp its start before waiting on the webcam.
			const mainStartedAt = Date.now();
			microphoneFallback.resetStartDelay();
			resetRecordingClock(mainStartedAt);
			const startWebcam = async () => {
				await webcamReady;
				if (startWasCancelled()) return;
				beginWebcamCapture();
				webcamTimeOffsetMs.current =
					webcamStartTime.current === null ? 0 : webcamStartTime.current - mainStartedAt;
			};

			// When native mic capture is unavailable or explicitly bypassed,
			// record mic via browser getUserMedia as a sidecar file.
			const startMicrophone = async () => {
				if (!nativeResult.microphoneFallbackRequired || !microphoneEnabled) return true;
				if (useNativeWindowsCapture) {
					await window.electronAPI
						.beginWindowsRecordingCursorCapture?.()
						.catch((error) => {
							console.warn("Could not start early Windows cursor capture:", error);
						});
					if (startWasCancelled()) return false;
				}
				void logNativeCaptureDiagnostics("start-browser-microphone-fallback");
				console.info("Using browser microphone processing for this recording.");
				return microphoneFallback.start({
					microphoneDeviceId,
					mainStartedAt,
					startWasCancelled,
				});
			};
			const [microphoneStarted] = await Promise.all([startMicrophone(), startWebcam()]);
			if (!microphoneStarted || startWasCancelled()) {
				await stopMicFallbackRecorder();
				await stopWebcamRecorder();
				cleanupCapturedMedia();
				return "finished";
			}

			if (nativeResult.systemAudioCaptureUnavailable) {
				toast.warning(
					translate(
						"notifications.systemAudioUnavailable",
						"System audio is not available for this source. Recording will continue without system audio.",
					),
					{ id: "recording-system-audio-unavailable", duration: 10000 },
				);
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

		if (countdown) {
			const result = await countdown;
			countdown = null;
			if (startWasCancelled()) return "finished";
			if (result.cancelled) {
				cleanupCapturedMedia();
				await stopWebcamRecorder();
				return "finished";
			}
			if (!result.success) return "browser-fallback-needs-countdown";
		}
		return "browser-fallback";
	} finally {
		if (countdown) {
			// Startup ended early; stop the countdown that was running alongside it.
			await window.electronAPI.cancelCountdown().catch(() => undefined);
			await countdown;
		}
	}
}
