import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { getErrorMessage } from "./recordingError";
import {
	type BrowserMicrophoneProfile,
	createAudioInputDeviceSnapshot,
	createMicrophoneTrackSettingsSnapshot,
	createProcessedMicrophoneConstraints,
	type MicrophoneAudioInputDeviceSnapshot,
	type MicrophoneFallbackChunkEvent,
	type MicrophoneFallbackPauseInterval,
	type MicrophoneFallbackRecorderMetadata,
	type MicrophoneSidecarOptions,
	type MicrophoneTrackSettingsSnapshot,
} from "./recordingMicrophoneCapture";

const MICROPHONE_FALLBACK_ERROR_TOAST_ID = "recording-microphone-fallback-error";
const MICROPHONE_SIDECAR_ERROR_TOAST_ID = "recording-microphone-sidecar-error";

export {
	type BrowserMicrophoneProfile,
	createProcessedMicrophoneConstraints,
	DEFAULT_BROWSER_MICROPHONE_PROFILE,
	normalizeBrowserMicrophoneProfile,
} from "./recordingMicrophoneCapture";

/** Owns browser microphone sidecar capture and its timing diagnostics for one recorder. */
export function createRecordingMicrophoneFallback({
	audioBitsPerSecond,
	timesliceMs,
	getBrowserMicrophoneProfile,
	getRequestedBrowserMicrophoneProfile,
}: {
	audioBitsPerSecond: number;
	timesliceMs: number;
	getBrowserMicrophoneProfile: () => BrowserMicrophoneProfile;
	getRequestedBrowserMicrophoneProfile: () => string | null;
}) {
	let micFallbackRecorder: MediaRecorder | null = null;
	let micFallbackChunks: Blob[] = [];
	let micFallbackStartDelayMs: number | null = null;
	let micFallbackTrackSettings: MicrophoneTrackSettingsSnapshot | null = null;
	let micFallbackRequestedConstraints: MediaStreamConstraints | null = null;
	let micFallbackAudioInputDevices: MicrophoneAudioInputDeviceSnapshot[] | null = null;
	let micFallbackRecorderMetadata: MicrophoneFallbackRecorderMetadata | null = null;
	let micFallbackChunkEvents: MicrophoneFallbackChunkEvent[] = [];
	let micFallbackRecorderStartedAt: number | null = null;
	let micFallbackPauseStartedAt: number | null = null;
	let micFallbackPausedDurationMs = 0;
	let micFallbackPauseIntervals: MicrophoneFallbackPauseInterval[] = [];

	const getMicFallbackRecordedElapsedMs = (now = performance.now()) => {
		const startedAt = micFallbackRecorderStartedAt;
		if (startedAt === null) {
			return 0;
		}

		const currentPauseDurationMs =
			micFallbackPauseStartedAt === null ? 0 : Math.max(0, now - micFallbackPauseStartedAt);
		return Math.max(
			0,
			Math.round(now - startedAt - micFallbackPausedDurationMs - currentPauseDurationMs),
		);
	};

	const resetMicFallbackTimingDiagnostics = () => {
		micFallbackChunkEvents = [];
		micFallbackRecorderStartedAt = null;
		micFallbackPauseStartedAt = null;
		micFallbackPausedDurationMs = 0;
		micFallbackPauseIntervals = [];
	};

	const appendMicFallbackChunk = (event: BlobEvent) => {
		if (event.data.size <= 0) {
			return;
		}

		micFallbackChunks.push(event.data);
		const startedAt = micFallbackRecorderStartedAt;
		if (startedAt === null) {
			return;
		}

		const now = performance.now();
		const elapsedMs = Math.max(0, Math.round(now - startedAt));
		const recordedElapsedMs = getMicFallbackRecordedElapsedMs(now);
		const previous = micFallbackChunkEvents[micFallbackChunkEvents.length - 1];
		micFallbackChunkEvents.push({
			index: micFallbackChunkEvents.length,
			size: event.data.size,
			elapsedMs,
			deltaMs: previous ? Math.max(0, elapsedMs - previous.elapsedMs) : null,
			recordedElapsedMs,
			recordedDeltaMs: previous
				? Math.max(0, recordedElapsedMs - previous.recordedElapsedMs)
				: null,
		});
	};

	const closeMicFallbackPauseInterval = (now = performance.now()) => {
		const pauseStartedAt = micFallbackPauseStartedAt;
		if (pauseStartedAt === null) {
			return;
		}

		const durationMs = Math.max(0, Math.round(now - pauseStartedAt));
		micFallbackPausedDurationMs += durationMs;
		const startedAt = micFallbackRecorderStartedAt ?? now;
		const lastInterval = micFallbackPauseIntervals[micFallbackPauseIntervals.length - 1];
		if (lastInterval && lastInterval.endElapsedMs === undefined) {
			lastInterval.endElapsedMs = Math.max(
				lastInterval.startElapsedMs,
				Math.round(now - startedAt),
			);
			lastInterval.durationMs = durationMs;
		}
		micFallbackPauseStartedAt = null;
	};

	const stopMicFallbackRecorder = (): Promise<Blob | null> => {
		return new Promise((resolve) => {
			const recorder = micFallbackRecorder;
			if (!recorder || recorder.state === "inactive") {
				micFallbackRecorder = null;
				resolve(null);
				return;
			}
			closeMicFallbackPauseInterval();
			recorder.ondataavailable = appendMicFallbackChunk;
			recorder.onstop = () => {
				const blob =
					micFallbackChunks.length > 0
						? new Blob(micFallbackChunks, { type: recorder.mimeType })
						: null;
				micFallbackChunks = [];
				recorder.stream.getTracks().forEach((track) => track.stop());
				micFallbackRecorder = null;
				micFallbackRecorderStartedAt = null;
				resolve(blob);
			};
			recorder.stop();
		});
	};

	const pauseMicFallbackRecorder = () => {
		const recorder = micFallbackRecorder;
		if (recorder?.state !== "recording") {
			return;
		}

		try {
			recorder.requestData();
		} catch (error) {
			console.warn("Failed to flush microphone fallback chunk before pause:", error);
		}

		recorder.pause();
		const now = performance.now();
		const startedAt = micFallbackRecorderStartedAt ?? now;
		micFallbackPauseStartedAt = now;
		micFallbackPauseIntervals.push({
			startElapsedMs: Math.max(0, Math.round(now - startedAt)),
		});
	};

	const resumeMicFallbackRecorder = () => {
		const recorder = micFallbackRecorder;
		if (recorder?.state !== "paused") {
			return;
		}

		closeMicFallbackPauseInterval();
		recorder.resume();
	};

	const storeMicrophoneSidecar = async (
		micFallbackBlobPromise: Promise<Blob | null> | null | undefined,
		finalPath: string,
		startDelayMs?: number | null,
		mediaTrackSettings?: MicrophoneTrackSettingsSnapshot | null,
	) => {
		const micFallbackBlob = await micFallbackBlobPromise;
		if (!micFallbackBlob) {
			micFallbackStartDelayMs = null;
			micFallbackTrackSettings = null;
			micFallbackRequestedConstraints = null;
			micFallbackAudioInputDevices = null;
			micFallbackRecorderMetadata = null;
			resetMicFallbackTimingDiagnostics();
			return;
		}

		try {
			const arrayBuffer = await micFallbackBlob.arrayBuffer();
			const effectiveStartDelayMs = startDelayMs ?? micFallbackStartDelayMs;
			const effectiveTrackSettings = mediaTrackSettings ?? micFallbackTrackSettings;
			const sidecarOptions: MicrophoneSidecarOptions = {
				...(Number.isFinite(effectiveStartDelayMs) && (effectiveStartDelayMs ?? 0) >= 0
					? { startDelayMs: effectiveStartDelayMs ?? 0 }
					: {}),
				browserMicrophoneProfile: getBrowserMicrophoneProfile(),
				...(getRequestedBrowserMicrophoneProfile()
					? {
							requestedBrowserMicrophoneProfile:
								getRequestedBrowserMicrophoneProfile(),
						}
					: {}),
				...(micFallbackRequestedConstraints
					? { requestedConstraints: micFallbackRequestedConstraints }
					: {}),
				...(effectiveTrackSettings ? { mediaTrackSettings: effectiveTrackSettings } : {}),
				...(micFallbackAudioInputDevices
					? { audioInputDevices: micFallbackAudioInputDevices }
					: {}),
				...(micFallbackRecorderMetadata
					? { mediaRecorder: micFallbackRecorderMetadata }
					: {}),
				...(micFallbackChunkEvents.length > 0
					? { chunkEvents: [...micFallbackChunkEvents] }
					: {}),
				...(micFallbackPauseIntervals.length > 0
					? {
							pauseIntervals: micFallbackPauseIntervals.map((interval) => ({
								...interval,
							})),
						}
					: {}),
			};
			const result = await window.electronAPI.storeMicrophoneSidecar(
				arrayBuffer,
				finalPath,
				sidecarOptions,
			);
			if (!result.success) {
				const errorMessage =
					result.error || "Failed to save the fallback microphone audio track";
				console.warn("Failed to store microphone sidecar:", errorMessage);
				toast.error(
					translate(
						"notifications.microphoneTrackMissing",
						"{{error}}. Recording was saved without the fallback microphone track.",
						{ error: errorMessage },
					),
					{ id: MICROPHONE_SIDECAR_ERROR_TOAST_ID, duration: 10000 },
				);
			}
		} catch (error) {
			console.warn("Failed to store microphone sidecar:", error);
			toast.error(
				translate(
					"notifications.microphoneTrackMissing",
					"{{error}}. Recording was saved without the fallback microphone track.",
					{ error: getErrorMessage(error) },
				),
				{ id: MICROPHONE_SIDECAR_ERROR_TOAST_ID, duration: 10000 },
			);
		} finally {
			micFallbackStartDelayMs = null;
			micFallbackTrackSettings = null;
			micFallbackRequestedConstraints = null;
			micFallbackAudioInputDevices = null;
			micFallbackRecorderMetadata = null;
			resetMicFallbackTimingDiagnostics();
		}
	};

	const cleanup = () => {
		if (micFallbackRecorder) {
			try {
				if (micFallbackRecorder.state !== "inactive") {
					micFallbackRecorder.stop();
				}
				micFallbackRecorder.stream?.getTracks().forEach((track) => track.stop());
			} catch {
				/* ignore */
			}
			micFallbackRecorder = null;
			micFallbackChunks = [];
			micFallbackTrackSettings = null;
			micFallbackRequestedConstraints = null;
			micFallbackAudioInputDevices = null;
			micFallbackRecorderMetadata = null;
			resetMicFallbackTimingDiagnostics();
		}
	};

	const start = async ({
		microphoneDeviceId,
		mainStartedAt,
		startWasCancelled,
	}: {
		microphoneDeviceId?: string;
		mainStartedAt: number;
		startWasCancelled: () => boolean;
	}): Promise<boolean> => {
		let unownedMicStream: MediaStream | null = null;
		try {
			const microphoneConstraints = createProcessedMicrophoneConstraints(
				microphoneDeviceId,
				getBrowserMicrophoneProfile(),
			);
			micFallbackRequestedConstraints = microphoneConstraints;
			const micStream = await navigator.mediaDevices.getUserMedia(microphoneConstraints);
			unownedMicStream = micStream;
			micFallbackTrackSettings = createMicrophoneTrackSettingsSnapshot(micStream);
			micFallbackAudioInputDevices = await createAudioInputDeviceSnapshot().catch(() => null);
			console.info("Browser microphone track settings:", micFallbackTrackSettings);
			console.info("Browser microphone audio input devices:", micFallbackAudioInputDevices);
			micFallbackChunks = [];
			const recorder = new MediaRecorder(micStream, {
				mimeType: "audio/webm;codecs=opus",
				audioBitsPerSecond,
			});
			micFallbackRecorderMetadata = {
				mimeType: recorder.mimeType,
				audioBitsPerSecond,
				timesliceMs,
			};
			resetMicFallbackTimingDiagnostics();
			micFallbackRecorderStartedAt = performance.now();
			recorder.ondataavailable = appendMicFallbackChunk;
			micFallbackStartDelayMs = Math.max(0, Date.now() - mainStartedAt);
			if (startWasCancelled()) return false;
			recorder.start(timesliceMs);
			micFallbackRecorder = recorder;
			unownedMicStream = null;
		} catch (micError) {
			micFallbackStartDelayMs = null;
			micFallbackTrackSettings = null;
			micFallbackRequestedConstraints = null;
			micFallbackAudioInputDevices = null;
			micFallbackRecorderMetadata = null;
			resetMicFallbackTimingDiagnostics();
			console.warn("Browser microphone fallback failed:", micError);
			const permissionDenied =
				micError instanceof DOMException &&
				(micError.name === "NotAllowedError" || micError.name === "SecurityError");
			toast.error(
				permissionDenied
					? translate(
							"notifications.microphoneDenied",
							"Microphone permission denied. Recording will continue without microphone audio.",
						)
					: translate(
							"notifications.microphoneAudioMissing",
							"{{error}}. Recording will continue without microphone audio.",
							{ error: getErrorMessage(micError) },
						),
				{ id: MICROPHONE_FALLBACK_ERROR_TOAST_ID, duration: 10000 },
			);
		} finally {
			// Until the recorder owns it, cancellation or setup failure must release the mic.
			unownedMicStream?.getTracks().forEach((track) => track.stop());
		}
		return true;
	};

	return {
		get startDelayMs() {
			return micFallbackStartDelayMs;
		},
		get trackSettings() {
			return micFallbackTrackSettings;
		},
		resetStartDelay: () => {
			micFallbackStartDelayMs = null;
		},
		start,
		stop: stopMicFallbackRecorder,
		pause: pauseMicFallbackRecorder,
		resume: resumeMicFallbackRecorder,
		cleanup,
		storeSidecar: storeMicrophoneSidecar,
	};
}
