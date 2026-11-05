import { DEFAULT_WEBCAM_ROUNDNESS } from "@/components/video-editor/types";
import { getSceneEffectMetrics } from "@/components/video-editor/videoPlayback/sceneEffects";
import {
	getWebcamMediaTargetTimeSeconds,
	isWebcamVisibleAtSourceTime,
} from "@/components/video-editor/videoPlayback/webcamSync";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamCornerRadiusPx,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	scaleWebcamOverlayPixels,
} from "@/components/video-editor/webcamOverlay";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import { configureHighQuality2DContext } from "./legacyFrameRendererContext";

export function compositeWithShadows(
	context: Pick<
		LegacyFrameRendererContext,
		| "compositeCanvas"
		| "compositeCtx"
		| "app"
		| "config"
		| "backgroundSprite"
		| "shadowCanvas"
		| "shadowCtx"
		| "drawWebcamOverlay"
	>,
	includeWebcam: boolean = true,
): void {
	if (!context.compositeCanvas || !context.compositeCtx || !context.app) return;

	const videoCanvas = context.app.canvas as HTMLCanvasElement;
	const ctx = context.compositeCtx;
	const w = context.compositeCanvas.width;
	const h = context.compositeCanvas.height;
	const sceneEffects = getSceneEffectMetrics({
		viewportWidth: w,
		backgroundBlur: context.config.backgroundBlur,
		shadowIntensity: context.config.showShadow ? context.config.shadowIntensity : 0,
	});

	// Clear composite canvas
	ctx.clearRect(0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";

	// Step 1: Draw background layer (with optional blur, not affected by zoom)
	if (context.backgroundSprite) {
		const bgCanvas = context.backgroundSprite;

		if (sceneEffects.backgroundBlurPx > 0) {
			ctx.save();
			const overscan = sceneEffects.backgroundOverscanPx;
			ctx.filter = `blur(${sceneEffects.backgroundBlurPx}px)`;
			ctx.drawImage(bgCanvas, -overscan, -overscan, w + overscan * 2, h + overscan * 2);
			ctx.restore();
		} else {
			ctx.drawImage(bgCanvas, 0, 0, w, h);
		}
	} else {
		console.warn("[FrameRenderer] No background sprite found during compositing!");
	}

	// Draw video layer with shadows on top of background
	if (
		context.config.showShadow &&
		context.config.shadowIntensity > 0 &&
		context.shadowCanvas &&
		context.shadowCtx
	) {
		const shadowCtx = context.shadowCtx;
		shadowCtx.clearRect(0, 0, w, h);
		shadowCtx.imageSmoothingEnabled = true;
		shadowCtx.imageSmoothingQuality = "high";
		shadowCtx.save();

		shadowCtx.filter = sceneEffects.shadowFilter;
		shadowCtx.drawImage(videoCanvas, 0, 0, w, h);
		shadowCtx.restore();
		ctx.drawImage(context.shadowCanvas, 0, 0, w, h);
	} else {
		ctx.drawImage(videoCanvas, 0, 0, w, h);
	}

	if (includeWebcam) context.drawWebcamOverlay(ctx, w, h);
}

export function drawWebcamOverlay(
	context: Pick<
		LegacyFrameRendererContext,
		| "config"
		| "webcamDecodedFrame"
		| "webcamVideoElement"
		| "currentVideoTime"
		| "webcamMotionBlur"
		| "webcamFrameCacheCanvas"
		| "lastSyncedWebcamTime"
		| "webcamFrameCacheCtx"
		| "animationState"
		| "webcamMotionTimeMs"
	>,
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
): void {
	const webcam = context.config.webcam;
	const webcamDecodedFrame = context.webcamDecodedFrame;
	const webcamVideo = context.webcamVideoElement;
	if (
		!webcam?.enabled ||
		!isWebcamVisibleAtSourceTime(webcam, context.currentVideoTime) ||
		(!webcamDecodedFrame && !webcamVideo)
	) {
		context.webcamMotionBlur.reset();
		return;
	}

	const hasCachedWebcamFrame = Boolean(
		context.webcamFrameCacheCanvas &&
			context.webcamFrameCacheCanvas.width > 0 &&
			context.webcamFrameCacheCanvas.height > 0,
	);
	const hasLiveWebcamFrame = webcamDecodedFrame
		? webcamDecodedFrame.displayWidth > 0 && webcamDecodedFrame.displayHeight > 0
		: Boolean(
				webcamVideo &&
					webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
					webcamVideo.videoWidth > 0 &&
					webcamVideo.videoHeight > 0,
			);
	if (!hasLiveWebcamFrame && !hasCachedWebcamFrame) {
		context.webcamMotionBlur.reset();
		return;
	}

	const expectedWebcamTargetTime = getWebcamMediaTargetTimeSeconds({
		currentTime: context.currentVideoTime,
		webcamDuration: Number.isFinite(webcamVideo?.duration) ? webcamVideo?.duration : null,
		timeOffsetMs: webcam.timeOffsetMs,
	});

	const canRefreshCache =
		hasLiveWebcamFrame &&
		context.lastSyncedWebcamTime !== null &&
		Math.abs(context.lastSyncedWebcamTime - expectedWebcamTargetTime) <= 0.02 &&
		(webcamDecodedFrame
			? true
			: Boolean(
					webcamVideo &&
						!webcamVideo.seeking &&
						Math.abs(webcamVideo.currentTime - expectedWebcamTargetTime) <= 0.02 &&
						webcamVideo.videoWidth > 0 &&
						webcamVideo.videoHeight > 0,
				));

	if (canRefreshCache) {
		const liveFrameWidth = webcamDecodedFrame?.displayWidth ?? webcamVideo?.videoWidth ?? 0;
		const liveFrameHeight = webcamDecodedFrame?.displayHeight ?? webcamVideo?.videoHeight ?? 0;
		if (
			!context.webcamFrameCacheCanvas ||
			context.webcamFrameCacheCanvas.width !== liveFrameWidth ||
			context.webcamFrameCacheCanvas.height !== liveFrameHeight
		) {
			context.webcamFrameCacheCanvas = document.createElement("canvas");
			context.webcamFrameCacheCanvas.width = liveFrameWidth;
			context.webcamFrameCacheCanvas.height = liveFrameHeight;
			context.webcamFrameCacheCtx = configureHighQuality2DContext(
				context.webcamFrameCacheCanvas.getContext("2d"),
			);
		}

		context.webcamFrameCacheCtx?.clearRect(
			0,
			0,
			context.webcamFrameCacheCanvas!.width,
			context.webcamFrameCacheCanvas!.height,
		);
		context.webcamFrameCacheCtx?.drawImage(
			webcamDecodedFrame ?? webcamVideo!,
			0,
			0,
			context.webcamFrameCacheCanvas!.width,
			context.webcamFrameCacheCanvas!.height,
		);
	}

	const webcamFrameSource =
		context.webcamFrameCacheCanvas ??
		(hasLiveWebcamFrame ? (webcamDecodedFrame ?? webcamVideo) : null);
	if (!webcamFrameSource) {
		return;
	}

	const sourceWidth =
		("displayWidth" in webcamFrameSource
			? webcamFrameSource.displayWidth
			: "videoWidth" in webcamFrameSource
				? webcamFrameSource.videoWidth
				: webcamFrameSource.width) || 1;
	const sourceHeight =
		("displayHeight" in webcamFrameSource
			? webcamFrameSource.displayHeight
			: "videoHeight" in webcamFrameSource
				? webcamFrameSource.videoHeight
				: webcamFrameSource.height) || sourceWidth;
	const margin = scaleWebcamOverlayPixels(webcam.margin ?? 24, width);
	const widthPercent = webcam.width ?? webcam.size ?? 50;
	const heightPercent = getCropMatchedWebcamHeightPercent(
		widthPercent,
		webcam.height ?? webcam.size ?? 50,
		sourceWidth,
		sourceHeight,
		webcam.cropRegion,
	);
	const dimensions = getWebcamOverlayDimensionsPx({
		shape: webcam.shape,
		containerWidth: width,
		containerHeight: height,
		widthPercent,
		heightPercent,
		margin,
		zoomScale: context.animationState.appliedScale || 1,
		reactToZoom: webcam.reactToZoom ?? true,
	});
	const { x, y } = getWebcamOverlayPosition({
		containerWidth: width,
		containerHeight: height,
		width: dimensions.width,
		height: dimensions.height,
		margin,
		positionPreset: webcam.positionPreset ?? webcam.corner,
		positionX: webcam.positionX ?? 1,
		positionY: webcam.positionY ?? 1,
		legacyCorner: webcam.corner,
	});
	const radius = getWebcamCornerRadiusPx(
		webcam.roundness ?? DEFAULT_WEBCAM_ROUNDNESS,
		dimensions.width,
		dimensions.height,
		webcam.shape,
	);
	// Keep fractional layout coordinates in one backing store; rounding a small
	// bubble canvas and stretching it back shifts the clipped video at the edge.
	const overlay = context.webcamMotionBlur.render({
		renderStill: true,
		layout: { x, y, ...dimensions, radius },
		shape: webcam.shape,
		timeMs: context.webcamMotionTimeMs,
		playing: true,
		amount: context.config.zoomMotionBlur ?? 0,
		source: webcamFrameSource,
		sourceWidth,
		sourceHeight,
		cropRegion: webcam.cropRegion,
		mirror: webcam.mirror,
		shadow: webcam.shadow ?? 0,
	});
	if (overlay) {
		ctx.drawImage(overlay.canvas, overlay.x, overlay.y);
	}
}
