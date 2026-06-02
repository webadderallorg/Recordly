import type { SourceAudioTrackWithPeaks } from "@/components/video-editor/audio/audioTypes";
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
	sourceAudioPeaks,
	micSidecarPeaks,
	systemSidecarPeaks,
	labels,
}: {
	sourceAudioPeaks: AudioPeaksData | null;
	micSidecarPeaks: AudioPeaksData | null;
	systemSidecarPeaks: AudioPeaksData | null;
	labels: {
		system: string;
		mic: string;
		mixed: string;
	};
}): SourceAudioTrackWithPeaks[] {
	if (systemSidecarPeaks || micSidecarPeaks) {
		const tracks: SourceAudioTrackWithPeaks[] = [];
		if (systemSidecarPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: systemSidecarPeaks,
			});
		} else if (micSidecarPeaks && sourceAudioPeaks) {
			tracks.push({
				id: "system",
				label: labels.system,
				peaks: sourceAudioPeaks,
			});
		}
		if (micSidecarPeaks) {
			tracks.push({
				id: "mic",
				label: labels.mic,
				peaks: micSidecarPeaks,
			});
		}
		return tracks;
	}

	return sourceAudioPeaks
		? [
				{
					id: "mixed",
					label: labels.mixed,
					peaks: sourceAudioPeaks,
				},
			]
		: [];
}
