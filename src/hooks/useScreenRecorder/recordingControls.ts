import { fixWebmDuration } from "@fix-webm-duration/fix";
import {
	AUDIO_BITRATE_SYSTEM,
	AUDIO_BITRATE_VOICE,
	BITS_PER_MEGABIT,
	CHROME_MEDIA_SOURCE,
	CODEC_ALIGNMENT,
	MIC_GAIN_BOOST,
	MIN_FRAME_RATE,
	RECORDER_TIMESLICE_MS,
	RECORDING_FILE_PREFIX,
	TARGET_FRAME_RATE,
	TARGET_HEIGHT,
	TARGET_WIDTH,
	VIDEO_FILE_EXTENSION,
	type DesktopCaptureMediaDevices,
	type ScreenRecorderRefs,
} from "./shared";
import { computeBitrate, normalizeCaptureDimensions, selectMimeType } from "./recordingCore";
import {
	beginWebcamCapture,
	finalizeRecordingSession,
} from "./webcamRecording";
import { stopBrowserRecordingSession, stopNativeRecordingSession } from "./recordingStopHelpers";

type StartRecordingOptions = {
	refs: ScreenRecorderRefs;
	selectedSource: ProcessedDesktopSource;
	microphoneEnabled: boolean;
	microphoneDeviceId: string | undefined;
	systemAudioEnabled: boolean;
	resolveBrowserCaptureSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>;
	prepareWebcamRecorder: () => Promise<void>;
	getRecordingDurationMs: (endedAt: number) => number;
	resetRecordingClock: (startedAt: number) => void;
	setRecording: (recording: boolean) => void;
	setMicrophoneEnabled: (enabled: boolean) => void;
	cleanupCapturedMedia: () => Promise<void>;
	showRecordingFinalizationToast: (message?: string) => void;
	notifyRecordingFinalizationFailure: (message: string) => Promise<void>;
	clearRecordingFinalizationToast: () => void;
};

