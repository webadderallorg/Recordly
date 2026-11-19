import { useEffect } from "react";
import { toast } from "@/components/ui/toast";
import type { RecorderStopContext } from "./recorderContext";
export function useRecorderSubscriptions(
	context: Pick<
		RecorderStopContext,
		| "stopRecording"
		| "stopMicFallbackRecorder"
		| "stopWebcamRecorder"
		| "microphoneFallback"
		| "setRecording"
		| "recordingStartGeneration"
		| "nativeScreenRecording"
		| "nativeWindowsRecording"
		| "nativeWarmStartActive"
		| "cleanupCapturedMedia"
		| "recoverNativeRecordingSession"
		| "hasPromptedForReselect"
		| "nativeStopRequestInFlight"
		| "discardActiveNativeCapture"
		| "pendingNativeCleanupPath"
		| "mediaRecorder"
	>,
) {
	const {
		stopRecording,
		stopMicFallbackRecorder,
		stopWebcamRecorder,
		microphoneFallback,
		setRecording,
		recordingStartGeneration,
		nativeScreenRecording,
		nativeWindowsRecording,
		nativeWarmStartActive,
		cleanupCapturedMedia,
		recoverNativeRecordingSession,
		hasPromptedForReselect,
		nativeStopRequestInFlight,
		discardActiveNativeCapture,
		pendingNativeCleanupPath,
		mediaRecorder,
	} = context;
	useEffect(() => {
		let cleanup: (() => void) | undefined;

		if (window.electronAPI?.onStopRecordingFromTray) {
			cleanup = window.electronAPI.onStopRecordingFromTray(() => {
				stopRecording.current();
			});
		}

		const removeRecordingStateListener = window.electronAPI?.onRecordingStateChanged?.(
			(state) => {
				setRecording(state.recording);
			},
		);

		const removeRecordingInterruptedListener = window.electronAPI?.onRecordingInterrupted?.(
			(state) => {
				void (async () => {
					recordingStartGeneration.current += 1;
					setRecording(false);
					nativeScreenRecording.current = false;
					nativeWindowsRecording.current = false;
					nativeWarmStartActive.current = false;
					const startDelayMs = microphoneFallback.startDelayMs;
					const microphone = stopMicFallbackRecorder().catch((error) => {
						console.warn("Could not finalize the interrupted microphone:", error);
						return null;
					});
					const webcam = stopWebcamRecorder().catch((error) => {
						console.warn("Could not finalize the interrupted webcam:", error);
						return null;
					});
					let recoveredPath: string | null = null;
					try {
						try {
							await window.electronAPI.setRecordingState(false);
						} catch (error) {
							console.warn("Could not reset interrupted recording state:", error);
						}
						// Keep microphone chunks and timing metadata until recovery stores the sidecar.
						toast.error(state.message);
						recoveredPath = await recoverNativeRecordingSession(
							microphone,
							startDelayMs,
						);
					} catch (recoveryError) {
						console.error(
							"Failed to recover interrupted native screen recording:",
							recoveryError,
						);
					} finally {
						await Promise.allSettled([microphone, webcam]);
						cleanupCapturedMedia();
					}
					if (recoveredPath) return;

					if (state.reason === "window-unavailable" && !hasPromptedForReselect.current) {
						hasPromptedForReselect.current = true;
						alert(state.message);
						await window.electronAPI.openSourceSelector();
					} else {
						console.error(state.message);
						toast.error(state.message);
					}
				})();
			},
		);

		return () => {
			recordingStartGeneration.current += 1;
			cleanup?.();
			removeRecordingStateListener?.();
			removeRecordingInterruptedListener?.();

			if (nativeScreenRecording.current) {
				if (
					!nativeStopRequestInFlight.current &&
					window.electronAPI.recoverRecordingOwner
				) {
					// Fast Refresh can remount the controls without navigating. Let main
					// save/discard this session and finish Windows audio before releasing it.
					nativeStopRequestInFlight.current = true;
					void window.electronAPI
						.recoverRecordingOwner()
						.then(() => {
							nativeScreenRecording.current = false;
							nativeWindowsRecording.current = false;
							nativeWarmStartActive.current = false;
							setRecording(false);
						})
						.catch((error) =>
							console.warn("Failed to recover recording controls:", error),
						)
						.finally(() => {
							nativeStopRequestInFlight.current = false;
						});
				} else if (nativeWarmStartActive.current) {
					void discardActiveNativeCapture();
				} else if (!nativeStopRequestInFlight.current) {
					nativeStopRequestInFlight.current = true;
					void window.electronAPI
						.stopNativeScreenRecording()
						.then(async (result) => {
							if (result.success) {
								nativeScreenRecording.current = false;
								nativeWindowsRecording.current = false;
								// Compatibility with an already loaded older preload.
								setRecording(false);
								await window.electronAPI.setRecordingState(false);
							}
						})
						.catch((error) => {
							console.warn("Failed to stop native capture during cleanup:", error);
						})
						.finally(() => {
							nativeStopRequestInFlight.current = false;
						});
				}
			} else if (pendingNativeCleanupPath.current) {
				void discardActiveNativeCapture();
			}

			const recorder = mediaRecorder.current;
			const recorderState = recorder?.state;
			if (recorder && (recorderState === "recording" || recorderState === "paused")) {
				recorder.stop();
			}

			cleanupCapturedMedia();
		};
	}, [
		cleanupCapturedMedia,
		discardActiveNativeCapture,
		recoverNativeRecordingSession,
		setRecording,
		stopRecording,
		stopMicFallbackRecorder,
		stopWebcamRecorder,
		microphoneFallback,
		recordingStartGeneration,
		nativeScreenRecording,
		nativeWindowsRecording,
		nativeWarmStartActive,
		hasPromptedForReselect,
		nativeStopRequestInFlight,
		pendingNativeCleanupPath,
		mediaRecorder,
	]);
}
