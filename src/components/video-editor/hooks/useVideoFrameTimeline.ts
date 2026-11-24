import { useEffect, useState } from "react";
import { getLocalFilePath } from "@/lib/exporter/localMediaSource";
import { loadVideoFrameTimeline } from "../videoPlayback/frameStepping";

export interface VideoFrameTimelineState {
	presentationTimestamps: Float64Array | null;
	frameRate: number | null;
}

const EMPTY_FRAME_TIMELINE: VideoFrameTimelineState = {
	presentationTimestamps: null,
	frameRate: null,
};

interface UseVideoFrameTimelineParams {
	videoPath: string | null;
	videoSourcePath?: string | null;
}

/**
 * Loads packet presentation timestamps (and fallback frame rate) for the active
 * editor recording so frame-by-frame stepping lands on real decoded frames.
 */
export function useVideoFrameTimeline({
	videoPath,
	videoSourcePath,
}: UseVideoFrameTimelineParams): VideoFrameTimelineState {
	const [timeline, setTimeline] = useState<VideoFrameTimelineState>(EMPTY_FRAME_TIMELINE);

	useEffect(() => {
		setTimeline(EMPTY_FRAME_TIMELINE);
		const resource = videoPath || videoSourcePath;
		if (!resource) {
			return;
		}

		const controller = new AbortController();
		const { signal } = controller;

		const resolveFallbackFrameRate = async () => {
			if (typeof window === "undefined" || !window.electronAPI?.probeNativeVideoMetadata) {
				return null;
			}
			const localPath = getLocalFilePath(videoSourcePath ?? videoPath ?? "");
			if (!localPath) {
				return null;
			}
			try {
				const result = await window.electronAPI.probeNativeVideoMetadata(localPath);
				const probedFps = result?.success ? result.metadata?.frameRate : undefined;
				return typeof probedFps === "number" && Number.isFinite(probedFps) && probedFps > 0
					? probedFps
					: null;
			} catch {
				return null;
			}
		};

		void (async () => {
			try {
				const loaded = await loadVideoFrameTimeline(resource, { signal });
				if (signal.aborted) {
					return;
				}
				const fallbackFrameRate = loaded.frameRate ?? (await resolveFallbackFrameRate());
				if (signal.aborted) {
					return;
				}
				setTimeline({
					presentationTimestamps:
						loaded.presentationTimestamps.length > 0
							? loaded.presentationTimestamps
							: null,
					frameRate: fallbackFrameRate,
				});
			} catch {
				if (signal.aborted) {
					return;
				}
				const fallbackFrameRate = await resolveFallbackFrameRate();
				if (signal.aborted || fallbackFrameRate === null) {
					return;
				}
				setTimeline({
					presentationTimestamps: null,
					frameRate: fallbackFrameRate,
				});
			}
		})();

		return () => {
			controller.abort();
		};
	}, [videoPath, videoSourcePath]);

	return timeline;
}
