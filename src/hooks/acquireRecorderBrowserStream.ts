import { translate } from "@/i18n/runtime";
import { acquireBrowserScreenCapture } from "./browserScreenCapture";
import {
	CHROME_MEDIA_SOURCE,
	MIC_GAIN_BOOST,
	MIN_FRAME_RATE,
	resolveBrowserCaptureCursorPolicy,
	TARGET_FRAME_RATE,
	TARGET_HEIGHT,
	TARGET_WIDTH,
} from "./recorderCaptureOptions";
import type { RecorderContext } from "./recorderContext";
import { createProcessedMicrophoneConstraints } from "./recordingMicrophoneFallback";

type DesktopCaptureMediaDevices = {
	getUserMedia: (constraints: unknown) => Promise<MediaStream>;
	getDisplayMedia: (constraints: unknown) => Promise<MediaStream>;
};

export async function acquireRecorderBrowserStream(
	context: Pick<
		RecorderContext,
		| "hideEditorOverlayCursorByDefault"
		| "microphoneEnabled"
		| "systemAudioEnabled"
		| "resolveBrowserCaptureSource"
		| "screenStream"
		| "stream"
		| "microphoneStream"
		| "microphoneDeviceId"
		| "browserMicrophoneProfile"
		| "setMicrophoneEnabled"
		| "mixingContext"
	>,
	{
		selectedSource,
		nativeWindowsCaptureStartFailed,
		onPortalCapture,
	}: {
		selectedSource: ProcessedDesktopSource;
		nativeWindowsCaptureStartFailed: boolean;
		onPortalCapture: (usingPortal: boolean) => void;
	},
) {
	const {
		hideEditorOverlayCursorByDefault,
		microphoneEnabled,
		systemAudioEnabled,
		resolveBrowserCaptureSource,
		screenStream,
		stream,
		microphoneStream,
		microphoneDeviceId,
		browserMicrophoneProfile,
		setMicrophoneEnabled,
		mixingContext,
	} = context;

	const browserCursorPolicy = resolveBrowserCaptureCursorPolicy({
		nativeWindowsCaptureStartFailed,
	});
	hideEditorOverlayCursorByDefault.current = browserCursorPolicy.hideEditorOverlayCursorByDefault;

	const wantsAudioCapture = microphoneEnabled || systemAudioEnabled;
	const browserCaptureSource = await resolveBrowserCaptureSource(selectedSource);

	if (
		browserCaptureSource?.id?.startsWith("screen:fallback:") ||
		browserCaptureSource?.id?.startsWith("window:fallback:")
	) {
		throw new Error("Selected display is not available for browser capture on this system.");
	}

	if (browserCursorPolicy.hideOsCursorBeforeRecording) {
		try {
			const hideCursorResult = await window.electronAPI.hideOsCursor?.();
			if (hideCursorResult && !hideCursorResult.success) {
				console.warn("Could not hide OS cursor before recording.", hideCursorResult);
			}
		} catch {
			console.warn("Could not hide OS cursor before recording.");
		}
	}

	let videoTrack: MediaStreamTrack | undefined;
	let systemAudioIncluded = false;
	const mediaDevices = navigator.mediaDevices as DesktopCaptureMediaDevices;
	const useLinuxPortal = selectedSource.id === "screen:linux-portal";
	onPortalCapture(useLinuxPortal);
	const browserScreenVideoConstraints = {
		mandatory: {
			chromeMediaSource: CHROME_MEDIA_SOURCE,
			chromeMediaSourceId: browserCaptureSource.id,
			maxWidth: TARGET_WIDTH,
			maxHeight: TARGET_HEIGHT,
			maxFrameRate: TARGET_FRAME_RATE,
			minFrameRate: MIN_FRAME_RATE,
			googCaptureCursor: browserCursorPolicy.streamCursor === "always",
		},
		cursor: browserCursorPolicy.streamCursor,
	};

	if (wantsAudioCapture) {
		let screenMediaStream: MediaStream;
		const acquireLinuxPortalStream = (withAudio: boolean) =>
			mediaDevices.getDisplayMedia({
				audio: withAudio,
				video: {
					displaySurface: "monitor",
					width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
					height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
					frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
					cursor: browserCursorPolicy.streamCursor,
				},
				selfBrowserSurface: "exclude",
				surfaceSwitching: "exclude",
			});

		screenMediaStream = await acquireBrowserScreenCapture({
			audio: systemAudioEnabled,
			usePortal: useLinuxPortal,
			request: (audio) =>
				useLinuxPortal
					? acquireLinuxPortalStream(audio)
					: mediaDevices.getUserMedia({
							audio: audio
								? {
										mandatory: {
											chromeMediaSource: CHROME_MEDIA_SOURCE,
											chromeMediaSourceId: browserCaptureSource.id,
										},
									}
								: false,
							video: browserScreenVideoConstraints,
						}),
			onAudioFallback: () => {
				alert(
					translate(
						"notifications.systemAudioUnavailable",
						"System audio is not available for this source. Recording will continue without system audio.",
					),
				);
			},
		});

		screenStream.current = screenMediaStream;
		stream.current = new MediaStream();

		videoTrack = screenMediaStream.getVideoTracks()[0];
		if (!videoTrack) {
			throw new Error("Video track is not available.");
		}

		stream.current.addTrack(videoTrack);

		if (microphoneEnabled) {
			try {
				microphoneStream.current = await navigator.mediaDevices.getUserMedia(
					createProcessedMicrophoneConstraints(
						microphoneDeviceId,
						browserMicrophoneProfile.current,
					),
				);
			} catch (audioError) {
				console.warn("Failed to get microphone access:", audioError);
				alert(
					translate(
						"notifications.microphoneDenied",
						"Microphone permission denied. Recording will continue without microphone audio.",
					),
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
			const micSource = context.createMediaStreamSource(new MediaStream([micAudioTrack]));
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
		const mediaStream = useLinuxPortal
			? await mediaDevices.getDisplayMedia({
					audio: false,
					video: {
						displaySurface: selectedSource.id?.startsWith("window:")
							? "window"
							: "monitor",
						width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
						height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
						frameRate: { ideal: TARGET_FRAME_RATE, max: TARGET_FRAME_RATE },
						cursor: browserCursorPolicy.streamCursor,
					},
					selfBrowserSurface: "exclude",
					surfaceSwitching: "exclude",
				})
			: await mediaDevices.getUserMedia({
					audio: false,
					video: browserScreenVideoConstraints,
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

	return { videoTrack, systemAudioIncluded };
}
