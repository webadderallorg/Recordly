import { useEffect, type MutableRefObject } from "react";
import { toast } from "sonner";
import type { ScreenRecorderRefs } from "./shared";

type UseScreenRecorderLifecycleOptions = {
	refs: ScreenRecorderRefs;
	stopRecordingRef: MutableRefObject<() => void>;
	cleanupCapturedMedia: () => Promise<void>;
	recoverNativeRecordingSession: () => Promise<string | null>;
	setRecording: (recording: boolean) => void;
	setIsMacOS: (isMacOS: boolean) => void;
	setCountdownDelayState: (delay: number) => void;
	setMicrophoneEnabled: (enabled: boolean) => void;
	setMicrophoneDeviceId: (deviceId: string | undefined) => void;
	setSystemAudioEnabled: (enabled: boolean) => void;
};

export function useScreenRecorderLifecycle(options: UseScreenRecorderLifecycleOptions) {
	useEffect(() => {
		void (async () => {
			const platform = await window.electronAPI.getPlatform();
			options.setIsMacOS(platform === "darwin");
		})();
	}, [options]);

	useEffect(() => {
		if (options.refs.countdownDelayLoaded.current) return;
		options.refs.countdownDelayLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getCountdownDelay();
			if (result.success && typeof result.delay === "number") {
				options.setCountdownDelayState(result.delay);
			}
		})();
	}, [options]);

	useEffect(() => {
		if (options.refs.recordingPrefsLoaded.current) return;
		options.refs.recordingPrefsLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getRecordingPreferences();
			if (result.success) {
				options.setMicrophoneEnabled(result.microphoneEnabled);
				if (result.microphoneDeviceId) {
					options.setMicrophoneDeviceId(result.microphoneDeviceId);
				}
				options.setSystemAudioEnabled(result.systemAudioEnabled);
			}
		})();
	}, [options]);

	useEffect(() => {
		let cleanup: (() => void) | undefined;

		if (window.electronAPI?.onStopRecordingFromTray) {
			cleanup = window.electronAPI.onStopRecordingFromTray(() => {
				options.stopRecordingRef.current();
			});
		}

		const removeRecordingStateListener = window.electronAPI?.onRecordingStateChanged?.(
			(state) => {
				options.setRecording(state.recording);
			},
		);

		const removeRecordingInterruptedListener = window.electronAPI?.onRecordingInterrupted?.(
			(state) => {
				void (async () => {
					options.setRecording(false);
					options.refs.nativeScreenRecording.current = false;
					await options.cleanupCapturedMedia();
					await window.electronAPI.setRecordingState(false);

					if (state.reason !== "window-unavailable") {
						try {
							const recoveredPath = await options.recoverNativeRecordingSession();
							if (recoveredPath) {
								return;
							}
						} catch (recoveryError) {
							console.error(
								"Failed to recover interrupted native screen recording:",
								recoveryError,
							);
						}
					}

					if (
						state.reason === "window-unavailable" &&
						!options.refs.hasPromptedForReselect.current
					) {
						options.refs.hasPromptedForReselect.current = true;
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
			cleanup?.();
			removeRecordingStateListener?.();
			removeRecordingInterruptedListener?.();

			if (options.refs.nativeScreenRecording.current) {
				options.refs.nativeScreenRecording.current = false;
				void window.electronAPI.stopNativeScreenRecording();
			}

			const recorder = options.refs.mediaRecorder.current;
			const recorderState = recorder?.state;
			if (recorder && (recorderState === "recording" || recorderState === "paused")) {
				recorder.stop();
			}

			void options.cleanupCapturedMedia();
		};
	}, [options]);
}