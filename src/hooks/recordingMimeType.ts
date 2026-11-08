const RECORDING_MIME_TYPE_PREFERENCES = [
	"video/webm;codecs=h264",
	"video/webm;codecs=vp9",
	"video/webm",
	"video/webm;codecs=vp8",
	"video/webm;codecs=av1",
] as const;

const WEBCAM_RECORDING_MIME_TYPE_PREFERENCES = [
	"video/webm;codecs=h264",
	"video/webm;codecs=vp8",
	"video/webm;codecs=vp9",
	"video/webm",
] as const;

type MimeTypeSelectorOptions = {
	isTypeSupported?: (type: string) => boolean;
	canPlayType?: (type: string) => string;
};

function selectMimeTypeFromPreferences(
	preferences: readonly string[],
	options: MimeTypeSelectorOptions = {},
): string | undefined {
	const isTypeSupported =
		options.isTypeSupported ?? ((type: string) => MediaRecorder.isTypeSupported(type));
	const canPlayType =
		options.canPlayType ??
		((type: string) => document.createElement("video").canPlayType(type));

	const supportedTypes = preferences.filter((type) => isTypeSupported(type));
	const playableType = supportedTypes.find((type) => canPlayType(type) !== "");

	return playableType ?? supportedTypes[0];
}

export function selectRecordingMimeType(options: MimeTypeSelectorOptions = {}): string | undefined {
	return selectMimeTypeFromPreferences(RECORDING_MIME_TYPE_PREFERENCES, options);
}

export function selectWebcamRecordingMimeType(
	options: MimeTypeSelectorOptions = {},
): string | undefined {
	// Chromium's MP4 MediaRecorder muxer aborts the renderer at 4 GiB.
	// H.264 WebM is recordable despite canPlayType returning empty; main remuxes it.
	const supported =
		options.isTypeSupported ?? ((type: string) => MediaRecorder.isTypeSupported(type));
	return WEBCAM_RECORDING_MIME_TYPE_PREFERENCES.find((type) => supported(type));
}

export function isWebmMimeType(mimeType: string | undefined | null): boolean {
	return /^video\/webm(?:[;\s]|$)/i.test(mimeType ?? "");
}

export function getVideoExtensionForMimeType(
	mimeType: string | undefined | null,
): ".mp4" | ".webm" {
	return /^video\/mp4(?:[;\s]|$)/i.test(mimeType ?? "") ? ".mp4" : ".webm";
}
