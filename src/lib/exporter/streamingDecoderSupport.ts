export interface DecodedVideoInfo {
	width: number;
	height: number;
	duration: number; // seconds
	mediaStartTime?: number; // seconds
	streamStartTime?: number; // seconds
	streamDuration?: number; // seconds
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
}

export interface VideoDecodeFailureContext {
	decoderConfig: VideoDecoderConfig;
	sourceMetadata?: DecodedVideoInfo;
	chunkIndex?: number;
	chunk?: EncodedVideoChunk;
	decoderState?: CodecState;
	decodeQueueSize?: number;
}

/** Maps WebCodecs failures to stable support-facing identifiers. */
export function getVideoDecodeFailureCode(error: unknown): string {
	const name = error instanceof DOMException ? error.name : "";
	switch (name) {
		case "EncodingError":
			return "VIDEO_DECODE_ENCODING_ERROR";
		case "NotSupportedError":
			return "VIDEO_CODEC_UNSUPPORTED";
		case "QuotaExceededError":
			return "VIDEO_DECODER_RESOURCE_EXHAUSTED";
		case "InvalidStateError":
			return "VIDEO_DECODER_INVALID_STATE";
		default:
			return "VIDEO_DECODE_FAILED";
	}
}

function describeUnknownError(error: unknown): string {
	if (error instanceof DOMException) {
		return `${error.name}: ${error.message}`;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

/** Builds a decode error with codec, source, chunk, and decoder-state context. */
export function buildVideoDecodeFailure(error: unknown, context: VideoDecodeFailureContext): Error {
	const details = [`codec=${context.decoderConfig.codec}`];
	const failureCode = getVideoDecodeFailureCode(error);
	const width = context.decoderConfig.codedWidth;
	const height = context.decoderConfig.codedHeight;
	if (width && height) {
		details.push(`codedSize=${width}x${height}`);
	}
	if (context.decoderConfig.hardwareAcceleration) {
		details.push(`hardwareAcceleration=${context.decoderConfig.hardwareAcceleration}`);
	}
	if (context.sourceMetadata) {
		details.push(`sourceFps=${context.sourceMetadata.frameRate}`);
		details.push(`sourceDurationSec=${context.sourceMetadata.duration}`);
	}
	if (context.chunkIndex !== undefined) {
		details.push(`chunkIndex=${context.chunkIndex}`);
	}
	if (context.chunk) {
		details.push(`chunkType=${context.chunk.type}`);
		details.push(`chunkTimestampUs=${context.chunk.timestamp}`);
		details.push(`sourceTimeSec=${(context.chunk.timestamp / 1_000_000).toFixed(3)}`);
		if (typeof context.chunk.duration === "number") {
			details.push(`chunkDurationUs=${context.chunk.duration}`);
		}
		details.push(`chunkBytes=${context.chunk.byteLength}`);
	}
	if (context.decoderState) {
		details.push(`decoderState=${context.decoderState}`);
	}
	if (context.decodeQueueSize !== undefined) {
		details.push(`decodeQueueSize=${context.decodeQueueSize}`);
	}

	const failure = new Error(
		`[${failureCode}] VideoDecoder failure: ${describeUnknownError(error)} (${details.join(", ")})`,
	);
	(failure as Error & { cause?: unknown }).cause = error;
	return failure;
}

/** Preserve both decoder attempts without claiming that a damaged source is proven. */
export function buildVideoDecodeRecoveryFailure(initial: unknown, software: unknown): Error {
	const describe = (value: unknown) => (value instanceof Error ? value.message : String(value));
	const failure = new Error(
		[
			"[VIDEO_DECODE_RECOVERY_FAILED] Default decoding and the software retry both failed.",
			`Initial decoder failure: ${describe(initial)}`,
			`Software decoder failure: ${describe(software)}`,
			"Chunk positions are the last submitted input, not necessarily the exact failing frame.",
			"Source corruption is not confirmed. Test this file with an independent decoder; if other files also fail, investigate the system decoder/driver.",
		].join("\n"),
	);
	(failure as Error & { cause?: unknown }).cause = { initial, software };
	return failure;
}

/** Keeps the original decoder failure when cleanup triggers secondary errors. */
export function preserveFirstVideoDecodeFailure(
	existingError: Error | null,
	error: unknown,
	context: VideoDecodeFailureContext,
): Error {
	return existingError ?? buildVideoDecodeFailure(error, context);
}

export function getDecodedFrameStartupOffsetUs(
	firstDecodedFrameTimestampUs: number,
	metadata: Pick<DecodedVideoInfo, "mediaStartTime" | "streamStartTime">,
): number {
	const streamStartTimeUs = Math.round(
		(metadata.streamStartTime ?? metadata.mediaStartTime ?? 0) * 1_000_000,
	);

	return Math.max(0, firstDecodedFrameTimestampUs - streamStartTimeUs);
}

export function getDecodedFrameTimelineOffsetUs(
	firstDecodedFrameTimestampUs: number,
	metadata: Pick<DecodedVideoInfo, "mediaStartTime" | "streamStartTime">,
): number {
	const mediaStartTimeUs = Math.round((metadata.mediaStartTime ?? 0) * 1_000_000);
	const streamStartTimeUs = Math.round(
		(metadata.streamStartTime ?? metadata.mediaStartTime ?? 0) * 1_000_000,
	);

	return (
		Math.max(0, streamStartTimeUs - mediaStartTimeUs) +
		getDecodedFrameStartupOffsetUs(firstDecodedFrameTimestampUs, metadata)
	);
}
