import { destroyPixiApplication } from "@/lib/pixiApplicationLifecycle";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";

export function cancelPendingMedia(
	context: Pick<
		LegacyFrameRendererContext,
		| "mediaCancelled"
		| "backgroundForwardFrameSource"
		| "webcamForwardFrameSource"
		| "pendingMediaCancellations"
	>,
): void {
	context.mediaCancelled = true;
	context.backgroundForwardFrameSource?.cancel();
	context.webcamForwardFrameSource?.cancel();
	for (const cancel of [...context.pendingMediaCancellations]) cancel();
	context.pendingMediaCancellations.clear();
}

export function getCanvas(
	context: Pick<LegacyFrameRendererContext, "compositeCanvas">,
): HTMLCanvasElement {
	if (!context.compositeCanvas) {
		throw new Error("Renderer not initialized");
	}
	return context.compositeCanvas;
}

export function destroy(
	context: Pick<
		LegacyFrameRendererContext,
		| "sourceRedaction"
		| "cancelPendingMedia"
		| "webcamMotionBlur"
		| "videoSprite"
		| "videoTextureSource"
		| "backgroundSprite"
		| "app"
		| "zoomBlurFilter"
		| "motionBlurFilter"
		| "cameraContainer"
		| "videoEffectsContainer"
		| "videoContainer"
		| "maskGraphics"
		| "cursorOverlay"
		| "shadowCanvas"
		| "shadowCtx"
		| "compositeCanvas"
		| "compositeCtx"
		| "backgroundCtx"
		| "closeBackgroundDecodedFrame"
		| "backgroundForwardFrameSource"
		| "backgroundForwardFrameSourceUrl"
		| "backgroundForwardFrameDurationSec"
		| "lastSyncedBackgroundLoopTimeSec"
		| "backgroundVideoElement"
		| "cleanupBackgroundSource"
		| "webcamVideoElement"
		| "webcamForwardFrameSource"
		| "closeWebcamDecodedFrame"
		| "cleanupWebcamSource"
		| "webcamFrameCacheCanvas"
		| "webcamFrameCacheCtx"
		| "lastSyncedWebcamTime"
	>,
): void {
	context.cancelPendingMedia();
	context.sourceRedaction.dispose();
	context.webcamMotionBlur.destroy();
	if (context.videoSprite) {
		const videoTexture = context.videoSprite.texture;
		context.videoSprite.destroy({ texture: false, textureSource: false });
		videoTexture?.destroy(true);
		context.videoSprite = null;
		context.videoTextureSource = null;
	}
	context.backgroundSprite = null;
	if (context.app) {
		destroyPixiApplication(context.app, "legacy export renderer");
		context.app = null;
	}
	context.zoomBlurFilter?.destroy();
	context.motionBlurFilter?.destroy();
	context.cameraContainer = null;
	context.videoEffectsContainer = null;
	context.videoContainer = null;
	context.maskGraphics = null;
	context.zoomBlurFilter = null;
	context.motionBlurFilter = null;
	if (context.cursorOverlay) {
		context.cursorOverlay.destroy();
		context.cursorOverlay = null;
	}
	context.shadowCanvas = null;
	context.shadowCtx = null;
	context.compositeCanvas = null;
	context.compositeCtx = null;
	context.backgroundCtx = null;
	context.closeBackgroundDecodedFrame();
	context.backgroundForwardFrameSource?.cancel();
	void context.backgroundForwardFrameSource?.destroy();
	context.backgroundForwardFrameSource = null;
	context.backgroundForwardFrameSourceUrl = null;
	context.backgroundForwardFrameDurationSec = null;
	context.lastSyncedBackgroundLoopTimeSec = null;
	if (context.backgroundVideoElement) {
		context.backgroundVideoElement.pause();
		context.backgroundVideoElement.src = "";
		context.backgroundVideoElement.load();
		context.backgroundVideoElement = null;
	}
	context.cleanupBackgroundSource?.();
	context.cleanupBackgroundSource = null;
	if (context.webcamVideoElement) {
		context.webcamVideoElement.pause();
		context.webcamVideoElement.src = "";
		context.webcamVideoElement.load();
		context.webcamVideoElement = null;
	}
	context.webcamForwardFrameSource?.cancel();
	void context.webcamForwardFrameSource?.destroy();
	context.webcamForwardFrameSource = null;
	context.closeWebcamDecodedFrame();
	context.cleanupWebcamSource?.();
	context.cleanupWebcamSource = null;
	context.webcamFrameCacheCanvas = null;
	context.webcamFrameCacheCtx = null;
	context.lastSyncedWebcamTime = null;
}
