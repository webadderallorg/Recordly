import { useCallback, useRef, useState } from "react";
import { AUDIO_BITRATE_VOICE, RECORDER_TIMESLICE_MS } from "./recorderCaptureOptions";
import { RecordingFileWriter } from "./recordingFileWriter";
import { createRecordingMicrophoneFallback } from "./recordingMicrophoneFallback";
import { selectRecordingMimeType } from "./recordingMimeType";
import type { useRecorderPreferences } from "./useRecorderPreferences";

type RecorderPreferences = ReturnType<typeof useRecorderPreferences>;

export function useRecorderState(
	context: Pick<
		RecorderPreferences,
		"browserMicrophoneProfile" | "requestedBrowserMicrophoneProfile"
	>,
) {
	const { browserMicrophoneProfile, requestedBrowserMicrophoneProfile } = context;
	const [recording, setRecordingValue] = useState(false);

	const recordingActive = useRef(false);

	const setRecording = useCallback((value: boolean) => {
		recordingActive.current = value;
		setRecordingValue(value);
	}, []);

	const [paused, setPaused] = useState(false);

	const [starting, setStarting] = useState(false);

	const [finalizing, setFinalizing] = useState(false);

	const browserFinalizing = useRef(false);

	const [restarting, setRestarting] = useState(false);

	const restartInFlight = useRef(false);

	const [countdownActive, setCountdownActive] = useState(false);

	const mediaRecorder = useRef<MediaRecorder | null>(null);

	const stream = useRef<MediaStream | null>(null);

	const screenStream = useRef<MediaStream | null>(null);

	const microphoneStream = useRef<MediaStream | null>(null);

	const mixingContext = useRef<AudioContext | null>(null);

	const screenWriter = useRef<RecordingFileWriter | null>(null);

	const recordingSessionTimestamp = useRef<number | null>(null);

	const nativeScreenRecording = useRef(false);

	const nativeWindowsRecording = useRef(false);

	const nativeWarmStartActive = useRef(false);

	const pendingNativeCleanupPath = useRef<string | null>(null);

	const recordingStartGeneration = useRef(0);

	const nativeStopRequestInFlight = useRef(false);

	const startInFlight = useRef(false);

	const pendingStart = useRef<Promise<void> | null>(null);

	const hasPromptedForReselect = useRef(false);

	const hasShownNativeWindowsFallbackToast = useRef(false);

	const [microphoneFallback] = useState(() =>
		createRecordingMicrophoneFallback({
			audioBitsPerSecond: AUDIO_BITRATE_VOICE,
			timesliceMs: RECORDER_TIMESLICE_MS,
			getBrowserMicrophoneProfile: () => browserMicrophoneProfile.current,
			getRequestedBrowserMicrophoneProfile: () => requestedBrowserMicrophoneProfile.current,
		}),
	);

	const {
		stop: stopMicFallbackRecorder,
		pause: pauseMicFallbackRecorder,
		resume: resumeMicFallbackRecorder,
		cleanup: cleanupMicFallbackRecorder,
		storeSidecar: storeMicrophoneSidecar,
	} = microphoneFallback;

	const hideEditorOverlayCursorByDefault = useRef(false);

	const selectMimeType = useCallback(() => {
		return selectRecordingMimeType();
	}, []);

	return {
		recording,
		recordingActive,
		setRecording,
		paused,
		setPaused,
		starting,
		setStarting,
		finalizing,
		setFinalizing,
		browserFinalizing,
		restarting,
		setRestarting,
		restartInFlight,
		countdownActive,
		setCountdownActive,
		mediaRecorder,
		stream,
		screenStream,
		microphoneStream,
		mixingContext,
		screenWriter,
		recordingSessionTimestamp,
		nativeScreenRecording,
		nativeWindowsRecording,
		nativeWarmStartActive,
		pendingNativeCleanupPath,
		recordingStartGeneration,
		nativeStopRequestInFlight,
		startInFlight,
		pendingStart,
		hasPromptedForReselect,
		hasShownNativeWindowsFallbackToast,
		microphoneFallback,
		stopMicFallbackRecorder,
		pauseMicFallbackRecorder,
		resumeMicFallbackRecorder,
		cleanupMicFallbackRecorder,
		storeMicrophoneSidecar,
		hideEditorOverlayCursorByDefault,
		selectMimeType,
	};
}
