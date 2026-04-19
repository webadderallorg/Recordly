const MICROPHONE_TEST_MIME_TYPE_PREFERENCES = ["audio/webm;codecs=opus", "audio/webm"] as const;

type MimeTypeSelectorOptions = {
	isTypeSupported?: (type: string) => boolean;
	canPlayType?: (type: string) => string;
};

export function selectMicrophoneTestMimeType(
	options: MimeTypeSelectorOptions = {},
): string | undefined {
	const isTypeSupported =
		options.isTypeSupported ?? ((type: string) => MediaRecorder.isTypeSupported(type));
	const canPlayType =
		options.canPlayType ??
		((type: string) => document.createElement("audio").canPlayType(type));

	const supportedTypes = MICROPHONE_TEST_MIME_TYPE_PREFERENCES.filter((type) =>
		isTypeSupported(type),
	);
	const playableType = supportedTypes.find((type) => canPlayType(type) !== "");

	return playableType ?? supportedTypes[0];
}
