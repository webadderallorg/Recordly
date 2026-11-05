import { useEffect, useMemo } from "react";
import type { SourceAudioTrackMeta } from "@/components/video-editor/audio/audioTypes";
import { useScopedT } from "@/contexts/I18nContext";
import { fromFileUrl } from "../../projectPersistence";
import {
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
} from "../sourceAudioTracks";
import { useTimelineAudioPeaks } from "./useTimelineAudioPeaks";

interface TimelineSourceAudioOptions {
	videoPath?: string | null;
	sourceAudioResourceVersion?: number;
	onSourceAudioTracksMetaChange?: (tracks: SourceAudioTrackMeta) => void;
	onSourceAudioAvailabilityChange?: (available: boolean) => void;
}

function extractLocalPathFromMediaServerUrl(input: string | null | undefined): string | null {
	if (!input) return null;
	try {
		const url = new URL(input);
		const isLocalMediaServer =
			(url.protocol === "http:" || url.protocol === "https:") &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
			url.pathname === "/video";
		if (!isLocalMediaServer) return null;
		return url.searchParams.get("path");
	} catch {
		return null;
	}
}

export function useTimelineSourceAudioTracks({
	videoPath,
	sourceAudioResourceVersion = 0,
	onSourceAudioTracksMetaChange,
	onSourceAudioAvailabilityChange,
}: TimelineSourceAudioOptions) {
	const t = useScopedT("settings");
	const { peaks: sourceAudioPeaks, loading: sourceAudioLoading } = useTimelineAudioPeaks(
		videoPath,
		{ resourceVersion: sourceAudioResourceVersion },
	);
	const localSourcePath = useMemo(() => {
		if (!videoPath) return null;
		return (
			extractLocalPathFromMediaServerUrl(videoPath) ||
			(/^file:\/\//i.test(videoPath) ? fromFileUrl(videoPath) : videoPath)
		);
	}, [videoPath]);
	const micSidecarPaths = useMemo(
		() => (localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "mic") : []),
		[localSourcePath],
	);
	const micSidecarFallbackPaths = useMemo(() => micSidecarPaths.slice(1), [micSidecarPaths]);
	const systemSidecarPaths = useMemo(
		() => (localSourcePath ? buildSourceSidecarPathCandidates(localSourcePath, "system") : []),
		[localSourcePath],
	);
	const systemSidecarFallbackPaths = useMemo(
		() => systemSidecarPaths.slice(1),
		[systemSidecarPaths],
	);
	const { peaks: micSidecarPeaks, loading: micSidecarLoading } = useTimelineAudioPeaks(
		micSidecarPaths[0] ?? null,
		{
			fallbackResources: micSidecarFallbackPaths,
			resourceVersion: sourceAudioResourceVersion,
		},
	);
	const { peaks: systemSidecarPeaks, loading: systemSidecarLoading } = useTimelineAudioPeaks(
		systemSidecarPaths[0] ?? null,
		{
			fallbackResources: systemSidecarFallbackPaths,
			resourceVersion: sourceAudioResourceVersion,
		},
	);
	const sourceAudioTracks = useMemo(
		() =>
			buildTimelineSourceAudioTracks({
				sourceAudioPeaks,
				micSidecarPeaks,
				systemSidecarPeaks,
				labels: {
					system: t("audio.systemLabel", "Source System"),
					mic: t("audio.micLabel", "Source Mic"),
					mixed: t("audio.mixedLabel", "Source"),
				},
			}),
		[micSidecarPeaks, sourceAudioPeaks, systemSidecarPeaks, t],
	);
	useEffect(() => {
		onSourceAudioTracksMetaChange?.(
			sourceAudioTracks.map((t) => ({ id: t.id, label: t.label })),
		);
	}, [onSourceAudioTracksMetaChange, sourceAudioTracks]);
	useEffect(() => {
		onSourceAudioAvailabilityChange?.(sourceAudioTracks.length > 0);
	}, [onSourceAudioAvailabilityChange, sourceAudioTracks.length]);
	return { sourceAudioTracks, sourceAudioLoading, micSidecarLoading, systemSidecarLoading };
}
