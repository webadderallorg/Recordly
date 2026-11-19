import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { shouldUseNativeWindowsCaptureForSource } from "./recorderCaptureOptions";
import type { RecorderServices } from "./recorderContext";
import {
	type DiscardNativeCaptureResult,
	deleteNativeCaptureFile,
	stopAndDiscardNativeCapture,
} from "./recordingNativeCleanup";
export function useRecorderCaptureSetup(
	context: Pick<
		RecorderServices,
		| "stopMicFallbackRecorder"
		| "stopWebcamRecorder"
		| "storeMicrophoneSidecar"
		| "finalizeRecordingSession"
		| "hideEditorOverlayCursorByDefault"
		| "preparePermissions"
		| "recordingSessionTimestamp"
		| "resetRecordingClock"
		| "prepareWebcamRecorder"
		| "hasShownNativeWindowsFallbackToast"
		| "logNativeCaptureDiagnostics"
		| "microphoneEnabled"
		| "microphoneDeviceId"
		| "pendingNativeCleanupPath"
		| "nativeScreenRecording"
		| "nativeStopRequestInFlight"
		| "nativeWindowsRecording"
		| "nativeWarmStartActive"
	>,
) {
	const {
		stopMicFallbackRecorder,
		stopWebcamRecorder,
		storeMicrophoneSidecar,
		finalizeRecordingSession,
		hideEditorOverlayCursorByDefault,
		preparePermissions,
		recordingSessionTimestamp,
		resetRecordingClock,
		prepareWebcamRecorder,
		hasShownNativeWindowsFallbackToast,
		logNativeCaptureDiagnostics,
		microphoneEnabled,
		microphoneDeviceId,
		pendingNativeCleanupPath,
		nativeScreenRecording,
		nativeStopRequestInFlight,
		nativeWindowsRecording,
		nativeWarmStartActive,
	} = context;
	const resolveBrowserCaptureSource = useCallback(async (source: ProcessedDesktopSource) => {
		if (!source?.id?.startsWith("screen:")) {
			return source;
		}

		// Linux/Wayland portal sentinel: do NOT call getSources here, because
		// on Wayland that triggers an additional xdg-desktop-portal dialog.
		// The sentinel is handled later by routing through getDisplayMedia,
		// which lets the portal pick the source in a single dialog.
		if (source.id === "screen:linux-portal") {
			return source;
		}

		try {
			const liveSources = await window.electronAPI.getSources({
				types: ["screen"],
				thumbnailSize: { width: 1, height: 1 },
				fetchWindowIcons: false,
			});

			const exactMatch = liveSources.find((candidate) => candidate.id === source.id);
			if (exactMatch) {
				return {
					...source,
					id: exactMatch.id,
					name: exactMatch.name ?? source.name,
					display_id: exactMatch.display_id ?? source.display_id,
				};
			}

			const displayMatch = liveSources.find(
				(candidate) =>
					String(candidate.display_id ?? "") === String(source.display_id ?? ""),
			);
			if (displayMatch) {
				return {
					...source,
					id: displayMatch.id,
					name: displayMatch.name ?? source.name,
					display_id: displayMatch.display_id ?? source.display_id,
				};
			}
		} catch (error) {
			console.warn("Failed to resolve browser capture source:", error);
		}

		return source;
	}, []);

	const recoverNativeRecordingSession = useCallback(
		async (
			micFallbackBlobPromise?: Promise<Blob | null> | null,
			startDelayMs?: number | null,
		) => {
			if (typeof window.electronAPI?.recoverNativeScreenRecording !== "function") {
				return null;
			}

			const result = await window.electronAPI.recoverNativeScreenRecording();
			if (!result.success || !result.path) {
				return null;
			}

			const resolvedMicFallbackBlobPromise =
				micFallbackBlobPromise ?? stopMicFallbackRecorder();
			const webcamPath = await stopWebcamRecorder();
			await storeMicrophoneSidecar(resolvedMicFallbackBlobPromise, result.path, startDelayMs);
			await finalizeRecordingSession(result.path, webcamPath);

			if (typeof window.electronAPI?.hudOverlayClose === "function") {
				window.electronAPI.hudOverlayClose();
			}

			return result.path;
		},
		[
			finalizeRecordingSession,
			stopMicFallbackRecorder,
			stopWebcamRecorder,
			storeMicrophoneSidecar,
		],
	);

	const prepareRecordingStart = useCallback(async () => {
		// Retry a failed discard before a new take can overwrite its cleanup path.
		if (pendingNativeCleanupPath.current) {
			await deleteNativeCaptureFile(pendingNativeCleanupPath.current, (path) =>
				window.electronAPI.deleteRecordingFile(path),
			);
			pendingNativeCleanupPath.current = null;
		}
		const platform = await window.electronAPI.getPlatform();
		hideEditorOverlayCursorByDefault.current = false;
		const selectedSource = await window.electronAPI.getSelectedSource();
		if (!selectedSource) {
			alert(translate("notifications.selectSource", "Please select a source to record"));
			return null;
		}

		const permissionsReady = await preparePermissions();
		if (!permissionsReady) {
			return null;
		}

		recordingSessionTimestamp.current = Date.now();
		resetRecordingClock(recordingSessionTimestamp.current);
		await prepareWebcamRecorder();

		const useNativeMacScreenCapture =
			platform === "darwin" &&
			(selectedSource.id?.startsWith("screen:") ||
				selectedSource.id?.startsWith("window:") ||
				selectedSource.id?.startsWith("area:")) &&
			typeof window.electronAPI.startNativeScreenRecording === "function";

		let useNativeWindowsCapture = false;
		if (
			platform === "win32" &&
			shouldUseNativeWindowsCaptureForSource(selectedSource) &&
			typeof window.electronAPI.isNativeWindowsCaptureAvailable === "function"
		) {
			try {
				const nativeWindowsResult =
					await window.electronAPI.isNativeWindowsCaptureAvailable();
				useNativeWindowsCapture = nativeWindowsResult.available;
				if (!useNativeWindowsCapture && !hasShownNativeWindowsFallbackToast.current) {
					void logNativeCaptureDiagnostics("is-native-windows-capture-available");
					hasShownNativeWindowsFallbackToast.current = true;
					toast.info(
						translate(
							"notifications.windowsUnavailable",
							"Native Windows capture is unavailable. Falling back to browser capture.",
						),
					);
				}
			} catch {
				useNativeWindowsCapture = false;
				if (!hasShownNativeWindowsFallbackToast.current) {
					hasShownNativeWindowsFallbackToast.current = true;
					toast.info(
						translate(
							"notifications.windowsCheckFailed",
							"Unable to check native Windows capture. Falling back to browser capture.",
						),
					);
				}
			}
		}

		let micLabel: string | undefined;
		if ((useNativeMacScreenCapture || useNativeWindowsCapture) && microphoneEnabled) {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				const mic = devices.find(
					(d) => d.deviceId === microphoneDeviceId && d.kind === "audioinput",
				);
				micLabel = mic?.label || undefined;
			} catch {
				// Fall through - native process will use the default mic.
			}
		}

		return {
			platform,
			selectedSource,
			useNativeMacScreenCapture,
			useNativeWindowsCapture,
			micLabel,
		};
	}, [
		logNativeCaptureDiagnostics,
		microphoneDeviceId,
		microphoneEnabled,
		preparePermissions,
		prepareWebcamRecorder,
		pendingNativeCleanupPath,
		resetRecordingClock,
		hideEditorOverlayCursorByDefault,
		recordingSessionTimestamp,
		hasShownNativeWindowsFallbackToast,
	]);

	const discardActiveNativeCapture = useCallback(async () => {
		const pendingPath = pendingNativeCleanupPath.current;
		if (pendingPath) {
			try {
				await deleteNativeCaptureFile(pendingPath, (path) =>
					window.electronAPI.deleteRecordingFile(path),
				);
				pendingNativeCleanupPath.current = null;
			} catch (error) {
				console.warn("Failed to delete pending native capture file:", error);
			}
		}

		if (!nativeScreenRecording.current) {
			return pendingNativeCleanupPath.current === null;
		}
		if (nativeStopRequestInFlight.current) {
			return false;
		}

		nativeStopRequestInFlight.current = true;
		let result: DiscardNativeCaptureResult;
		try {
			result = await stopAndDiscardNativeCapture({
				stopNativeScreenRecording: () => window.electronAPI.stopNativeScreenRecording(),
				deleteRecordingFile: (path) => window.electronAPI.deleteRecordingFile(path),
			});
		} finally {
			nativeStopRequestInFlight.current = false;
		}

		if (result.stopSucceeded) {
			nativeScreenRecording.current = false;
			nativeWindowsRecording.current = false;
			nativeWarmStartActive.current = false;
		}

		if (!result.deleteSucceeded && result.path) {
			pendingNativeCleanupPath.current = result.path;
		}

		if (!result.stopSucceeded || !result.deleteSucceeded) {
			console.warn("Failed to fully discard native capture:", result.error);
			return false;
		}

		return true;
	}, [
		pendingNativeCleanupPath,
		nativeScreenRecording,
		nativeStopRequestInFlight,
		nativeWindowsRecording,
		nativeWarmStartActive,
	]);

	return {
		resolveBrowserCaptureSource,
		recoverNativeRecordingSession,
		prepareRecordingStart,
		discardActiveNativeCapture,
	};
}
