import { useCallback, useEffect } from "react";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import { extensionHost } from "@/lib/extensions";
import type { VideoPlaybackRuntimeRefs } from "./shared";

interface UseVideoElementLifecycleParams {
	refs: VideoPlaybackRuntimeRefs;
	videoPath: string;
	currentTime: number;
	onDurationChange: (duration: number) => void;
	onPreviewReadyChange?: (ready: boolean) => void;
	setVideoReady: (ready: boolean) => void;
	videoReady: boolean;
}

export function useVideoElementLifecycle({
	refs,
	videoPath,
	currentTime,
	onDurationChange,
	onPreviewReadyChange,
	setVideoReady,
	videoReady,
}: UseVideoElementLifecycleParams) {
	useEffect(() => {
		const video = refs.videoRef.current;
		if (!video) return;
		video.pause();
		video.currentTime = 0;
		refs.allowPlaybackRef.current = false;
		refs.lockedVideoDimensionsRef.current = null;
		setVideoReady(false);
		if (refs.videoReadyRafRef.current) {
			cancelAnimationFrame(refs.videoReadyRafRef.current);
			refs.videoReadyRafRef.current = null;
		}
	}, [refs, setVideoReady, videoPath]);

	useEffect(() => {
		onPreviewReadyChange?.(videoReady);
	}, [onPreviewReadyChange, videoReady]);

	useEffect(() => {
		return () => {
			if (refs.videoReadyRafRef.current) {
				cancelAnimationFrame(refs.videoReadyRafRef.current);
				refs.videoReadyRafRef.current = null;
			}
		};
	}, [refs.videoReadyRafRef]);

	const handleLoadedMetadata = useCallback(
		(event: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = event.currentTarget;
			onDurationChange(video.duration);

			extensionHost.setVideoInfo({
				width: video.videoWidth,
				height: video.videoHeight,
				durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : 0,
				fps: 60,
			});
			const targetTime = clampMediaTimeToDuration(
				currentTime,
				Number.isFinite(video.duration) ? video.duration : null,
			);
			video.currentTime = targetTime;
			video.pause();
			refs.allowPlaybackRef.current = false;
			refs.currentTimeRef.current = targetTime * 1000;

			if (refs.videoReadyRafRef.current) {
				cancelAnimationFrame(refs.videoReadyRafRef.current);
				refs.videoReadyRafRef.current = null;
			}

			const waitForRenderableFrame = () => {
				const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
				const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
				if (hasDimensions && hasData) {
					refs.videoReadyRafRef.current = null;
					setVideoReady(true);
					return;
				}
				refs.videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
			};

			refs.videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
		},
		[currentTime, onDurationChange, refs, setVideoReady],
	);

	return { handleLoadedMetadata };
}