import { getCloudShareBitrate } from "@/components/video-editor/cloud/shareBitrate";
import {
	capShareDimensions,
	type ShareResolution,
} from "@/components/video-editor/cloud/shareResolution";
import {
	type ClipRegion,
	type SpeedRegion,
	type TrimRegion,
	getTimelineDurationMs,
} from "@/components/video-editor/types";
import { AUDIO_BITRATE } from "./audioProcessorShared";
import { getMp4ExportBitrate } from "./exportBitrate";
import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";
import { computeVideoSegments, splitVideoSegmentsBySpeed } from "./videoTimelineSegments";

/** Approximate target-rate size; content and encoder/container overhead affect actual bytes. */
export function estimateMp4FileBytes(options: {
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	durationSeconds: number;
	includeAudio?: boolean;
	/** Cloud estimates use source dimensions plus the plan cap, ignoring local quality. */
	cloudResolution?: ShareResolution;
}): number | null {
	if (
		![options.width, options.height, options.frameRate, options.durationSeconds].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	) {
		return null;
	}
	const videoBitrate = options.cloudResolution
		? getCloudShareBitrate({
				...capShareDimensions(options, options.cloudResolution),
				frameRate: options.frameRate,
			})
		: getMp4ExportBitrate(options);
	// Re-encoded audio uses the same AAC target as both export audio processors.
	const audioBitrate = options.includeAudio ? AUDIO_BITRATE : 0;
	const bytes = Math.round(((videoBitrate + audioBitrate) * options.durationSeconds) / 8);
	return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/** Mirrors StreamingVideoDecoder's timeline duration, including clip gaps and speed changes. */
export function getEditedExportDurationSeconds(options: {
	durationSeconds: number;
	clipRegions?: ClipRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
}): number | null {
	if (!Number.isFinite(options.durationSeconds) || options.durationSeconds < 0) return null;
	let duration: number;
	if (options.clipRegions) {
		if (
			options.clipRegions.some(
				(clip) => !Number.isFinite(clip.startMs) || !Number.isFinite(clip.endMs),
			)
		)
			return null;
		duration =
			getTimelineDurationMs(options.clipRegions, options.durationSeconds * 1000) / 1000;
	} else {
		const regions = [...(options.trimRegions ?? []), ...(options.speedRegions ?? [])];
		if (
			regions.some(
				(region) =>
					!Number.isFinite(region.startMs) ||
					!Number.isFinite(region.endMs) ||
					region.endMs < region.startMs,
			) ||
			options.speedRegions?.some(
				(region) => !Number.isFinite(region.speed) || region.speed <= 0,
			)
		)
			return null;
		const segments = splitVideoSegmentsBySpeed(
			computeVideoSegments(options.durationSeconds, options.trimRegions),
			options.speedRegions,
		);
		duration = segments.reduce(
			(sum, segment) => sum + (segment.endSec - segment.startSec) / segment.speed,
			0,
		);
	}
	return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
