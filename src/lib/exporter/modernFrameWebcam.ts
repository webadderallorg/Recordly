import { Sprite } from "pixi.js";
import { DEFAULT_WEBCAM_ROUNDNESS } from "@/components/video-editor/types";
import { isWebcamVisibleAtSourceTime } from "@/components/video-editor/videoPlayback/webcamSync";
import { WebcamMotionBlur } from "@/components/video-editor/webcamMotionBlur";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamCornerRadiusPx,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	getWebcamShapeExponent,
	scaleWebcamOverlayPixels,
} from "@/components/video-editor/webcamOverlay";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { MutableVideoTextureSource, WebcamLayoutCache } from "./modernFrameTypes";
import { applyCoverLayoutToSprite, areNearlyEqual } from "./modernFrameUtils";
import { getWebcamShadowStrength } from "./shadowProfile";

/** Owns webcam resources for one export renderer. */
export class FrameWebcam {
	constructor(
		private readonly context: Pick<
			FrameRenderContext,
			| "scene"
			| "textures"
			| "currentVideoTime"
			| "config"
			| "webcamFrames"
			| "webcamMedia"
			| "motion"
		>,
	) {}

	webcamMotionBlur = new WebcamMotionBlur();

	webcamBlurSprite: Sprite | null = null;

	webcamSprite: Sprite | null = null;

	webcamTextureSource: MutableVideoTextureSource | null = null;

	webcamLayoutCache: WebcamLayoutCache | null = null;

	webcamTextureUsesStartupStaging = false;

	ensureWebcamSprite(
		source: CanvasImageSource | VideoFrame,
		sourceWidth: number,
		sourceHeight: number,
	): void {
		if (!this.context.scene.webcamContainer) {
			return;
		}

		const resolvedSource =
			typeof VideoFrame !== "undefined" && source instanceof VideoFrame
				? this.context.textures.stageVideoFrameForTexture(
						source,
						"webcam",
						sourceWidth,
						sourceHeight,
					)
				: source;
		const usesStartupStaging = resolvedSource !== source;

		if (!this.webcamSprite) {
			const texture = this.context.textures.createTextureFromSource(resolvedSource);
			this.webcamSprite = new Sprite(texture);
			this.webcamTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.context.scene.webcamContainer.addChildAt(this.webcamSprite, 0);
			this.webcamTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.webcamTextureUsesStartupStaging !== usesStartupStaging) {
			this.webcamTextureSource = this.context.textures.replaceSpriteTexture(
				this.webcamSprite,
				resolvedSource,
			);
			this.webcamTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.webcamTextureSource) {
			this.webcamTextureSource.resource = resolvedSource;
			this.webcamTextureSource.update();
		}

		if (this.context.scene.webcamRootContainer) {
			this.context.scene.webcamRootContainer.visible = sourceWidth > 0 && sourceHeight > 0;
		}
	}

	hasMatchingWebcamLayout(nextLayout: WebcamLayoutCache): boolean {
		const previousLayout = this.webcamLayoutCache;
		if (!previousLayout) {
			return false;
		}

		return (
			previousLayout.exponent === nextLayout.exponent &&
			previousLayout.mirror === nextLayout.mirror &&
			areNearlyEqual(previousLayout.sourceWidth, nextLayout.sourceWidth) &&
			areNearlyEqual(previousLayout.sourceHeight, nextLayout.sourceHeight) &&
			areNearlyEqual(previousLayout.width, nextLayout.width) &&
			areNearlyEqual(previousLayout.height, nextLayout.height) &&
			areNearlyEqual(previousLayout.positionX, nextLayout.positionX) &&
			areNearlyEqual(previousLayout.positionY, nextLayout.positionY) &&
			areNearlyEqual(previousLayout.radius, nextLayout.radius)
		);
	}

	applyWebcamLayout(nextLayout: WebcamLayoutCache): void {
		if (
			!this.context.scene.webcamRootContainer ||
			!this.webcamSprite ||
			!this.context.scene.webcamMaskGraphics
		) {
			return;
		}

		this.context.scene.webcamRootContainer.position.set(
			nextLayout.positionX,
			nextLayout.positionY,
		);

		applyCoverLayoutToSprite(
			this.webcamSprite,
			nextLayout.sourceWidth,
			nextLayout.sourceHeight,
			nextLayout.width,
			nextLayout.height,
			nextLayout.width / 2,
			nextLayout.height / 2,
			nextLayout.mirror,
		);

		this.context.scene.webcamMaskGraphics.clear();
		drawSquircleOnGraphics(this.context.scene.webcamMaskGraphics, {
			x: 0,
			y: 0,
			width: nextLayout.width,
			height: nextLayout.height,
			radius: nextLayout.radius,
			exponent: nextLayout.exponent,
		});
		this.context.scene.webcamMaskGraphics.fill({ color: 0xffffff });

		this.webcamLayoutCache = { ...nextLayout };
	}

