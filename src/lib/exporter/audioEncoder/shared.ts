import type {
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	TrimRegion,
} from "@/components/video-editor/types";

export const AUDIO_BITRATE = 128_000;
export const DECODE_BACKPRESSURE_LIMIT = 20;
export const ENCODE_BACKPRESSURE_LIMIT = 20;
export const MIN_SPEED_REGION_DELTA_MS = 0.0001;
export const MP4_AUDIO_CODEC = "mp4a.40.2";
export const OFFLINE_AUDIO_SAMPLE_RATE = 48_000;
export const OFFLINE_ENCODE_CHUNK_FRAMES = 1024;
export const OFFLINE_CHUNK_DURATION_SEC = 30;

export type TrimLikeRegion = TrimRegion | ClipRegion;

export interface TimelineSlice {
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
}

export interface PreparedOfflineRender {
	mainBuffer: AudioBuffer | null;
	companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number }>;
	regionEntries: Array<{ buffer: AudioBuffer; region: AudioRegion }>;
	slices: TimelineSlice[];
	outputDurationMs: number;
	numChannels: number;
}

export function isInTrimRegion(timestampMs: number, trims: TrimLikeRegion[]) {
	return trims.some((trim) => timestampMs >= trim.startMs && timestampMs < trim.endMs);
}

export function computeTrimOffset(timestampMs: number, trims: TrimLikeRegion[]) {
	let offset = 0;
	for (const trim of trims) {
		if (trim.endMs <= timestampMs) {
			offset += trim.endMs - trim.startMs;
		}
	}
	return offset;
}

export function cloneAudioDataWithTimestamp(src: AudioData, newTimestamp: number): AudioData {
	const isPlanar = src.format?.includes("planar") ?? false;
	const numPlanes = isPlanar ? src.numberOfChannels : 1;

	let totalSize = 0;
	for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
		totalSize += src.allocationSize({ planeIndex });
	}

	const buffer = new ArrayBuffer(totalSize);
	let offset = 0;

	for (let planeIndex = 0; planeIndex < numPlanes; planeIndex++) {
		const planeSize = src.allocationSize({ planeIndex });
		src.copyTo(new Uint8Array(buffer, offset, planeSize), { planeIndex });
		offset += planeSize;
	}

	return new AudioData({
		format: src.format!,
		sampleRate: src.sampleRate,
		numberOfFrames: src.numberOfFrames,
		numberOfChannels: src.numberOfChannels,
		timestamp: newTimestamp,
		data: buffer,
	});
}

export function cloneEncodedAudioChunkWithTimestamp(
	src: EncodedAudioChunk,
	newTimestamp: number,
): EncodedAudioChunk {
	const data = new Uint8Array(src.byteLength);
	src.copyTo(data);

	return new EncodedAudioChunk({
		type: src.type,
		timestamp: newTimestamp,
		duration: src.duration ?? undefined,
		data,
	});
}

export function buildTimelineSlices(
	sourceDurationMs: number,
	trimRegions: TrimLikeRegion[],
	speedRegions: SpeedRegion[],
): TimelineSlice[] {
	const boundaries = new Set<number>();
	boundaries.add(0);
	boundaries.add(sourceDurationMs);

	for (const trim of trimRegions) {
		if (trim.startMs >= 0 && trim.startMs <= sourceDurationMs)
			boundaries.add(trim.startMs);
		if (trim.endMs >= 0 && trim.endMs <= sourceDurationMs) boundaries.add(trim.endMs);
	}
	for (const speed of speedRegions) {
		if (speed.startMs >= 0 && speed.startMs <= sourceDurationMs)
			boundaries.add(speed.startMs);
		if (speed.endMs >= 0 && speed.endMs <= sourceDurationMs) boundaries.add(speed.endMs);
	}

	const sorted = [...boundaries].sort((a, b) => a - b);
	const slices: TimelineSlice[] = [];

	for (let i = 0; i < sorted.length - 1; i++) {
		const start = sorted[i];
		const end = sorted[i + 1];
		if (end - start < 0.001) continue;

		const midpoint = (start + end) / 2;
		if (isInTrimRegion(midpoint, trimRegions)) continue;

		const speedRegion = speedRegions.find(
			(s) => midpoint >= s.startMs && midpoint < s.endMs,
		);

		const rawSpeed = speedRegion?.speed ?? 1;
		const speed = Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1;
		slices.push({
			sourceStartMs: start,
			sourceEndMs: end,
			speed,
		});
	}

	return slices;
}

export function sourceTimeToOutputTime(
	sourceMs: number,
	slices: TimelineSlice[],
): number {
	let outputMs = 0;

	for (const slice of slices) {
		if (sourceMs <= slice.sourceStartMs) {
			return outputMs;
		}
		const sliceDurationMs = slice.sourceEndMs - slice.sourceStartMs;
		if (sourceMs >= slice.sourceEndMs) {
			outputMs += sliceDurationMs / slice.speed;
			continue;
		}
		outputMs += (sourceMs - slice.sourceStartMs) / slice.speed;
		return outputMs;
	}

	return outputMs;
}
