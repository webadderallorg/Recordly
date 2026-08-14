import { useEffect, useRef, useState } from "react";
import { getVersionedAudioResourceUrl } from "@/components/video-editor/audio/audioResourceVersion";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { waveformGenerator } from "../../audio/waveform/WaveformGenerator";
import { fromFileUrl } from "../../projectPersistence";
import { WAVEFORM_DEFAULT_PEAK_COUNT } from "../core/constants";
import type { AudioPeaksData } from "../core/timelineTypes";
import {
	BoundedMediaUrlResolverCache,
	buildSourceSidecarPathCandidates,
} from "../sourceAudioTracks";

const EMPTY_FALLBACK_RESOURCES: string[] = [];

// Shared across hook instances and remounts so repeated resolution of the same
// sidecar path does not repeat an identical get-local-media-url IPC call.
const mediaUrlResolverCache = new BoundedMediaUrlResolverCache(resolveMediaResourceUrl);

function extractLocalPathFromMediaServerUrl(input: string): string | null {
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

interface TimelineAudioPeaksOptions {
	enableSourceSidecarFallback?: boolean;
	fallbackResources?: string[];
	// Authoritative companion sidecar paths reported by the main process
	// (get-video-audio-fallback-paths). When provided, these replace the
	// speculative candidates derived from the source path so the renderer never
	// asks the media server for paths the finalized recording cannot produce.
	authoritativeSidecarPaths?: readonly string[];
	// Deterministic sidecar paths the finalized recording metadata reports as
	// expected but not yet materialized. They are retried on each refresh without
	// being duplicated into the primary candidate list.
	delayedSidecarPaths?: readonly string[];
	peakCount?: number;
	resourceVersion?: number;
}

export interface TimelineAudioPeaksResult {
	peaks: AudioPeaksData | null;
	loading: boolean;
}

export function useTimelineAudioPeaks(
	mediaResource: string | null | undefined,
	options: TimelineAudioPeaksOptions = {},
): TimelineAudioPeaksResult {
	const [peaks, setPeaks] = useState<AudioPeaksData | null>(null);
	const [loading, setLoading] = useState(false);
	const sourceRef = useRef(mediaResource);
	const enableSourceSidecarFallback = options.enableSourceSidecarFallback ?? false;
	const fallbackResources = options.fallbackResources ?? EMPTY_FALLBACK_RESOURCES;
	const authoritativeSidecarPaths = options.authoritativeSidecarPaths ?? EMPTY_FALLBACK_RESOURCES;
	const delayedSidecarPaths = options.delayedSidecarPaths ?? EMPTY_FALLBACK_RESOURCES;
	const peakCount = options.peakCount ?? WAVEFORM_DEFAULT_PEAK_COUNT;
	const resourceVersion = options.resourceVersion ?? 0;

	useEffect(() => {
		sourceRef.current = mediaResource;
		setPeaks(null);
		if (!mediaResource) {
			setLoading(false);
			return;
		}

		setLoading(true);
		let cancelled = false;

		const run = async () => {
			const tryGenerate = async (resource: string): Promise<AudioPeaksData> => {
				const resolvedUrl = await mediaUrlResolverCache.resolve(resource);
				const versionedUrl = getVersionedAudioResourceUrl(resolvedUrl, resourceVersion);
				return waveformGenerator.generate(versionedUrl, peakCount, resourceVersion);
			};

			try {
				const result = await tryGenerate(mediaResource);
				if (!cancelled && sourceRef.current === mediaResource) {
					setPeaks(result);
					setLoading(false);
				}
				return;
			} catch {
				// fallthrough
			}

			if (
				!enableSourceSidecarFallback &&
				fallbackResources.length === 0 &&
				authoritativeSidecarPaths.length === 0 &&
				delayedSidecarPaths.length === 0
			) {
				if (!cancelled && sourceRef.current === mediaResource) {
					setLoading(false);
				}
				return;
			}

			let sourceSidecarCandidates: string[] = [];
			if (authoritativeSidecarPaths.length > 0) {
				// Authoritative main-process companion sidecars. These are the exact
				// paths the finalized recording reports as usable; no speculative
				// variants are derived from the source path, so impossible candidates
				// are never sent to the media server.
				sourceSidecarCandidates = [...authoritativeSidecarPaths];
			} else if (enableSourceSidecarFallback) {
				const localPathFromServer = extractLocalPathFromMediaServerUrl(mediaResource);
				const localSourcePath =
					localPathFromServer ||
					(/^file:\/\//i.test(mediaResource)
						? fromFileUrl(mediaResource)
						: mediaResource);
				if (localSourcePath) {
					// System sidecars first, then mic sidecars, preserving the legacy
					// candidate ordering. Extension set is platform-aware (Windows only
					// ever materializes .wav sidecars).
					sourceSidecarCandidates = [
						...buildSourceSidecarPathCandidates(localSourcePath, "system"),
						...buildSourceSidecarPathCandidates(localSourcePath, "mic"),
					];
				}
			}

			// Delayed sidecars are appended for retry (deduped) so a sidecar that the
			// recording metadata expects but has not materialized yet is re-probed on
			// the next refresh instead of being dropped or duplicated.
			const candidates = Array.from(
				new Set([...fallbackResources, ...sourceSidecarCandidates, ...delayedSidecarPaths]),
			);
			for (const candidate of candidates) {
				try {
					const result = await tryGenerate(candidate);
					if (!cancelled && sourceRef.current === mediaResource) {
						setPeaks(result);
						setLoading(false);
					}
					return;
				} catch {
					// try next
				}
			}

			if (!cancelled && sourceRef.current === mediaResource) {
				setLoading(false);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, [
		mediaResource,
		enableSourceSidecarFallback,
		fallbackResources,
		authoritativeSidecarPaths,
		delayedSidecarPaths,
		peakCount,
		resourceVersion,
	]);

	return { peaks, loading };
}
