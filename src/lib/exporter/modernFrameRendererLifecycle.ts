import type { Texture } from "pixi.js";
import { closeBackgroundDecodedFrame } from "./frameRendererBackground";
import { closeWebcamDecodedFrame } from "./frameRendererWebcamSync";
import type { FrameRenderer } from "./modernFrameRenderer";

export function destroyFrameRenderer(self: FrameRenderer): void {
	const texturesToDestroy = new Set<Texture>();
	if (self.videoSprite?.texture) {
		texturesToDestroy.add(self.videoSprite.texture);
	}
	if (self.backgroundSprite?.texture) {
		texturesToDestroy.add(self.backgroundSprite.texture);
	}
	if (self.webcamSprite?.texture) {
		texturesToDestroy.add(self.webcamSprite.texture);
	}
	if (self.captionSprite?.texture) {
		texturesToDestroy.add(self.captionSprite.texture);
	}
	for (const layer of self.videoShadowLayers) {
		if (layer.sprite?.texture) {
			texturesToDestroy.add(layer.sprite.texture);
		}
	}
	for (const layer of self.webcamShadowLayers) {
		if (layer.sprite?.texture) {
			texturesToDestroy.add(layer.sprite.texture);
		}
	}
	for (const entry of self.annotationSprites) {
		texturesToDestroy.add(entry.texture);
	}

	if (self.cursorOverlay) {
		self.cursorOverlay.destroy();
		self.cursorOverlay = null;
	}

	if (self.videoEffectsContainer) {
		self.videoEffectsContainer.filters = null;
	}
	if (self.backgroundSprite) {
		self.backgroundSprite.filters = null;
	}
	self.blurFilter?.destroy();
	self.motionBlurFilter?.destroy();
	self.backgroundBlurFilter?.destroy();

	self.app?.destroy(true, {
		children: true,
		texture: false,
		textureSource: false,
	});

	for (const texture of texturesToDestroy) {
		try {
			texture.destroy(true);
		} catch (error) {
			console.warn("[FrameRenderer] Failed to destroy texture during cleanup:", error);
		}
	}

	self.app = null;
	self.backgroundContainer = null;
	self.cameraContainer = null;
	self.videoEffectsContainer = null;
	self.videoContainer = null;
	self.cursorContainer = null;
	self.overlayContainer = null;
	self.annotationContainer = null;
	self.captionContainer = null;
	self.webcamRootContainer = null;
	self.webcamContainer = null;
	self.videoSprite = null;
	self.videoTextureSource = null;
	self.backgroundSprite = null;
	self.backgroundTextureSource = null;
	self.videoMaskGraphics = null;
	self.webcamMaskGraphics = null;
	self.blurFilter = null;
	self.motionBlurFilter = null;
	self.backgroundBlurFilter = null;
	self.annotationAssets = null;
	self.annotationSprites = [];
	self.videoShadowLayers = [];
	self.webcamShadowLayers = [];
	self.webcamSprite = null;
	self.webcamTextureSource = null;

	closeBackgroundDecodedFrame(self);
	self.backgroundForwardFrameSource?.cancel();
	void self.backgroundForwardFrameSource?.destroy();
	self.backgroundForwardFrameSource = null;
	if (self.backgroundVideoElement) {
		self.backgroundVideoElement.pause();
		self.backgroundVideoElement.src = "";
		self.backgroundVideoElement.load();
		self.backgroundVideoElement = null;
	}

	self.webcamForwardFrameSource?.cancel();
	void self.webcamForwardFrameSource?.destroy();
	self.webcamForwardFrameSource = null;
	closeWebcamDecodedFrame(self);
	if (self.webcamVideoElement) {
		self.webcamVideoElement.pause();
		self.webcamVideoElement.src = "";
		self.webcamVideoElement.load();
		self.webcamVideoElement = null;
	}
	self.cleanupWebcamSource?.();
	self.cleanupWebcamSource = null;
	self.webcamFrameCacheCanvas = null;
	self.webcamFrameCacheCtx = null;
	self.sceneVideoFrameStagingCanvas = null;
	self.sceneVideoFrameStagingCtx = null;
	self.webcamVideoFrameStagingCanvas = null;
	self.webcamVideoFrameStagingCtx = null;
	self.videoTextureUsesStartupStaging = false;
	self.webcamTextureUsesStartupStaging = false;

	self.captionCanvas = null;
	self.captionCtx = null;
	self.captionMeasureCanvas = null;
	self.captionMeasureCtx = null;
	self.captionSprite = null;
	self.captionTextureSource = null;
	self.captionRenderKey = null;
	self.exportCompositeCanvas = null;
	self.outputCanvasOverride = null;

	self.annotationScaleFactor = 1;
	self.lastSyncedWebcamTime = null;
	self.lastWebcamCacheRefreshTime = null;
	self.webcamRenderMode = "hidden";
	self.webcamLayoutCache = null;
	self.layoutCache = null;
}