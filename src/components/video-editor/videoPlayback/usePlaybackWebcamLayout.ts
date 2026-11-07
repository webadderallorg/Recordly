import type React from "react";
import { useCallback, useEffect, useMemo } from "react";
import { getWebcamShadowFilter } from "@/lib/exporter/shadowProfile";
import {
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
} from "../types";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamClipPath,
	getWebcamCornerRadiusPx,
	getWebcamCropSourceRect,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	scaleWebcamOverlayPixels,
} from "../webcamOverlay";
import { findPreviewClipAtTimelineTime } from "./clipPlayback";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
import { isWebcamVisibleAtSourceTime } from "./webcamSync";
export type usePlaybackWebcamLayoutInput = Pick<
	PlaybackProps & ReturnType<typeof usePlaybackState>,
	| "webcam"
	| "webcamVideoDimensions"
	| "webcamBubbleRef"
	| "webcamBlurCanvasRef"
	| "webcamBubbleInnerRef"
	| "overlayRef"
	| "webcamVideoPath"
	| "timelineTimeRef"
	| "clipRegionsRef"
	| "currentTimeRef"
	| "webcamMotionBlurRef"
	| "webcamVideoRef"
	| "webcamMediaSynchronized"
	| "isPlayingRef"
	| "isSeekingRef"
	| "zoomMotionBlurRef"
	| "isPlaying"
