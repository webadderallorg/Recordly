import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import {
	computeCursorFollowFocus,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import {
	getZoomSpringConfig,
	resetSpringState,
	stepSpringValue,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import { findDominantRegion } from "@/components/video-editor/videoPlayback/zoomRegionUtils";
import {
	computeFocusFromTransform,
	computeZoomTransform,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import { ZOOM_DEPTH_SCALES } from "@/components/video-editor/types";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { FrameRenderer } from "./modernFrameRenderer";
import { clampUnitInterval, rasterizeShadowLayer } from "./frameRendererHelpers";

export function updateAnimationState(self: FrameRenderer, timeMs: number): number {
	if (!self.cameraContainer || !self.layoutCache) {
		return 0;
	}

	const { region, strength, blendedScale, transition } = findDominantRegion(
		self.config.zoomRegions,
		timeMs,
		{
			connectZooms: self.config.connectZooms,
		},
	);

	let targetScaleFactor = 1;
	let targetFocus = { ...DEFAULT_FOCUS };
	let targetProgress = 0;

	if (region && strength > 0) {
		const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];

		let regionFocus = region.focus;
		if (
			!self.config.zoomClassicMode &&
			region.mode !== "manual" &&
			self.config.cursorTelemetry &&
			self.config.cursorTelemetry.length > 0
		) {
			regionFocus = computeCursorFollowFocus(
				self.cursorFollowCamera,
				self.config.cursorTelemetry,
				timeMs,
				zoomScale,
				strength,
				region.focus,
				{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
			);
		}

		targetScaleFactor = zoomScale;
		targetFocus = regionFocus;
		targetProgress = strength;

		if (transition) {
			const startTransform = computeZoomTransform({
				stageSize: self.layoutCache.stageSize,
				baseMask: self.layoutCache.maskRect,
				zoomScale: transition.startScale,
				zoomProgress: 1,
				focusX: transition.startFocus.cx,
				focusY: transition.startFocus.cy,
			});
			const endTransform = computeZoomTransform({
				stageSize: self.layoutCache.stageSize,
				baseMask: self.layoutCache.maskRect,
				zoomScale: transition.endScale,
				zoomProgress: 1,
				focusX: transition.endFocus.cx,
				focusY: transition.endFocus.cy,
			});

			const interpolatedTransform = {
				scale:
					startTransform.scale +
					(endTransform.scale - startTransform.scale) * transition.progress,
				x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
				y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
			};

			targetScaleFactor = interpolatedTransform.scale;
			targetFocus = computeFocusFromTransform({
				stageSize: self.layoutCache.stageSize,
				baseMask: self.layoutCache.maskRect,
				zoomScale: interpolatedTransform.scale,
				x: interpolatedTransform.x,
				y: interpolatedTransform.y,
			});
			targetProgress = 1;
		}
	}

	const state = self.animationState;
	const previousScale = state.appliedScale;
	const previousX = state.x;
	const previousY = state.y;

	state.scale = targetScaleFactor;
	state.focusX = targetFocus.cx;
	state.focusY = targetFocus.cy;
	state.progress = targetProgress;

	const projectedTransform = computeZoomTransform({
		stageSize: self.layoutCache.stageSize,
		baseMask: self.layoutCache.maskRect,
		zoomScale: state.scale,
		zoomProgress: state.progress,
		focusX: state.focusX,
		focusY: state.focusY,
	});

	const deltaMs =
		self.lastContentTimeMs !== null ? timeMs - self.lastContentTimeMs : 1000 / 60;
	self.lastContentTimeMs = timeMs;

	const zoomSpringConfig = getZoomSpringConfig(self.config.zoomSmoothness);

	if (self.config.zoomClassicMode) {
		state.appliedScale = projectedTransform.scale;
		state.x = projectedTransform.x;
		state.y = projectedTransform.y;
		resetSpringState(self.springScale, state.appliedScale);
		resetSpringState(self.springX, state.x);
		resetSpringState(self.springY, state.y);
	} else {
		state.appliedScale = stepSpringValue(
			self.springScale,
			projectedTransform.scale,
			deltaMs,
			zoomSpringConfig,
		);
		state.x = stepSpringValue(
			self.springX,
			projectedTransform.x,
			deltaMs,
			zoomSpringConfig,
		);
		state.y = stepSpringValue(
			self.springY,
			projectedTransform.y,
			deltaMs,
			zoomSpringConfig,
		);
	}

	self.lastMotionVector = {
		x: state.x - previousX,
		y: state.y - previousY,
	};

	return Math.max(
		Math.abs(state.appliedScale - previousScale),
		Math.abs(state.x - previousX) / Math.max(1, self.layoutCache.stageSize.width),
		Math.abs(state.y - previousY) / Math.max(1, self.layoutCache.stageSize.height),
	);
}

export function updateLayout(self: FrameRenderer): void {
	if (!self.videoSprite || !self.videoMaskGraphics || !self.videoContainer) {
		return;
	}

	const { width, height } = self.config;
	const { cropRegion, borderRadius = 0, padding = 0 } = self.config;
	const videoWidth = self.config.videoWidth;
	const videoHeight = self.config.videoHeight;

	const cropStartX = cropRegion.x;
	const cropStartY = cropRegion.y;
	const cropEndX = cropRegion.x + cropRegion.width;
	const cropEndY = cropRegion.y + cropRegion.height;

	const croppedVideoWidth = videoWidth * (cropEndX - cropStartX);
	const croppedVideoHeight = videoHeight * (cropEndY - cropStartY);

	const paddingScale = 1.0 - (padding / 100) * 0.4;
	const viewportWidth = width * paddingScale;
	const viewportHeight = height * paddingScale;
	const scale = Math.min(
		viewportWidth / croppedVideoWidth,
		viewportHeight / croppedVideoHeight,
	);

	self.videoSprite.scale.set(scale);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;
	const centerOffsetX = (width - croppedDisplayWidth) / 2;
	const centerOffsetY = (height - croppedDisplayHeight) / 2;

	const spriteX = centerOffsetX - cropRegion.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - cropRegion.y * fullVideoDisplayHeight;
	self.videoSprite.position.set(spriteX, spriteY);

	const previewWidth = self.config.previewWidth || 1920;
	const previewHeight = self.config.previewHeight || 1080;
	const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
	const scaledBorderRadius = borderRadius * canvasScaleFactor;

	self.videoMaskGraphics.clear();
	drawSquircleOnGraphics(self.videoMaskGraphics, {
		x: centerOffsetX,
		y: centerOffsetY,
		width: croppedDisplayWidth,
		height: croppedDisplayHeight,
		radius: scaledBorderRadius,
	});
	self.videoMaskGraphics.fill({ color: 0xffffff });

	updateVideoShadowLayout(self, {
		maskX: centerOffsetX,
		maskY: centerOffsetY,
		maskWidth: croppedDisplayWidth,
		maskHeight: croppedDisplayHeight,
		maskRadius: scaledBorderRadius,
	});

	self.layoutCache = {
		stageSize: { width, height },
		videoSize: { width: croppedVideoWidth, height: croppedVideoHeight },
		baseScale: scale,
		baseOffset: { x: spriteX, y: spriteY },
		maskRect: {
			x: centerOffsetX,
			y: centerOffsetY,
			width: croppedDisplayWidth,
			height: croppedDisplayHeight,
			sourceCrop: cropRegion,
		},
	};
}

function updateVideoShadowLayout(
	self: FrameRenderer,
	layout: {
		maskX: number;
		maskY: number;
		maskWidth: number;
		maskHeight: number;
		maskRadius: number;
	},
): void {
	const shadowStrength = clampUnitInterval(self.config.shadowIntensity);
	for (const layer of self.videoShadowLayers) {
		if (!self.config.showShadow || shadowStrength <= 0) {
			layer.container.visible = false;
			continue;
		}

		const offsetY = layer.offsetScale * shadowStrength;
		rasterizeShadowLayer(layer, {
			x: layout.maskX,
			y: layout.maskY,
			width: layout.maskWidth,
			height: layout.maskHeight,
			radius: layout.maskRadius,
			offsetY,
			alpha: layer.alphaScale * shadowStrength,
			blur: Math.max(0, layer.blurScale * shadowStrength),
		});
	}
}
