export type CaptionSetupStatusId =
	| "generating"
	| "missing-audio"
	| "missing-model"
	| "missing-engine"
	| "checking-ffmpeg"
	| "missing-ffmpeg"
	| "captions-hidden"
	| "ready-with-captions"
	| "ready-to-generate"
	| "error";

export type CaptionSetupStatusTone = "error" | "ready" | "setup";

export interface CaptionSetupStatusInput {
	captionCueCount: number;
	captionsEnabled: boolean;
	whisperModelPath?: string | null;
	whisperExecutablePath?: string | null;
	captionFfmpegPath?: string | null;
	captionFfmpegError?: string | null;
	captionGenerationError?: string | null;
	isGeneratingCaptions: boolean;
}

export interface CaptionSetupStatus {
	id: CaptionSetupStatusId;
	tone: CaptionSetupStatusTone;
	canGenerate: boolean;
	isWhisperModelReady: boolean;
	isWhisperEngineReady: boolean;
	isCaptionFfmpegChecking: boolean;
	isCaptionFfmpegReady: boolean;
	isMissingAudioError: boolean;
	isMissingEngineError: boolean;
	isMissingFfmpegError: boolean;
}

function includesAny(value: string | null | undefined, needles: string[]) {
	const normalizedValue = value?.toLowerCase() ?? "";
	return needles.some((needle) => normalizedValue.includes(needle));
}

export function getCaptionSetupStatus(input: CaptionSetupStatusInput): CaptionSetupStatus {
	const isWhisperModelReady = Boolean(input.whisperModelPath);
	const isWhisperEngineReady = Boolean(input.whisperExecutablePath);
	const isCaptionFfmpegChecking = !input.captionFfmpegPath && !input.captionFfmpegError;
	const isCaptionFfmpegReady = Boolean(input.captionFfmpegPath) && !input.captionFfmpegError;
	const isMissingAudioError = includesAny(input.captionGenerationError, [
		"no audio was found",
		"no audio to transcribe",
	]);
	const isMissingEngineError = includesAny(input.captionGenerationError, [
		"whisper engine",
		"whisper runtime",
		"whisper executable",
	]);
	const isFfmpegBlocking = !isCaptionFfmpegReady && isWhisperModelReady && isWhisperEngineReady;
	const isMissingFfmpegError =
		includesAny(input.captionGenerationError, ["ffmpeg"]) ||
		(isFfmpegBlocking && Boolean(input.captionFfmpegError));
	const canGenerate =
		isWhisperModelReady &&
		isWhisperEngineReady &&
		isCaptionFfmpegReady &&
		!isMissingEngineError &&
		!isMissingFfmpegError;

	let id: CaptionSetupStatusId = "ready-to-generate";
	if (input.isGeneratingCaptions) {
		id = "generating";
	} else if (isMissingAudioError) {
		id = "missing-audio";
	} else if (!isWhisperModelReady) {
		id = "missing-model";
	} else if (!isWhisperEngineReady || isMissingEngineError) {
		id = "missing-engine";
	} else if (isCaptionFfmpegChecking) {
		id = "checking-ffmpeg";
	} else if (!isCaptionFfmpegReady || isMissingFfmpegError) {
		id = "missing-ffmpeg";
	} else if (input.captionGenerationError) {
		id = "error";
	} else if (input.captionCueCount > 0 && !input.captionsEnabled) {
		id = "captions-hidden";
	} else if (input.captionCueCount > 0) {
		id = "ready-with-captions";
	}

	const tone: CaptionSetupStatusTone =
		id === "missing-audio" || id === "missing-ffmpeg" || id === "error"
			? "error"
			: id === "ready-with-captions" || id === "ready-to-generate"
				? "ready"
				: "setup";

	return {
		id,
		tone,
		canGenerate,
		isWhisperModelReady,
		isWhisperEngineReady,
		isCaptionFfmpegChecking,
		isCaptionFfmpegReady,
		isMissingAudioError,
		isMissingEngineError,
		isMissingFfmpegError,
	};
}
