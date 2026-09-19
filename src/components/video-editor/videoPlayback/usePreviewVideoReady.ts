import { type RefObject, useLayoutEffect, useState } from "react";

/** Subscribe before media events can arrive for React's newly assigned source. */
export function usePreviewVideoReady(videoRef: RefObject<HTMLVideoElement | null>, source: string) {
	const [ready, setReady] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Recheck readiness whenever React changes the media source.
	useLayoutEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		// Readiness owns the sprite/transport lifetime, not each decoder seek.
		// Retain the last frame until new data arrives; only a new source or a
		// media failure should tear the preview down.
		const update = () => {
			if (
				video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
				video.videoWidth > 0 && video.videoHeight > 0
			) setReady(true);
		};
		const reset = () => setReady(false);
		const events = ["loadeddata", "canplay", "seeked"];
		for (const event of events) video.addEventListener(event, update);
		video.addEventListener("emptied", reset);
		video.addEventListener("error", reset);
		reset();
		update();
		return () => {
			for (const event of events) video.removeEventListener(event, update);
			video.removeEventListener("emptied", reset);
			video.removeEventListener("error", reset);
		};
	}, [videoRef, source]);
	return ready;
}
