import { type MutableRefObject, type RefObject, useEffect, useState } from "react";
import { type AgentActivityLog, planAgentEdits } from "../agentEdits/planAgentEdits";
import { createCaptionCue } from "../captionOps";
import { packClipSequence, rippleRegionAnchors, rippleRegions } from "../clipSequence";
import type { useTimelineState } from "../state/useTimelineState";
import { type ClipRegion, mapSourceTimeToTimelineTime, type ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Input = {
	enabled: boolean;
	applyZooms: boolean;
	videoPath: string | null;
	videoSourcePath: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	duration: number;
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAgentEditsPathRef: MutableRefObject<string | null>;
};

export function useFreshRecordingAgentEdits({
	enabled,
	applyZooms,
	videoPath,
	videoSourcePath,
	loading,
	isPreviewReady,
	duration,
	timeline,
	videoPlaybackRef,
	nextZoomIdRef,
	nextClipIdRef,
	pendingFreshRecordingAutoZoomPathRef: autoZoomPendingRef,
	pendingFreshRecordingAgentEditsPathRef: pendingRef,
}: Input) {
	const [settledPath, setSettledPath] = useState<string | null>(null);
	const [loaded, setLoaded] = useState<{ path: string; log: AgentActivityLog } | null>(null);
	const settled = !videoPath || settledPath === videoPath;

	useEffect(() => {
		if (!videoPath || settled) return;
		if (!enabled || !videoSourcePath || pendingRef.current !== videoPath) {
			pendingRef.current = null;
			setSettledPath(videoPath);
			return;
		}
		let active = true;
		Promise.resolve()
			.then(() => window.electronAPI.getAgentActivity(videoSourcePath))
			.then(
				(result) => (result.success ? result.log : null),
				() => null,
			)
			.then((log) => {
				if (!active) return;
				if (log) {
					setLoaded({ path: videoPath, log });
					return;
				}
				pendingRef.current = null;
				setSettledPath(videoPath);
			});
		return () => {
			active = false;
		};
	}, [enabled, pendingRef, settled, videoPath, videoSourcePath]);

	const {
		clipRegions,
		zoomRegions,
		setClipRegions,
		setZoomRegions,
		setAnnotationRegions,
		setAudioRegions,
		setAutoCaptions,
		setAutoCaptionSettings,
	} = timeline;
	useEffect(() => {
		if (!videoPath || settled || loaded?.path !== videoPath) return;
		const video = videoPlaybackRef.current?.video;
		if (loading || !isPreviewReady || duration <= 0 || !video?.videoWidth || !video.videoHeight)
			return;
		let plan: ReturnType<typeof planAgentEdits> = null;
		try {
			if (enabled)
				plan = planAgentEdits(
					loaded.log,
					Math.round(duration * 1000),
					video.videoWidth / video.videoHeight,
					loaded.log.changeTimesMs,
				);
		} catch (error) {
			console.warn("Unable to plan agent edits:", error);
		}
		const untouched =
			zoomRegions.length === 0 &&
			clipRegions.length <= 1 &&
			clipRegions.every(
				(clip) => clip.startMs === 0 && (clip.sourceStartMs ?? 0) === 0 && clip.speed === 1,
			);
		if (plan && untouched) {
			const edited: ClipRegion[] = plan.keepRanges.map(({ startMs, endMs, speed }) => {
				const clipSpeed = Number.isFinite(speed) && Number(speed) > 0 ? Number(speed) : 1;
				return {
					id: `clip-${nextClipIdRef.current++}`,
					startMs,
					endMs: startMs + Math.round((endMs - startMs) / clipSpeed),
					sourceStartMs: startMs,
					speed: clipSpeed,
				};
			});
			const next = packClipSequence(edited);
			setClipRegions(next);
			const zooms = (applyZooms ? plan.zooms : []).map(
				({ startMs, endMs, depth, focus }): ZoomRegion => ({
					id: `zoom-${nextZoomIdRef.current++}`,
					startMs: mapSourceTimeToTimelineTime(startMs, next),
					endMs: mapSourceTimeToTimelineTime(endMs, next),
					depth,
					focus,
					mode: "auto",
				}),
			);
			setZoomRegions((current) => [...rippleRegions(current, edited, next), ...zooms]);
			setAnnotationRegions((current) => rippleRegions(current, edited, next));
			setAudioRegions((current) => rippleRegionAnchors(current, edited, next));
			if (plan.captions.length > 0) {
				setAutoCaptions(plan.captions.map((caption) => createCaptionCue(caption)));
				setAutoCaptionSettings((previous) => ({ ...previous, enabled: true }));
			}
			autoZoomPendingRef.current = null;
		}
		pendingRef.current = null;
		setSettledPath(videoPath);
	}, [
		applyZooms,
		autoZoomPendingRef,
		clipRegions,
		duration,
		enabled,
		isPreviewReady,
		loaded,
		loading,
		nextClipIdRef,
		nextZoomIdRef,
		pendingRef,
		setAnnotationRegions,
		setAudioRegions,
		setAutoCaptionSettings,
		setAutoCaptions,
		setClipRegions,
		setZoomRegions,
		settled,
		videoPath,
		videoPlaybackRef,
		zoomRegions,
	]);

	return { agentEditsSettled: settled };
}
