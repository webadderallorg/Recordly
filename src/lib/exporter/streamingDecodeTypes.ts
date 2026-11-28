import type { WebDemuxer } from "web-demuxer";
import { type DecodedVideoInfo } from "./streamingDecoderSupport";
export type OnFrameCallback = (
	frame: VideoFrame,
	exportTimestampUs: number,
	sourceTimestampMs: number,
	cursorTimestampMs: number,
) => Promise<void>;

export interface StreamingDecodeContext {
	readonly demuxer: WebDemuxer | null;
	discardDemuxer(): void;
	readonly signal: AbortSignal;
	decoder: VideoDecoder | null;
	readonly cancelled: boolean;
	readonly metadata: DecodedVideoInfo;
	pendingFrames: VideoFrame[];
	readonly maxDecodeQueue: number;
	readonly maxPendingFrames: number;
	onCancel?: (handler: () => void) => () => void;
	/** Start with the software decoder; a remembered hardware stall makes a replay pointless. */
	readonly forceSoftwareDecode?: boolean;
	/** The software replay finished a decode that the default decoder could not. */
	onSoftwareDecodeFallback?: () => void;
}

export interface DecodeReadWindow {
	startSec: number;
	endSec: number;
}
