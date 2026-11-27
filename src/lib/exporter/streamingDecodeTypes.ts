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
}

export interface DecodeReadWindow {
	startSec: number;
	endSec: number;
}
