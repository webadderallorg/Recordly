import type { ComponentProps, Dispatch, RefObject, SetStateAction } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, FreezeRegion, SpeedRegion, ZoomRegion } from "../types";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";

type PlaybackProps = ComponentProps<typeof VideoPlayback>;
type Handlers = Pick<
	PlaybackProps,
	| "onSelectZoom"
	| "onZoomFocusChange"
	| "onEditAutoCaption"
	| "onSelectAnnotation"
	| "onAnnotationPositionChange"
	| "onAnnotationSizeChange"
>;

type Props = {
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	playbackRef: RefObject<VideoPlaybackRef>;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	suspendRendering: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	effectiveZoomRegions: ZoomRegion[];
	effectiveSpeedRegions: SpeedRegion[];
	effectiveFreezeRegions: FreezeRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	setDuration: Dispatch<SetStateAction<number>>;
	setIsPreviewReady: Dispatch<SetStateAction<boolean>>;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setFreezeHoldElapsedMs: Dispatch<SetStateAction<number | null>>;
	setError: Dispatch<SetStateAction<string | null>>;
	handlers: Handlers;
};

export function EditorVideoPreview({
	videoPath,
	previewVersion,
	aspectRatio,
	playbackRef,
	currentTime,
	isPlaying,
	previewVolume,
	suspendRendering,
	appearance,
	timeline,
	audio,
	effectiveZoomRegions,
	effectiveSpeedRegions,
	effectiveFreezeRegions,
	effectiveCursorTelemetry,
	effectiveShowCursor,
	setDuration,
	setIsPreviewReady,
	setCurrentTime,
	setIsPlaying,
	setFreezeHoldElapsedMs,
	setError,
	handlers,
}: Props) {
	return (
		<VideoPlayback
			key={`${videoPath || "no-video"}:${previewVersion}:inline`}
			aspectRatio={aspectRatio}
			ref={playbackRef}
			videoPath={videoPath || ""}
			onDurationChange={setDuration}
			onPreviewReadyChange={setIsPreviewReady}
			onTimeUpdate={setCurrentTime}
			currentTime={currentTime}
			onPlayStateChange={setIsPlaying}
			onError={setError}
			wallpaper={appearance.wallpaper}
			zoomRegions={effectiveZoomRegions}
			selectedZoomId={timeline.selectedZoomId}
			isPlaying={isPlaying}
			showShadow={appearance.shadowIntensity > 0}
			shadowIntensity={appearance.shadowIntensity}
			backgroundBlur={appearance.backgroundBlur}
			connectZooms={appearance.connectZooms}
			zoomInDurationMs={appearance.zoomInDurationMs}
			zoomInOverlapMs={appearance.zoomInOverlapMs}
			zoomOutDurationMs={appearance.zoomOutDurationMs}
			connectedZoomGapMs={appearance.connectedZoomGapMs}
			connectedZoomDurationMs={appearance.connectedZoomDurationMs}
			zoomInEasing={appearance.zoomInEasing}
			zoomOutEasing={appearance.zoomOutEasing}
			connectedZoomEasing={appearance.connectedZoomEasing}
			borderRadius={appearance.borderRadius}
			padding={appearance.padding}
			cropRegion={appearance.cropRegion}
			webcam={appearance.webcam}
			webcamVideoPath={
				appearance.webcam.sourcePath ? appearance.resolvedWebcamVideoUrl : null
			}
			trimRegions={timeline.trimRegions}
			speedRegions={effectiveSpeedRegions}
			freezeRegions={effectiveFreezeRegions}
			onFreezeHoldChange={setFreezeHoldElapsedMs}
			annotationRegions={timeline.annotationRegions}
			autoCaptions={timeline.autoCaptions}
			autoCaptionSettings={timeline.autoCaptionSettings}
			selectedAnnotationId={timeline.selectedAnnotationId}
			cursorTelemetry={effectiveCursorTelemetry}
			showCursor={effectiveShowCursor}
			cursorStyle={appearance.cursorStyle}
			cursorSize={appearance.cursorSize}
			cursorSmoothing={appearance.cursorSmoothing}
			cursorSpringStiffnessMultiplier={appearance.cursorSpringStiffnessMultiplier}
			cursorSpringDampingMultiplier={appearance.cursorSpringDampingMultiplier}
			cursorSpringMassMultiplier={appearance.cursorSpringMassMultiplier}
			cameraSpringStiffnessMultiplier={appearance.cameraSpringStiffnessMultiplier}
			cameraSpringDampingMultiplier={appearance.cameraSpringDampingMultiplier}
			cameraSpringMassMultiplier={appearance.cameraSpringMassMultiplier}
			zoomSmoothness={appearance.zoomSmoothness}
			zoomClassicMode={appearance.zoomClassicMode}
			zoomMotionBlur={appearance.zoomMotionBlur}
			zoomMotionBlurTuning={appearance.zoomMotionBlurTuning}
			cursorMotionBlur={appearance.cursorMotionBlur}
			cursorClickEffect={appearance.cursorClickEffect}
			cursorClickEffectColor={appearance.cursorClickEffectColor}
			cursorClickEffectScale={appearance.cursorClickEffectScale}
			cursorClickEffectOpacity={appearance.cursorClickEffectOpacity}
			cursorClickEffectDurationMs={appearance.cursorClickEffectDurationMs}
			cursorClickBounce={appearance.cursorClickBounce}
			cursorClickBounceDuration={appearance.cursorClickBounceDuration}
			cursorSway={appearance.cursorSway}
			volume={
				audio.shouldMutePreviewVideo || audio.isCurrentClipMuted
					? 0
					: Math.max(0, Math.min(1, previewVolume * audio.embeddedSourcePreviewGain))
			}
			suspendRendering={suspendRendering}
			{...handlers}
		/>
	);
}
