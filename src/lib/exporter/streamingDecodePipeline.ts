import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { decodeVideoStreamAttempt } from "./streamingDecodeAttempt";
import { buildVideoDecodeRecoveryFailure, isDecodedFrameTimeout } from "./streamingDecoderSupport";
import type {
	DecodeReadWindow,
	OnFrameCallback,
	StreamingDecodeContext,
} from "./streamingDecodeTypes";

import { type VideoSegment } from "./videoTimelineSegments";

/** Decoder failures that a software decoder can plausibly get past. */
const SOFTWARE_REPLAYABLE_FAILURE =
	/^\[VIDEO_DECODE_ENCODING_ERROR\]|^\[VIDEO_DECODER_RESOURCE_EXHAUSTED\]/;

export async function decodeVideoStream(
	context: StreamingDecodeContext,
	targetFrameRate: number,
	trimRegions: TrimRegion[] | undefined,
	speedRegions: SpeedRegion[] | undefined,
	onFrame: OnFrameCallback,
	segmentsOverride?: VideoSegment[],
	readWindow?: DecodeReadWindow,
): Promise<void> {
	let emittedFrames = 0;
	let callbackFailed = false;
	try {
		await decodeVideoStreamAttempt(
			context,
			targetFrameRate,
			trimRegions,
			speedRegions,
			async (...args) => {
				try {
					await onFrame(...args);
				} catch (error) {
					callbackFailed = true;
					throw error;
				}
				emittedFrames++;
			},
			segmentsOverride,
			readWindow,
			context.forceSoftwareDecode === true,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const codec = context.metadata.codec.toLowerCase();
		// Only retry failures that completed the decode-error cleanup. Configuration
		// and renderer/encoder callback failures must propagate without replay.
		if (
			context.cancelled ||
			context.forceSoftwareDecode === true ||
			!context.demuxer ||
			callbackFailed ||
			context.decoder !== null ||
			codec.includes("av01") ||
			codec.includes("av1") ||
			(!SOFTWARE_REPLAYABLE_FAILURE.test(message) && !isDecodedFrameTimeout(error))
		) {
			throw error;
		}
		console.warn(
			"[StreamingVideoDecoder] Decoder failed; replaying with software decoding",
			error,
		);
		// Replay from a keyframe to rebuild decoder state. Output already handed to
		// the renderer/encoder must not be submitted again.
		let replayedFrames = 0;
		try {
			await decodeVideoStreamAttempt(
				context,
				targetFrameRate,
				trimRegions,
				speedRegions,
				async (...args) => {
					if (replayedFrames++ < emittedFrames) return;
					await onFrame(...args);
				},
				segmentsOverride,
				readWindow,
				true,
			);
			if (!context.cancelled) context.onSoftwareDecodeFallback?.();
		} catch (softwareError) {
			const softwareMessage =
				softwareError instanceof Error ? softwareError.message : String(softwareError);
			if (!/^\[VIDEO_(?:DECODE|DECODER|CODEC)_/.test(softwareMessage)) throw softwareError;
			throw buildVideoDecodeRecoveryFailure(error, softwareError);
		}
	}
}
