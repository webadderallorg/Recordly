import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type ScreenRecorderRefs,
	type UseScreenRecorderReturn,
} from "./shared";
import {
	cleanupCapturedMedia as cleanupCapturedMediaImpl,
	getRecordingDurationMs as getRecordingDurationMsImpl,
	markRecordingPaused as markRecordingPausedImpl,
	markRecordingResumed as markRecordingResumedImpl,
	preparePermissions,
	resetRecordingClock as resetRecordingClockImpl,
	resolveBrowserCaptureSource,
	selectMimeType,
} from "./recordingCore";
import {
	cancelRecordingSession,
	pauseRecordingSession,
	resumeRecordingSession,
	startBrowserRecording,
	stopRecordingSession,
} from "./recordingControls";
import {
	handleSuccessfulNativeStart,
	resolveNativeCaptureMode,
	startNativeRecording,
} from "./nativeRecording";
import {
	finalizeRecordingSession as finalizeRecordingSessionImpl,
	prepareWebcamRecorder as prepareWebcamRecorderImpl,
	recoverNativeRecordingSession as recoverNativeRecordingSessionImpl,
	stopWebcamRecorder,
	storeMicrophoneSidecar,
} from "./webcamRecording";
import { useScreenRecorderLifecycle } from "./lifecycle";

