import { useCallback, useEffect } from "react";
import {
	LAUNCH_SHORTCUT_ACTIONS,
	matchesShortcut,
	type LaunchShortcutAction,
	type LaunchShortcutsConfig,
} from "@/lib/shortcuts";

interface UseLaunchShortcutsParams {
	launchShortcuts: LaunchShortcutsConfig;
	isMac: boolean;
	recording: boolean;
	paused: boolean;
	countdownActive: boolean;
	hasSelectedSource: boolean;
	platform: string | null;
	toggleRecording: () => void | Promise<void>;
	pauseRecording: () => void;
	resumeRecording: () => void;
	toggleMicrophoneMute: () => void;
	openSources: () => void;
}

export function useLaunchShortcuts({
	launchShortcuts,
	isMac,
	recording,
	paused,
	countdownActive,
	hasSelectedSource,
	platform,
	toggleRecording,
	pauseRecording,
	resumeRecording,
	toggleMicrophoneMute,
	openSources,
}: UseLaunchShortcutsParams) {
	const runLaunchShortcut = useCallback(
		(action: LaunchShortcutAction) => {
			switch (action) {
				case "startRecording":
					if (!recording && !countdownActive) {
						if (hasSelectedSource || platform === "linux") {
							void toggleRecording();
						} else {
							openSources();
						}
					}
					return;
				case "stopRecording":
					if (recording) {
						void toggleRecording();
					}
					return;
				case "pauseRecording":
					if (recording && !paused) pauseRecording();
					return;
				case "resumeRecording":
					if (recording && paused) resumeRecording();
					return;
				case "muteMicrophone":
					toggleMicrophoneMute();
					return;
				default:
					return;
			}
		},
		[
			recording,
			countdownActive,
			hasSelectedSource,
			platform,
			toggleRecording,
			openSources,
			paused,
			pauseRecording,
			resumeRecording,
			toggleMicrophoneMute,
		],
	);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.repeat) return;

			for (const action of LAUNCH_SHORTCUT_ACTIONS) {
				if (!matchesShortcut(e, launchShortcuts[action], isMac)) continue;
				e.preventDefault();
				e.stopPropagation();
				runLaunchShortcut(action);
				break;
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isMac, launchShortcuts, runLaunchShortcut]);

	useEffect(() => {
		const unsubscribe = window.electronAPI?.onLaunchShortcutTriggered?.((action) => {
			runLaunchShortcut(action);
		});
		return () => unsubscribe?.();
	}, [runLaunchShortcut]);

	useEffect(() => {
		const shortcutsToRegister = recording
			? {
					stopRecording: launchShortcuts.stopRecording,
					pauseRecording: launchShortcuts.pauseRecording,
					resumeRecording: launchShortcuts.resumeRecording,
					muteMicrophone: launchShortcuts.muteMicrophone,
				}
			: {
					startRecording: launchShortcuts.startRecording,
				};
		void window.electronAPI?.registerLaunchGlobalShortcuts?.(shortcutsToRegister);
		return () => {
			void window.electronAPI?.unregisterLaunchGlobalShortcuts?.();
		};
	}, [recording, launchShortcuts]);
}
