import {
	ALL_FORMATS,
	BlobSource,
	BufferSource,
	EncodedPacketSink,
	Input,
	IsobmffInputFormat,
	MatroskaInputFormat,
	Source,
	UrlSource,
} from "mediabunny";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { type ClipRegion, getClipSourceStartMs, sortClipRegions } from "../types";

export const DEFAULT_FRAME_STEP_FPS = 60;
const FRAME_TIME_EPSILON_SEC = 1e-5;
const DEDUPE_TIMESTAMP_EPSILON_SEC = 1e-6;
const DEFAULT_MAX_MATROSKA_SCAN_BYTES = 64 * 1024 * 1024;
const MAX_INDEXED_PACKETS = 1_000_000;

export interface VideoFrameTimeline {
	presentationTimestamps: Float64Array;
	frameRate: number | null;
}

export interface LoadVideoFrameTimelineOptions {
	signal?: AbortSignal;
	maxMatroskaBytes?: number;
	maxIndexedPackets?: number;
}

export interface ResolveAdjacentFrameParams {
	currentTimeSeconds: number;
	direction: "backward" | "forward";
	timelineDurationSeconds: number;
	clipRegions?: readonly ClipRegion[];
	sourceFrameTimestampsSeconds?: ArrayLike<number> | null;
	fallbackFps?: number | null;
}

/** Sorts finite non-negative timestamps ascending and drops sub-microsecond duplicates. */
export function normalizePresentationTimestamps(timestamps: Iterable<number>): Float64Array {
	const finite: number[] = [];
	for (const timestamp of timestamps) {
		if (Number.isFinite(timestamp) && timestamp >= 0) {
			finite.push(timestamp);
		}
	}
	if (finite.length === 0) {
		return new Float64Array(0);
	}

	const sorted = Float64Array.from(finite).sort();
	let writeIndex = 1;
	for (let readIndex = 1; readIndex < sorted.length; readIndex++) {
		if (sorted[readIndex] - sorted[writeIndex - 1] > DEDUPE_TIMESTAMP_EPSILON_SEC) {
			sorted[writeIndex++] = sorted[readIndex];
		}
	}

	return writeIndex === sorted.length ? sorted : sorted.subarray(0, writeIndex);
}

async function createFrameTimelineSource(
	resource: string | Blob | ArrayBuffer | ArrayBufferView | Source,
	signal?: AbortSignal,
): Promise<Source | null> {
	if (resource instanceof Source) {
		return resource;
	}
	if (resource instanceof Blob) {
		return new BlobSource(resource);
	}
	if (resource instanceof ArrayBuffer || ArrayBuffer.isView(resource)) {
		return new BufferSource(resource);
	}
	if (!resource.trim()) {
		return null;
	}

	let resolved = await resolveMediaResourceUrl(resource);
	if (typeof window !== "undefined" && !/^(?:https?:|blob:|data:|file:)/i.test(resolved)) {
		resolved = new URL(resolved, window.location.href).href;
	}

	if (/^https?:/i.test(resolved)) {
		return new UrlSource(resolved, {
			getRetryDelay: () => null,
			maxCacheSize: 8 * 1024 * 1024,
			handleUnhandledError: () => undefined,
		});
	}

	const response = await fetch(resolved, signal ? { signal } : undefined);
	if (!response.ok) {
		throw new Error(`Failed to load media resource: ${response.status} ${response.statusText}`);
	}

	return new BlobSource(await response.blob());
}

/**
 * Indexes a video's packet presentation timestamps without decoding frames.
 * ISOBMFF tracks (MP4/MOV, including sparse WGC captures) read sample tables
 * directly in metadataOnly mode; large Matroska/WebM files fall back to
 * packet-rate estimation so cluster scanning stays bounded.
 */
