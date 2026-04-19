import { fixWebmDuration } from "@fix-webm-duration/fix";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getEffectiveRecordingDurationMs } from "@/lib/mediaTiming";
import { selectRecordingMimeType } from "./recordingMimeType";

const TARGET_FRAME_RATE = 60;
const TARGET_WIDTH = 3840;
const TARGET_HEIGHT = 2160;
const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
const QHD_WIDTH = 2560;
const QHD_HEIGHT = 1440;
const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;
const BITRATE_4K = 45_000_000;
const BITRATE_QHD = 28_000_000;
const BITRATE_BASE = 18_000_000;
const HIGH_FRAME_RATE_THRESHOLD = 60;
const HIGH_FRAME_RATE_BOOST = 1.7;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const CODEC_ALIGNMENT = 2;
const RECORDER_TIMESLICE_MS = 250;
const BITS_PER_MEGABIT = 1_000_000;
const MIN_FRAME_RATE = 30;
const CHROME_MEDIA_SOURCE = "desktop";
const RECORDING_FILE_PREFIX = "recording-";
const VIDEO_FILE_EXTENSION = ".webm";
const AUDIO_BITRATE_VOICE = 128_000;
const AUDIO_BITRATE_SYSTEM = 192_000;
const MIC_GAIN_BOOST = 1.4;
const WEBCAM_BITRATE = 8_000_000;
const WEBCAM_WIDTH = 1280;
const WEBCAM_HEIGHT = 720;
const WEBCAM_FRAME_RATE = 30;
const WEBCAM_SUFFIX = "-webcam";
const LINUX_PORTAL_SOURCE: ProcessedDesktopSource = {
	id: "screen:linux-portal",
	name: "Linux Portal",
	display_id: "",
	thumbnail: null,
	appIcon: null,
	sourceType: "screen",
};

type PauseSegment = {
	startMs: number;
	endMs: number;
};

type DesktopCaptureMediaDevices = {
	getUserMedia: (constraints: unknown) => Promise<MediaStream>;
	getDisplayMedia: (constraints: unknown) => Promise<MediaStream>;
};

