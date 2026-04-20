import type { DecodedVideoInfo } from "../streamingDecoder";
import type { NativeAudioPlan, VideoExporterConfig } from "./exporterTypes";

export function getNativeVideoSourcePath(videoUrl: string): string | null {
	if (!videoUrl) return null;

	if (/^file:\/\//i.test(videoUrl)) {
		try {
			const url = new URL(videoUrl);
			const pathname = decodeURIComponent(url.pathname);
			if (url.host && url.host !== "localhost") {
				return `//${url.host}${pathname}`;
			}
			if (/^\/[A-Za-z]:/.test(pathname)) {
				return pathname.slice(1);
			}
			return pathname;
		} catch {
			return videoUrl.replace(/^file:\/\//i, "");
		}
	}

	if (
		videoUrl.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(videoUrl) ||
		/^\\\\[^\\]+\\[^\\]+/.test(videoUrl)
	) {
		return videoUrl;
	}

	return null;
}

export function buildNativeTrimSegments(
	trimRegions: Array<{ startMs: number; endMs: number }> | undefined,
	durationMs: number,
): Array<{ startMs: number; endMs: number }> {
	const sorted = [...(trimRegions ?? [])].sort((a, b) => a.startMs - b.startMs);
	if (sorted.length === 0) {
		return [{ startMs: 0, endMs: Math.max(0, durationMs) }];
	}

	const segments: Array<{ startMs: number; endMs: number }> = [];
	let cursorMs = 0;

	for (const region of sorted) {
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

	return segments.filter((seg) => seg.endMs - seg.startMs > 0.5);
}

export function buildNativeAudioPlan(
	config: VideoExporterConfig,
	videoInfo: DecodedVideoInfo,
): NativeAudioPlan {
	const speedRegions = config.speedRegions ?? [];
	const audioRegions = config.audioRegions ?? [];
	const sourceAudioFallbackPaths = (config.sourceAudioFallbackPaths ?? []).filter(
		(p) => typeof p === "string" && p.trim().length > 0,
	);
	const localVideoSourcePath = getNativeVideoSourcePath(config.videoUrl);
	const primaryAudioSourcePath =
		(videoInfo.hasAudio ? localVideoSourcePath : null) ??
		sourceAudioFallbackPaths[0] ??
		null;

	if (
		!videoInfo.hasAudio &&
		sourceAudioFallbackPaths.length === 0 &&
		audioRegions.length === 0
	) {
		return { audioMode: "none" };
	}

	if (
		speedRegions.length > 0 ||
		audioRegions.length > 0 ||
		sourceAudioFallbackPaths.length > 1
	) {
		return { audioMode: "edited-track" };
	}

	if (!primaryAudioSourcePath) {
		return { audioMode: "edited-track" };
	}

	if ((config.trimRegions ?? []).length > 0) {
		const sourceDurationMs = Math.max(
			0,
			Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
		);
		const trimSegments = buildNativeTrimSegments(config.trimRegions, sourceDurationMs);
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
