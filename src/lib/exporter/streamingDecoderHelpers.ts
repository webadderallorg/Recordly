import { WebDemuxer } from "web-demuxer";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import type { DecodedVideoInfo } from "./streamingDecoder";

export interface DecodeSegment {
	startSec: number;
	endSec: number;
	speed: number;
}

function toLocalFilePath(resourceUrl: string): string | null {
	if (!resourceUrl.startsWith("file:")) {
		return null;
	}

	try {
		const url = new URL(resourceUrl);
		let filePath = decodeURIComponent(url.pathname);
		if (/^\/[A-Za-z]:/.test(filePath)) {
			filePath = filePath.slice(1);
		}
		return filePath;
	} catch {
		return resourceUrl.replace(/^file:\/\//, "");
	}
}

function inferMimeType(fileName: string): string {
	const extension = fileName.split(".").pop()?.toLowerCase();
	switch (extension) {
		case "mov":
			return "video/quicktime";
		case "webm":
			return "video/webm";
		case "mkv":
			return "video/x-matroska";
		case "avi":
			return "video/x-msvideo";
		case "mp4":
		default:
			return "video/mp4";
	}
}

async function loadVideoFile(resourceUrl: string): Promise<File> {
	const filename = resourceUrl.split("/").pop() || "video";
	const localFilePath = toLocalFilePath(resourceUrl);

	if (localFilePath) {
		const result = await window.electronAPI.readLocalFile(localFilePath);
		if (!result.success || !result.data) {
			throw new Error(result.error || "Failed to read local video file");
		}

		const bytes = result.data instanceof Uint8Array ? result.data : new Uint8Array(result.data);
		const arrayBuffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		return new File([arrayBuffer], filename, { type: inferMimeType(filename) });
	}

	const response = await fetch(resourceUrl);
	if (!response.ok) {
		throw new Error(`Failed to load video resource: ${response.status} ${response.statusText}`);
	}

	const blob = await response.blob();
	return new File([blob], filename, { type: blob.type || inferMimeType(filename) });
}

export function resolveVideoResourceUrl(videoUrl: string): string {
	if (/^(blob:|data:|https?:|file:)/i.test(videoUrl)) {
		return videoUrl;
	}

	if (videoUrl.startsWith("/")) {
		return `file://${encodeURI(videoUrl)}`;
	}

	return videoUrl;
}

export async function loadStreamingVideoMetadata(videoUrl: string): Promise<{
	demuxer: WebDemuxer;
	metadata: DecodedVideoInfo;
}> {
	const resourceUrl = resolveVideoResourceUrl(videoUrl);
	const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
	const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
	const file = await loadVideoFile(resourceUrl);
	await demuxer.load(file);

	const mediaInfo = await demuxer.getMediaInfo();
	const videoStream = mediaInfo.streams.find((stream) => stream.codec_type_string === "video");
	const audioStream = mediaInfo.streams.find((stream) => stream.codec_type_string === "audio");
	const mediaStartTime =
		typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
			? mediaInfo.start_time
			: 0;
	const streamStartTime =
		typeof videoStream?.start_time === "number" && Number.isFinite(videoStream.start_time)
			? videoStream.start_time
			: mediaStartTime;

	let frameRate = 60;
	if (videoStream?.avg_frame_rate) {
		const parts = videoStream.avg_frame_rate.split("/");
		if (parts.length === 2) {
			const numerator = parseInt(parts[0], 10);
			const denominator = parseInt(parts[1], 10);
			if (denominator > 0 && numerator > 0) {
				frameRate = numerator / denominator;
			}
		}
	}

	return {
		demuxer,
		metadata: {
			width: videoStream?.width || 1920,
			height: videoStream?.height || 1080,
			duration: mediaInfo.duration,
			mediaStartTime,
			streamStartTime,
			streamDuration:
				typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
					? videoStream.duration
					: undefined,
			frameRate,
			codec: videoStream?.codec_string || "unknown",
			hasAudio: !!audioStream,
			audioCodec: audioStream?.codec_string,
		},
	};
}

function computeTrimSegments(
	totalDuration: number,
	trimRegions?: TrimRegion[],
): Array<{ startSec: number; endSec: number }> {
	if (!trimRegions || trimRegions.length === 0) {
		return [{ startSec: 0, endSec: totalDuration }];
	}

	const sorted = [...trimRegions].sort((left, right) => left.startMs - right.startMs);
	const segments: Array<{ startSec: number; endSec: number }> = [];
	let cursor = 0;

	for (const trim of sorted) {
		const trimStart = trim.startMs / 1000;
		const trimEnd = trim.endMs / 1000;
		if (cursor < trimStart) {
			segments.push({ startSec: cursor, endSec: trimStart });
		}
		cursor = Math.max(cursor, trimEnd);
	}

	if (cursor < totalDuration) {
		segments.push({ startSec: cursor, endSec: totalDuration });
	}

	return segments;
}

export function splitSegmentsBySpeed(
	segments: Array<{ startSec: number; endSec: number }>,
	speedRegions?: SpeedRegion[],
): DecodeSegment[] {
	if (!speedRegions || speedRegions.length === 0) {
		return segments.map((segment) => ({ ...segment, speed: 1 }));
	}

	const result: DecodeSegment[] = [];
	for (const segment of segments) {
		const overlapping = speedRegions
			.filter(
				(region) =>
					region.startMs / 1000 < segment.endSec && region.endMs / 1000 > segment.startSec,
			)
			.sort((left, right) => left.startMs - right.startMs);

		if (overlapping.length === 0) {
			result.push({ ...segment, speed: 1 });
			continue;
		}

		let cursor = segment.startSec;
		for (const speedRegion of overlapping) {
			const regionStart = Math.max(speedRegion.startMs / 1000, segment.startSec);
			const regionEnd = Math.min(speedRegion.endMs / 1000, segment.endSec);
			if (cursor < regionStart) {
				result.push({ startSec: cursor, endSec: regionStart, speed: 1 });
			}
			const effectiveStart = Math.max(cursor, regionStart);
			if (regionEnd > effectiveStart) {
				result.push({ startSec: effectiveStart, endSec: regionEnd, speed: speedRegion.speed });
			}
			cursor = Math.max(cursor, regionEnd);
		}

		if (cursor < segment.endSec) {
			result.push({ startSec: cursor, endSec: segment.endSec, speed: 1 });
		}
	}

	return result.filter((segment) => segment.endSec - segment.startSec > 0.0001);
}

export function buildDecodeSegments(
	metadata: Pick<DecodedVideoInfo, "duration" | "streamDuration">,
	trimRegions?: TrimRegion[],
	speedRegions?: SpeedRegion[],
): DecodeSegment[] {
	const effectiveVideoDuration = getEffectiveVideoStreamDurationSeconds({
		duration: metadata.duration,
		streamDuration: metadata.streamDuration,
	});
	return splitSegmentsBySpeed(computeTrimSegments(effectiveVideoDuration, trimRegions), speedRegions);
}

export function getEffectiveDecodedDuration(
	metadata: Pick<DecodedVideoInfo, "duration" | "streamDuration">,
	trimRegions?: TrimRegion[],
	speedRegions?: SpeedRegion[],
): number {
	return buildDecodeSegments(metadata, trimRegions, speedRegions).reduce(
		(sum, segment) => sum + (segment.endSec - segment.startSec) / segment.speed,
		0,
	);
}

export function destroyStreamingDecoderResources(options: {
	decoder: VideoDecoder | null;
	demuxer: WebDemuxer | null;
	pendingFrames: VideoFrame[];
}): void {
	if (options.decoder) {
		try {
			if (options.decoder.state === "configured") {
				options.decoder.close();
			}
		} catch {
			// ignore cleanup errors
		}
	}

	if (options.demuxer) {
		try {
			options.demuxer.destroy();
		} catch {
			// ignore cleanup errors
		}
	}

	for (const frame of options.pendingFrames) {
		try {
			frame.close();
		} catch {
			// ignore cleanup errors
		}
	}
	options.pendingFrames.length = 0;
}