	updateWebcamOverlay(
		referenceTimeSeconds = this.context.currentVideoTime,
		frameTimeMs = referenceTimeSeconds * 1000,
	): void {
		const webcam = this.context.config.webcam;
		if (
			!webcam?.enabled ||
			!isWebcamVisibleAtSourceTime(webcam, referenceTimeSeconds) ||
			!this.context.scene.webcamRootContainer ||
			!this.context.scene.webcamMaskGraphics
		) {
			if (this.context.scene.webcamRootContainer) {
				this.context.scene.webcamRootContainer.visible = false;
			}
			this.webcamLayoutCache = null;
			this.webcamMotionBlur.reset();
			this.context.webcamFrames.setWebcamRenderMode("hidden");
			return;
		}

		const webcamSource =
			this.context.webcamMedia.webcamDecodedFrame ??
			this.context.webcamMedia.webcamVideoElement;
		const liveSourceDimensions = webcamSource
			? this.context.webcamMedia.getWebcamSourceDimensions(webcamSource)
			: { width: 0, height: 0 };
		const activeWebcamVideoElement =
			webcamSource === this.context.webcamMedia.webcamVideoElement
				? this.context.webcamMedia.webcamVideoElement
				: null;
		const expectedWebcamTargetTime =
			this.context.webcamMedia.getExpectedWebcamTargetTimeSeconds(referenceTimeSeconds);
		const measuredWebcamTime =
			activeWebcamVideoElement && Number.isFinite(activeWebcamVideoElement.currentTime)
				? activeWebcamVideoElement.currentTime
				: this.context.webcamMedia.lastSyncedWebcamTime;
		const webcamTimeDrift =
			measuredWebcamTime === null
				? 0
				: Math.abs(measuredWebcamTime - expectedWebcamTargetTime);
		const canUseLiveSource =
			!!webcamSource &&
			liveSourceDimensions.width > 0 &&
			liveSourceDimensions.height > 0 &&
			webcamTimeDrift <= 0.08 &&
			(!activeWebcamVideoElement ||
				(activeWebcamVideoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
					!activeWebcamVideoElement.seeking));
		const renderableWebcamSource = this.context.webcamFrames.resolveRenderableWebcamSource(
			webcamSource,
			liveSourceDimensions.width,
			liveSourceDimensions.height,
			canUseLiveSource,
		);

		if (!renderableWebcamSource) {
			this.context.scene.webcamRootContainer.visible = false;
			this.webcamLayoutCache = null;
			this.webcamMotionBlur.reset();
			return;
		}

		this.ensureWebcamSprite(
			renderableWebcamSource.source,
			renderableWebcamSource.width,
			renderableWebcamSource.height,
		);
		if (!this.webcamSprite) {
			this.context.scene.webcamRootContainer.visible = false;
			return;
		}

		const margin = scaleWebcamOverlayPixels(webcam.margin ?? 24, this.context.config.width);
		const widthPercent = webcam.width ?? webcam.size ?? 50;
		const aspectSourceWidth =
			liveSourceDimensions.width > 0
				? liveSourceDimensions.width
				: renderableWebcamSource.width;
		const aspectSourceHeight =
			liveSourceDimensions.height > 0
				? liveSourceDimensions.height
				: renderableWebcamSource.height;
		const heightPercent = getCropMatchedWebcamHeightPercent(
			widthPercent,
			webcam.height ?? webcam.size ?? 50,
			aspectSourceWidth,
			aspectSourceHeight,
			webcam.cropRegion,
		);
		const dimensions = getWebcamOverlayDimensionsPx({
			shape: webcam.shape,
			containerWidth: this.context.config.width,
			containerHeight: this.context.config.height,
			widthPercent,
			heightPercent,
			margin,
			zoomScale: this.context.motion.animationState.appliedScale || 1,
			reactToZoom: webcam.reactToZoom ?? true,
		});
		const position = getWebcamOverlayPosition({
			containerWidth: this.context.config.width,
			containerHeight: this.context.config.height,
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
		const shadowStrength = getWebcamShadowStrength(webcam.shadow ?? 0);

		this.context.scene.webcamRootContainer.visible = true;

		const nextLayout: WebcamLayoutCache = {
			exponent: getWebcamShapeExponent(webcam.shape),
			sourceWidth: renderableWebcamSource.width,
			sourceHeight: renderableWebcamSource.height,
			width: dimensions.width,
			height: dimensions.height,
			positionX: position.x,
			positionY: position.y,
			radius,
			mirror: webcam.mirror,
		};

		// Composite the clipped image before applying its shadow. A separate black
		// silhouette and a GPU stencil have different edge coverage, exposing a rim.
		const blur = this.webcamMotionBlur.render({
			renderStill: shadowStrength > 0,
			layout: { x: position.x, y: position.y, ...dimensions, radius },
			shape: webcam.shape,
			timeMs: frameTimeMs,
			playing: true,
			amount: this.context.config.zoomMotionBlur ?? 0,
			source: renderableWebcamSource.source,
			sourceWidth: renderableWebcamSource.width,
			sourceHeight: renderableWebcamSource.height,
			mirror: webcam.mirror,
			shadow: webcam.shadow ?? 0,
		});
		if (blur) {
			if (!this.webcamBlurSprite) {
				const texture = this.context.textures.createTextureFromSource(blur.canvas);
				texture.dynamic = true;
				this.webcamBlurSprite = new Sprite(texture);
				this.context.scene.webcamRootContainer.addChild(this.webcamBlurSprite);
			} else {
				this.webcamBlurSprite.texture.source.update();
			}
			this.context.scene.webcamRootContainer.position.set(0, 0);
			this.webcamBlurSprite.position.set(blur.x, blur.y);
			this.webcamBlurSprite.visible = true;
			if (this.context.scene.webcamContainer)
				this.context.scene.webcamContainer.visible = false;
			this.webcamLayoutCache = null;
			return;
		}
		if (this.webcamBlurSprite) this.webcamBlurSprite.visible = false;
		if (this.context.scene.webcamContainer) this.context.scene.webcamContainer.visible = true;
		if (!this.hasMatchingWebcamLayout(nextLayout)) {
			this.applyWebcamLayout(nextLayout);
		}
	}
}
