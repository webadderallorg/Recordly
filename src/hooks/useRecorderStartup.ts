import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { acquireRecorderBrowserStream } from "./acquireRecorderBrowserStream";
import { isCapturePermissionDismissed } from "./browserScreenCapture";
import type { RecorderContext } from "./recorderContext";
import { startBrowserRecorder } from "./startBrowserRecorder";
import { startNativeRecorder } from "./startNativeRecorder";
export function useRecorderStartup(context: RecorderContext) {
	const {
		startInFlight,
		recordingActive,
		browserFinalizing,
		recordingStartGeneration,
		hasPromptedForReselect,
		pendingStart,
		setStarting,
		prepareRecordingStart,
		cleanupCapturedMedia,
		stopWebcamRecorder,
		countdownDelay,
		setCountdownActive,
		resetRecordingClock,
		setRecording,
		nativeScreenRecording,
		discardActiveNativeCapture,
		stopMicFallbackRecorder,
	} = context;
	const startRecording = async () => {
		if (startInFlight.current || recordingActive.current || browserFinalizing.current) {
			return;
		}
		const startGeneration = recordingStartGeneration.current + 1;
		recordingStartGeneration.current = startGeneration;
		const startWasCancelled = () => recordingStartGeneration.current !== startGeneration;
		let usingLinuxPortal = false;

		let hudSourceSelectionActive = false;
		const setHudSourceSelectionActive = (active: boolean) => {
			if (hudSourceSelectionActive === active) {
				return;
			}

			hudSourceSelectionActive = active;
			window.electronAPI?.hudOverlaySetSourceSelectionActive?.(active);
		};

		hasPromptedForReselect.current = false;
		startInFlight.current = true;
		let finishStart!: () => void;
		pendingStart.current = new Promise<void>((resolve) => {
			finishStart = resolve;
		});
		setStarting(true);
		let sessionReservationToken: string | undefined;

		try {
			const reservation = await window.electronAPI.reserveRecordingSession();
			if (!reservation.success) {
				toast.error(reservation.message);
				return;
			}
			sessionReservationToken = reservation.token;
			if (startWasCancelled()) return;
			const preparedStart = await prepareRecordingStart();
			if (!preparedStart || startWasCancelled()) {
				cleanupCapturedMedia();
				await stopWebcamRecorder();
				return;
			}

			const { selectedSource, useNativeMacScreenCapture, useNativeWindowsCapture, micLabel } =
				preparedStart;
			const useNativeCapture = useNativeMacScreenCapture || useNativeWindowsCapture;
			const shouldWarmStartNativeCapture = useNativeCapture && countdownDelay > 0;
			if (countdownDelay > 0 && !shouldWarmStartNativeCapture) {
				setCountdownActive(true);
				try {
					const result = await window.electronAPI.startCountdown(countdownDelay);
					if (!result.success || result.cancelled || startWasCancelled()) {
						cleanupCapturedMedia();
						await stopWebcamRecorder();
						return;
					}
				} finally {
					setCountdownActive(false);
				}
				resetRecordingClock(Date.now());
			}

			let nativeWindowsCaptureStartFailed = false;

			if (useNativeCapture) {
				const outcome = await startNativeRecorder(context, {
					selectedSource,
					useNativeWindowsCapture,
					micLabel,
					shouldWarmStartNativeCapture,
					startWasCancelled,
				});
				if (outcome === "finished") return;
				nativeWindowsCaptureStartFailed = true;
			}

			if (startWasCancelled()) return;
			if (nativeWindowsCaptureStartFailed && countdownDelay > 0) {
				setCountdownActive(true);
				try {
					const result = await window.electronAPI.startCountdown(countdownDelay);
					if (!result.success || result.cancelled || startWasCancelled()) {
						cleanupCapturedMedia();
						await stopWebcamRecorder();
						return;
					}
				} finally {
					setCountdownActive(false);
				}
				resetRecordingClock(Date.now());
			}

			if (startWasCancelled()) return;
			const { videoTrack, systemAudioIncluded } = await acquireRecorderBrowserStream(
				context,
				{
					selectedSource,
					nativeWindowsCaptureStartFailed,
					onPortalCapture: (value) => {
						usingLinuxPortal = value;
					},
				},
			);
			await startBrowserRecorder(context, {
				videoTrack,
				systemAudioIncluded,
				startWasCancelled,
			});
		} catch (error) {
			if (
				!startWasCancelled() &&
				!(usingLinuxPortal && isCapturePermissionDismissed(error))
			) {
				console.error("Failed to start recording:", error);
				alert(
					error instanceof Error
						? translate(
								"notifications.startRecordingError",
								"Failed to start recording: {{error}}",
								{ error: error.message },
							)
						: translate(
								"notifications.startRecordingFailed",
								"Failed to start recording",
							),
				);
			}
			setRecording(false);
			if (nativeScreenRecording.current) {
				await discardActiveNativeCapture();
			}
			try {
				await window.electronAPI?.setRecordingState(false);
			} catch (stateError) {
				console.warn("Failed to reset main-process recording state:", stateError);
			} finally {
				cleanupCapturedMedia();
				await stopWebcamRecorder();
			}
		} finally {
			try {
				if (startWasCancelled()) {
					try {
						await discardActiveNativeCapture();
					} finally {
						cleanupCapturedMedia();
						await Promise.allSettled([
							stopMicFallbackRecorder(),
							stopWebcamRecorder(),
							// This also restores the Windows cursor hidden during browser startup.
							window.electronAPI.setRecordingState(false),
						]);
					}
				}
			} catch (error) {
				console.warn("Failed to clean up canceled recording startup:", error);
			}
			try {
				await window.electronAPI.finishRecordingStartup();
			} catch (error) {
				console.warn("Failed to release recording startup protection:", error);
			}
			setHudSourceSelectionActive(false);
			if (sessionReservationToken) {
				window.electronAPI.releaseRecordingStartup(sessionReservationToken);
			}
			startInFlight.current = false;
			pendingStart.current = null;
			setStarting(false);
			finishStart();
		}
	};
	return { startRecording };
}
