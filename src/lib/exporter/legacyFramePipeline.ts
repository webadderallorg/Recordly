import { Sprite, Texture } from "pixi.js";
import { BASE_PREVIEW_HEIGHT, BASE_PREVIEW_WIDTH } from "@/components/video-editor/types";
import { applyZoomTransform } from "@/components/video-editor/videoPlayback/zoomTransform";
import { renderAnnotations } from "./annotationRenderer";
import { renderCaptions } from "./captionRenderer";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import { PixiTextureInput, VideoTextureSource } from "./legacyFrameRendererContext";

export async function renderFrame(
	context: Pick<
		LegacyFrameRendererContext,
		| "sourceRedaction"
		| "sourceRedactionTextureActive"
		| "app"
		| "videoContainer"
		| "cameraContainer"
		| "compositeCtx"
		| "currentVideoTime"
		| "webcamMotionBlur"
		| "updateAnimationState"
		| "backgroundForwardFrameSource"
		| "backgroundVideoElement"
		| "syncBackgroundFrame"
		| "compositeWithShadows"
		| "videoSprite"
		| "videoTextureSource"
		| "cursorOverlay"
		| "cursorContainer"
		| "updateLayout"
		| "layoutCache"
		| "webcamForwardFrameSource"
		| "webcamVideoElement"
		| "syncWebcamFrame"
		| "config"
		| "webcamMotionTimeMs"
		| "zoomBlurFilter"
		| "motionBlurFilter"
		| "animationState"
		| "motionBlurState"
	>,
	videoFrame: VideoFrame | null,
	timestamp: number,
	cursorTimestamp: number = timestamp,
	_frameDurationUs?: number,
	backgroundTimelineTimestamp: number = timestamp,
): Promise<void> {
	if (
		!context.app ||
		!context.videoContainer ||
		!context.cameraContainer ||
		!context.compositeCtx
	) {
		throw new Error("Renderer not initialized");
	}

	context.currentVideoTime = timestamp / 1000000;
	context.cameraContainer.visible = videoFrame !== null;
	if (!videoFrame) {
		context.webcamMotionBlur.reset();
		context.updateAnimationState(backgroundTimelineTimestamp / 1000, cursorTimestamp / 1000);
		if (context.backgroundForwardFrameSource || context.backgroundVideoElement) {
			await context.syncBackgroundFrame(backgroundTimelineTimestamp / 1_000_000);
		}
		context.app.renderer.render(context.app.stage);
		context.compositeWithShadows(false);
		return;
	}

	const timeMs = context.config.timelineEffects
		? backgroundTimelineTimestamp / 1000
		: timestamp / 1000;
	const redactedSource = context.sourceRedaction.render(videoFrame, {
		width: videoFrame.displayWidth || context.config.videoWidth,
		height: videoFrame.displayHeight || context.config.videoHeight,
		annotations: context.config.annotationRegions ?? [],
		timeMs,
		cropRegion: context.config.cropRegion,
	});
	const source = redactedSource ?? videoFrame;
	const sourceRedactionActive = redactedSource !== null;

	// Create or update video sprite from VideoFrame
	if (!context.videoSprite || context.sourceRedactionTextureActive !== sourceRedactionActive) {
		const texture = Texture.from(source as unknown as PixiTextureInput);
		if (context.videoSprite) {
			const previous = context.videoSprite.texture;
			context.videoSprite.texture = texture;
			previous.destroy(true);
		} else {
			context.videoSprite = new Sprite(texture);
			context.videoContainer.addChild(context.videoSprite);
		}
		context.videoTextureSource = texture.source as unknown as VideoTextureSource;
		context.sourceRedactionTextureActive = sourceRedactionActive;
		if (context.cursorOverlay && context.cursorContainer) {
			context.cursorContainer.addChild(context.cursorOverlay.container);
		}
	} else {
		context.videoTextureSource ??= context.videoSprite.texture
			.source as unknown as VideoTextureSource;
		context.videoTextureSource.resource = source;
		context.videoTextureSource.update();
	}

	// Apply layout
	context.updateLayout();
	const layoutCache = context.layoutCache;
	if (!layoutCache) {
		return;
	}

	if (context.webcamForwardFrameSource || context.webcamVideoElement) {
		const targetTime = Math.max(0, context.currentVideoTime);
		await context.syncWebcamFrame(targetTime);
	}

	// Sync video wallpaper frame
	if (context.backgroundForwardFrameSource || context.backgroundVideoElement) {
		await context.syncBackgroundFrame(Math.max(0, backgroundTimelineTimestamp / 1_000_000));
	}

	context.webcamMotionTimeMs = timeMs;
	const cursorTimeMs = cursorTimestamp / 1000;

	if (context.cursorOverlay) {
		context.cursorOverlay.update(
			context.config.cursorTelemetry ?? [],
			cursorTimeMs,
			layoutCache.maskRect,
			context.config.showCursor ?? true,
			false,
		);
	}

	const TICKS_PER_FRAME = 1;

	for (let i = 0; i < TICKS_PER_FRAME; i++) {
		context.updateAnimationState(timeMs, cursorTimeMs);
	}

	applyZoomTransform({
		cameraContainer: context.cameraContainer,
		zoomBlurFilter: context.zoomBlurFilter,
		motionBlurFilter: context.motionBlurFilter,
		stageSize: layoutCache.stageSize,
		baseMask: layoutCache.maskRect,
		zoomScale: context.animationState.scale,
		zoomProgress: context.animationState.progress,
		focusX: context.animationState.focusX,
		focusY: context.animationState.focusY,
		isPlaying: true,
		motionBlurAmount: context.config.zoomMotionBlur ?? 0,
		motionBlurTuning: context.config.zoomMotionBlurTuning,
		transformOverride: {
			scale: context.animationState.appliedScale,
			x: context.animationState.x,
			y: context.animationState.y,
		},
		motionBlurState: context.motionBlurState,
		frameTimeMs: timeMs,
	});

	// Render the PixiJS stage to its canvas (video only, transparent background)
	context.app.renderer.render(context.app.stage);

	// Composite with shadows to final output canvas
	context.compositeWithShadows();

	// Draw device frame overlay on top of video content

	// Render annotations on top if present
	if (
		context.config.annotationRegions &&
		context.config.annotationRegions.length > 0 &&
		context.compositeCtx
	) {
		// Calculate scale factor based on export vs preview dimensions
		const scaleX = context.config.width / (context.config.previewWidth || BASE_PREVIEW_WIDTH);
		const scaleY =
			context.config.height / (context.config.previewHeight || BASE_PREVIEW_HEIGHT);
		const scaleFactor = (scaleX + scaleY) / 2;

		await renderAnnotations(
			context.compositeCtx,
			context.config.annotationRegions,
			context.config.width,
			context.config.height,
			timeMs,
			scaleFactor,
			undefined,
			{
				scale: context.animationState.appliedScale,
				x: context.animationState.x,
				y: context.animationState.y,
			},
			context.layoutCache?.maskRect,
		);
	}

	if (
		context.config.autoCaptions &&
		context.config.autoCaptions.length > 0 &&
		context.config.autoCaptionSettings &&
		context.compositeCtx
	) {
		renderCaptions(
			context.compositeCtx,
			context.config.autoCaptions,
			context.config.autoCaptionSettings,
			context.config.width,
			context.config.height,
			timestamp / 1000,
		);
	}
}
