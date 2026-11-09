import { useRef } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { RecorderContext } from "./recorderContext";
import { getErrorMessage } from "./recordingError";
import type { NativeCaptureStopResult } from "./recordingNativeCleanup";
export function useRecorderStop(
	context: Pick<
		RecorderContext,
		| "recordingStartGeneration"
		| "setPaused"
		| "nativeScreenRecording"
		| "nativeWarmStartActive"
		| "setRecording"
		| "discardActiveNativeCapture"
		| "cleanupCapturedMedia"
		| "stopMicFallbackRecorder"
		| "stopWebcamRecorder"
		| "nativeStopRequestInFlight"
		| "setFinalizing"
		| "microphoneFallback"
		| "markRecordingResumed"
		| "getRecordingDurationMs"
		| "nativeWindowsRecording"
		| "openLoadingEditor"
		| "logNativeCaptureDiagnostics"
		| "recoverNativeRecordingSession"
		| "buildNativeCaptureFailureMessage"
		| "isMacOS"
		| "notifyRecordingFinalizationFailure"
		| "finalizeRecordingSession"
		| "webcamTimeOffsetMs"
		| "hideEditorOverlayCursorByDefault"
		| "storeMicrophoneSidecar"
		| "mediaRecorder"
		| "pendingWebcamPathPromise"
	>,
) {
	const {
		recordingStartGeneration,
		setPaused,
		nativeScreenRecording,
		nativeWarmStartActive,
		setRecording,
		discardActiveNativeCapture,
		cleanupCapturedMedia,
		stopMicFallbackRecorder,
		stopWebcamRecorder,
		nativeStopRequestInFlight,
		setFinalizing,
		microphoneFallback,
		markRecordingResumed,
		getRecordingDurationMs,
		nativeWindowsRecording,
		openLoadingEditor,
		logNativeCaptureDiagnostics,
		recoverNativeRecordingSession,
		buildNativeCaptureFailureMessage,
		isMacOS,
		notifyRecordingFinalizationFailure,
		finalizeRecordingSession,
		webcamTimeOffsetMs,
		hideEditorOverlayCursorByDefault,
		storeMicrophoneSidecar,
		mediaRecorder,
		pendingWebcamPathPromise,
	} = context;
	const stopRecording = useRef<() => void>(() => undefined);
	stopRecording.current = () => {
		recordingStartGeneration.current += 1;
		setPaused(false);
		if (nativeScreenRecording.current && nativeWarmStartActive.current) {
			setRecording(false);
			void (async () => {
				await discardActiveNativeCapture();
				cleanupCapturedMedia();
				await Promise.allSettled([
					stopMicFallbackRecorder(),
					stopWebcamRecorder(),
					window.electronAPI?.setRecordingState(false),
				]);
			})();
			return;
		}
		if (nativeScreenRecording.current) {
			if (nativeStopRequestInFlight.current) {
				return;
			}
			nativeStopRequestInFlight.current = true;
			setRecording(false);
			setFinalizing(true);

			void (async () => {
				const stopStart = performance.now();
				console.log("[PERF:RENDERER] Total Stop Sequence: STARTED");

				const fallbackStartDelayMs = microphoneFallback.startDelayMs;
				const fallbackTrackSettings = microphoneFallback.trackSettings;
				const stoppedAtMs = Date.now();
				markRecordingResumed(stoppedAtMs);
				const expectedDurationMs = getRecordingDurationMs(stoppedAtMs);
				const isNativeWindows = nativeWindowsRecording.current;

				const ipcStopStart = performance.now();
				console.log("[PERF:RENDERER] IPC: stopNativeScreenRecording: STARTED");
				let stopped: Promise<NativeCaptureStopResult>;
				try {
					stopped = window.electronAPI.stopNativeScreenRecording().catch((error) => ({
						success: false,
						error: getErrorMessage(error),
					}));
				} catch (error) {
					stopped = Promise.resolve({ success: false, error: getErrorMessage(error) });
				}
				// Show the editor skeleton while capture flushes its final frames to disk.
				openLoadingEditor();
				const micFallbackBlobPromise = stopMicFallbackRecorder();
				const webcamPathPromise = stopWebcamRecorder();
				const result = await stopped;
				nativeStopRequestInFlight.current = false;
				console.log(
					`[PERF:RENDERER] IPC: stopNativeScreenRecording: COMPLETED in ${(performance.now() - ipcStopStart).toFixed(2)}ms`,
				);
				if (result.success && result.error) toast.error(result.error);
				if (result.success) {
					nativeScreenRecording.current = false;
					nativeWindowsRecording.current = false;
					nativeWarmStartActive.current = false;
				}

				try {
					await window.electronAPI?.setRecordingState(false);
				} catch (stateError) {
					console.warn("Failed to reset main-process recording state:", stateError);
				}

				if (!result.success || !result.path) {
					console.error(
						"Failed to stop native screen recording:",
						result.error ?? result.message,
					);
					void logNativeCaptureDiagnostics("stop-native-screen-recording");
					try {
						const recoveredPath = await recoverNativeRecordingSession(
							micFallbackBlobPromise,
							fallbackStartDelayMs,
						);
						if (recoveredPath) {
							console.log(
								`[PERF:RENDERER] Total Stop Sequence (RECOVERED) in ${(performance.now() - stopStart).toFixed(2)}ms`,
							);
							return;
						}
					} catch (recoveryError) {
						console.error("Failed to recover native screen recording:", recoveryError);
					}

					const failureMessage = await buildNativeCaptureFailureMessage(
						"stop-native-screen-recording",
						isMacOS
							? translate(
									"notifications.finishRecordingFailed",
									"Failed to finish the recording. Your recording may still be available in Projects.",
								)
							: translate(
									"notifications.finishRecordingFailed",
									"Failed to finish the recording. Your recording may still be available in Projects.",
								),
					);
					await notifyRecordingFinalizationFailure(failureMessage);
					return;
				}

				const finalPath = result.path;

				// 1. Finalize the session and switch to editor immediately (Optimistic UI)
				// We pass null for webcamPath initially to avoid blocking on webcam disk writes/muxing.
				await finalizeRecordingSession(finalPath, null);

				// 2. Perform background finalization (webcam, muxing, sidecars)
				// We don't await this to keep the UI responsive
				void (async () => {
					try {
						// Webcam persistence, microphone sidecars, and Windows muxing are
						// independent. Run them concurrently so the editor can keep playing
						// the main video and reveal the webcam as soon as only that file is ready.
						const webcamReadyPromise = webcamPathPromise.then(async (webcamPath) => {
							console.log(
								"[useScreenRecorder] Background native processing: webcamPath is",
								webcamPath,
							);

							if (webcamPath) {
								try {
									await window.electronAPI.setCurrentRecordingSession({
										videoPath: finalPath,
										webcamPath,
										timeOffsetMs: webcamTimeOffsetMs.current,
										hideOverlayCursorByDefault:
											hideEditorOverlayCursorByDefault.current,
									});
								} catch (sessionError) {
									console.error(
										"Failed to publish the asynchronously finalized webcam:",
										sessionError,
									);
								}
							}

							return webcamPath;
						});
						const microphoneReadyPromise = storeMicrophoneSidecar(
							micFallbackBlobPromise,
							finalPath,
							fallbackStartDelayMs,
							fallbackTrackSettings,
						);
						const muxReadyPromise = isNativeWindows
							? window.electronAPI.muxNativeWindowsRecording(expectedDurationMs)
							: Promise.resolve(null);
						const [webcamResult, microphoneResult, muxResult] =
							await Promise.allSettled([
								webcamReadyPromise,
								microphoneReadyPromise,
								muxReadyPromise,
							]);
						const webcamPath =
							webcamResult.status === "fulfilled" ? webcamResult.value : null;
						for (const [taskName, result] of [
							["webcam", webcamResult],
							["microphone sidecar", microphoneResult],
							["Windows mux", muxResult],
						] as const) {
							if (result.status === "rejected") {
								console.error(
									`[useScreenRecorder] ${taskName} finalization failed:`,
									result.reason,
								);
							}
						}

						console.log(
							"[useScreenRecorder] Emitting setCurrentRecordingSession with:",
							{ finalPath, webcamPath },
						);

						// Update the session state to notify the editor that all background assets (webcam, mic, etc.) are now ready.
						// This broadcasts a 'recording-session-changed' event that the open editor listens to for re-scanning assets.
						await window.electronAPI.setCurrentRecordingSession({
							videoPath: finalPath,
							webcamPath,
							timeOffsetMs: webcamTimeOffsetMs.current,
							hideOverlayCursorByDefault: hideEditorOverlayCursorByDefault.current,
						});

						console.log(
							`[PERF:RENDERER] Background Stop Sequence: COMPLETED in ${(performance.now() - stopStart).toFixed(2)}ms`,
						);
					} catch (bgError) {
						console.error("Error in background finalization:", bgError);
					} finally {
						// After all background tasks are done (webcam, mic sidecars, muxing),
						// we can safely close the HUD window to release hardware and resources.
						if (typeof window.electronAPI?.hudOverlayClose === "function") {
							console.log(
								"[useScreenRecorder] All background tasks finished, closing HUD",
							);
							window.electronAPI.hudOverlayClose();
						}
					}
				})();
			})();
			return;
		}

		const recorder = mediaRecorder.current;
		const recorderState = recorder?.state;
		if (recorder && (recorderState === "recording" || recorderState === "paused")) {
			if (recorderState === "paused") {
				try {
					recorder.resume();
					markRecordingResumed(Date.now());
				} catch (error) {
					console.warn("Failed to resume recorder before stopping:", error);
				}
			}
			pendingWebcamPathPromise.current = stopWebcamRecorder();
			try {
				recorder.requestData();
			} catch (error) {
				console.warn("Failed to flush recorder before stopping:", error);
			}
			recorder.stop();
			openLoadingEditor();
			setRecording(false);
			setFinalizing(true);
			window.electronAPI?.setRecordingState(false);
		}
	};

	return { stopRecording };
}
