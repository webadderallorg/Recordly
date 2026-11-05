import { hasClipSourceAudioOverrides } from "./audioProcessorShared";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { requiresClipTimelineRendering } from "./clipTimeline";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import {
	FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE,
	hasNonDefaultSourceTrackSettings,
	NativeAudioPlan,
} from "./legacyVideoExporterContext";
import { getLocalFilePath } from "./localMediaSource";
import { type DecodedVideoInfo } from "./streamingDecoder";

export function getNativeVideoSourcePath(
	context: Pick<LegacyVideoExporterContext, "config">,
): string | null {
	return context.config.videoUrl ? getLocalFilePath(context.config.videoUrl) : null;
}

export function buildNativeTrimSegments(
	context: Pick<LegacyVideoExporterContext, "config">,
	durationMs: number,
): Array<{ startMs: number; endMs: number }> {
	const trimRegions = [...(context.config.trimRegions ?? [])].sort(
		(a, b) => a.startMs - b.startMs,
	);
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

export function buildNativeAudioPlan(
	context: Pick<
		LegacyVideoExporterContext,
		"config" | "getNativeVideoSourcePath" | "buildNativeTrimSegments"
	>,
	videoInfo: DecodedVideoInfo,
): NativeAudioPlan {
	const speedRegions = context.config.speedRegions ?? [];
	const audioRegions = context.config.audioRegions ?? [];
	const sourceAudioFallbackPaths = (context.config.sourceAudioFallbackPaths ?? []).filter(
		(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
	);
	const hasTimedSourceAudioFallback = sourceAudioFallbackPaths.some(
		(audioPath) => (context.config.sourceAudioFallbackStartDelayMsByPath?.[audioPath] ?? 0) > 0,
	);
	const localVideoSourcePath = context.getNativeVideoSourcePath();
	const primaryAudioSourcePath =
		(videoInfo.hasAudio ? localVideoSourcePath : null) ?? sourceAudioFallbackPaths[0] ?? null;
	const usesEmbeddedPrimaryAudio =
		Boolean(videoInfo.hasAudio) && primaryAudioSourcePath === localVideoSourcePath;
	const primaryAudioSourceSampleRate = usesEmbeddedPrimaryAudio
		? videoInfo.audioSampleRate
		: FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE;

	if (!videoInfo.hasAudio && sourceAudioFallbackPaths.length === 0 && audioRegions.length === 0) {
		return { audioMode: "none" };
	}

	if (
		requiresClipTimelineRendering(context.config.clipRegions) ||
		speedRegions.length > 0 ||
		audioRegions.length > 0 ||
		sourceAudioFallbackPaths.length > 1 ||
		hasTimedSourceAudioFallback ||
		hasNonDefaultSourceTrackSettings(context.config.sourceAudioTrackSettings) ||
		hasClipSourceAudioOverrides(
			context.config.clipRegions,
			context.config.sourceAudioTrackSettingsByClip,
		) ||
		(context.config.clipRegions ?? []).some((clip) => Boolean(clip.muted))
	) {
		const sourceDurationMs = Math.max(
			0,
			Math.round(
				getEffectiveVideoStreamDurationSeconds({
					duration: videoInfo.duration,
					streamDuration: videoInfo.streamDuration,
				}) * 1000,
			),
		);
		const trimRegions = context.config.trimRegions ?? [];
		const canUsePrimaryAudioFiltergraph =
			!requiresClipTimelineRendering(context.config.clipRegions) &&
			!hasNonDefaultSourceTrackSettings(context.config.sourceAudioTrackSettings) &&
			!hasClipSourceAudioOverrides(
				context.config.clipRegions,
				context.config.sourceAudioTrackSettingsByClip,
			) &&
			!(context.config.clipRegions ?? []).some((clip) => Boolean(clip.muted)) &&
			Boolean(primaryAudioSourcePath) &&
			!hasTimedSourceAudioFallback &&
			(usesEmbeddedPrimaryAudio ||
				sourceAudioFallbackPaths.includes(primaryAudioSourcePath ?? "")) &&
			typeof primaryAudioSourceSampleRate === "number" &&
			Number.isFinite(primaryAudioSourceSampleRate) &&
			primaryAudioSourceSampleRate > 0;
		const strategy = canUsePrimaryAudioFiltergraph
			? classifyEditedTrackStrategy({
					primaryAudioSourcePath,
					sourceDurationMs,
					trimRegions,
					speedRegions,
					audioRegions,
					sourceAudioFallbackPaths,
				})
			: "offline-render-fallback";

		if (strategy === "filtergraph-fast-path") {
			const audioSourcePath = primaryAudioSourcePath;
			const audioSourceSampleRate = primaryAudioSourceSampleRate;
			const editedTrackSegments = buildEditedTrackSourceSegments(
				sourceDurationMs,
				trimRegions,
				speedRegions,
			);
			if (
				audioSourcePath &&
				typeof audioSourceSampleRate === "number" &&
				editedTrackSegments.length > 0
			) {
				return {
					audioMode: "edited-track",
					strategy,
					audioSourcePath,
					audioSourceSampleRate,
					editedTrackSegments,
				};
			}
		}

		return {
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
		};
	}

	if (!primaryAudioSourcePath) {
		return {
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
		};
	}

	if ((context.config.trimRegions ?? []).length > 0) {
		const sourceDurationMs = Math.max(
			0,
			Math.round(
				getEffectiveVideoStreamDurationSeconds({
					duration: videoInfo.duration,
					streamDuration: videoInfo.streamDuration,
				}) * 1000,
			),
		);
		const trimSegments = context.buildNativeTrimSegments(sourceDurationMs);
		if (trimSegments.length === 0) {
			return { audioMode: "none" };
		}

		return {
			audioMode: "trim-source",
			audioSourcePath: primaryAudioSourcePath,
			trimSegments,
		};
	}

	return {
		audioMode: "copy-source",
		audioSourcePath: primaryAudioSourcePath,
	};
}
