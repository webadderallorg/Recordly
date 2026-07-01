import type { SourceAudioTrackWithPeaks } from "@/components/video-editor/audio/audioTypes";
import type { SourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import type { AudioPeaksData } from "./core/timelineTypes";

const SOURCE_SIDECAR_EXTENSIONS = [".wav", ".m4a", ".webm"] as const;

export function buildSourceSidecarPathCandidates(
	source: string,
	suffix: "mic" | "system",
): string[] {
	const normalized = source.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	return SOURCE_SIDECAR_EXTENSIONS.map((extension) => `${dir}${baseName}.${suffix}${extension}`);
}

export function buildTimelineSourceAudioTracks({
	routingPolicy,
	videoResource,
	sourceAudioPeaks,
	micSidecarPeaks,
	systemSidecarPeaks,
	mixedSidecarPeaks,
	probedDurationMsByPath = {},
	labels,
}: {
	routingPolicy: SourceTrackRoutingPolicy;
	videoResource: string | null;
	sourceAudioPeaks: AudioPeaksData | null;
	micSidecarPeaks: AudioPeaksData | null;
	systemSidecarPeaks: AudioPeaksData | null;
	mixedSidecarPeaks: AudioPeaksData | null;
	probedDurationMsByPath?: Record<string, number>;
	labels: {
		system: string;
		mic: string;
		mixed: string;
	};
}): SourceAudioTrackWithPeaks[] {
	const getProbedDurationMs = (resourcePath: string | null) => {
		if (!resourcePath) return null;
		const durationMs = probedDurationMsByPath[resourcePath];
		return Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
	};
	const getWaveformCoverage = (
		peaks: AudioPeaksData | null,
		probedDurationMs: number | null,
	): "full" | "partial" | "none" => {
		if (!peaks) return "none";
		const durationMs = probedDurationMs ?? Number.NaN;
		if (!Number.isFinite(durationMs)) return "full";
		return peaks.durationMs + 250 < durationMs ? "partial" : "full";
	};
	const systemResourcePath = routingPolicy.pathsByTrack.system ?? null;
	const micResourcePath = routingPolicy.pathsByTrack.mic ?? null;
	const mixedResourcePath = routingPolicy.pathsByTrack.mixed ?? null;

	if (systemResourcePath || micResourcePath) {
		const tracks: SourceAudioTrackWithPeaks[] = [];
		if (systemResourcePath) {
			const probedDurationMs = getProbedDurationMs(systemResourcePath);
			tracks.push({
				id: "system",
				label: labels.system,
				kind: "system",
				resourcePath: systemResourcePath,
				peaks: systemSidecarPeaks,
				probedDurationMs,
				waveformAvailable: systemSidecarPeaks !== null,
				waveformCoverage: getWaveformCoverage(systemSidecarPeaks, probedDurationMs),
			});
		} else if (routingPolicy.hasEmbeddedSourceAudio && routingPolicy.includeEmbeddedInExport) {
			tracks.push({
				id: "system",
				label: labels.system,
				kind: "embedded",
				resourcePath: videoResource,
				peaks: sourceAudioPeaks,
				probedDurationMs: null,
				waveformAvailable: sourceAudioPeaks !== null,
				waveformCoverage: getWaveformCoverage(sourceAudioPeaks, null),
			});
		}
		if (micResourcePath) {
			const probedDurationMs = getProbedDurationMs(micResourcePath);
			tracks.push({
				id: "mic",
				label: labels.mic,
				kind: "mic",
				resourcePath: micResourcePath,
				peaks: micSidecarPeaks,
				probedDurationMs,
				waveformAvailable: micSidecarPeaks !== null,
				waveformCoverage: getWaveformCoverage(micSidecarPeaks, probedDurationMs),
			});
		}
		return tracks;
	}

	if (mixedResourcePath) {
		const probedDurationMs = getProbedDurationMs(mixedResourcePath);
		return [
			{
				id: "mixed",
				label: labels.mixed,
				kind: "mixed",
				resourcePath: mixedResourcePath,
				peaks: mixedSidecarPeaks,
				probedDurationMs,
				waveformAvailable: mixedSidecarPeaks !== null,
				waveformCoverage: getWaveformCoverage(mixedSidecarPeaks, probedDurationMs),
			},
		];
	}

	return (routingPolicy.hasEmbeddedSourceAudio || sourceAudioPeaks !== null) && videoResource
		? [
				{
					id: "mixed",
					label: labels.mixed,
					kind: "embedded",
					resourcePath: videoResource,
					peaks: sourceAudioPeaks,
					probedDurationMs: null,
					waveformAvailable: sourceAudioPeaks !== null,
					waveformCoverage: getWaveformCoverage(sourceAudioPeaks, null),
				},
			]
		: [];
}
