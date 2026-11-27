import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { beginAppOperation } from "@/lib/feedback/diagnostics";
import { acquireRecorderBrowserStream } from "./acquireRecorderBrowserStream";
import { isCapturePermissionDismissed, LINUX_PORTAL_SOURCE_ID } from "./browserScreenCapture";
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
		discardActiveNativeCapture,
		stopMicFallbackRecorder,
	} = context;
	const startRecording = async () => {
		if (startInFlight.current || recordingActive.current || browserFinalizing.current) {
			return;
		}
		const operation = beginAppOperation("recording.start");
		const startGeneration = recordingStartGeneration.current + 1;
		recordingStartGeneration.current = startGeneration;
		const startWasCancelled = () => recordingStartGeneration.current !== startGeneration;
		let startupFailed = false;
		const startupWasAborted = () => startupFailed || startWasCancelled();
		let usingLinuxPortal = false;
		const runCountdown = async () => {
			if (countdownDelay <= 0) return true;
			operation.step("countdown");
			setCountdownActive(true);
			try {
				const result = await window.electronAPI.startCountdown(countdownDelay);
				if (startWasCancelled()) return false;
				if (!result.success || result.cancelled) {
					cleanupCapturedMedia();
					await stopWebcamRecorder();
					return false;
				}
			} finally {
				setCountdownActive(false);
			}
			resetRecordingClock(Date.now());
			return true;
		};

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
			operation.step("reserve-session");
			const reservation = await window.electronAPI.reserveRecordingSession();
			if (!reservation.success) {
				operation.finish("blocked");
				toast.error(reservation.message);
				return;
			}
			sessionReservationToken = reservation.token;
			if (startWasCancelled()) return;
			operation.step("prepare-source");
			const preparedStart = await prepareRecordingStart();
			if (!preparedStart || startWasCancelled()) {
				cleanupCapturedMedia();
				await stopWebcamRecorder();
				return;
			}

			const {
				selectedSource,
				useNativeMacScreenCapture,
				useNativeWindowsCapture,
				useNativeLinuxPortalCapture = false,
				micLabel,
				webcamReady,
			} = preparedStart;
			usingLinuxPortal = selectedSource.id === LINUX_PORTAL_SOURCE_ID;
			const useNativeCapture =
				useNativeMacScreenCapture || useNativeWindowsCapture || useNativeLinuxPortalCapture;
			const shouldWarmStartNativeCapture =
				(useNativeMacScreenCapture || useNativeWindowsCapture) && countdownDelay > 0;
			const shouldPostStartCountdown = useNativeLinuxPortalCapture && countdownDelay > 0;
			if (
				!usingLinuxPortal &&
				!useNativeLinuxPortalCapture &&
				!shouldWarmStartNativeCapture &&
				!(await runCountdown())
			)
				return;

			let nativeWindowsCaptureStartFailed = false;

			if (useNativeCapture) {
				operation.step(
					useNativeWindowsCapture
						? "windows-native"
						: useNativeLinuxPortalCapture
							? "linux-portal-native"
							: "mac-native",
				);
				const outcome = await startNativeRecorder(context, {
					selectedSource,
					useNativeWindowsCapture,
					useNativeLinuxPortalCapture,
					micLabel,
					shouldWarmStartNativeCapture,
					shouldPostStartCountdown,
					startWasCancelled: startupWasAborted,
					webcamReady,
				});
				if (outcome === "failed") {
					operation.finish(startWasCancelled() ? "cancelled" : "failed");
					return;
				}
				if (outcome === "finished" || startWasCancelled()) return;
				if (
					outcome === "browser-fallback-needs-countdown" ||
					(useNativeLinuxPortalCapture && !usingLinuxPortal)
				) {
					if (!(await runCountdown())) return;
				} else if (shouldWarmStartNativeCapture) {
					resetRecordingClock(Date.now());
				}
				nativeWindowsCaptureStartFailed = useNativeWindowsCapture;
			}

			if (startWasCancelled()) return;
			operation.step(usingLinuxPortal ? "portal-capture" : "browser-capture");
			// The webcam opens while the screen stream is acquired; both must be ready to record.
			const [{ videoTrack, systemAudioIncluded }] = await Promise.all([
				acquireRecorderBrowserStream(context, {
					selectedSource,
					nativeWindowsCaptureStartFailed,
				}),
				webcamReady,
			]);
			operation.step("start-browser-recorder");
			await startBrowserRecorder(context, {
				videoTrack,
				systemAudioIncluded,
				startWasCancelled: startupWasAborted,
				runPortalCountdown: usingLinuxPortal ? runCountdown : undefined,
			});
		} catch (error) {
			startupFailed = true;
			const missingWaylandScreenCast =
				!startWasCancelled() &&
				usingLinuxPortal &&
				(await window.electronAPI.isWaylandScreenCastMissing?.().catch(() => false));
			const portalDismissed = usingLinuxPortal && isCapturePermissionDismissed(error);
			operation.finish(startWasCancelled() || portalDismissed ? "cancelled" : "failed");
			if (!startWasCancelled() && (missingWaylandScreenCast || !portalDismissed)) {
				console.error("Failed to start recording:", error);
				if (missingWaylandScreenCast) {
					alert(
						translate(
							"notifications.waylandScreenCastMissing",
							"Screen recording on Wayland needs a ScreenCast portal. Install the screen-sharing portal for your desktop, or switch to an X11 session and try again.",
						),
					);
				} else {
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
			}
			setRecording(false);
		} finally {
			operation.finish(recordingActive.current ? "succeeded" : "cancelled");
			try {
				if (startupWasAborted()) {
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
				console.warn("Failed to clean up recording startup:", error);
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
