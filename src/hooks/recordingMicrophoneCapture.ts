export type BrowserMicrophoneProfile =
	| "processed"
	| "no-agc"
	| "no-echo"
	| "no-noise-suppression"
	| "raw";
export const DEFAULT_BROWSER_MICROPHONE_PROFILE: BrowserMicrophoneProfile = "no-agc";
const BROWSER_MICROPHONE_PROFILES = new Set<BrowserMicrophoneProfile>([
	"processed",
	"no-agc",
	"no-echo",
	"no-noise-suppression",
	"raw",
]);
export type MicrophoneTrackSettingsSnapshot = Partial<
	Pick<
		MediaTrackSettings,
		| "autoGainControl"
		| "channelCount"
		| "deviceId"
		| "echoCancellation"
		| "groupId"
		| "noiseSuppression"
		| "sampleRate"
		| "sampleSize"
	>
> & {
	trackId?: string;
	trackLabel?: string;
	trackEnabled?: boolean;
	trackMuted?: boolean;
	trackReadyState?: MediaStreamTrackState;
};
export type MicrophoneAudioInputDeviceSnapshot = {
	deviceId: string;
	groupId?: string;
	label: string;
};
export type MicrophoneFallbackChunkEvent = {
	index: number;
	size: number;
	elapsedMs: number;
	deltaMs: number | null;
	recordedElapsedMs: number;
	recordedDeltaMs: number | null;
};
export type MicrophoneFallbackPauseInterval = {
	startElapsedMs: number;
	endElapsedMs?: number;
	durationMs?: number;
};
export type MicrophoneFallbackRecorderMetadata = {
	mimeType: string;
	audioBitsPerSecond: number;
	timesliceMs: number;
};
export type MicrophoneSidecarOptions = {
	startDelayMs?: number;
	browserMicrophoneProfile?: BrowserMicrophoneProfile;
	requestedBrowserMicrophoneProfile?: string | null;
	requestedConstraints?: MediaStreamConstraints;
	mediaTrackSettings?: MicrophoneTrackSettingsSnapshot;
	audioInputDevices?: MicrophoneAudioInputDeviceSnapshot[];
	mediaRecorder?: MicrophoneFallbackRecorderMetadata;
	chunkEvents?: MicrophoneFallbackChunkEvent[];
	pauseIntervals?: MicrophoneFallbackPauseInterval[];
};

export function normalizeBrowserMicrophoneProfile(value?: string | null): BrowserMicrophoneProfile {
	const normalized = value?.trim().toLowerCase();
	return normalized && BROWSER_MICROPHONE_PROFILES.has(normalized as BrowserMicrophoneProfile)
		? (normalized as BrowserMicrophoneProfile)
		: DEFAULT_BROWSER_MICROPHONE_PROFILE;
}

export function createProcessedMicrophoneConstraints(
	microphoneDeviceId?: string,
	profile: BrowserMicrophoneProfile = DEFAULT_BROWSER_MICROPHONE_PROFILE,
): MediaStreamConstraints {
	const normalizedProfile = normalizeBrowserMicrophoneProfile(profile);
	const audio: MediaTrackConstraints = {
		echoCancellation: normalizedProfile !== "no-echo" && normalizedProfile !== "raw",
		noiseSuppression:
			normalizedProfile !== "no-noise-suppression" && normalizedProfile !== "raw",
		autoGainControl: normalizedProfile !== "no-agc" && normalizedProfile !== "raw",
		channelCount: { ideal: 1 },
		sampleRate: { ideal: 48000 },
	};

	if (microphoneDeviceId) {
		audio.deviceId = { exact: microphoneDeviceId };
	}

	return { audio, video: false };
}

export function createMicrophoneTrackSettingsSnapshot(
	stream: MediaStream,
): MicrophoneTrackSettingsSnapshot | null {
	const track = stream.getAudioTracks()[0];
	const settings = track?.getSettings?.();
	if (!track || !settings) {
		return null;
	}

	const snapshot: MicrophoneTrackSettingsSnapshot = {
		trackId: track.id,
		trackLabel: track.label,
		trackEnabled: track.enabled,
		trackMuted: track.muted,
		trackReadyState: track.readyState,
	};
	for (const key of [
		"autoGainControl",
		"channelCount",
		"deviceId",
		"echoCancellation",
		"groupId",
		"noiseSuppression",
		"sampleRate",
		"sampleSize",
	] as const) {
		const value = settings[key];
		if (value !== undefined) {
			snapshot[key] = value as never;
		}
	}

	return Object.keys(snapshot).length > 0 ? snapshot : null;
}

export async function createAudioInputDeviceSnapshot(): Promise<
	MicrophoneAudioInputDeviceSnapshot[] | null
> {
	if (typeof navigator.mediaDevices?.enumerateDevices !== "function") {
		return null;
	}

	const devices = await navigator.mediaDevices.enumerateDevices();
	const audioInputs = devices
		.filter((device) => device.kind === "audioinput")
		.map((device) => ({
			deviceId: device.deviceId,
			...(device.groupId ? { groupId: device.groupId } : {}),
			label: device.label,
		}));

	return audioInputs.length > 0 ? audioInputs : null;
}
