import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import { useRef, useState } from "react";
import { type ZoomRegion } from "../types";
import { createAnnotationFrameStore } from "./annotationFrameStore";
import {
	type AnnotationRecordingRect,
	type ComposedPreviewFrame,
	createPlaybackAnimationState,
	type PlaybackAnimationState,
} from "./playbackTypes";
export function usePreviewSceneState() {
	const previewFrameRef = useRef<HTMLDivElement | null>(null);
	const composedFrameRef = useRef<ComposedPreviewFrame | null>(null);

	const containerRef = useRef<HTMLDivElement | null>(null);

	const appRef = useRef<Application | null>(null);

	const videoSpriteRef = useRef<Sprite | null>(null);

	const videoEffectsContainerRef = useRef<Container | null>(null);

	const videoContainerRef = useRef<Container | null>(null);

	const zoomBlurFilterRef = useRef<ZoomBlurFilter | null>(null);

	const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);

	const cameraContainerRef = useRef<Container | null>(null);

	const [pixiReady, setPixiReady] = useState(false);

	const [previewViewportWidth, setPreviewViewportWidth] = useState(640);

	const [annotationFrameStore] = useState(createAnnotationFrameStore);

	const [annotationRecordingRect, setAnnotationRecordingRect] = useState<AnnotationRecordingRect>(
		{
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		},
	);

	const overlayRef = useRef<HTMLDivElement | null>(null);

	const focusIndicatorRef = useRef<HTMLDivElement | null>(null);

	const zoomRegionsRef = useRef<ZoomRegion[]>([]);

	const selectedZoomIdRef = useRef<string | null>(null);

	const animationStateRef = useRef<PlaybackAnimationState>(createPlaybackAnimationState());

	const isDraggingFocusRef = useRef(false);

	const stageSizeRef = useRef({ width: 0, height: 0 });

	const videoSizeRef = useRef({ width: 0, height: 0 });

	const baseScaleRef = useRef(1);

	const baseOffsetRef = useRef({ x: 0, y: 0 });

	const baseMaskRef = useRef<{
		x: number;
		y: number;
		width: number;
		height: number;
		renderWidth?: number;
		renderHeight?: number;
		sourceCrop?: {
			x: number;
			y: number;
			width: number;
			height: number;
		};
	}>({ x: 0, y: 0, width: 0, height: 0 });

	const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });

	const maskGraphicsRef = useRef<Graphics | null>(null);

	const lockedVideoDimensionsRef = useRef<{
		width: number;
		height: number;
	} | null>(null);

	const layoutVideoContentRef = useRef<(() => void) | null>(null);
	return {
		previewFrameRef,
		composedFrameRef,
		containerRef,
		appRef,
		videoSpriteRef,
		videoEffectsContainerRef,
		videoContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		cameraContainerRef,
		pixiReady,
		setPixiReady,
		previewViewportWidth,
		setPreviewViewportWidth,
		annotationFrameStore,
		annotationRecordingRect,
		setAnnotationRecordingRect,
		overlayRef,
		focusIndicatorRef,
		zoomRegionsRef,
		selectedZoomIdRef,
		animationStateRef,
		isDraggingFocusRef,
		stageSizeRef,
		videoSizeRef,
		baseScaleRef,
		baseOffsetRef,
		baseMaskRef,
		cropBoundsRef,
		maskGraphicsRef,
		lockedVideoDimensionsRef,
		layoutVideoContentRef,
	};
}
