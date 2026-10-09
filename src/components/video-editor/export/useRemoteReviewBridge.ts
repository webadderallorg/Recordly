import { type RefObject, useEffect, useRef } from "react";
import type { useTimelineState } from "../state/useTimelineState";
import { getClipSourceStartMs, getTimelineDurationMs } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Input = {
	ready: boolean;
	duration: number;
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
};

export function useRemoteReviewBridge(input: Input) {
	const latestRef = useRef(input);
	latestRef.current = input;

	useEffect(
		() =>
			window.electronAPI.onRemoteReviewRequest?.((request) => {
				const reply = (result: Omit<RemoteReviewResult, "id">) =>
					window.electronAPI.sendRemoteReviewResult({ id: request.id, ...result });
				const { ready, duration, timeline, videoPlaybackRef } = latestRef.current;
				if (!ready) {
					reply({ ok: false, error: "The editor is still loading the recording." });
					return;
				}
				const video = videoPlaybackRef.current?.video;
				if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
					reply({ ok: false, error: "The video is not loaded in the editor." });
					return;
				}
				const sourceDurationMs = Math.round(duration * 1000);
				reply({
					ok: true,
					timeline: {
						clips: timeline.clipRegions.map((clip) => ({
							startMs: clip.startMs,
							endMs: clip.endMs,
							sourceStartMs: getClipSourceStartMs(clip),
							speed: clip.speed,
						})),
						zooms: timeline.zoomRegions.length,
						captions: timeline.autoCaptionSettings.enabled
							? timeline.autoCaptions.length
							: 0,
						durationMs: getTimelineDurationMs(timeline.clipRegions, sourceDurationMs),
						sourceDurationMs,
						width: video.videoWidth,
						height: video.videoHeight,
					},
				});
			}),
		[],
	);
}
