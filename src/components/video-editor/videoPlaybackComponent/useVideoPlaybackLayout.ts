import { useCallback } from "react";
import { extensionHost } from "@/lib/extensions";
import { clamp01 } from "../videoPlayback/mathUtils";
import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import { clampFocusToStage as clampFocusToStageUtil } from "../videoPlayback/focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "../videoPlayback/layoutUtils";
import { updateOverlayIndicator } from "../videoPlayback/overlayUtils";
import {
	DEFAULT_WEBCAM_CORNER_RADIUS,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	type CropRegion,
	type WebcamOverlaySettings,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
} from "../types";
import { getWebcamOverlayPosition, getWebcamOverlaySizePx } from "../webcamOverlay";
import type { VideoPlaybackRuntimeRefs } from "./shared";

interface UseVideoPlaybackLayoutParams {
	refs: VideoPlaybackRuntimeRefs;
	cropRegion?: CropRegion;
	borderRadius: number;
	padding: number;
	frame: string | null;
	showShadow?: boolean;
	shadowIntensity: number;
	selectedZoom: ZoomRegion | null;
	webcam?: WebcamOverlaySettings;
	webcamVideoPath?: string | null;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	onSelectZoom: (id: string | null) => void;
}

export function useVideoPlaybackLayout({
	refs,
	cropRegion,
	borderRadius,
	padding,
	frame,
	showShadow,
	shadowIntensity,
	selectedZoom,
	webcam,
	webcamVideoPath,
	onZoomFocusChange,
	onSelectZoom,
}: UseVideoPlaybackLayoutParams) {
	const applyWebcamBubbleLayout = useCallback(
		(zoomScale: number) => {
			const bubble = refs.webcamBubbleRef.current;
			const bubbleInner = refs.webcamBubbleInnerRef.current;
			const overlay = refs.overlayRef.current;
			if (!bubble || !bubbleInner || !overlay || !webcam?.enabled || !webcamVideoPath) {
				if (bubble) {
					bubble.style.display = "none";
				}
				return;
			}

			const margin = webcam.margin ?? 24;
			const scaledSize = getWebcamOverlaySizePx({
				containerWidth: overlay.clientWidth,
				containerHeight: overlay.clientHeight,
				sizePercent: webcam.size ?? DEFAULT_WEBCAM_SIZE,
				margin,
				zoomScale,
				reactToZoom: webcam.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM,
			});
			const { x, y } = getWebcamOverlayPosition({
				containerWidth: overlay.clientWidth,
				containerHeight: overlay.clientHeight,
				size: scaledSize,
				margin,
				positionPreset: webcam.positionPreset ?? webcam.corner,
				positionX: webcam.positionX ?? 1,
				positionY: webcam.positionY ?? 1,
				legacyCorner: webcam.corner,
			});

			bubble.style.display = "block";
			bubble.style.left = `${x}px`;
			bubble.style.top = `${y}px`;
			bubble.style.width = `${scaledSize}px`;
			bubble.style.height = `${scaledSize}px`;
			const squirclePath = getSquircleSvgPath({
				x: 0,
				y: 0,
				width: scaledSize,
				height: scaledSize,
				radius: webcam.cornerRadius ?? DEFAULT_WEBCAM_CORNER_RADIUS,
			});
			bubble.style.filter = `drop-shadow(0 ${Math.round(scaledSize * 0.06)}px ${Math.round(scaledSize * 0.22)}px rgba(0, 0, 0, ${webcam.shadow ?? DEFAULT_WEBCAM_SHADOW}))`;
			bubble.style.borderRadius = "0px";
			bubble.style.boxShadow = "none";

			bubbleInner.style.borderRadius = "0px";
			bubbleInner.style.clipPath = `path('${squirclePath}')`;
			bubbleInner.style.setProperty("-webkit-clip-path", `path('${squirclePath}')`);
		},
		[refs, webcam, webcamVideoPath],
	);

	const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
		return clampFocusToStageUtil(focus, depth, refs.stageSizeRef.current);
	}, [refs.stageSizeRef]);

	const updateOverlayForRegion = useCallback(
		(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
			const overlayEl = refs.overlayRef.current;
			const indicatorEl = refs.focusIndicatorRef.current;

			if (!overlayEl || !indicatorEl) {
				return;
			}

			const stageWidth = overlayEl.clientWidth;
			const stageHeight = overlayEl.clientHeight;
			if (stageWidth && stageHeight) {
				refs.stageSizeRef.current = { width: stageWidth, height: stageHeight };
			}

			updateOverlayIndicator({
				overlayEl,
				indicatorEl,
				region,
				focusOverride,
				baseMask: refs.baseMaskRef.current,
				isPlaying: refs.isPlayingRef.current,
			});
		},
		[refs],
	);

	const layoutVideoContent = useCallback(() => {
		const container = refs.containerRef.current;
		const app = refs.appRef.current;
		const videoSprite = refs.videoSpriteRef.current;
		const maskGraphics = refs.maskGraphicsRef.current;
		const videoElement = refs.videoRef.current;
		const cameraContainer = refs.cameraContainerRef.current;

		if (!container || !app || !videoSprite || !maskGraphics || !videoElement || !cameraContainer) {
			return;
		}

		if (!refs.lockedVideoDimensionsRef.current && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
			refs.lockedVideoDimensionsRef.current = {
				width: videoElement.videoWidth,
				height: videoElement.videoHeight,
			};
		}

		let frameInsets: { top: number; right: number; bottom: number; left: number } | null = null;
		if (frame) {
			const frames = extensionHost.getFrames();
			const frameData = frames.find((item) => item.id === frame);
			if (frameData?.screenInsets) {
				frameInsets = frameData.screenInsets;
			}
		}

		const result = layoutVideoContentUtil({
			container,
			app,
			videoSprite,
			maskGraphics,
			videoElement,
			cropRegion,
			lockedVideoDimensions: refs.lockedVideoDimensionsRef.current,
			borderRadius,
			padding,
			frameInsets,
		});

		if (!result) return;

		refs.stageSizeRef.current = result.stageSize;
		refs.videoSizeRef.current = result.videoSize;
		refs.baseScaleRef.current = result.baseScale;
		refs.baseOffsetRef.current = result.baseOffset;
		refs.baseMaskRef.current = result.maskRect;
		refs.cropBoundsRef.current = result.cropBounds;

		const effectsCanvas = refs.cursorEffectsCanvasRef.current;
		if (effectsCanvas) {
			const width = result.stageSize.width;
			const height = result.stageSize.height;
			if (effectsCanvas.width !== width || effectsCanvas.height !== height) {
				effectsCanvas.width = width;
				effectsCanvas.height = height;
			}
		}

		extensionHost.setVideoLayout({
			maskRect: {
				x: result.maskRect.x,
				y: result.maskRect.y,
				width: result.maskRect.width,
				height: result.maskRect.height,
			},
			canvasWidth: result.stageSize.width,
			canvasHeight: result.stageSize.height,
			borderRadius,
			padding,
		});
		extensionHost.setShadowConfig({
			enabled: Boolean(showShadow) && shadowIntensity > 0,
			intensity: shadowIntensity,
		});

		const frameSprite = refs.frameSpriteRef.current;
		if (frameSprite && frame) {
			const frames = extensionHost.getFrames();
			const frameData = frames.find((item) => item.id === frame);
			if (frameData) {
				const maskRect = result.maskRect;
				const insets = frameData.screenInsets;
				if (insets) {
					const screenW = maskRect.width;
					const screenH = maskRect.height;
					const frameW = screenW / (1 - insets.left - insets.right);
					const frameH = screenH / (1 - insets.top - insets.bottom);
					const frameX = maskRect.x - insets.left * frameW;
					const frameY = maskRect.y - insets.top * frameH;
					frameSprite.position.set(frameX, frameY);
					frameSprite.width = frameW;
					frameSprite.height = frameH;
				} else {
					frameSprite.position.set(maskRect.x, maskRect.y);
					frameSprite.width = maskRect.width;
					frameSprite.height = maskRect.height;
				}
			}
		}

		cameraContainer.scale.set(1);
		cameraContainer.position.set(0, 0);

		const activeRegion = selectedZoom;
		updateOverlayForRegion(activeRegion);
		applyWebcamBubbleLayout(refs.animationStateRef.current.appliedScale || 1);
	}, [applyWebcamBubbleLayout, borderRadius, cropRegion, frame, padding, refs, selectedZoom, shadowIntensity, showShadow, updateOverlayForRegion]);

	const updateFocusFromClientPoint = useCallback(
		(clientX: number, clientY: number) => {
			const overlayEl = refs.overlayRef.current;
			if (!overlayEl) return;

			const regionId = refs.selectedZoomIdRef.current;
			if (!regionId) return;

			const region = refs.zoomRegionsRef.current.find((item) => item.id === regionId);
			if (!region) return;

			const rect = overlayEl.getBoundingClientRect();
			const stageWidth = rect.width;
			const stageHeight = rect.height;
			if (!stageWidth || !stageHeight) return;

			refs.stageSizeRef.current = { width: stageWidth, height: stageHeight };
			const localX = clientX - rect.left;
			const localY = clientY - rect.top;
			const baseMask = refs.baseMaskRef.current;

			const unclampedFocus: ZoomFocus = {
				cx: clamp01((localX - baseMask.x) / Math.max(1, baseMask.width)),
				cy: clamp01((localY - baseMask.y) / Math.max(1, baseMask.height)),
			};
			const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

			onZoomFocusChange(region.id, clampedFocus);
			updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
		},
		[clampFocusToStage, onZoomFocusChange, refs, updateOverlayForRegion],
	);

	const handleOverlayPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (refs.isPlayingRef.current) return;
			const regionId = refs.selectedZoomIdRef.current;
			if (!regionId) return;
			const region = refs.zoomRegionsRef.current.find((item) => item.id === regionId);
			if (!region || region.mode !== "manual") return;
			onSelectZoom(region.id);
			event.preventDefault();
			refs.isDraggingFocusRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);
			updateFocusFromClientPoint(event.clientX, event.clientY);
		},
		[onSelectZoom, refs, updateFocusFromClientPoint],
	);

	const handleOverlayPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!refs.isDraggingFocusRef.current) return;
			event.preventDefault();
			updateFocusFromClientPoint(event.clientX, event.clientY);
		},
		[refs.isDraggingFocusRef, updateFocusFromClientPoint],
	);

	const endFocusDrag = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!refs.isDraggingFocusRef.current) return;
			refs.isDraggingFocusRef.current = false;
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
			}
		},
		[refs.isDraggingFocusRef],
	);

	const handleOverlayPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		endFocusDrag(event);
	}, [endFocusDrag]);

	const handleOverlayPointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		endFocusDrag(event);
	}, [endFocusDrag]);

	return {
		applyWebcamBubbleLayout,
		clampFocusToStage,
		updateOverlayForRegion,
		layoutVideoContent,
		handleOverlayPointerDown,
		handleOverlayPointerMove,
		handleOverlayPointerUp,
		handleOverlayPointerLeave,
	};
}