export async function loadVideoFrameTimeline(
	resource: string | Blob | ArrayBuffer | ArrayBufferView | Source,
	options: LoadVideoFrameTimelineOptions = {},
): Promise<VideoFrameTimeline> {
	options.signal?.throwIfAborted();
	const source = await createFrameTimelineSource(resource, options.signal);
	if (!source) {
		return { presentationTimestamps: new Float64Array(0), frameRate: null };
	}

	const input = new Input({ source, formats: ALL_FORMATS });
	const onAbort = () => {
		try {
			input.dispose();
		} catch {
			// Ignore disposal errors during cancellation.
		}
	};

	if (options.signal) {
		if (options.signal.aborted) {
			onAbort();
			options.signal.throwIfAborted();
		}
		options.signal.addEventListener("abort", onAbort, { once: true });
	}

	try {
		const format = await input.getFormat();
		const track = await input.getPrimaryVideoTrack();
		if (!track) {
			return { presentationTimestamps: new Float64Array(0), frameRate: null };
		}

		const maxMatroskaBytes = options.maxMatroskaBytes ?? DEFAULT_MAX_MATROSKA_SCAN_BYTES;
		const sizeBytes =
			format instanceof MatroskaInputFormat ? await source.getSizeOrNull() : null;
		const shouldScanAllPackets =
			format instanceof IsobmffInputFormat ||
			!(format instanceof MatroskaInputFormat) ||
			(sizeBytes !== null && sizeBytes <= maxMatroskaBytes);

		if (!shouldScanAllPackets) {
			const stats = await track.computePacketStats(180);
			options.signal?.throwIfAborted();
			return {
				presentationTimestamps: new Float64Array(0),
				frameRate:
					Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0
						? stats.averagePacketRate
						: null,
			};
		}

		const maxIndexedPackets = options.maxIndexedPackets ?? MAX_INDEXED_PACKETS;
		const sink = new EncodedPacketSink(track);
		const rawTimestamps: number[] = [];
		let count = 0;
		let truncated = false;
		for await (const packet of sink.packets(undefined, undefined, { metadataOnly: true })) {
			options.signal?.throwIfAborted();
			if (count >= maxIndexedPackets) {
				truncated = true;
				break;
			}
			if (Number.isFinite(packet.timestamp) && packet.timestamp >= 0) {
				rawTimestamps.push(packet.timestamp);
			}
			count++;
		}

		if (truncated) {
			const stats = await track.computePacketStats(180).catch(() => null);
			options.signal?.throwIfAborted();
			return {
				presentationTimestamps: new Float64Array(0),
				frameRate:
					stats && Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0
						? stats.averagePacketRate
						: null,
			};
		}

		const presentationTimestamps = normalizePresentationTimestamps(rawTimestamps);
		const duration = await track.computeDuration().catch(() => 0);
		const frameRate =
			duration > 0 && presentationTimestamps.length > 0
				? presentationTimestamps.length / duration
				: null;

		return { presentationTimestamps, frameRate };
	} finally {
		options.signal?.removeEventListener("abort", onAbort);
		input.dispose();
	}
}

/** Largest index `i` such that `pts[i] <= sourceSec + FRAME_TIME_EPSILON_SEC`, or `-1`. */
function findDisplayedFrameIndex(pts: ArrayLike<number>, sourceSec: number): number {
	const target = sourceSec + FRAME_TIME_EPSILON_SEC;
	let lo = 0;
	let hi = pts.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (pts[mid] <= target) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}

