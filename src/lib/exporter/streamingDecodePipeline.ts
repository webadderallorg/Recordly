import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { decodeVideoStreamAttempt } from "./streamingDecodeAttempt";
import { buildVideoDecodeRecoveryFailure } from "./streamingDecoderSupport";
import type {
	DecodeReadWindow,
	OnFrameCallback,
	StreamingDecodeContext,
} from "./streamingDecodeTypes";

import { type VideoSegment } from "./videoTimelineSegments";

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
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const codec = context.metadata.codec.toLowerCase();
		// Only retry failures that completed the decode-error cleanup. Configuration
		// and renderer/encoder callback failures must propagate without replay.
		if (
			context.cancelled ||
			callbackFailed ||
			context.decoder !== null ||
			codec.includes("av01") ||
			codec.includes("av1") ||
			!/^\[VIDEO_DECODE_ENCODING_ERROR\]|^\[VIDEO_DECODER_RESOURCE_EXHAUSTED\]/.test(message)
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
		} catch (softwareError) {
			const softwareMessage =
				softwareError instanceof Error ? softwareError.message : String(softwareError);
			if (!/^\[VIDEO_(?:DECODE|DECODER|CODEC)_/.test(softwareMessage)) throw softwareError;
			throw buildVideoDecodeRecoveryFailure(error, softwareError);
		}
	}
}
