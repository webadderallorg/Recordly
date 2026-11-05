import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { DecodedVideoInfo } from "./streamingDecoder";

type NativeTimelineConfig = Pick<VideoExporterConfig, "trimRegions" | "speedRegions">;

const MIN_NATIVE_STATIC_LAYOUT_SPEED = 0.25;
const MAX_NATIVE_STATIC_LAYOUT_SPEED = 30;

export type NativeStaticLayoutTimelineSegment = {
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
};

function canUseNativeStaticLayoutSpeed(speed: number): boolean {
	return (
		Number.isFinite(speed) &&
		speed >= MIN_NATIVE_STATIC_LAYOUT_SPEED &&
		speed <= MAX_NATIVE_STATIC_LAYOUT_SPEED
	);
}

function buildNativeStaticLayoutTimelineSegments(
	segments: Array<{ startMs: number; endMs: number; speed: number }>,
): NativeStaticLayoutTimelineSegment[] {
	const timelineSegments: NativeStaticLayoutTimelineSegment[] = [];
	let outputCursorMs = 0;

	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.startMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.endMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			speed <= 0
		) {
			return [];
		}

		const outputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (!Number.isFinite(outputDurationMs) || outputDurationMs <= 0.5) {
			return [];
		}

		const outputStartMs = outputCursorMs;
		const outputEndMs = outputStartMs + outputDurationMs;
		timelineSegments.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		outputCursorMs = outputEndMs;
	}

	return timelineSegments;
}

export function buildNativeTrimSegments(
	config: NativeTimelineConfig,
	durationMs: number,
): Array<{ startMs: number; endMs: number }> {
	const trimRegions = [...(config.trimRegions ?? [])].sort((a, b) => a.startMs - b.startMs);
	if (trimRegions.length === 0) {
		return [{ startMs: 0, endMs: Math.max(0, durationMs) }];
	}

	const segments: Array<{ startMs: number; endMs: number }> = [];
	let cursorMs = 0;

	for (const region of trimRegions) {
		const startMs = Math.max(0, Math.min(region.startMs, durationMs));
		const endMs = Math.max(startMs, Math.min(region.endMs, durationMs));
		if (startMs > cursorMs) {
			segments.push({ startMs: cursorMs, endMs: startMs });
		}
		cursorMs = Math.max(cursorMs, endMs);
	}

	if (cursorMs < durationMs) {
		segments.push({ startMs: cursorMs, endMs: durationMs });
	}

	return segments.filter((segment) => segment.endMs - segment.startMs > 0.5);
}

export function getNativeStaticLayoutEffectiveDuration(
	config: NativeTimelineConfig,
	videoInfo: DecodedVideoInfo,
): number {
	const sourceDurationSec = getEffectiveVideoStreamDurationSeconds({
		duration: videoInfo.duration,
		streamDuration: videoInfo.streamDuration,
	});
	const sourceDurationMs = sourceDurationSec * 1000;
	const speedRegions = config.speedRegions ?? [];
	if (speedRegions.length > 0) {
		const timelineSegments = buildNativeStaticLayoutSourceSegments(config, sourceDurationMs);
		if (timelineSegments.length > 0) {
			return timelineSegments.reduce(
				(totalSec, segment) =>
					totalSec + (segment.endMs - segment.startMs) / segment.speed / 1000,
				0,
			);
		}
	}

	const trimSegments = buildNativeTrimSegments(config, sourceDurationMs);
	return trimSegments.reduce(
		(totalSec, segment) => totalSec + (segment.endMs - segment.startMs) / 1000,
		0,
	);
}

function buildNativeStaticLayoutSourceSegments(
	config: NativeTimelineConfig,
	sourceDurationMs: number,
) {
	if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) {
		return [];
	}

	const speedRegions = config.speedRegions ?? [];
	if (
		speedRegions.some(
			(region) =>
				!Number.isFinite(region.startMs) ||
				!Number.isFinite(region.endMs) ||
				!canUseNativeStaticLayoutSpeed(region.speed),
		)
	) {
		return [];
	}

	const normalizedSpeedRegions = speedRegions
		.map((region) => ({
			startMs: Math.max(0, Math.min(region.startMs, sourceDurationMs)),
			endMs: Math.max(0, Math.min(region.endMs, sourceDurationMs)),
			speed: region.speed,
		}))
		.filter((region) => region.endMs - region.startMs > 0.5);
	const sourceSegments: Array<{
		startMs: number;
		endMs: number;
		speed: number;
	}> = [];

	for (const keptRange of buildNativeTrimSegments(config, sourceDurationMs)) {
		const boundaries = new Set<number>([keptRange.startMs, keptRange.endMs]);
		for (const speedRegion of normalizedSpeedRegions) {
			const startMs = Math.max(keptRange.startMs, speedRegion.startMs);
			const endMs = Math.min(keptRange.endMs, speedRegion.endMs);
			if (endMs - startMs > 0.5) {
				boundaries.add(startMs);
				boundaries.add(endMs);
			}
		}

		const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
		for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
			const startMs = orderedBoundaries[index] ?? 0;
			const endMs = orderedBoundaries[index + 1] ?? 0;
			if (endMs - startMs <= 0.5) {
				continue;
			}

			const midpointMs = startMs + (endMs - startMs) / 2;
			const speedRegion = normalizedSpeedRegions.find(
				(region) => midpointMs >= region.startMs && midpointMs < region.endMs,
			);
			sourceSegments.push({
				startMs,
				endMs,
				speed: speedRegion?.speed ?? 1,
			});
		}
	}

	return sourceSegments;
}

export function buildNativeStaticLayoutVideoTimelineSegments(
	config: NativeTimelineConfig,
	videoInfo: DecodedVideoInfo,
): NativeStaticLayoutTimelineSegment[] {
	const sourceDurationMs = Math.max(
		0,
		Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
	);
	const sourceSegments = buildNativeStaticLayoutSourceSegments(config, sourceDurationMs);
	return buildNativeStaticLayoutTimelineSegments(sourceSegments);
}

export function shouldUseNativeStaticLayoutTimelineMap(
	config: NativeTimelineConfig,
	videoInfo: DecodedVideoInfo,
	effectiveDurationSec: number,
): boolean {
	const speedRegions = config.speedRegions ?? [];
	if (speedRegions.length > 0) {
		return true;
	}

	const trimRegions = config.trimRegions ?? [];
	return (
		trimRegions.length > 0 &&
		!canUseNativeStaticTailTrim(config, videoInfo, effectiveDurationSec)
	);
}

function canUseNativeStaticTailTrim(
	config: NativeTimelineConfig,
	videoInfo: DecodedVideoInfo,
	effectiveDurationSec: number,
): boolean {
	const trimRegions = config.trimRegions ?? [];
	if (trimRegions.length === 0) {
		return true;
	}

	if (trimRegions.length !== 1) {
		return false;
	}

	const [trim] = trimRegions;
	const sourceDurationMs = Math.max(
		0,
		Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
	);
	const outputDurationMs = Math.max(0, Math.round(effectiveDurationSec * 1000));
	const toleranceMs = 250;

	return (
		Math.abs(trim.startMs - outputDurationMs) <= toleranceMs &&
		Math.abs(trim.endMs - sourceDurationMs) <= toleranceMs
	);
}
