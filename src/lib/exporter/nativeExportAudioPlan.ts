import {
	hasClipSourceAudioOverrides,
	hasNonDefaultSourceTrackSettings,
} from "./audioProcessorShared";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { requiresClipTimelineRendering } from "./clipTimeline";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";
import { getLocalFilePath } from "./localMediaSource";
import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import { buildNativeTrimSegments } from "./nativeExportTimeline";
import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";
import type { DecodedVideoInfo } from "./streamingDecoder";

type NativeAudioConfig = Pick<
	VideoExporterConfig,
	| "videoUrl"
	| "trimRegions"
	| "speedRegions"
	| "clipRegions"
	| "audioRegions"
	| "sourceAudioFallbackPaths"
	| "sourceAudioFallbackStartDelayMsByPath"
	| "sourceAudioTrackSettings"
	| "sourceAudioTrackSettingsByClip"
>;

export type NativeAudioPlan =
	| {
			audioMode: "none";
	  }
	| {
			audioMode: "copy-source" | "trim-source";
			audioSourcePath: string;
			audioSourceCodec?: string;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
	  }
	| {
			audioMode: "edited-track";
			strategy: "offline-render-fallback";
			sourceAudioFallbackPaths?: string[];
	  }
	| {
			audioMode: "edited-track";
			strategy: "filtergraph-fast-path";
			audioSourcePath: string;
			audioSourceCodec?: string;
			audioSourceSampleRate: number;
			editedTrackSegments: Array<{
				startMs: number;
				endMs: number;
				speed: number;
			}>;
	  };

const FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE = 48_000;

function getNativeAudioFallbackPaths(
	config: NativeAudioConfig,
	videoInfo: DecodedVideoInfo,
): string[] {
	const sourceAudioFallbackPaths = (config.sourceAudioFallbackPaths ?? []).filter(
		(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
	);
	const localVideoSourcePath = config.videoUrl ? getLocalFilePath(config.videoUrl) : null;
	if (!videoInfo.hasAudio || !localVideoSourcePath) {
		return sourceAudioFallbackPaths;
	}

	const { externalAudioPaths } = resolveSourceAudioFallbackPaths(
		localVideoSourcePath,
		sourceAudioFallbackPaths,
	);
	if (externalAudioPaths.length === 0) {
		return sourceAudioFallbackPaths;
	}

	return [localVideoSourcePath, ...externalAudioPaths];
}

export function buildNativeAudioPlan(
	config: NativeAudioConfig,
	videoInfo: DecodedVideoInfo,
): NativeAudioPlan {
	const speedRegions = config.speedRegions ?? [];
	const audioRegions = config.audioRegions ?? [];
	const sourceAudioFallbackPaths = getNativeAudioFallbackPaths(config, videoInfo);
	const hasTimedSourceAudioFallback = sourceAudioFallbackPaths.some(
		(audioPath) => (config.sourceAudioFallbackStartDelayMsByPath?.[audioPath] ?? 0) > 0,
	);
	const localVideoSourcePath = config.videoUrl ? getLocalFilePath(config.videoUrl) : null;
	const primaryAudioSourcePath =
		(videoInfo.hasAudio ? localVideoSourcePath : null) ?? sourceAudioFallbackPaths[0] ?? null;
	const usesEmbeddedPrimaryAudio =
		Boolean(videoInfo.hasAudio) && primaryAudioSourcePath === localVideoSourcePath;
	const primaryAudioSourceSampleRate = usesEmbeddedPrimaryAudio
		? videoInfo.audioSampleRate
		: FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE;
	const primaryAudioSourceCodec = usesEmbeddedPrimaryAudio ? videoInfo.audioCodec : undefined;

	if (!videoInfo.hasAudio && sourceAudioFallbackPaths.length === 0 && audioRegions.length === 0) {
		return { audioMode: "none" };
	}

	if (
		requiresClipTimelineRendering(config.clipRegions) ||
		speedRegions.length > 0 ||
		audioRegions.length > 0 ||
		sourceAudioFallbackPaths.length > 1 ||
		hasTimedSourceAudioFallback ||
		hasNonDefaultSourceTrackSettings(config.sourceAudioTrackSettings) ||
		hasClipSourceAudioOverrides(config.clipRegions, config.sourceAudioTrackSettingsByClip) ||
		(config.clipRegions ?? []).some((clip) => Boolean(clip.muted))
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
		const trimRegions = config.trimRegions ?? [];
		const canUsePrimaryAudioFiltergraph =
			Boolean(primaryAudioSourcePath) &&
			!hasTimedSourceAudioFallback &&
			(usesEmbeddedPrimaryAudio ||
				sourceAudioFallbackPaths.includes(primaryAudioSourcePath ?? "")) &&
			typeof primaryAudioSourceSampleRate === "number" &&
			Number.isFinite(primaryAudioSourceSampleRate) &&
			primaryAudioSourceSampleRate > 0;
		const requiresRenderedEditedTrack =
			requiresClipTimelineRendering(config.clipRegions) ||
			hasNonDefaultSourceTrackSettings(config.sourceAudioTrackSettings) ||
			hasClipSourceAudioOverrides(
				config.clipRegions,
				config.sourceAudioTrackSettingsByClip,
			) ||
			(config.clipRegions ?? []).some((clip) => Boolean(clip.muted));
		const strategy =
			canUsePrimaryAudioFiltergraph && !requiresRenderedEditedTrack
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
					audioSourceCodec: primaryAudioSourceCodec,
					audioSourceSampleRate,
					editedTrackSegments,
				};
			}
		}

		return {
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
			sourceAudioFallbackPaths,
		};
	}

	if (!primaryAudioSourcePath) {
		return {
			audioMode: "edited-track",
			strategy: "offline-render-fallback",
			sourceAudioFallbackPaths,
		};
	}

	if ((config.trimRegions ?? []).length > 0) {
		const sourceDurationMs = Math.max(
			0,
			Math.round(
				getEffectiveVideoStreamDurationSeconds({
					duration: videoInfo.duration,
					streamDuration: videoInfo.streamDuration,
				}) * 1000,
			),
		);
		const trimSegments = buildNativeTrimSegments(config, sourceDurationMs);
		if (trimSegments.length === 0) {
			return { audioMode: "none" };
		}

		return {
			audioMode: "trim-source",
			audioSourcePath: primaryAudioSourcePath,
			audioSourceCodec: primaryAudioSourceCodec,
			trimSegments,
		};
	}

	return {
		audioMode: "copy-source",
		audioSourcePath: primaryAudioSourcePath,
		audioSourceCodec: primaryAudioSourceCodec,
	};
}
