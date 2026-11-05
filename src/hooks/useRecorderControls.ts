import { useCallback, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { RecorderControlContext } from "./recorderContext";
import { getErrorMessage } from "./recordingError";

function reportRecordingControlFailure(action: "pause" | "resume", error: unknown) {
	toast.error(
		action === "pause"
			? translate("notifications.pauseRecordingFailed", "Could not pause the recording")
			: translate("notifications.resumeRecordingFailed", "Could not resume the recording"),
		{
			id: `recording-${action}-error`,
			description: `${translate(
				"notifications.recordingControlFailedDescription",
				"Try again, or stop the recording to keep what you’ve captured.",
			)}\n\n${getErrorMessage(error)}`,
		},
	);
}

/** A sidecar failure must not undo the state acknowledged by the screen recorder. */
function updateCaptureTracks(action: "pause" | "resume", updates: (() => void)[]) {
	const failures: unknown[] = [];
	for (const update of updates) {
		try {
			update();
		} catch (error) {
			console.error(`Failed to ${action} a recording track:`, error);
			failures.push(error);
		}
	}
	if (failures.length) {
		toast.error(
			action === "pause"
				? translate(
						"notifications.pauseRecordingTrackFailed",
						"The screen recording paused, but a camera or audio track could not pause.",
					)
				: translate(
						"notifications.resumeRecordingTrackFailed",
						"The screen recording resumed, but a camera or audio track could not resume.",
					),
			{
				id: `recording-${action}-error`,
				description: failures.map(getErrorMessage).join("\n\n"),
			},
		);
	}
}

export function useRecorderControls(
	context: Pick<
		RecorderControlContext,
		| "recordingActive"
		| "pendingStart"
		| "recordingStartGeneration"
		| "nativeScreenRecording"
		| "pendingNativeCleanupPath"
		| "recording"
		| "paused"
		| "webcamRecorder"
		| "pauseMicFallbackRecorder"
		| "markRecordingPaused"
		| "setPaused"
		| "mediaRecorder"
		| "resumeMicFallbackRecorder"
		| "markRecordingResumed"
		| "webcamWriter"
		| "screenWriter"
		| "webcamStartTime"
		| "webcamTimeOffsetMs"
		| "webcamStream"
		| "pendingWebcamPathPromise"
		| "resolvedWebcamPath"
		| "discardActiveNativeCapture"
		| "stopMicFallbackRecorder"
		| "cleanupCapturedMedia"
		| "setRecording"
		| "restartInFlight"
		| "starting"
		| "countdownActive"
		| "finalizing"
		| "setRestarting"
		| "startRecording"
		| "stopRecording"
	>,
) {
	const {
		recordingActive,
		pendingStart,
		recordingStartGeneration,
		nativeScreenRecording,
		pendingNativeCleanupPath,
		recording,
		paused,
		webcamRecorder,
		pauseMicFallbackRecorder,
		markRecordingPaused,
		setPaused,
		mediaRecorder,
		resumeMicFallbackRecorder,
		markRecordingResumed,
		webcamWriter,
		screenWriter,
		webcamStartTime,
		webcamTimeOffsetMs,
		webcamStream,
		pendingWebcamPathPromise,
		resolvedWebcamPath,
		discardActiveNativeCapture,
		stopMicFallbackRecorder,
		cleanupCapturedMedia,
		setRecording,
		restartInFlight,
		starting,
		countdownActive,
		finalizing,
		setRestarting,
		startRecording,
		stopRecording,
	} = context;
	const nativeControlRequest = useRef<{ generation: number } | null>(null);
	const runNativeControl = useCallback(
		(action: "pause" | "resume", onSuccess: () => void) => {
			if (!recordingActive.current || !nativeScreenRecording.current) return;
			const generation = recordingStartGeneration.current;
			if (nativeControlRequest.current?.generation === generation) return;
			const request = { generation };
			nativeControlRequest.current = request;
			const isCurrentCapture = () =>
				recordingActive.current &&
				nativeScreenRecording.current &&
				recordingStartGeneration.current === generation &&
				nativeControlRequest.current === request;
			void (async () => {
				try {
					let result;
					try {
						result = await (action === "pause"
							? window.electronAPI.pauseNativeScreenRecording()
							: window.electronAPI.resumeNativeScreenRecording());
					} catch (error) {
						if (!isCurrentCapture()) return;
						console.error(`Failed to ${action} native screen recording:`, error);
						reportRecordingControlFailure(action, error);
						return;
					}
					// Stop/cancel and a new take invalidate both late state updates and errors.
					if (!isCurrentCapture()) return;
					if (!result.success) {
						console.error(
							`Failed to ${action} native screen recording:`,
							result.error ?? result.message,
						);
						reportRecordingControlFailure(action, result.error ?? result.message);
						return;
					}
					toast.dismiss(`recording-${action}-error`);
					onSuccess();
				} finally {
					// An older response must not unlock an operation belonging to a new take.
					if (nativeControlRequest.current === request)
						nativeControlRequest.current = null;
				}
			})();
		},
		[recordingActive, recordingStartGeneration, nativeScreenRecording],
	);
	const cancelRecordingStart = useCallback(async () => {
		if (recordingActive.current) return false;
		const pending = pendingStart.current;
		if (!pending) return true;
		recordingStartGeneration.current += 1;
		await window.electronAPI.cancelCountdown();
		// Wait for native warm-up, webcam and microphone cleanup before picking again.
		await pending;
		if (nativeScreenRecording.current || pendingNativeCleanupPath.current)
			throw new Error("Could not stop the pending capture. Try again.");
		return true;
	}, [
		recordingActive,
		pendingStart,
		recordingStartGeneration,
		nativeScreenRecording,
		pendingNativeCleanupPath,
	]);

	const pauseRecording = useCallback(() => {
		if (!recording || paused) return;
		if (nativeScreenRecording.current) {
			runNativeControl("pause", () => {
				const boundaryMs = Date.now();
				markRecordingPaused(boundaryMs);
				setPaused(true);
				updateCaptureTracks("pause", [
					() => {
						if (webcamRecorder.current?.state === "recording")
							webcamRecorder.current.pause();
					},
					pauseMicFallbackRecorder,
				]);
				void window.electronAPI.pauseCursorCapture(boundaryMs).catch((error) => {
					console.warn("Failed to pause cursor capture:", error);
				});
			});
			return;
		}
		if (mediaRecorder.current?.state === "recording") {
			mediaRecorder.current.pause();
			if (webcamRecorder.current?.state === "recording") {
				webcamRecorder.current.pause();
			}
			void (async () => {
				const boundaryMs = Date.now();
				markRecordingPaused(boundaryMs);
				setPaused(true);
				try {
					await window.electronAPI.pauseCursorCapture(boundaryMs);
				} catch (error) {
					console.warn("Failed to pause cursor capture:", error);
				}
			})();
		}
	}, [
		runNativeControl,
		markRecordingPaused,
		pauseMicFallbackRecorder,
		paused,
		recording,
		nativeScreenRecording,
		webcamRecorder,
		setPaused,
		mediaRecorder,
	]);

	const resumeRecording = useCallback(() => {
		if (!recording || !paused) return;
		if (nativeScreenRecording.current) {
			runNativeControl("resume", () => {
				const boundaryMs = Date.now();
				markRecordingResumed(boundaryMs);
				setPaused(false);
				updateCaptureTracks("resume", [
					() => {
						if (webcamRecorder.current?.state === "paused")
							webcamRecorder.current.resume();
					},
					resumeMicFallbackRecorder,
				]);
				void window.electronAPI.resumeCursorCapture(boundaryMs).catch((error) => {
					console.warn("Failed to resume cursor capture:", error);
				});
			});
			return;
		}
		if (mediaRecorder.current?.state === "paused") {
			mediaRecorder.current.resume();
			if (webcamRecorder.current?.state === "paused") {
				webcamRecorder.current.resume();
			}
			void (async () => {
				const boundaryMs = Date.now();
				markRecordingResumed(boundaryMs);
				setPaused(false);
				try {
					await window.electronAPI.resumeCursorCapture(boundaryMs);
				} catch (error) {
					console.warn("Failed to resume cursor capture:", error);
				}
			})();
		}
	}, [
		runNativeControl,
		markRecordingResumed,
		paused,
		recording,
		resumeMicFallbackRecorder,
		nativeScreenRecording,
		webcamRecorder,
		setPaused,
		mediaRecorder,
	]);

	const cancelRecording = useCallback(async () => {
		recordingStartGeneration.current += 1;
		if (!recordingActive.current) return false;

		try {
			// Discard webcam recording regardless of recording mode
			webcamWriter.current?.cancel();
			screenWriter.current?.cancel();
			const discardResults = await Promise.allSettled([
				webcamWriter.current?.discard(),
				screenWriter.current?.discard(),
			]);
			const discardFailure = discardResults.find(
				(result): result is PromiseRejectedResult => result.status === "rejected",
			);
			webcamWriter.current = null;
			screenWriter.current = null;

			if (webcamRecorder.current && webcamRecorder.current.state !== "inactive") {
				webcamRecorder.current.ondataavailable = null;
				webcamRecorder.current.onstop = null;
				webcamRecorder.current.onerror = null;
				webcamRecorder.current.stop();
			}
			webcamRecorder.current = null;
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			webcamStream.current?.getTracks().forEach((t) => t.stop());
			webcamStream.current = null;
			pendingWebcamPathPromise.current = null;
			resolvedWebcamPath.current = null;

			let discarded = true;
			if (nativeScreenRecording.current) {
				const results = await Promise.all([
					discardActiveNativeCapture(),
					stopMicFallbackRecorder(),
				]);
				discarded = results[0];
				if (nativeScreenRecording.current)
					throw new Error("The current capture could not be stopped.");
			} else if (mediaRecorder.current) {
				const recorder = mediaRecorder.current;
				recorder.ondataavailable = null;
				recorder.onstop = null;
				recorder.onerror = null;
				if (recorder.state !== "inactive") {
					await new Promise<void>((resolve) => {
						recorder.addEventListener("stop", () => resolve(), { once: true });
						recorder.stop();
					});
				}
				mediaRecorder.current = null;
			}
			cleanupCapturedMedia();
			setPaused(false);
			markRecordingResumed(Date.now());
			setRecording(false);
			await window.electronAPI?.setRecordingState(false);
			if (discardFailure) throw discardFailure.reason;
			if (!discarded)
				toast.error(
					translate(
						"notifications.discardIncomplete",
						"The recording could not be fully discarded. Try again before starting another take.",
					),
				);
			return discarded;
		} catch (error) {
			if (!nativeScreenRecording.current) {
				cleanupCapturedMedia();
				mediaRecorder.current = null;
				setPaused(false);
				markRecordingResumed(Date.now());
				setRecording(false);
				await window.electronAPI?.setRecordingState?.(false).catch(() => undefined);
			}
			toast.error(
				translate(
					"notifications.discardRecordingFailed",
					"Could not discard the recording",
				),
				{
					description: error instanceof Error ? error.message : String(error),
				},
			);
			return false;
		}
	}, [
		cleanupCapturedMedia,
		discardActiveNativeCapture,
		markRecordingResumed,
		setRecording,
		stopMicFallbackRecorder,
		recordingStartGeneration,
		recordingActive,
		webcamWriter,
		screenWriter,
		webcamRecorder,
		webcamStartTime,
		webcamTimeOffsetMs,
		webcamStream,
		pendingWebcamPathPromise,
		resolvedWebcamPath,
		nativeScreenRecording,
		mediaRecorder,
		setPaused,
	]);

	const restartRecording = async () => {
		if (
			restartInFlight.current ||
			starting ||
			countdownActive ||
			finalizing ||
			!recordingActive.current
		)
			return false;
		restartInFlight.current = true;
		setRestarting(true);
		try {
			if (!(await cancelRecording())) return false;
			await startRecording();
			return recordingActive.current;
		} catch (error) {
			toast.error(
				translate(
					"notifications.restartRecordingFailed",
					"Could not restart the recording",
				),
				{
					description: error instanceof Error ? error.message : String(error),
				},
			);
			return false;
		} finally {
			restartInFlight.current = false;
			setRestarting(false);
		}
	};

	const toggleRecording = async () => {
		if (restartInFlight.current || starting || countdownActive || finalizing) {
			return;
		}

		if (recording) {
			stopRecording.current();
			return;
		}

		startRecording();
	};

	return {
		cancelRecordingStart,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		restartRecording,
		toggleRecording,
	};
}
