import {
	DEFAULT_WEBCAM_BACKGROUND_BLUR,
	normalizeWebcamBackgroundBlurSettings,
	type WebcamBackgroundBlurSettings,
} from "../../src/lib/webcamBackgroundBlur";

export interface RecordingPreferences {
	microphoneEnabled: boolean;
	microphoneDeviceId?: string;
	systemAudioEnabled: boolean;
	webcamBackgroundBlur: WebcamBackgroundBlurSettings;
}

export function normalizeRecordingPreferences(value: unknown): RecordingPreferences {
	const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		microphoneEnabled: candidate.microphoneEnabled === true,
		microphoneDeviceId:
			typeof candidate.microphoneDeviceId === "string"
				? candidate.microphoneDeviceId
				: undefined,
		systemAudioEnabled: candidate.systemAudioEnabled === true,
		webcamBackgroundBlur: normalizeWebcamBackgroundBlurSettings(
			candidate.webcamBackgroundBlur ?? DEFAULT_WEBCAM_BACKGROUND_BLUR,
		),
	};
}