/** Largest index `i` such that `pts[i] < sourceSec - FRAME_TIME_EPSILON_SEC`, or `-1`. */
function findFrameIndexBefore(pts: ArrayLike<number>, sourceSec: number): number {
	const limit = sourceSec - FRAME_TIME_EPSILON_SEC;
	let lo = 0;
	let hi = pts.length - 1;
	let result = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if (pts[mid] < limit) {
			result = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return result;
}

function getSafeClipSpeed(clip: Pick<ClipRegion, "speed"> | null | undefined): number {
	return clip && Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

function toTimelineTimeSeconds(clip: ClipRegion, sourceSec: number): number {
	const clipStartSec = clip.startMs / 1000;
	const clipSourceStartSec = getClipSourceStartMs(clip) / 1000;
	const speed = getSafeClipSpeed(clip);
	return clipStartSec + Math.max(0, sourceSec - clipSourceStartSec) / speed;
}

function toSourceTimeSeconds(clip: ClipRegion, timelineSec: number): number {
	const clipStartSec = clip.startMs / 1000;
	const clipSourceStartSec = getClipSourceStartMs(clip) / 1000;
	const speed = getSafeClipSpeed(clip);
	return clipSourceStartSec + Math.max(0, timelineSec - clipStartSec) * speed;
}

function getClipSourceBoundsSeconds(clip: ClipRegion) {
	const clipStartSec = clip.startMs / 1000;
	const clipEndSec = clip.endMs / 1000;
	const speed = getSafeClipSpeed(clip);
	const clipSourceStartSec = getClipSourceStartMs(clip) / 1000;
	const clipSourceEndSec = clipSourceStartSec + Math.max(0, clipEndSec - clipStartSec) * speed;
	return { clipStartSec, clipEndSec, clipSourceStartSec, clipSourceEndSec };
}

function getLastFrameTimelineInClip(pts: ArrayLike<number>, clip: ClipRegion): number {
	const { clipStartSec, clipSourceStartSec, clipSourceEndSec } = getClipSourceBoundsSeconds(clip);
	const lastIdx = findFrameIndexBefore(pts, clipSourceEndSec);
	if (lastIdx < 0) {
		return clipStartSec;
	}
	return toTimelineTimeSeconds(clip, Math.max(clipSourceStartSec, pts[lastIdx]));
}

function getFallbackLastFrameTimelineInClip(clip: ClipRegion, safeFps: number): number {
	const clipStartSec = clip.startMs / 1000;
	const clipEndSec = clip.endMs / 1000;
	const delta = 1 / (safeFps * getSafeClipSpeed(clip));
	return Math.max(clipStartSec, clipEndSec - delta);
}

/**
 * Resolves the target timeline timestamp (in seconds) for stepping one frame
 * forward or backward from `currentTimeSeconds`, using decoded presentation
 * timestamps when available and falling back to `fallbackFps` / 60 fps.
 */
export function resolveAdjacentFrameTimelineTime({
	currentTimeSeconds,
	direction,
	timelineDurationSeconds,
	clipRegions,
	sourceFrameTimestampsSeconds,
	fallbackFps,
}: ResolveAdjacentFrameParams): number {
	const safeDuration =
		Number.isFinite(timelineDurationSeconds) && timelineDurationSeconds > 0
			? timelineDurationSeconds
			: 0;
	if (safeDuration === 0) {
		return 0;
	}

	const safeCurrent = Number.isFinite(currentTimeSeconds)
		? Math.max(0, Math.min(safeDuration, currentTimeSeconds))
		: 0;

	const clips =
		clipRegions && clipRegions.length > 0
			? sortClipRegions([...clipRegions]).filter((clip) => clip.endMs > clip.startMs)
			: [
					{
						id: "__full__",
						startMs: 0,
						endMs: safeDuration * 1000,
						sourceStartMs: 0,
						speed: 1,
					},
				];
	if (clips.length === 0) {
		return 0;
	}

	const pts = sourceFrameTimestampsSeconds;
	if (!pts || pts.length === 0) {
		const safeFps =
			typeof fallbackFps === "number" && Number.isFinite(fallbackFps) && fallbackFps > 0
				? Math.max(1, fallbackFps)
				: DEFAULT_FRAME_STEP_FPS;

		if (direction === "forward") {
			for (let i = 0; i < clips.length; i++) {
				const clip = clips[i];
				const clipStartSec = clip.startMs / 1000;
				const clipEndSec = clip.endMs / 1000;
				if (
					safeCurrent >= clipStartSec - FRAME_TIME_EPSILON_SEC &&
					safeCurrent < clipEndSec - FRAME_TIME_EPSILON_SEC
				) {
					const delta = 1 / (safeFps * getSafeClipSpeed(clip));
					const candidate = Math.max(clipStartSec, safeCurrent) + delta;
					if (candidate < clipEndSec - FRAME_TIME_EPSILON_SEC) {
						return Math.min(safeDuration, candidate);
					}
					if (i + 1 < clips.length) {
						return Math.min(safeDuration, clips[i + 1].startMs / 1000);
					}
					return Math.min(safeDuration, clipEndSec);
				}
			}

			const nextClip = clips.find(
				(clip) => clip.startMs / 1000 > safeCurrent + FRAME_TIME_EPSILON_SEC,
			);
			return nextClip ? Math.min(safeDuration, nextClip.startMs / 1000) : safeCurrent;
		}

		// Backward fallback
		if (safeCurrent <= clips[0].startMs / 1000 + FRAME_TIME_EPSILON_SEC) {
			return 0;
		}

		for (let i = 1; i < clips.length; i++) {
			if (Math.abs(safeCurrent - clips[i].startMs / 1000) <= FRAME_TIME_EPSILON_SEC) {
				return Math.max(0, getFallbackLastFrameTimelineInClip(clips[i - 1], safeFps));
			}
		}

		for (let i = 0; i < clips.length; i++) {
			const clip = clips[i];
			const clipStartSec = clip.startMs / 1000;
			const clipEndSec = clip.endMs / 1000;
			if (
				safeCurrent > clipStartSec + FRAME_TIME_EPSILON_SEC &&
				safeCurrent <= clipEndSec + FRAME_TIME_EPSILON_SEC
			) {
				const delta = 1 / (safeFps * getSafeClipSpeed(clip));
				const candidate = Math.min(clipEndSec, safeCurrent) - delta;
				if (candidate > clipStartSec + FRAME_TIME_EPSILON_SEC) {
					return Math.max(0, candidate);
				}
				return Math.max(0, clipStartSec);
			}
		}

		for (let i = clips.length - 1; i >= 0; i--) {
			if (clips[i].endMs / 1000 < safeCurrent + FRAME_TIME_EPSILON_SEC) {
				return Math.max(0, getFallbackLastFrameTimelineInClip(clips[i], safeFps));
			}
		}

		return 0;
	}

	if (direction === "forward") {
		for (let i = 0; i < clips.length; i++) {
			const clip = clips[i];
			const { clipStartSec, clipEndSec, clipSourceEndSec } = getClipSourceBoundsSeconds(clip);
			if (
				safeCurrent >= clipStartSec - FRAME_TIME_EPSILON_SEC &&
				safeCurrent < clipEndSec - FRAME_TIME_EPSILON_SEC
			) {
				const clampedInClip = Math.max(clipStartSec, safeCurrent);
				const sourceSec = toSourceTimeSeconds(clip, clampedInClip);
				const nextIdx = findDisplayedFrameIndex(pts, sourceSec) + 1;
				if (
					nextIdx < pts.length &&
					pts[nextIdx] < clipSourceEndSec - FRAME_TIME_EPSILON_SEC
				) {
					return Math.min(safeDuration, toTimelineTimeSeconds(clip, pts[nextIdx]));
				}
				if (i + 1 < clips.length) {
					return Math.min(safeDuration, clips[i + 1].startMs / 1000);
				}
				return safeCurrent;
			}
		}

		const nextClip = clips.find(
			(clip) => clip.startMs / 1000 > safeCurrent + FRAME_TIME_EPSILON_SEC,
		);
		return nextClip ? Math.min(safeDuration, nextClip.startMs / 1000) : safeCurrent;
	}

	// Backward
	if (safeCurrent <= clips[0].startMs / 1000 + FRAME_TIME_EPSILON_SEC) {
		return 0;
	}

	for (let i = 1; i < clips.length; i++) {
		if (Math.abs(safeCurrent - clips[i].startMs / 1000) <= FRAME_TIME_EPSILON_SEC) {
			return Math.max(0, getLastFrameTimelineInClip(pts, clips[i - 1]));
		}
	}

	for (let i = 0; i < clips.length; i++) {
		const clip = clips[i];
		const { clipStartSec, clipEndSec, clipSourceStartSec, clipSourceEndSec } =
			getClipSourceBoundsSeconds(clip);
		if (
			safeCurrent > clipStartSec + FRAME_TIME_EPSILON_SEC &&
			safeCurrent <= clipEndSec + FRAME_TIME_EPSILON_SEC
		) {
			const effectiveSourceSec =
				safeCurrent >= clipEndSec - FRAME_TIME_EPSILON_SEC
					? Math.max(clipSourceStartSec, clipSourceEndSec - FRAME_TIME_EPSILON_SEC)
					: toSourceTimeSeconds(clip, safeCurrent);
			const curIdx = findDisplayedFrameIndex(pts, effectiveSourceSec);
			let prevIdx = curIdx - 1;
			while (prevIdx >= 0 && pts[curIdx] - pts[prevIdx] <= FRAME_TIME_EPSILON_SEC) {
				prevIdx--;
			}
			if (prevIdx >= 0 && pts[prevIdx] > clipSourceStartSec + FRAME_TIME_EPSILON_SEC) {
				return Math.max(0, toTimelineTimeSeconds(clip, pts[prevIdx]));
			}
			return Math.max(0, clipStartSec);
		}
	}

	for (let i = clips.length - 1; i >= 0; i--) {
		if (clips[i].endMs / 1000 < safeCurrent + FRAME_TIME_EPSILON_SEC) {
			return Math.max(0, getLastFrameTimelineInClip(pts, clips[i]));
		}
	}

	return 0;
}