type UseScreenRecorderReturn = {
	recording: boolean;
	paused: boolean;
	countdownActive: boolean;
	toggleRecording: () => void;
	pauseRecording: () => void;
	resumeRecording: () => void;
	cancelRecording: () => void;
	preparePermissions: (options?: { startup?: boolean }) => Promise<boolean>;
	isMacOS: boolean;
	microphoneEnabled: boolean;
	setMicrophoneEnabled: (enabled: boolean) => void;
	microphoneDeviceId: string | undefined;
	setMicrophoneDeviceId: (deviceId: string | undefined) => void;
	systemAudioEnabled: boolean;
	setSystemAudioEnabled: (enabled: boolean) => void;
	webcamEnabled: boolean;
	setWebcamEnabled: (enabled: boolean) => void;
	webcamDeviceId: string | undefined;
	setWebcamDeviceId: (deviceId: string | undefined) => void;
	countdownDelay: number;
	setCountdownDelay: (delay: number) => void;
};

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
	const mediaRecorder = useRef<MediaRecorder | null>(null);
	const webcamRecorder = useRef<MediaRecorder | null>(null);
	const stream = useRef<MediaStream | null>(null);
	const screenStream = useRef<MediaStream | null>(null);
	const microphoneStream = useRef<MediaStream | null>(null);
	const webcamStream = useRef<MediaStream | null>(null);
	const mixingContext = useRef<AudioContext | null>(null);
	const chunks = useRef<Blob[]>([]);
	const webcamChunks = useRef<Blob[]>([]);
	const startTime = useRef<number>(0);
	const webcamStartTime = useRef<number | null>(null);
	const webcamTimeOffsetMs = useRef(0);
	const recordingSessionTimestamp = useRef<number | null>(null);
	const nativeScreenRecording = useRef(false);
	const nativeWindowsRecording = useRef(false);
	const startInFlight = useRef(false);
	const hasPromptedForReselect = useRef(false);
	const hasShownNativeWindowsFallbackToast = useRef(false);
	const countdownDelayLoaded = useRef(false);
	const recordingPrefsLoaded = useRef(false);
	const pendingWebcamPathPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopPromise = useRef<Promise<string | null> | null>(null);
	const webcamStopResolver = useRef<((path: string | null) => void) | null>(null);
	const resolvedWebcamPath = useRef<string | null>(null);
	const accumulatedPausedDurationMs = useRef(0);
	const pauseStartedAtMs = useRef<number | null>(null);
	const pauseSegmentsRef = useRef<PauseSegment[]>([]);
	const recordingFinalizationToastId = useRef<string | number | null>(null);
	const micFallbackRecorder = useRef<MediaRecorder | null>(null);
	const micFallbackChunks = useRef<Blob[]>([]);

	const showRecordingFinalizationToast = useCallback((message = "Preparing recording...") => {
		recordingFinalizationToastId.current = toast.loading(message, {
			id: recordingFinalizationToastId.current ?? undefined,
			duration: Number.POSITIVE_INFINITY,
		});
	}, []);

	const clearRecordingFinalizationToast = useCallback(() => {
		const toastId = recordingFinalizationToastId.current;
		if (toastId === null) {
			return;
		}

		toast.dismiss(toastId);
		recordingFinalizationToastId.current = null;
	}, []);

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

	const resetRecordingClock = useCallback((startedAt: number) => {
		startTime.current = startedAt;
		accumulatedPausedDurationMs.current = 0;
		pauseStartedAtMs.current = null;
		pauseSegmentsRef.current = [];
	}, []);

	const markRecordingPaused = useCallback((pausedAt: number) => {
		if (pauseStartedAtMs.current === null) {
			pauseStartedAtMs.current = pausedAt;
		}
	}, []);

	const markRecordingResumed = useCallback((resumedAt: number) => {
		if (pauseStartedAtMs.current === null) {
			return;
		}

		const pauseStart = pauseStartedAtMs.current;
		const pauseDurationMs = Math.max(0, resumedAt - pauseStart);
		accumulatedPausedDurationMs.current += pauseDurationMs;
		if (pauseDurationMs > 0) {
			pauseSegmentsRef.current.push({ startMs: pauseStart, endMs: resumedAt });
		}
		pauseStartedAtMs.current = null;
	}, []);

	const getRecordingDurationMs = useCallback((endedAt: number) => {
		return getEffectiveRecordingDurationMs({
			startTimeMs: startTime.current,
			endTimeMs: endedAt,
			accumulatedPausedDurationMs: accumulatedPausedDurationMs.current,
			pauseStartedAtMs: pauseStartedAtMs.current,
		});
	}, []);

	const preparePermissions = useCallback(async (options: { startup?: boolean } = {}) => {
		const platform = await window.electronAPI.getPlatform();
		if (platform !== "darwin") {
			return true;
		}

		const screenPermission = await window.electronAPI.getScreenRecordingPermissionStatus();
		if (!screenPermission.success || screenPermission.status !== "granted") {
			await window.electronAPI.openScreenRecordingPreferences();
			alert(
				options.startup
					? "Recordly needs Screen Recording permission before you start. System Settings has been opened. After enabling it, quit and reopen Recordly."
					: "Screen Recording permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Recordly before recording.",
			);
			return false;
		}

		const accessibilityPermission = await window.electronAPI.getAccessibilityPermissionStatus();
		if (!accessibilityPermission.success) {
			return false;
		}

		if (accessibilityPermission.trusted) {
			return true;
		}

		const requestedAccessibility = await window.electronAPI.requestAccessibilityPermission();
		if (requestedAccessibility.success && requestedAccessibility.trusted) {
			return true;
		}

		await window.electronAPI.openAccessibilityPreferences();
		alert(
			options.startup
				? "Recordly also needs Accessibility permission for cursor tracking. System Settings has been opened. After enabling it, quit and reopen Recordly."
				: "Accessibility permission is still missing. System Settings has been opened again. Enable it, then quit and reopen Recordly before recording.",
		);

		return false;
	}, []);

	const selectMimeType = useCallback(() => {
		return selectRecordingMimeType();
	}, []);

	const computeBitrate = (width: number, height: number) => {
		const pixels = width * height;
		const highFrameRateBoost =
			TARGET_FRAME_RATE >= HIGH_FRAME_RATE_THRESHOLD ? HIGH_FRAME_RATE_BOOST : 1;

		if (pixels >= FOUR_K_PIXELS) {
			return Math.round(BITRATE_4K * highFrameRateBoost);
		}

		if (pixels >= QHD_PIXELS) {
			return Math.round(BITRATE_QHD * highFrameRateBoost);
		}

		return Math.round(BITRATE_BASE * highFrameRateBoost);
	};

	const cleanupCapturedMedia = useCallback(() => {
		if (stream.current) {
			stream.current.getTracks().forEach((track) => track.stop());
			stream.current = null;
		}

		if (screenStream.current) {
			screenStream.current.getTracks().forEach((track) => track.stop());
			screenStream.current = null;
		}

		if (microphoneStream.current) {
			microphoneStream.current.getTracks().forEach((track) => track.stop());
			microphoneStream.current = null;
		}

		if (webcamStream.current) {
			webcamStream.current.getTracks().forEach((track) => track.stop());
			webcamStream.current = null;
		}

		if (mixingContext.current) {
			mixingContext.current.close().catch(() => undefined);
			mixingContext.current = null;
		}

		if (micFallbackRecorder.current) {
			try {
				if (micFallbackRecorder.current.state !== "inactive") {
					micFallbackRecorder.current.stop();
				}
				micFallbackRecorder.current.stream?.getTracks().forEach((track) => track.stop());
			} catch {
				/* ignore */
			}
			micFallbackRecorder.current = null;
			micFallbackChunks.current = [];
		}
	}, []);

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

	const finalizeRecordingSession = useCallback(
		async (videoPath: string, webcamPath: string | null) => {
			try {
				if (webcamPath) {
					await window.electronAPI.setCurrentRecordingSession({
						videoPath,
						webcamPath,
						timeOffsetMs: webcamTimeOffsetMs.current,
					});
				} else {
					await window.electronAPI.setCurrentVideoPath(videoPath);
				}
			} catch (error) {
				console.error("Failed to persist recording session metadata:", error);

				try {
					await window.electronAPI.setCurrentVideoPath(videoPath);
				} catch (fallbackError) {
					console.error("Failed to persist fallback video path:", fallbackError);
				}
			}

			clearRecordingFinalizationToast();
			await window.electronAPI.switchToEditor();
		},
		[clearRecordingFinalizationToast],
	);

	const stopMicFallbackRecorder = useCallback((): Promise<Blob | null> => {
		return new Promise((resolve) => {
			const recorder = micFallbackRecorder.current;
			if (!recorder || recorder.state === "inactive") {
				micFallbackRecorder.current = null;
				resolve(null);
				return;
			}
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					micFallbackChunks.current.push(event.data);
				}
			};
			recorder.onstop = () => {
				const blob =
					micFallbackChunks.current.length > 0
						? new Blob(micFallbackChunks.current, { type: recorder.mimeType })
						: null;
				micFallbackChunks.current = [];
				recorder.stream.getTracks().forEach((track) => track.stop());
				micFallbackRecorder.current = null;
				resolve(blob);
			};
			recorder.stop();
		});
	}, []);

	const storeMicrophoneSidecar = useCallback(
		async (micFallbackBlobPromise: Promise<Blob | null> | null | undefined, finalPath: string) => {
			const micFallbackBlob = await micFallbackBlobPromise;
			if (!micFallbackBlob) {
				return;
			}

			try {
				const arrayBuffer = await micFallbackBlob.arrayBuffer();
				await window.electronAPI.storeMicrophoneSidecar(arrayBuffer, finalPath);
			} catch (error) {
				console.warn("Failed to store microphone sidecar:", error);
			}
		},
		[],
	);

	const stopWebcamRecorder = useCallback(async () => {
		const recorder = webcamRecorder.current;
		const pending = webcamStopPromise.current;

		if (!recorder) {
			const result = pending ? await pending : resolvedWebcamPath.current;
			webcamStopPromise.current = null;
			pendingWebcamPathPromise.current = null;
			resolvedWebcamPath.current = result ?? null;
			return result ?? null;
		}

		if (recorder.state !== "inactive") {
			recorder.stop();
		} else if (pending && webcamStopResolver.current) {
			webcamStopResolver.current(resolvedWebcamPath.current);
			webcamStopResolver.current = null;
		}

		const result = pending ? await pending : resolvedWebcamPath.current;
		webcamStopPromise.current = null;
		pendingWebcamPathPromise.current = null;
		resolvedWebcamPath.current = result ?? null;
		return result ?? null;
	}, []);

	const recoverNativeRecordingSession = useCallback(
		async (micFallbackBlobPromise?: Promise<Blob | null> | null) => {
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
			await storeMicrophoneSidecar(resolvedMicFallbackBlobPromise, result.path);
			await finalizeRecordingSession(result.path, webcamPath);
			return result.path;
		},
		[
			finalizeRecordingSession,
			stopMicFallbackRecorder,
			stopWebcamRecorder,
			storeMicrophoneSidecar,
		],
	);

	/**
	 * Acquire the webcam stream and prepare the MediaRecorder, but do NOT start
	 * recording yet. Call {@link beginWebcamCapture} after the main recording
	 * has started so both begin at approximately the same time.
	 */
	const prepareWebcamRecorder = useCallback(async () => {
		if (!webcamEnabled) {
			resolvedWebcamPath.current = null;
			pendingWebcamPathPromise.current = Promise.resolve(null);
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			return;
		}

		try {
			webcamStream.current = await navigator.mediaDevices.getUserMedia({
				video: webcamDeviceId
					? {
							deviceId: { exact: webcamDeviceId },
							width: { ideal: WEBCAM_WIDTH },
							height: { ideal: WEBCAM_HEIGHT },
							frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
						}
					: {
							width: { ideal: WEBCAM_WIDTH },
							height: { ideal: WEBCAM_HEIGHT },
							frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
						},
				audio: false,
			});

			const mimeType = selectMimeType();
			webcamChunks.current = [];
			resolvedWebcamPath.current = null;
			webcamStopPromise.current = new Promise((resolve) => {
				webcamStopResolver.current = resolve;
			});
			pendingWebcamPathPromise.current = webcamStopPromise.current;

			const recorder = new MediaRecorder(webcamStream.current, {
				videoBitsPerSecond: WEBCAM_BITRATE,
				...(mimeType ? { mimeType } : {}),
			});

			webcamRecorder.current = recorder;
			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					webcamChunks.current.push(event.data);
				}
			};
			recorder.onerror = () => {
				webcamStopResolver.current?.(null);
				webcamStopResolver.current = null;
			};
			recorder.onstop = async () => {
				const sessionTimestamp = recordingSessionTimestamp.current ?? Date.now();
				const webcamFileName = `${RECORDING_FILE_PREFIX}${sessionTimestamp}${WEBCAM_SUFFIX}${VIDEO_FILE_EXTENSION}`;

				try {
					if (webcamChunks.current.length === 0) {
						webcamStopResolver.current?.(null);
						return;
					}

					const duration = Math.max(
						0,
						getRecordingDurationMs(Date.now()) - webcamTimeOffsetMs.current,
					);
					const webcamBlobType = recorder.mimeType || mimeType;
					const webcamBlob = new Blob(
						webcamChunks.current,
						webcamBlobType ? { type: webcamBlobType } : undefined,
					);
					webcamChunks.current = [];
					const fixedBlob = await fixWebmDuration(webcamBlob, duration);
					const arrayBuffer = await fixedBlob.arrayBuffer();
					const result = await window.electronAPI.storeRecordedVideo(
						arrayBuffer,
						webcamFileName,
					);
					webcamStopResolver.current?.(result.success ? (result.path ?? null) : null);
				} catch (error) {
					console.error("Error saving webcam recording:", error);
					webcamStopResolver.current?.(null);
				} finally {
					webcamStopResolver.current = null;
					webcamRecorder.current = null;
					webcamStartTime.current = null;
					if (webcamStream.current) {
						webcamStream.current.getTracks().forEach((track) => track.stop());
						webcamStream.current = null;
					}
				}
			};
		} catch (error) {
			console.warn(
				"Failed to start webcam recording; continuing without webcam layer:",
				error,
			);
			resolvedWebcamPath.current = null;
			pendingWebcamPathPromise.current = Promise.resolve(null);
			webcamStopPromise.current = Promise.resolve(null);
			webcamRecorder.current = null;
			webcamStartTime.current = null;
			webcamTimeOffsetMs.current = 0;
			if (webcamStream.current) {
				webcamStream.current.getTracks().forEach((track) => track.stop());
				webcamStream.current = null;
			}
		}
	}, [getRecordingDurationMs, selectMimeType, webcamDeviceId, webcamEnabled]);

	/** Start the prepared webcam MediaRecorder. Call after main recording begins. */
	const beginWebcamCapture = useCallback(() => {
		const recorder = webcamRecorder.current;
		if (recorder && recorder.state === "inactive") {
			webcamStartTime.current = Date.now();
			recorder.start(RECORDER_TIMESLICE_MS);
		}
	}, []);

	const stopRecording = useRef(() => {
		setPaused(false);
		if (nativeScreenRecording.current) {
			nativeScreenRecording.current = false;
			setRecording(false);

			void (async () => {
				showRecordingFinalizationToast();
				const micFallbackBlobPromise = stopMicFallbackRecorder();
				const webcamPath = await stopWebcamRecorder();
				const isNativeWindows = nativeWindowsRecording.current;
				markRecordingResumed(Date.now());
				const pauseSegments = pauseSegmentsRef.current.slice();
				nativeWindowsRecording.current = false;

				const result = await window.electronAPI.stopNativeScreenRecording();
				await window.electronAPI?.setRecordingState(false);

				if (!result.success || !result.path) {
					console.error(
						"Failed to stop native screen recording:",
						result.error ?? result.message,
					);
					void logNativeCaptureDiagnostics("stop-native-screen-recording");
					try {
						const recoveredPath = await recoverNativeRecordingSession(
							micFallbackBlobPromise,
						);
						if (recoveredPath) {
							return;
						}
					} catch (recoveryError) {
						console.error("Failed to recover native screen recording:", recoveryError);
					}

					const failureMessage = await buildNativeCaptureFailureMessage(
						"stop-native-screen-recording",
						isMacOS
							? "Failed to finish the macOS recording, so the editor was not opened."
							: "Failed to finish the recording, so the editor was not opened.",
					);
					await notifyRecordingFinalizationFailure(failureMessage);
					return;
				}

				let finalPath = result.path;

				if (isNativeWindows) {
					const muxResult =
						await window.electronAPI.muxNativeWindowsRecording(pauseSegments);
					if (!muxResult?.success) {
						void logNativeCaptureDiagnostics("mux-native-windows-recording");
					}
					finalPath = muxResult?.path ?? result.path;
				}

				await storeMicrophoneSidecar(micFallbackBlobPromise, finalPath);

				await finalizeRecordingSession(finalPath, webcamPath);
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
			cleanupCapturedMedia();
			recorder.stop();
			setRecording(false);
			window.electronAPI?.setRecordingState(false);
		}
	});

	useEffect(() => {
		void (async () => {
			const platform = await window.electronAPI.getPlatform();
			setIsMacOS(platform === "darwin");
		})();
	}, []);

	useEffect(() => {
		if (countdownDelayLoaded.current) return;
		countdownDelayLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getCountdownDelay();
			if (result.success && typeof result.delay === "number") {
				setCountdownDelayState(result.delay);
			}
		})();
	}, []);

	const setCountdownDelay = useCallback((delay: number) => {
		setCountdownDelayState(delay);
		void window.electronAPI.setCountdownDelay(delay);
	}, []);

	useEffect(() => {
		if (recordingPrefsLoaded.current) return;
		recordingPrefsLoaded.current = true;

		void (async () => {
			const result = await window.electronAPI.getRecordingPreferences();
			if (result.success) {
				setMicrophoneEnabled(result.microphoneEnabled);
				if (result.microphoneDeviceId) {
					setMicrophoneDeviceId(result.microphoneDeviceId);
				}
				setSystemAudioEnabled(result.systemAudioEnabled);
			}
		})();
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
					setRecording(false);
					nativeScreenRecording.current = false;
					cleanupCapturedMedia();
					await window.electronAPI.setRecordingState(false);

					if (state.reason !== "window-unavailable") {
						try {
							const recoveredPath = await recoverNativeRecordingSession();
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
			cleanup?.();
			removeRecordingStateListener?.();
			removeRecordingInterruptedListener?.();

			if (nativeScreenRecording.current) {
				nativeScreenRecording.current = false;
				void window.electronAPI.stopNativeScreenRecording();
			}

			const recorder = mediaRecorder.current;
			const recorderState = recorder?.state;
			if (recorder && (recorderState === "recording" || recorderState === "paused")) {
				recorder.stop();
			}

			cleanupCapturedMedia();
		};
	}, [cleanupCapturedMedia, recoverNativeRecordingSession]);

	const startRecording = async () => {
		if (startInFlight.current) {
			return;
		}

		hasPromptedForReselect.current = false;
		startInFlight.current = true;
		setStarting(true);

		try {
			const platform = await window.electronAPI.getPlatform();
			const existingSource = await window.electronAPI.getSelectedSource();
			const selectedSource =
				existingSource ?? (platform === "linux" ? LINUX_PORTAL_SOURCE : null);
			if (!selectedSource) {
				alert("Please select a source to record");
				return;
			}
			// Persist the synthetic Linux portal sentinel to main so that the
			// setDisplayMediaRequestHandler can short-circuit getSources() and
			// avoid triggering an extra portal dialog.
			if (!existingSource && selectedSource.id === "screen:linux-portal") {
				try {
					await window.electronAPI.selectSource(selectedSource);
				} catch (err) {
					console.warn("Failed to persist Linux portal sentinel source:", err);
				}
			}

			const permissionsReady = await preparePermissions();
			if (!permissionsReady) {
				return;
			}

			recordingSessionTimestamp.current = Date.now();
			resetRecordingClock(recordingSessionTimestamp.current);
			await prepareWebcamRecorder();
			const useNativeMacScreenCapture =
				platform === "darwin" &&
				(selectedSource.id?.startsWith("screen:") ||
					selectedSource.id?.startsWith("window:")) &&
				typeof window.electronAPI.startNativeScreenRecording === "function";

			let useNativeWindowsCapture = false;
			if (
				platform === "win32" &&
				(selectedSource.id?.startsWith("screen:") ||
					selectedSource.id?.startsWith("window:")) &&
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
							"Native Windows capture is unavailable. Falling back to browser capture.",
						);
					}
				} catch {
					useNativeWindowsCapture = false;
					if (!hasShownNativeWindowsFallbackToast.current) {
						hasShownNativeWindowsFallbackToast.current = true;
						toast.info(
							"Unable to check native Windows capture. Falling back to browser capture.",
						);
					}
				}
			}

			if (useNativeMacScreenCapture || useNativeWindowsCapture) {
				// Resolve the selected mic label for native capture backends.
				let micLabel: string | undefined;
				if (microphoneEnabled) {
					try {
						const devices = await navigator.mediaDevices.enumerateDevices();
						const mic = devices.find(
							(d) => d.deviceId === microphoneDeviceId && d.kind === "audioinput",
						);
						micLabel = mic?.label || undefined;
					} catch {
						// Fall through — native process will use the default mic
					}
				}

				const nativeResult = await window.electronAPI.startNativeScreenRecording(
					selectedSource,
					{
						capturesSystemAudio: systemAudioEnabled,
						capturesMicrophone: microphoneEnabled,
						microphoneDeviceId,
						microphoneLabel: micLabel,
					},
				);
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
								"Native Windows capture failed to start. Falling back to browser capture.",
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
						return;
					}
				}

				if (nativeResult.success) {
					const mainStartedAt = Date.now();
					beginWebcamCapture();
					nativeScreenRecording.current = true;
					nativeWindowsRecording.current = useNativeWindowsCapture;
					resetRecordingClock(mainStartedAt);
					webcamTimeOffsetMs.current =
						webcamStartTime.current === null
							? 0
							: webcamStartTime.current - mainStartedAt;

					// When native mic capture is unavailable (macOS < 14), record mic
					// via browser getUserMedia so it can be saved as a sidecar file.
					if (nativeResult.microphoneFallbackRequired && microphoneEnabled) {
						try {
							const micStream = await navigator.mediaDevices.getUserMedia({
								audio: microphoneDeviceId
									? {
											deviceId: { exact: microphoneDeviceId },
											echoCancellation: true,
											noiseSuppression: true,
											autoGainControl: true,
										}
									: {
											echoCancellation: true,
											noiseSuppression: true,
											autoGainControl: true,
										},
								video: false,
							});
							micFallbackChunks.current = [];
							const recorder = new MediaRecorder(micStream, {
								mimeType: "audio/webm;codecs=opus",
							});
							recorder.ondataavailable = (event) => {
								if (event.data.size > 0) {
									micFallbackChunks.current.push(event.data);
								}
							};
							recorder.start(RECORDER_TIMESLICE_MS);
							micFallbackRecorder.current = recorder;
						} catch (micError) {
							console.warn("Browser microphone fallback failed:", micError);
						}
					}

					setRecording(true);
					window.electronAPI?.setRecordingState(true);

					return;
				}
			}

			const wantsAudioCapture = microphoneEnabled || systemAudioEnabled;
			const browserCaptureSource = await resolveBrowserCaptureSource(selectedSource);

			if (
				browserCaptureSource?.id?.startsWith("screen:fallback:") ||
				browserCaptureSource?.id?.startsWith("window:fallback:")
			) {
				throw new Error(
					"Selected display is not available for browser capture on this system.",
				);
			}

			try {
				await window.electronAPI.hideOsCursor?.();
			} catch {
				console.warn("Could not hide OS cursor before recording.");
			}

			let videoTrack: MediaStreamTrack | undefined;
			let systemAudioIncluded = false;
			const mediaDevices = navigator.mediaDevices as DesktopCaptureMediaDevices;
			const browserScreenVideoConstraints = {
				mandatory: {
					chromeMediaSource: CHROME_MEDIA_SOURCE,
					chromeMediaSourceId: browserCaptureSource.id,
					maxWidth: TARGET_WIDTH,
					maxHeight: TARGET_HEIGHT,
					maxFrameRate: TARGET_FRAME_RATE,
					minFrameRate: MIN_FRAME_RATE,
					googCaptureCursor: false,
				},
				cursor: "never" as const,
			};

			if (wantsAudioCapture) {
				let screenMediaStream: MediaStream;
				const useLinuxPortal = selectedSource.id === "screen:linux-portal";
				const acquireLinuxPortalStream = (withAudio: boolean) =>
					mediaDevices.getDisplayMedia({
						audio: withAudio,
						video: {
							displaySurface: "monitor",
							width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
							height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
							frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
							cursor: "never",
						},
						selfBrowserSurface: "exclude",
						surfaceSwitching: "exclude",
					});

				if (systemAudioEnabled) {
					try {
						screenMediaStream = useLinuxPortal
							? await acquireLinuxPortalStream(true)
							: await mediaDevices.getUserMedia({
									audio: {
										mandatory: {
											chromeMediaSource: CHROME_MEDIA_SOURCE,
											chromeMediaSourceId: browserCaptureSource.id,
										},
									},
									video: browserScreenVideoConstraints,
								});
					} catch (audioError) {
						console.warn(
							"System audio capture failed, falling back to video-only:",
							audioError,
						);
						alert(
							"System audio is not available for this source. Recording will continue without system audio.",
						);
						screenMediaStream = useLinuxPortal
							? await acquireLinuxPortalStream(false)
							: await mediaDevices.getUserMedia({
									audio: false,
									video: browserScreenVideoConstraints,
								});
					}
				} else {
					screenMediaStream = useLinuxPortal
						? await acquireLinuxPortalStream(false)
						: await mediaDevices.getUserMedia({
								audio: false,
								video: browserScreenVideoConstraints,
							});
				}

				screenStream.current = screenMediaStream;
				stream.current = new MediaStream();

				videoTrack = screenMediaStream.getVideoTracks()[0];
				if (!videoTrack) {
					throw new Error("Video track is not available.");
				}

				stream.current.addTrack(videoTrack);

				if (microphoneEnabled) {
					try {
						microphoneStream.current = await navigator.mediaDevices.getUserMedia({
							audio: microphoneDeviceId
								? {
										deviceId: { exact: microphoneDeviceId },
										echoCancellation: true,
										noiseSuppression: true,
										autoGainControl: true,
									}
								: {
										echoCancellation: true,
										noiseSuppression: true,
										autoGainControl: true,
									},
							video: false,
						});
					} catch (audioError) {
						console.warn("Failed to get microphone access:", audioError);
						alert(
							"Microphone access was denied. Recording will continue without microphone audio.",
						);
						setMicrophoneEnabled(false);
					}
				}

				const systemAudioTrack = screenMediaStream.getAudioTracks()[0];
				const micAudioTrack = microphoneStream.current?.getAudioTracks()[0];

				if (systemAudioTrack && micAudioTrack) {
					const context = new AudioContext({ sampleRate: 48000 });
					mixingContext.current = context;
					const systemSource = context.createMediaStreamSource(
						new MediaStream([systemAudioTrack]),
					);
					const micSource = context.createMediaStreamSource(
						new MediaStream([micAudioTrack]),
					);
					const micGain = context.createGain();
					micGain.gain.value = MIC_GAIN_BOOST;
					const destination = context.createMediaStreamDestination();

					systemSource.connect(destination);
					micSource.connect(micGain).connect(destination);

					const mixedTrack = destination.stream.getAudioTracks()[0];
					if (mixedTrack) {
						stream.current.addTrack(mixedTrack);
						systemAudioIncluded = true;
					}
				} else if (systemAudioTrack) {
					stream.current.addTrack(systemAudioTrack);
					systemAudioIncluded = true;
				} else if (micAudioTrack) {
					stream.current.addTrack(micAudioTrack);
				}
			} else {
				const mediaStream = await mediaDevices.getDisplayMedia({
					audio: false,
					video: {
						displaySurface: selectedSource.id?.startsWith("window:")
							? "window"
							: "monitor",
						width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
						height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
						frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
						cursor: "never",
					},
					selfBrowserSurface: "exclude",
					surfaceSwitching: "exclude",
				});

				stream.current = mediaStream;
				videoTrack = mediaStream.getVideoTracks()[0];
			}

			if (!stream.current || !videoTrack) {
				throw new Error("Media stream is not available.");
			}

			try {
				await videoTrack.applyConstraints({
					frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
					width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
					height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
				} as MediaTrackConstraints);
			} catch (error) {
				console.warn(
					"Unable to lock 4K/60fps constraints, using best available track settings.",
					error,
				);
			}

			let {
				width = DEFAULT_WIDTH,
				height = DEFAULT_HEIGHT,
				frameRate = TARGET_FRAME_RATE,
			} = videoTrack.getSettings();

			width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
			height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;

			const videoBitsPerSecond = computeBitrate(width, height);
			const mimeType = selectMimeType();

			console.log(
				`Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType ?? "browser default"} / ${Math.round(
					videoBitsPerSecond / BITS_PER_MEGABIT,
				)} Mbps`,
			);

			chunks.current = [];
			const hasAudio = stream.current.getAudioTracks().length > 0;
			const recorder = new MediaRecorder(stream.current, {
				videoBitsPerSecond,
				...(mimeType ? { mimeType } : {}),
				...(hasAudio
					? {
							audioBitsPerSecond: systemAudioIncluded
								? AUDIO_BITRATE_SYSTEM
								: AUDIO_BITRATE_VOICE,
						}
					: {}),
			});

			mediaRecorder.current = recorder;
			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) chunks.current.push(event.data);
			};
			recorder.onstop = async () => {
				cleanupCapturedMedia();
				if (chunks.current.length === 0) return;

				showRecordingFinalizationToast();

				const duration = getRecordingDurationMs(Date.now());
				const recordedChunks = chunks.current;
				const recordingBlobType = recorder.mimeType || mimeType;
				const buggyBlob = new Blob(
					recordedChunks,
					recordingBlobType ? { type: recordingBlobType } : undefined,
				);
				chunks.current = [];
				const timestamp = recordingSessionTimestamp.current ?? Date.now();
				const videoFileName = `${RECORDING_FILE_PREFIX}${timestamp}${VIDEO_FILE_EXTENSION}`;

				try {
					const videoBlob = await fixWebmDuration(buggyBlob, duration);
					const arrayBuffer = await videoBlob.arrayBuffer();
					const videoResult = await window.electronAPI.storeRecordedVideo(
						arrayBuffer,
						videoFileName,
					);
					if (!videoResult.success) {
						console.error("Failed to store video:", videoResult.message);
						await notifyRecordingFinalizationFailure(
							videoResult.message || "Failed to store the recording.",
						);
						return;
					}

					if (videoResult.path) {
						const webcamPath = pendingWebcamPathPromise.current
							? await pendingWebcamPathPromise.current
							: resolvedWebcamPath.current;
						await finalizeRecordingSession(videoResult.path, webcamPath);
					} else {
						await notifyRecordingFinalizationFailure("Failed to save the recording.");
					}
				} catch (error) {
					console.error("Error saving recording:", error);
					const message = error instanceof Error ? error.message : String(error);
					await notifyRecordingFinalizationFailure(
						`Failed to finalize the recording. ${message}`,
					);
				}
			};
			recorder.onerror = () => {
				setRecording(false);
			};
			const mainStartedAt = Date.now();
			beginWebcamCapture();
			resetRecordingClock(mainStartedAt);
			webcamTimeOffsetMs.current =
				webcamStartTime.current === null ? 0 : webcamStartTime.current - mainStartedAt;
			recorder.start(RECORDER_TIMESLICE_MS);
			setRecording(true);
			window.electronAPI?.setRecordingState(true);
		} catch (error) {
			console.error("Failed to start recording:", error);
			alert(
				error instanceof Error
					? `Failed to start recording: ${error.message}`
					: "Failed to start recording",
			);
			setRecording(false);
			cleanupCapturedMedia();
			await stopWebcamRecorder();
		} finally {
			startInFlight.current = false;
			setStarting(false);
		}
	};

	const pauseRecording = useCallback(() => {
		if (!recording || paused) return;
		if (nativeScreenRecording.current) {
			void (async () => {
				const result = await window.electronAPI.pauseNativeScreenRecording();
				if (!result.success) {
					console.error(
						"Failed to pause native screen recording:",
						result.error ?? result.message,
					);
					return;
				}

				if (webcamRecorder.current?.state === "recording") {
					webcamRecorder.current.pause();
				}
				markRecordingPaused(Date.now());
				setPaused(true);
			})();
			return;
		}
		if (mediaRecorder.current?.state === "recording") {
			mediaRecorder.current.pause();
			if (webcamRecorder.current?.state === "recording") {
				webcamRecorder.current.pause();
			}
			markRecordingPaused(Date.now());
			setPaused(true);
		}
	}, [markRecordingPaused, paused, recording]);

	const resumeRecording = useCallback(() => {
		if (!recording || !paused) return;
		if (nativeScreenRecording.current) {
			void (async () => {
				const result = await window.electronAPI.resumeNativeScreenRecording();
				if (!result.success) {
					console.error(
						"Failed to resume native screen recording:",
						result.error ?? result.message,
					);
					return;
				}

				if (webcamRecorder.current?.state === "paused") {
					webcamRecorder.current.resume();
				}
				markRecordingResumed(Date.now());
				setPaused(false);
			})();
			return;
		}
		if (mediaRecorder.current?.state === "paused") {
			mediaRecorder.current.resume();
			if (webcamRecorder.current?.state === "paused") {
				webcamRecorder.current.resume();
			}
			markRecordingResumed(Date.now());
			setPaused(false);
		}
	}, [markRecordingResumed, paused, recording]);

	const cancelRecording = useCallback(() => {
		if (!recording) return;
		setPaused(false);
		markRecordingResumed(Date.now());

		// Discard webcam recording regardless of recording mode
		webcamChunks.current = [];
		if (webcamRecorder.current && webcamRecorder.current.state !== "inactive") {
			webcamRecorder.current.stop();
		}
		webcamRecorder.current = null;
		webcamStartTime.current = null;
		webcamTimeOffsetMs.current = 0;
		webcamStream.current?.getTracks().forEach((t) => t.stop());
		webcamStream.current = null;
		pendingWebcamPathPromise.current = null;
		resolvedWebcamPath.current = null;

		if (nativeScreenRecording.current) {
			nativeScreenRecording.current = false;
			nativeWindowsRecording.current = false;
			setRecording(false);
			window.electronAPI?.setRecordingState(false);
			void (async () => {
				try {
					const result = await window.electronAPI.stopNativeScreenRecording();
					if (result?.path) {
						await window.electronAPI.deleteRecordingFile(result.path);
					}
				} catch {
					// Best-effort cleanup
				}
			})();
			return;
		}

		if (mediaRecorder.current) {
			chunks.current = [];
			cleanupCapturedMedia();
			if (mediaRecorder.current.state !== "inactive") {
				mediaRecorder.current.stop();
			}
			setRecording(false);
			window.electronAPI?.setRecordingState(false);
		}
	}, [cleanupCapturedMedia, markRecordingResumed, recording]);

	const toggleRecording = async () => {
		if (starting || countdownActive) {
			return;
		}

		if (recording) {
			stopRecording.current();
			return;
		}

		// Start recording with optional countdown
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

		startRecording();
	};

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
