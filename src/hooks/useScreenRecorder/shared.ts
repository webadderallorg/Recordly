import type { Dispatch, MutableRefObject, SetStateAction } from "react";

export const TARGET_FRAME_RATE = 60;
export const TARGET_WIDTH = 3840;
export const TARGET_HEIGHT = 2160;
export const FOUR_K_PIXELS = TARGET_WIDTH * TARGET_HEIGHT;
export const QHD_WIDTH = 2560;
export const QHD_HEIGHT = 1440;
export const QHD_PIXELS = QHD_WIDTH * QHD_HEIGHT;
export const BITRATE_4K = 45_000_000;
export const BITRATE_QHD = 28_000_000;
export const BITRATE_BASE = 18_000_000;
export const HIGH_FRAME_RATE_THRESHOLD = 60;
export const HIGH_FRAME_RATE_BOOST = 1.7;
export const DEFAULT_WIDTH = 1920;
export const DEFAULT_HEIGHT = 1080;
export const CODEC_ALIGNMENT = 2;
export const RECORDER_TIMESLICE_MS = 250;
export const BITS_PER_MEGABIT = 1_000_000;
export const MIN_FRAME_RATE = 30;
export const CHROME_MEDIA_SOURCE = "desktop";
export const RECORDING_FILE_PREFIX = "recording-";
export const VIDEO_FILE_EXTENSION = ".webm";
export const AUDIO_BITRATE_VOICE = 128_000;
export const AUDIO_BITRATE_SYSTEM = 192_000;
export const MIC_GAIN_BOOST = 1.4;
export const WEBCAM_BITRATE = 8_000_000;
export const WEBCAM_WIDTH = 1280;
export const WEBCAM_HEIGHT = 720;
export const WEBCAM_FRAME_RATE = 30;
export const WEBCAM_SUFFIX = "-webcam";

export type PauseSegment = {
	startMs: number;
	endMs: number;
};

export type DesktopCaptureMediaDevices = {
	getUserMedia: (constraints: unknown) => Promise<MediaStream>;
	getDisplayMedia: (constraints: unknown) => Promise<MediaStream>;
};

export type UseScreenRecorderReturn = {
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

export type ScreenRecorderRefs = {
	mediaRecorder: MutableRefObject<MediaRecorder | null>;
	webcamRecorder: MutableRefObject<MediaRecorder | null>;
	stream: MutableRefObject<MediaStream | null>;
	screenStream: MutableRefObject<MediaStream | null>;
	microphoneStream: MutableRefObject<MediaStream | null>;
	webcamStream: MutableRefObject<MediaStream | null>;
	mixingContext: MutableRefObject<AudioContext | null>;
	chunks: MutableRefObject<Blob[]>;
	webcamChunks: MutableRefObject<Blob[]>;
	startTime: MutableRefObject<number>;
	webcamStartTime: MutableRefObject<number | null>;
	webcamTimeOffsetMs: MutableRefObject<number>;
	recordingSessionTimestamp: MutableRefObject<number | null>;
	nativeScreenRecording: MutableRefObject<boolean>;
	nativeWindowsRecording: MutableRefObject<boolean>;
	startInFlight: MutableRefObject<boolean>;
	hasPromptedForReselect: MutableRefObject<boolean>;
	hasShownNativeWindowsFallbackToast: MutableRefObject<boolean>;
	countdownDelayLoaded: MutableRefObject<boolean>;
	recordingPrefsLoaded: MutableRefObject<boolean>;
	pendingWebcamPathPromise: MutableRefObject<Promise<string | null> | null>;
	webcamStopPromise: MutableRefObject<Promise<string | null> | null>;
	webcamStopResolver: MutableRefObject<((path: string | null) => void) | null>;
	resolvedWebcamPath: MutableRefObject<string | null>;
	accumulatedPausedDurationMs: MutableRefObject<number>;
	pauseStartedAtMs: MutableRefObject<number | null>;
	pauseSegmentsRef: MutableRefObject<PauseSegment[]>;
	recordingFinalizationToastId: MutableRefObject<string | number | null>;
	micFallbackRecorder: MutableRefObject<MediaRecorder | null>;
	micFallbackChunks: MutableRefObject<Blob[]>;
};

export type ScreenRecorderStateSetters = {
	setRecording: Dispatch<SetStateAction<boolean>>;
	setPaused: Dispatch<SetStateAction<boolean>>;
	setStarting: Dispatch<SetStateAction<boolean>>;
	setCountdownActive: Dispatch<SetStateAction<boolean>>;
	setIsMacOS: Dispatch<SetStateAction<boolean>>;
	setMicrophoneEnabled: Dispatch<SetStateAction<boolean>>;
	setMicrophoneDeviceId: Dispatch<SetStateAction<string | undefined>>;
	setSystemAudioEnabled: Dispatch<SetStateAction<boolean>>;
	setWebcamEnabled: Dispatch<SetStateAction<boolean>>;
	setWebcamDeviceId: Dispatch<SetStateAction<string | undefined>>;
	setCountdownDelayState: Dispatch<SetStateAction<number>>;
};