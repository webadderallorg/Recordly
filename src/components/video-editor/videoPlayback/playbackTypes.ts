import type { CursorIdleHideSettings } from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import { Application, Container, Sprite } from "pixi.js";
import type React from "react";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import { type CaptionEditTarget } from "../captionEditing";
import {
	type AnnotationRegion,
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	type CursorClickEffectStyle,
	type CursorStyle,
	type Padding,
	type WebcamOverlaySettings,
	type ZoomFocus,
	type ZoomMotionBlurTuning,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "../types";
import { DEFAULT_FOCUS } from "./constants";
export type PlaybackAnimationState = {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
};

export type CaptionEditSession = {
	target: CaptionEditTarget;
	draft: string;
};

export type SceneTransformState = {
	scale: number;
	x: number;
	y: number;
};

export type AnnotationRecordingRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export interface VideoPlaybackProps {
	autoPlay?: boolean;
	clipRegions: ClipRegion[];
	videoPath: string;
	onDurationChange: (duration: number) => void;
	onPreviewReadyChange?: (ready: boolean) => void;
	onTimeUpdate: (time: number) => void;
	currentTime: number;
	onPlayStateChange: (playing: boolean) => void;
	onError: (error: string) => void;
	wallpaper?: string;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	isPlaying: boolean;
	showShadow?: boolean;
	shadowIntensity?: number;
	backgroundBlur?: number;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomInOverlapMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
	zoomInEasing?: ZoomTransitionEasing;
	zoomOutEasing?: ZoomTransitionEasing;
	connectedZoomEasing?: ZoomTransitionEasing;
	borderRadius?: number;
	padding?: Padding | number;
	cropRegion?: import("../types").CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamVideoPath?: string | null;
	aspectRatio: AspectRatio;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	onEditAutoCaption?: (target: CaptionEditTarget, text: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
	onAnnotationContentChange?: (id: string, content: string) => void;
	onAnnotationDelete?: (id: string) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorStyle?: CursorStyle;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorSpringStiffnessMultiplier?: number;
	cursorSpringDampingMultiplier?: number;
	cursorSpringMassMultiplier?: number;
	cameraSpringStiffnessMultiplier?: number;
	cameraSpringDampingMultiplier?: number;
	cameraSpringMassMultiplier?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	cursorIdleHide?: CursorIdleHideSettings;
	volume?: number;
	suspendRendering?: boolean;
}

export interface VideoPlaybackRef {
	readonly isPlaying: boolean;
	seekTimeline: (time: number) => void;
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement | null>;
	play: () => Promise<void>;
	pause: () => void;
	getAnnotationPlacement?: () => Pick<AnnotationRegion, "position" | "size"> | null;
	refreshFrame: () => Promise<void>;
	cancelCaptionEdit: () => void;
}

export function createPlaybackAnimationState(): PlaybackAnimationState {
	return {
		scale: 1,
		appliedScale: 1,
		focusX: DEFAULT_FOCUS.cx,
		focusY: DEFAULT_FOCUS.cy,
		progress: 0,
		x: 0,
		y: 0,
	};
}

export function getEffectiveNativeAspectRatio(
	dimensions: { width: number; height: number } | null | undefined,
	cropRegion?: import("../types").CropRegion,
): number {
	if (!dimensions || dimensions.height <= 0 || dimensions.width <= 0) {
		return 16 / 9;
	}

	const cropWidth = cropRegion?.width ?? 1;
	const cropHeight = cropRegion?.height ?? 1;
	const effectiveWidth = dimensions.width * cropWidth;
	const effectiveHeight = dimensions.height * cropHeight;

	if (effectiveWidth <= 0 || effectiveHeight <= 0) {
		return dimensions.width / dimensions.height;
	}

	return effectiveWidth / effectiveHeight;
}
