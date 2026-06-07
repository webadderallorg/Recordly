import { useEffect, useRef, useState } from "react";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { waveformGenerator } from "../../audio/waveform/WaveformGenerator";
import { fromFileUrl } from "../../projectPersistence";
import { WAVEFORM_DEFAULT_PEAK_COUNT } from "../core/constants";
import type { AudioPeaksData } from "../core/timelineTypes";

const EMPTY_FALLBACK_RESOURCES: string[] = [];

function buildSidecarAudioCandidates(sourcePath: string): string[] {
	const normalized = sourcePath.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "";
	const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
	const dotIndex = fileName.lastIndexOf(".");
	const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;

	return [
		`${dir}${baseName}.system.wav`,
		`${dir}${baseName}.mic.wav`,
		`${dir}${baseName}.system.m4a`,
		`${dir}${baseName}.mic.m4a`,
		`${dir}${baseName}.system.webm`,
		`${dir}${baseName}.mic.webm`,
	];
}

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
	peakCount?: number;
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
	const peakCount = options.peakCount ?? WAVEFORM_DEFAULT_PEAK_COUNT;

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
				const resolvedUrl = await resolveMediaResourceUrl(resource);
				return waveformGenerator.generate(resolvedUrl, peakCount);
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

			if (!enableSourceSidecarFallback && fallbackResources.length === 0) {
				if (!cancelled && sourceRef.current === mediaResource) {
					setLoading(false);
				}
				return;
			}

			let sourceSidecarCandidates: string[] = [];
			if (enableSourceSidecarFallback) {
				const localPathFromServer = extractLocalPathFromMediaServerUrl(mediaResource);
				const localSourcePath =
					localPathFromServer ||
					(/^file:\/\//i.test(mediaResource)
						? fromFileUrl(mediaResource)
						: mediaResource);
				if (localSourcePath) {
					sourceSidecarCandidates = buildSidecarAudioCandidates(localSourcePath);
				}
			}

			const candidates = Array.from(
				new Set([...fallbackResources, ...sourceSidecarCandidates]),
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
	}, [mediaResource, enableSourceSidecarFallback, fallbackResources, peakCount]);

	return { peaks, loading };
}