export function useScreenRecorder(): UseScreenRecorderReturn {
	const [recording, setRecording] = useState(false);
	const [paused, setPaused] = useState(false);
	const [starting, setStarting] = useState(false);
	const [countdownActive, setCountdownActive] = useState(false);
	const [isMacOS, setIsMacOS] = useState(false);
	const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
	const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | undefined>(undefined);
	const [systemAudioEnabled, setSystemAudioEnabled] = useState(false);
	const [webcamEnabled, setWebcamEnabled] = useState(false);
	const [webcamDeviceId, setWebcamDeviceId] = useState<string | undefined>(undefined);
	const [countdownDelay, setCountdownDelayState] = useState(3);

	const refs: ScreenRecorderRefs = {
		mediaRecorder: useRef<MediaRecorder | null>(null),
		webcamRecorder: useRef<MediaRecorder | null>(null),
		stream: useRef<MediaStream | null>(null),
		screenStream: useRef<MediaStream | null>(null),
		microphoneStream: useRef<MediaStream | null>(null),
		webcamStream: useRef<MediaStream | null>(null),
		mixingContext: useRef<AudioContext | null>(null),
		chunks: useRef<Blob[]>([]),
		webcamChunks: useRef<Blob[]>([]),
		startTime: useRef<number>(0),
		webcamStartTime: useRef<number | null>(null),
		webcamTimeOffsetMs: useRef(0),
		recordingSessionTimestamp: useRef<number | null>(null),
		nativeScreenRecording: useRef(false),
		nativeWindowsRecording: useRef(false),
		startInFlight: useRef(false),
		hasPromptedForReselect: useRef(false),
		hasShownNativeWindowsFallbackToast: useRef(false),
		countdownDelayLoaded: useRef(false),
		recordingPrefsLoaded: useRef(false),
		pendingWebcamPathPromise: useRef<Promise<string | null> | null>(null),
		webcamStopPromise: useRef<Promise<string | null> | null>(null),
		webcamStopResolver: useRef<((path: string | null) => void) | null>(null),
		resolvedWebcamPath: useRef<string | null>(null),
		accumulatedPausedDurationMs: useRef(0),
		pauseStartedAtMs: useRef<number | null>(null),
		pauseSegmentsRef: useRef([]),
		recordingFinalizationToastId: useRef<string | number | null>(null),
		micFallbackRecorder: useRef<MediaRecorder | null>(null),
		micFallbackChunks: useRef<Blob[]>([]),
	};

	const showRecordingFinalizationToast = useCallback((message = "Preparing recording...") => {
		refs.recordingFinalizationToastId.current = toast.loading(message, {
			id: refs.recordingFinalizationToastId.current ?? undefined,
			duration: Number.POSITIVE_INFINITY,
		});
	}, [refs.recordingFinalizationToastId]);

	const clearRecordingFinalizationToast = useCallback(() => {
		const toastId = refs.recordingFinalizationToastId.current;
		if (toastId === null) {
			return;
		}

		toast.dismiss(toastId);
		refs.recordingFinalizationToastId.current = null;
	}, [refs.recordingFinalizationToastId]);

	const notifyRecordingFinalizationFailure = useCallback(
		async (message: string) => {
			clearRecordingFinalizationToast();
			toast.error(message, { duration: 10000 });
		},
		[clearRecordingFinalizationToast],
	);

	const logNativeCaptureDiagnostics = useCallback(async (context: string) => {
		if (typeof window.electronAPI?.getLastNativeCaptureDiagnostics !== "function") {
			return;
		}

		try {
			const result = await window.electronAPI.getLastNativeCaptureDiagnostics();
			if (result.success && result.diagnostics) {
				console.warn(`[NativeCaptureDiagnostics:${context}]`, result.diagnostics);
			}
		} catch (error) {
			console.warn("Failed to load native capture diagnostics:", error);
		}
	}, []);

	const buildNativeCaptureFailureMessage = useCallback(
		async (context: string, fallbackMessage: string) => {
			if (typeof window.electronAPI?.getLastNativeCaptureDiagnostics !== "function") {
				return fallbackMessage;
			}

			try {
				const result = await window.electronAPI.getLastNativeCaptureDiagnostics();
				const diagnostics = result.success ? (result.diagnostics ?? null) : null;
				if (!diagnostics) {
					return fallbackMessage;
				}

				console.warn(`[NativeCaptureDiagnostics:${context}]`, diagnostics);

				const details: string[] = [];
				if (diagnostics.error) {
					details.push(diagnostics.error);
				}
				if (diagnostics.outputPath) {
					details.push(`Saved file: ${diagnostics.outputPath}`);
				}

				return details.length > 0
					? `${fallbackMessage} ${details.join(". ")}`
					: fallbackMessage;
			} catch (error) {
				console.warn("Failed to load native capture diagnostics:", error);
				return fallbackMessage;
			}
		},
		[],
	);

	const resetRecordingClock = useCallback(
		(startedAt: number) => resetRecordingClockImpl(refs, startedAt),
		[refs],
	);
	const markRecordingPaused = useCallback(
		(pausedAt: number) => markRecordingPausedImpl(refs, pausedAt),
		[refs],
	);
	const markRecordingResumed = useCallback(
		(resumedAt: number) => markRecordingResumedImpl(refs, resumedAt),
		[refs],
	);
	const getRecordingDurationMs = useCallback(
		(endedAt: number) => getRecordingDurationMsImpl(refs, endedAt),
		[refs],
	);
	const cleanupCapturedMedia = useCallback(() => cleanupCapturedMediaImpl(refs), [refs]);

	const finalizeRecordingSession = useCallback(
		(videoPath: string, webcamPath: string | null) =>
			finalizeRecordingSessionImpl({
				videoPath,
				webcamPath,
				webcamTimeOffsetMs: refs.webcamTimeOffsetMs.current,
				clearRecordingFinalizationToast,
			}),
		[clearRecordingFinalizationToast, refs.webcamTimeOffsetMs],
	);

	const prepareWebcamRecorder = useCallback(
		() =>
			prepareWebcamRecorderImpl({
				refs,
				webcamEnabled,
				webcamDeviceId,
				getRecordingDurationMs,
				selectMimeType,
			}),
		[refs, webcamEnabled, webcamDeviceId, getRecordingDurationMs],
	);

	const recoverNativeRecordingSession = useCallback(
		(micFallbackBlobPromise?: Promise<Blob | null> | null) =>
			recoverNativeRecordingSessionImpl({
				refs,
				micFallbackBlobPromise,
				clearRecordingFinalizationToast,
			}),
		[clearRecordingFinalizationToast, refs],
	);

	const stopRecording = useRef(() => undefined);

	const setCountdownDelay = useCallback((delay: number) => {
		setCountdownDelayState(delay);
		void window.electronAPI.setCountdownDelay(delay);
	}, []);

	const persistMicrophoneEnabled = useCallback((enabled: boolean) => {
		setMicrophoneEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ microphoneEnabled: enabled });
	}, []);

	const persistMicrophoneDeviceId = useCallback((deviceId: string | undefined) => {
		setMicrophoneDeviceId(deviceId);
		void window.electronAPI.setRecordingPreferences({ microphoneDeviceId: deviceId });
	}, []);

	const persistSystemAudioEnabled = useCallback((enabled: boolean) => {
		setSystemAudioEnabled(enabled);
		void window.electronAPI.setRecordingPreferences({ systemAudioEnabled: enabled });
	}, []);


	useScreenRecorderLifecycle({
		refs,
		stopRecordingRef: stopRecording,
		cleanupCapturedMedia,
		recoverNativeRecordingSession: () => recoverNativeRecordingSession(),
		setRecording,
		setIsMacOS,
		setCountdownDelayState,
		setMicrophoneEnabled,
		setMicrophoneDeviceId,
		setSystemAudioEnabled,
	});

	const startRecording = useCallback(async () => {
		if (refs.startInFlight.current) {
			return;
		}

		refs.hasPromptedForReselect.current = false;
		refs.startInFlight.current = true;
		setStarting(true);

		try {
			const selectedSource = await window.electronAPI.getSelectedSource();
			if (!selectedSource) {
				alert("Please select a source to record");
				return;
			}

			const permissionsReady = await preparePermissions();
			if (!permissionsReady) {
				return;
			}

			refs.recordingSessionTimestamp.current = Date.now();
			resetRecordingClock(refs.recordingSessionTimestamp.current);
			await prepareWebcamRecorder();

			const { useNativeMacScreenCapture, useNativeWindowsCapture } =
				await resolveNativeCaptureMode({
					selectedSource,
					logNativeCaptureDiagnostics,
					hasShownNativeWindowsFallbackToast: refs.hasShownNativeWindowsFallbackToast,
				});

			if (useNativeMacScreenCapture || useNativeWindowsCapture) {
				const nativeResult = await startNativeRecording({
					selectedSource,
					microphoneEnabled,
					microphoneDeviceId,
					systemAudioEnabled,
				});

				if (!nativeResult.success) {
					if (useNativeWindowsCapture) {
						console.warn(
							"Native Windows capture failed, falling back to browser capture:",
							nativeResult.error ?? nativeResult.message,
						);
						await logNativeCaptureDiagnostics("start-native-screen-recording");
						if (!refs.hasShownNativeWindowsFallbackToast.current) {
							refs.hasShownNativeWindowsFallbackToast.current = true;
							toast.warning(
								"Native Windows capture failed to start. Falling back to browser capture.",
							);
						}
					} else if (!nativeResult.userNotified) {
						throw new Error(
							nativeResult.error ?? nativeResult.message ?? "Failed to start native screen recording",
						);
					} else {
						setRecording(false);
						await cleanupCapturedMedia();
						await stopWebcamRecorder(refs);
						return;
					}
				}

				if (nativeResult.success) {
					await handleSuccessfulNativeStart({
						refs,
						useNativeWindowsCapture,
						microphoneEnabled,
						microphoneDeviceId,
						nativeResult,
						setRecording,
						resetRecordingClock,
					});
					return;
				}
			}

			await startBrowserRecording({
				refs,
				selectedSource,
				microphoneEnabled,
				microphoneDeviceId,
				systemAudioEnabled,
				resolveBrowserCaptureSource,
				prepareWebcamRecorder,
				getRecordingDurationMs,
				resetRecordingClock,
				setRecording,
				setMicrophoneEnabled,
				cleanupCapturedMedia,
				showRecordingFinalizationToast,
				notifyRecordingFinalizationFailure,
				clearRecordingFinalizationToast,
			});
		} catch (error) {
			console.error("Failed to start recording:", error);
			alert(
				error instanceof Error
					? `Failed to start recording: ${error.message}`
					: "Failed to start recording",
			);
			setRecording(false);
			await cleanupCapturedMedia();
			await stopWebcamRecorder(refs);
		} finally {
			refs.startInFlight.current = false;
			setStarting(false);
		}
	}, [
		cleanupCapturedMedia,
		clearRecordingFinalizationToast,
		getRecordingDurationMs,
		isMacOS,
		logNativeCaptureDiagnostics,
		microphoneDeviceId,
		microphoneEnabled,
		notifyRecordingFinalizationFailure,
		prepareWebcamRecorder,
		refs,
		resetRecordingClock,
		systemAudioEnabled,
	]);

	const pauseRecording = useCallback(() => {
		void pauseRecordingSession({
			refs,
			recording,
			paused,
			markRecordingPaused,
			setPaused,
		});
	}, [markRecordingPaused, paused, recording, refs]);

	const resumeRecording = useCallback(() => {
		void resumeRecordingSession({
			refs,
			recording,
			paused,
			markRecordingResumed,
			setPaused,
		});
	}, [markRecordingResumed, paused, recording, refs]);

	const cancelRecording = useCallback(() => {
		void cancelRecordingSession({
			refs,
			recording,
			setPaused,
			setRecording,
			markRecordingResumed,
			cleanupCapturedMedia,
		});
	}, [cleanupCapturedMedia, markRecordingResumed, recording, refs]);

	stopRecording.current = () => {
		void stopRecordingSession({
			refs,
			setPaused,
			setRecording,
			isMacOS,
			markRecordingResumed,
			showRecordingFinalizationToast,
			logNativeCaptureDiagnostics,
			recoverNativeRecordingSession,
			buildNativeCaptureFailureMessage,
			notifyRecordingFinalizationFailure,
			storeMicrophoneSidecar,
			finalizeRecordingSession,
			cleanupCapturedMedia,
		});
	};

	const toggleRecording = useCallback(async () => {
		if (starting || countdownActive) {
			return;
		}

		if (recording) {
			stopRecording.current();
			return;
		}

		if (countdownDelay > 0) {
			setCountdownActive(true);
			try {
				const result = await window.electronAPI.startCountdown(countdownDelay);
				if (!result.success || result.cancelled) {
					return;
				}
			} finally {
				setCountdownActive(false);
			}
		}

		void startRecording();
	}, [countdownActive, countdownDelay, recording, startRecording, starting]);

	return {
		recording,
		paused,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		preparePermissions,
		isMacOS,
		microphoneEnabled,
		setMicrophoneEnabled: persistMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId: persistMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled: persistSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
	};
}