export async function startBrowserRecording(options: StartRecordingOptions) {
	const browserCaptureSource = await options.resolveBrowserCaptureSource(options.selectedSource);

	if (
		browserCaptureSource?.id?.startsWith("screen:fallback:") ||
		browserCaptureSource?.id?.startsWith("window:fallback:")
	) {
		throw new Error("Selected display is not available for browser capture on this system.");
	}

	try {
		await window.electronAPI.hideOsCursor?.();
	} catch {
		console.warn("Could not hide OS cursor before recording.");
	}

	const wantsAudioCapture = options.microphoneEnabled || options.systemAudioEnabled;
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

	let videoTrack: MediaStreamTrack | undefined;
	let systemAudioIncluded = false;

	if (wantsAudioCapture) {
		let screenMediaStream: MediaStream;

		if (options.systemAudioEnabled) {
			try {
				screenMediaStream = await mediaDevices.getUserMedia({
					audio: {
						mandatory: {
							chromeMediaSource: CHROME_MEDIA_SOURCE,
							chromeMediaSourceId: browserCaptureSource.id,
						},
					},
					video: browserScreenVideoConstraints,
				});
			} catch (audioError) {
				console.warn("System audio capture failed, falling back to video-only:", audioError);
				alert(
					"System audio is not available for this source. Recording will continue without system audio.",
				);
				screenMediaStream = await mediaDevices.getUserMedia({
					audio: false,
					video: browserScreenVideoConstraints,
				});
			}
		} else {
			screenMediaStream = await mediaDevices.getUserMedia({
				audio: false,
				video: browserScreenVideoConstraints,
			});
		}

		options.refs.screenStream.current = screenMediaStream;
		options.refs.stream.current = new MediaStream();

		videoTrack = screenMediaStream.getVideoTracks()[0];
		if (!videoTrack) {
			throw new Error("Video track is not available.");
		}

		options.refs.stream.current.addTrack(videoTrack);

		if (options.microphoneEnabled) {
			try {
				options.refs.microphoneStream.current = await navigator.mediaDevices.getUserMedia({
					audio: options.microphoneDeviceId
						? {
								deviceId: { exact: options.microphoneDeviceId },
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
				options.setMicrophoneEnabled(false);
			}
		}

		const systemAudioTrack = screenMediaStream.getAudioTracks()[0];
		const micAudioTrack = options.refs.microphoneStream.current?.getAudioTracks()[0];

		if (systemAudioTrack && micAudioTrack) {
			const context = new AudioContext({ sampleRate: 48000 });
			options.refs.mixingContext.current = context;
			const systemSource = context.createMediaStreamSource(new MediaStream([systemAudioTrack]));
			const micSource = context.createMediaStreamSource(new MediaStream([micAudioTrack]));
			const micGain = context.createGain();
			micGain.gain.value = MIC_GAIN_BOOST;
			const destination = context.createMediaStreamDestination();

			systemSource.connect(destination);
			micSource.connect(micGain).connect(destination);

			const mixedTrack = destination.stream.getAudioTracks()[0];
			if (mixedTrack) {
				options.refs.stream.current.addTrack(mixedTrack);
				systemAudioIncluded = true;
			}
		} else if (systemAudioTrack) {
			options.refs.stream.current.addTrack(systemAudioTrack);
			systemAudioIncluded = true;
		} else if (micAudioTrack) {
			options.refs.stream.current.addTrack(micAudioTrack);
		}
	} else {
		const mediaStream = await mediaDevices.getDisplayMedia({
			audio: false,
			video: {
				displaySurface: options.selectedSource.id?.startsWith("window:") ? "window" : "monitor",
				width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
				height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
				frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
				cursor: "never",
			},
			selfBrowserSurface: "exclude",
			surfaceSwitching: "exclude",
		});

		options.refs.stream.current = mediaStream;
		videoTrack = mediaStream.getVideoTracks()[0];
	}

	if (!options.refs.stream.current || !videoTrack) {
		throw new Error("Media stream is not available.");
	}

	try {
		await videoTrack.applyConstraints({
			frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
			width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
			height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
		} as MediaTrackConstraints);
	} catch (error) {
		console.warn("Unable to lock 4K/60fps constraints, using best available track settings.", error);
	}

	let { width, height, frameRate } = normalizeCaptureDimensions(videoTrack);
	width = Math.floor(width / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;
	height = Math.floor(height / CODEC_ALIGNMENT) * CODEC_ALIGNMENT;

	const videoBitsPerSecond = computeBitrate(width, height);
	const mimeType = selectMimeType();

	console.log(
		`Recording at ${width}x${height} @ ${frameRate ?? TARGET_FRAME_RATE}fps using ${mimeType} / ${Math.round(videoBitsPerSecond / BITS_PER_MEGABIT)} Mbps`,
	);

	options.refs.chunks.current = [];
	const hasAudio = options.refs.stream.current.getAudioTracks().length > 0;
	const recorder = new MediaRecorder(options.refs.stream.current, {
		mimeType,
		videoBitsPerSecond,
		...(hasAudio
			? {
					audioBitsPerSecond: systemAudioIncluded
						? AUDIO_BITRATE_SYSTEM
						: AUDIO_BITRATE_VOICE,
				}
			: {}),
	});

	options.refs.mediaRecorder.current = recorder;
	recorder.ondataavailable = (event) => {
		if (event.data && event.data.size > 0) options.refs.chunks.current.push(event.data);
	};
	recorder.onstop = async () => {
		await options.cleanupCapturedMedia();
		if (options.refs.chunks.current.length === 0) return;

		options.showRecordingFinalizationToast();

		const duration = options.getRecordingDurationMs(Date.now());
		const recordedChunks = options.refs.chunks.current;
		const buggyBlob = new Blob(recordedChunks, { type: mimeType });
		options.refs.chunks.current = [];
		const timestamp = options.refs.recordingSessionTimestamp.current ?? Date.now();
		const videoFileName = `${RECORDING_FILE_PREFIX}${timestamp}${VIDEO_FILE_EXTENSION}`;

		try {
			const videoBlob = await fixWebmDuration(buggyBlob, duration);
			const arrayBuffer = await videoBlob.arrayBuffer();
			const videoResult = await window.electronAPI.storeRecordedVideo(arrayBuffer, videoFileName);
			if (!videoResult.success) {
				console.error("Failed to store video:", videoResult.message);
				await options.notifyRecordingFinalizationFailure(
					videoResult.message || "Failed to store the recording.",
				);
				return;
			}

			if (videoResult.path) {
				const webcamPath = options.refs.pendingWebcamPathPromise.current
					? await options.refs.pendingWebcamPathPromise.current
					: options.refs.resolvedWebcamPath.current;
				await finalizeRecordingSession({
					videoPath: videoResult.path,
					webcamPath,
					webcamTimeOffsetMs: options.refs.webcamTimeOffsetMs.current,
					clearRecordingFinalizationToast: options.clearRecordingFinalizationToast,
				});
			} else {
				await options.notifyRecordingFinalizationFailure("Failed to save the recording.");
			}
		} catch (error) {
			console.error("Error saving recording:", error);
			const message = error instanceof Error ? error.message : String(error);
			await options.notifyRecordingFinalizationFailure(
				`Failed to finalize the recording. ${message}`,
			);
		}
	};
	recorder.onerror = () => {
		options.setRecording(false);
	};

	const mainStartedAt = Date.now();
	beginWebcamCapture(options.refs);
	options.resetRecordingClock(mainStartedAt);
	options.refs.webcamTimeOffsetMs.current =
		options.refs.webcamStartTime.current === null
			? 0
			: options.refs.webcamStartTime.current - mainStartedAt;
	recorder.start(RECORDER_TIMESLICE_MS);
	options.setRecording(true);
	window.electronAPI?.setRecordingState(true);
}

type StopRecordingOptions = {
	refs: ScreenRecorderRefs;
	setPaused: (paused: boolean) => void;
	setRecording: (recording: boolean) => void;
	isMacOS: boolean;
	markRecordingResumed: (resumedAt: number) => void;
	showRecordingFinalizationToast: (message?: string) => void;
	logNativeCaptureDiagnostics: (context: string) => Promise<void>;
	recoverNativeRecordingSession: (micFallbackBlobPromise?: Promise<Blob | null> | null) => Promise<string | null>;
	buildNativeCaptureFailureMessage: (context: string, fallbackMessage: string) => Promise<string>;
	notifyRecordingFinalizationFailure: (message: string) => Promise<void>;
	storeMicrophoneSidecar: (
		micFallbackBlobPromise: Promise<Blob | null> | null | undefined,
		finalPath: string,
	) => Promise<void>;
	finalizeRecordingSession: (videoPath: string, webcamPath: string | null) => Promise<void>;
	cleanupCapturedMedia: () => Promise<void>;
};

export async function stopRecordingSession(options: StopRecordingOptions) {
	options.setPaused(false);
	if (options.refs.nativeScreenRecording.current) {
		await stopNativeRecordingSession(options);
		return;
	}

	await stopBrowserRecordingSession(options);
}

export async function pauseRecordingSession(options: {
	refs: ScreenRecorderRefs;
	recording: boolean;
	paused: boolean;
	markRecordingPaused: (pausedAt: number) => void;
	setPaused: (paused: boolean) => void;
}) {
	if (!options.recording || options.paused) return;
	if (options.refs.nativeScreenRecording.current) {
		const result = await window.electronAPI.pauseNativeScreenRecording();
		if (!result.success) {
			console.error("Failed to pause native screen recording:", result.error ?? result.message);
			return;
		}

		if (options.refs.webcamRecorder.current?.state === "recording") {
			options.refs.webcamRecorder.current.pause();
		}
		options.markRecordingPaused(Date.now());
		options.setPaused(true);
		return;
	}

	if (options.refs.mediaRecorder.current?.state === "recording") {
		options.refs.mediaRecorder.current.pause();
		if (options.refs.webcamRecorder.current?.state === "recording") {
			options.refs.webcamRecorder.current.pause();
		}
		options.markRecordingPaused(Date.now());
		options.setPaused(true);
	}
}

export async function resumeRecordingSession(options: {
	refs: ScreenRecorderRefs;
	recording: boolean;
	paused: boolean;
	markRecordingResumed: (resumedAt: number) => void;
	setPaused: (paused: boolean) => void;
}) {
	if (!options.recording || !options.paused) return;
	if (options.refs.nativeScreenRecording.current) {
		const result = await window.electronAPI.resumeNativeScreenRecording();
		if (!result.success) {
			console.error("Failed to resume native screen recording:", result.error ?? result.message);
			return;
		}

		if (options.refs.webcamRecorder.current?.state === "paused") {
			options.refs.webcamRecorder.current.resume();
		}
		options.markRecordingResumed(Date.now());
		options.setPaused(false);
		return;
	}

	if (options.refs.mediaRecorder.current?.state === "paused") {
		options.refs.mediaRecorder.current.resume();
		if (options.refs.webcamRecorder.current?.state === "paused") {
			options.refs.webcamRecorder.current.resume();
		}
		options.markRecordingResumed(Date.now());
		options.setPaused(false);
	}
}

export async function cancelRecordingSession(options: {
	refs: ScreenRecorderRefs;
	recording: boolean;
	setPaused: (paused: boolean) => void;
	setRecording: (recording: boolean) => void;
	markRecordingResumed: (resumedAt: number) => void;
	cleanupCapturedMedia: () => Promise<void>;
}) {
	if (!options.recording) return;
	options.setPaused(false);
	options.markRecordingResumed(Date.now());

	options.refs.webcamChunks.current = [];
	if (options.refs.webcamRecorder.current && options.refs.webcamRecorder.current.state !== "inactive") {
		options.refs.webcamRecorder.current.stop();
	}
	options.refs.webcamRecorder.current = null;
	options.refs.webcamStartTime.current = null;
	options.refs.webcamTimeOffsetMs.current = 0;
	options.refs.webcamStream.current?.getTracks().forEach((track) => track.stop());
	options.refs.webcamStream.current = null;
	options.refs.pendingWebcamPathPromise.current = null;
	options.refs.resolvedWebcamPath.current = null;

	if (options.refs.nativeScreenRecording.current) {
		options.refs.nativeScreenRecording.current = false;
		options.refs.nativeWindowsRecording.current = false;
		options.setRecording(false);
		window.electronAPI?.setRecordingState(false);
		try {
			const result = await window.electronAPI.stopNativeScreenRecording();
			if (result?.path) {
				await window.electronAPI.deleteRecordingFile(result.path);
			}
		} catch {
			// best-effort cleanup
		}
		return;
	}

	if (options.refs.mediaRecorder.current) {
		options.refs.chunks.current = [];
		await options.cleanupCapturedMedia();
		if (options.refs.mediaRecorder.current.state !== "inactive") {
			options.refs.mediaRecorder.current.stop();
		}
		options.setRecording(false);
		window.electronAPI?.setRecordingState(false);
	}
}