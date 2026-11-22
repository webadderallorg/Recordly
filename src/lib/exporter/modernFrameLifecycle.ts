import { Texture } from "pixi.js";
import { destroyPixiApplication } from "@/lib/pixiApplicationLifecycle";
import type { FrameRenderContext } from "./modernFrameRenderer";

export function destroyFrameRenderer(context: FrameRenderContext): void {
	context.annotations.sourceRedaction.dispose();
	const texturesToDestroy = new Set<Texture>();
	for (const sprite of [
		context.scene.videoSprite,
		context.background.backgroundSprite,
		context.webcam.webcamSprite,
		context.webcam.webcamBlurSprite,
		context.captions.captionSprite,
		...context.shadows.videoShadowLayers.map((layer) => layer.sprite),
	]) {
		if (sprite?.texture) texturesToDestroy.add(sprite.texture);
	}
	for (const entry of context.annotations.annotationSprites) {
		texturesToDestroy.add(entry.texture);
	}

	if (context.scene.cursorOverlay) {
		context.scene.cursorOverlay.destroy();
		context.scene.cursorOverlay = null;
	}

	if (context.scene.videoEffectsContainer) {
		context.scene.videoEffectsContainer.filters = null;
	}
	if (context.background.backgroundSprite) {
		context.background.backgroundSprite.filters = null;
	}
	context.scene.zoomBlurFilter?.destroy();
	context.scene.motionBlurFilter?.destroy();
	context.background.backgroundBlurFilter?.destroy();

	destroyPixiApplication(context.scene.app, "Lightning export renderer");

	for (const texture of texturesToDestroy) {
		try {
			texture.destroy(true);
		} catch (error) {
			console.warn("[FrameRenderer] Failed to destroy texture during cleanup:", error);
		}
	}

	context.scene.app = null;
	context.scene.backgroundContainer = null;
	context.scene.cameraContainer = null;
	context.scene.videoEffectsContainer = null;
	context.scene.videoContainer = null;
	context.scene.cursorContainer = null;
	context.scene.overlayContainer = null;
	context.scene.annotationContainer = null;
	context.scene.captionContainer = null;
	context.webcam.webcamBlurSprite = null;
	context.webcam.webcamMotionBlur.destroy();
	context.scene.webcamRootContainer = null;
	context.scene.webcamContainer = null;
	context.scene.videoSprite = null;
	context.scene.videoTextureSource = null;
	context.background.backgroundSprite = null;
	context.background.backgroundTextureSource = null;
	context.scene.videoMaskGraphics = null;
	context.scene.webcamMaskGraphics = null;
	context.scene.zoomBlurFilter = null;
	context.scene.motionBlurFilter = null;
	context.background.backgroundBlurFilter = null;
	context.annotations.annotationAssets = null;
	context.annotations.annotationSprites = [];
	context.shadows.videoShadowLayers = [];
	context.webcam.webcamSprite = null;
	context.webcam.webcamTextureSource = null;

	context.backgroundPlayback.closeBackgroundDecodedFrame();
	context.backgroundPlayback.backgroundForwardFrameSource?.cancel();
	void context.backgroundPlayback.backgroundForwardFrameSource?.destroy();
	context.backgroundPlayback.backgroundForwardFrameSource = null;
	context.backgroundPlayback.backgroundForwardFrameSourceUrl = null;
	context.backgroundPlayback.backgroundForwardFrameDurationSec = null;
	context.backgroundPlayback.lastSyncedBackgroundLoopTimeSec = null;
	if (context.backgroundPlayback.backgroundVideoElement) {
		context.backgroundPlayback.backgroundVideoElement.pause();
		context.backgroundPlayback.backgroundVideoElement.src = "";
		context.backgroundPlayback.backgroundVideoElement.load();
		context.backgroundPlayback.backgroundVideoElement = null;
	}

	context.webcamMedia.webcamForwardFrameSource?.cancel();
	void context.webcamMedia.webcamForwardFrameSource?.destroy();
	context.webcamMedia.webcamForwardFrameSource = null;
	context.webcamMedia.closeWebcamDecodedFrame();
	if (context.webcamMedia.webcamVideoElement) {
		context.webcamMedia.webcamVideoElement.pause();
		context.webcamMedia.webcamVideoElement.src = "";
		context.webcamMedia.webcamVideoElement.load();
		context.webcamMedia.webcamVideoElement = null;
	}
	context.webcamMedia.cleanupWebcamSource?.();
	context.webcamMedia.cleanupWebcamSource = null;
	context.webcamFrames.webcamFrameCacheCanvas = null;
	context.webcamFrames.webcamFrameCacheCtx = null;
	context.textures.sceneVideoFrameStagingCanvas = null;
	context.textures.sceneVideoFrameStagingCtx = null;
	context.textures.webcamVideoFrameStagingCanvas = null;
	context.textures.webcamVideoFrameStagingCtx = null;
	context.scene.videoTextureUsesStartupStaging = false;
	context.webcam.webcamTextureUsesStartupStaging = false;
	context.textures.closeRetainedVideoFrame("scene");
	context.textures.closeRetainedVideoFrame("background");
	context.textures.closeRetainedVideoFrame("webcam");
	context.textures.closeRetainedBitmap("scene");
	context.textures.closeRetainedBitmap("background");

	context.captions.captionCanvas = null;
	context.captions.captionCtx = null;
	context.captions.captionMeasureCanvas = null;
	context.captions.captionMeasureCtx = null;
	context.captions.captionSprite = null;
	context.captions.captionTextureSource = null;
	context.captions.captionRenderKey = null;
	context.annotations.exportCompositeCanvas = null;
	context.annotations.outputCanvasOverride = null;

	context.annotations.annotationScaleFactor = 1;
	context.webcamMedia.lastSyncedWebcamTime = null;
	context.webcamFrames.webcamRenderMode = "hidden";
	context.webcam.webcamLayoutCache = null;
	context.geometry.layoutCache = null;
}
