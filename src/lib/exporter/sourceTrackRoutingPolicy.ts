import {
	buildResolvedAudioPlan,
	type SourceTrackId,
} from "./audioRoutingEngine";

export interface SourceTrackRoutingPolicy {
	hasEmbeddedSourceAudio: boolean;
	pathsByTrack: Partial<Record<SourceTrackId, string>>;
	playbackPaths: string[];
	muteEmbeddedPreview: boolean;
	includeEmbeddedInExport: boolean;
}

export function resolveSourceTrackRoutingPolicy(
	videoResource: string | null | undefined,
	sourceAudioFallbackPaths: string[] | null | undefined,
): SourceTrackRoutingPolicy {
	const plan = buildResolvedAudioPlan({
		videoResource,
		sourceAudioFallbackPaths,
	});

	return {
		hasEmbeddedSourceAudio: plan.hasEmbeddedSourceAudio,
		pathsByTrack: plan.pathsByTrack,
		playbackPaths: plan.playbackPaths,
		muteEmbeddedPreview: plan.muteEmbeddedPreview,
		includeEmbeddedInExport: plan.includeEmbeddedInExport,
	};
}
