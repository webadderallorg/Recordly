import { useRecorderCaptureSetup } from "./useRecorderCaptureSetup";
import { useRecorderClock } from "./useRecorderClock";
import { useRecorderControls } from "./useRecorderControls";
import { useRecorderEditorSession } from "./useRecorderEditorSession";
import { useRecorderMediaCleanup } from "./useRecorderMediaCleanup";
import { useRecorderPreferences } from "./useRecorderPreferences";
import { useRecorderStartup } from "./useRecorderStartup";
import { useRecorderState } from "./useRecorderState";
import { useRecorderStop } from "./useRecorderStop";
import { useRecorderSubscriptions } from "./useRecorderSubscriptions";
import { useRecorderWebcam } from "./useRecorderWebcam";

export {
	type BrowserCaptureCursorPolicy,
	createBrowserRecordingOptions,
	resolveBrowserCaptureCursorPolicy,
	shouldUseNativeWindowsCaptureForSource,
} from "./recorderCaptureOptions";
export {
	type BrowserMicrophoneProfile,
	createProcessedMicrophoneConstraints,
	normalizeBrowserMicrophoneProfile,
} from "./recordingMicrophoneFallback";
export {
	type DiscardNativeCaptureResult,
	stopAndDiscardNativeCapture,
} from "./recordingNativeCleanup";

type UseScreenRecorderReturn = {
	recording: boolean;
	paused: boolean;
	finalizing: boolean;
	restarting: boolean;
	restartRecording: () => Promise<boolean>;
	countdownActive: boolean;
	toggleRecording: () => void;
	pauseRecording: () => void;
	resumeRecording: () => void;
	cancelRecording: () => Promise<boolean>;
	cancelRecordingStart: () => Promise<boolean>;
	preparePermissions: () => Promise<boolean>;
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
	const preferences = useRecorderPreferences();
	const clock = useRecorderClock();
	const state = useRecorderState(preferences);
	const webcam = useRecorderWebcam({
		...preferences,
		...clock,
		recordingSessionTimestamp: state.recordingSessionTimestamp,
	});
	const core = { ...preferences, ...clock, ...state, ...webcam };
	const media = useRecorderMediaCleanup(core);
	const editor = useRecorderEditorSession(core);
	const services = { ...core, ...media, ...editor };
	const setup = useRecorderCaptureSetup(services);
	const context = { ...services, ...setup };
	const stop = useRecorderStop(context);
	useRecorderSubscriptions({ ...context, ...stop });
	const startup = useRecorderStartup(context);
	const controls = useRecorderControls({ ...context, ...stop, ...startup });
	const {
		recording,
		restarting,
		restartRecording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		cancelRecordingStart,
		preparePermissions,
		isMacOS,
		microphoneEnabled,
		persistMicrophoneEnabled,
		microphoneDeviceId,
		persistMicrophoneDeviceId,
		systemAudioEnabled,
		persistSystemAudioEnabled,
		webcamEnabled,
		persistWebcamEnabled,
		webcamDeviceId,
		persistWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
	} = { ...context, ...controls };
	return {
		recording,
		restarting,
		restartRecording,
		paused,
		finalizing,
		countdownActive,
		toggleRecording,
		pauseRecording,
		resumeRecording,
		cancelRecording,
		cancelRecordingStart,
		preparePermissions,
		isMacOS,
		microphoneEnabled,
		setMicrophoneEnabled: persistMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId: persistMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled: persistSystemAudioEnabled,
		webcamEnabled,
		setWebcamEnabled: persistWebcamEnabled,
		webcamDeviceId,
		setWebcamDeviceId: persistWebcamDeviceId,
		countdownDelay,
		setCountdownDelay,
	};
}
