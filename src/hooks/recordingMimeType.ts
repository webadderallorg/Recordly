const RECORDING_MIME_TYPE_PREFERENCES = [
	"video/webm;codecs=vp9",
	"video/webm",
	"video/webm;codecs=vp8",
	"video/webm;codecs=av1",
	"video/webm;codecs=h264",
] as const;

type MimeTypeSelectorOptions = {
	isTypeSupported?: (type: string) => boolean;
	canPlayType?: (type: string) => string;
};

export function selectRecordingMimeType(
	options: MimeTypeSelectorOptions = {},
): string | undefined {
	const isTypeSupported =
		options.isTypeSupported ?? ((type: string) => MediaRecorder.isTypeSupported(type));
	const canPlayType =
		options.canPlayType ??
		((type: string) => document.createElement("video").canPlayType(type));

	const supportedTypes = RECORDING_MIME_TYPE_PREFERENCES.filter((type) =>
		isTypeSupported(type),
	);
	const playableType = supportedTypes.find((type) => canPlayType(type) !== "");

	return playableType ?? supportedTypes[0];
}