>;
export function usePlaybackWebcamLayout(input: usePlaybackWebcamLayoutInput) {
	const {
		webcam,
		webcamVideoDimensions,
		webcamBubbleRef,
		webcamBlurCanvasRef,
		webcamBubbleInnerRef,
		overlayRef,
		webcamVideoPath,
		timelineTimeRef,
		clipRegionsRef,
		currentTimeRef,
		webcamMotionBlurRef,
		webcamVideoRef,
		webcamMediaSynchronized,
		isPlayingRef,
		isSeekingRef,
		zoomMotionBlurRef,
		isPlaying,
	} = input;

	const webcamEnabled = webcam?.enabled ?? false;
	const webcamShape = webcam?.shape ?? "squircle";

	const webcamMargin = webcam?.margin ?? 24;

	const webcamWidth = webcam?.width ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
	const rawWebcamHeight = webcam?.height ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;

	const webcamReactToZoom = webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM;

	const webcamPositionPreset = webcam?.positionPreset ?? webcam?.corner ?? "bottom-right";

	const webcamPositionX = webcam?.positionX ?? 1;

	const webcamPositionY = webcam?.positionY ?? 1;

	const webcamCorner = webcam?.corner ?? "bottom-right";

	const webcamRoundness = webcam?.roundness ?? DEFAULT_WEBCAM_ROUNDNESS;

	const webcamShadow = webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW;

	const webcamTimeOffsetMs = webcam?.timeOffsetMs;

	const webcamCropRegion = webcam?.cropRegion;

	const webcamMirror = webcam?.mirror ?? false;

	const webcamHeight = getCropMatchedWebcamHeightPercent(
		webcamWidth,
		rawWebcamHeight,
		webcamVideoDimensions?.width,
		webcamVideoDimensions?.height,
		webcamCropRegion,
		webcamShape,
	);

	const webcamCropPreviewContentStyle = useMemo<React.CSSProperties>(() => {
		if (!webcamVideoDimensions) {
			return { opacity: 0 };
		}

		const { sx, sy, sw, sh } = getWebcamCropSourceRect(
			webcamCropRegion,
			webcamVideoDimensions.width,
			webcamVideoDimensions.height,
		);
		const targetAspect =
			webcamShape === "circle"
				? 1
				: Math.max(0.01, webcamWidth) / Math.max(0.01, webcamHeight);
		const coverScale = Math.max(targetAspect / sw, 1 / sh);
		const drawWidth = webcamVideoDimensions.width * coverScale;
		const drawHeight = webcamVideoDimensions.height * coverScale;
		const drawX = (targetAspect - sw * coverScale) / 2 - sx * coverScale;
		const drawY = (1 - sh * coverScale) / 2 - sy * coverScale;

		return {
			left: `${(drawX / targetAspect) * 100}%`,
			top: `${drawY * 100}%`,
			width: `${(drawWidth / targetAspect) * 100}%`,
			height: `${drawHeight * 100}%`,
			maxWidth: "none",
			willChange: "left, top, width, height",
		};
	}, [webcamCropRegion, webcamHeight, webcamVideoDimensions, webcamWidth, webcamShape]);

	const applyWebcamBubbleLayout = useCallback(
		(zoomScale: number) => {
			const bubble = webcamBubbleRef.current;
			const blurCanvas = webcamBlurCanvasRef.current;
			if (blurCanvas) blurCanvas.style.display = "none";
			if (bubble) bubble.style.visibility = "visible";
			const bubbleInner = webcamBubbleInnerRef.current;
			const overlay = overlayRef.current;
			if (
				!bubble ||
				!bubbleInner ||
				!overlay ||
				!webcamEnabled ||
				!webcamVideoPath ||
				!findPreviewClipAtTimelineTime(
					timelineTimeRef.current * 1000,
					clipRegionsRef.current,
				) ||
				!isWebcamVisibleAtSourceTime(webcam, currentTimeRef.current / 1000)
			) {
				webcamMotionBlurRef.current.reset();
				if (bubble) {
					bubble.style.display = "none";
				}
				return;
			}
			const scaledMargin = scaleWebcamOverlayPixels(webcamMargin, overlay.clientWidth);

			const scaledDimensions = getWebcamOverlayDimensionsPx({
				shape: webcamShape,
				containerWidth: overlay.clientWidth,
				containerHeight: overlay.clientHeight,
				widthPercent: webcamWidth,
				heightPercent: webcamHeight,
				margin: scaledMargin,
				zoomScale,
				reactToZoom: webcamReactToZoom,
			});
			const scaledRadius = getWebcamCornerRadiusPx(
				webcamRoundness,
				scaledDimensions.width,
				scaledDimensions.height,
				webcamShape,
			);
			const { x, y } = getWebcamOverlayPosition({
				containerWidth: overlay.clientWidth,
				containerHeight: overlay.clientHeight,
				width: scaledDimensions.width,
				height: scaledDimensions.height,
				margin: scaledMargin,
				positionPreset: webcamPositionPreset,
				positionX: webcamPositionX,
				positionY: webcamPositionY,
				legacyCorner: webcamCorner,
			});

			bubble.style.display = "block";
			bubble.style.left = `${x}px`;
			bubble.style.top = `${y}px`;
			bubble.style.width = `${scaledDimensions.width}px`;
			bubble.style.height = `${scaledDimensions.height}px`;
			bubble.style.aspectRatio = `${scaledDimensions.width} / ${scaledDimensions.height}`;
			const webcamClipPath = getWebcamClipPath(
				webcamRoundness,
				scaledDimensions.width,
				scaledDimensions.height,
				webcamShape,
			);
			const shadowSize = Math.min(scaledDimensions.width, scaledDimensions.height);
			bubble.style.filter = getWebcamShadowFilter(shadowSize, webcamShadow);
			bubble.style.borderRadius = "0px";
			bubble.style.boxShadow = "none";

			bubbleInner.style.borderRadius = "0px";
			bubbleInner.style.overflow = "hidden";
			bubbleInner.style.contain = "paint";
			bubbleInner.style.clipPath = webcamClipPath;
			bubbleInner.style.setProperty("-webkit-clip-path", webcamClipPath);
			const video = webcamVideoRef.current;
			if (!video || video.readyState < 2 || !webcamMediaSynchronized) {
				webcamMotionBlurRef.current.reset();
			}
			const blur =
				video && video.readyState >= 2 && webcamMediaSynchronized
					? webcamMotionBlurRef.current.render({
							layout: { x, y, ...scaledDimensions, radius: scaledRadius },
							resolution: window.devicePixelRatio,
							shape: webcamShape,
							timeMs: timelineTimeRef.current * 1000,
							playing: isPlayingRef.current && !isSeekingRef.current,
							amount: zoomMotionBlurRef.current,
							source: video,
							sourceWidth: video.videoWidth,
							sourceHeight: video.videoHeight,
							cropRegion: webcamCropRegion,
							mirror: webcamMirror,
							shadow: webcamShadow,
						})
					: null;
			if (blur && blurCanvas) {
				if (blurCanvas.width !== blur.canvas.width) blurCanvas.width = blur.canvas.width;
				if (blurCanvas.height !== blur.canvas.height)
					blurCanvas.height = blur.canvas.height;
				const context = blurCanvas.getContext("2d");
				if (context) {
					context.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
					context.drawImage(blur.canvas, 0, 0);
					blurCanvas.style.width = `${blur.width}px`;
					blurCanvas.style.height = `${blur.height}px`;
					blurCanvas.style.left = `${blur.x}px`;
					blurCanvas.style.top = `${blur.y}px`;
					blurCanvas.style.display = "block";
					bubble.style.visibility = "hidden";
				}
			}
		},
		[
			webcamCorner,
			webcamRoundness,
			webcam,
			webcamShape,
			webcamEnabled,
			webcamMargin,
			webcamPositionPreset,
			webcamPositionX,
			webcamPositionY,
			webcamReactToZoom,
			webcamShadow,
			webcamHeight,
			webcamVideoPath,
			webcamWidth,
			webcamMediaSynchronized,
			webcamCropRegion,
			webcamMirror,
			webcamBubbleRef,
			webcamBlurCanvasRef,
			webcamBubbleInnerRef,
			overlayRef,
			timelineTimeRef,
			clipRegionsRef,
			currentTimeRef,
			webcamMotionBlurRef,
			webcamVideoRef,
			isPlayingRef,
			isSeekingRef,
			zoomMotionBlurRef,
		],
	);

	useEffect(() => () => webcamMotionBlurRef.current.destroy(), [webcamMotionBlurRef]);

	useEffect(() => {
		if (!isPlaying) {
			webcamMotionBlurRef.current.reset();
			if (webcamBlurCanvasRef.current) webcamBlurCanvasRef.current.style.display = "none";
			if (webcamBubbleRef.current) webcamBubbleRef.current.style.visibility = "visible";
		}
	}, [isPlaying, webcamMotionBlurRef, webcamBlurCanvasRef, webcamBubbleRef]);
	return {
		webcamEnabled,
		webcamMargin,
		webcamWidth,
		rawWebcamHeight,
		webcamReactToZoom,
		webcamPositionPreset,
		webcamPositionX,
		webcamPositionY,
		webcamCorner,
		webcamRoundness,
		webcamShadow,
		webcamTimeOffsetMs,
		webcamCropRegion,
		webcamMirror,
		webcamHeight,
		webcamCropPreviewContentStyle,
		applyWebcamBubbleLayout,
	};
}
