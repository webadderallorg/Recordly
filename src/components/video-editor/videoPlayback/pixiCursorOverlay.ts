import { Container, Sprite } from "pixi.js";
import {
	getCursorIdleOpacity,
	normalizeCursorIdleHideSettings,
	type CursorIdleHideSettings,
} from "./cursorIdleVisibility";
import {
	type CursorClickEffectStyle,
	type CursorStyle,
	type CursorTelemetryPoint,
	normalizeCursorClickEffectColor,
} from "../types";
import {
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
} from "./cursorAssetRegistry";
import { drawClickEffectGraphics } from "./cursorClickEffects";
import {
	applyCursorVisualStyle,
	type CursorOverlayVisuals,
	createCursorOverlayVisuals,
} from "./cursorOverlayVisuals";
import { prepareCinematicCursorTelemetry } from "./cinematicCursorTelemetry";
import { interpolateCursorPosition } from "./cursorPosition";
import {
	CURSOR_DIRECTIONAL_BLUR_STRENGTH,
	CURSOR_SHADOW_OFFSET_X,
	CURSOR_SHADOW_OFFSET_Y,
	CURSOR_TIME_DISCONTINUITY_MS,
	CursorAssetKey,
	CursorRenderConfig,
	clamp,
	DEFAULT_CURSOR_CONFIG,
	getCursorSwaySpringConfig,
	hasBakedCursorShadow,
	isSingleCursorStyle,
	isStatefulCursorStyle,
} from "./cursorRenderConfig";
import { getCursorViewportScale } from "./cursorScale";
import { computeCursorSwayRotation } from "./cursorSway";
import { type CursorViewportRect, projectCursorPositionToViewport } from "./cursorViewport";
import { getCursorVisualState } from "./cursorVisualState";
import { computeCursorFrameBlur } from "./frameMotionSample";
import {
	type CursorSpringTuning,
	createSpringState,
	resetSpringState,
	stepSpringValue,
} from "./motionSmoothing";
import { SmoothedCursorState } from "./smoothedCursorState";
import { getCursorStyleSizeMultiplier } from "./uploadedCursorAssets";
import { computeDirectionalMotionBlur } from "./zoomTransform";

export class PixiCursorOverlay {
	private readonly visuals: CursorOverlayVisuals;
	public readonly container: Container;
	private state: SmoothedCursorState;
	private config: CursorRenderConfig;
	private lastRenderedPoint: { px: number; py: number } | null = null;
	private lastRenderedTimeMs: number | null = null;
	private cursorVisible = false;
	private swayRotation = 0;
	private swaySpring = createSpringState(0);

	constructor(config: Partial<CursorRenderConfig> = {}) {
		this.config = {
			...DEFAULT_CURSOR_CONFIG,
			...config,
			idleHide: normalizeCursorIdleHideSettings(config.idleHide),
			springTuning: {
				...DEFAULT_CURSOR_CONFIG.springTuning,
				...config.springTuning,
			},
		};
		this.state = new SmoothedCursorState(this.config);
		this.visuals = createCursorOverlayVisuals();
		this.container = this.visuals.container;

		this.setMotionBlur(this.config.motionBlur);
		this.setStyle(this.config.style);
	}

	setDotRadius(dotRadius: number) {
		this.config.dotRadius = dotRadius;
	}

	setSmoothingFactor(smoothingFactor: number) {
		this.config.smoothingFactor = smoothingFactor;
		this.state.setSmoothingFactor(smoothingFactor);
	}

	setSpringTuning(springTuning: CursorSpringTuning) {
		this.config.springTuning = {
			...DEFAULT_CURSOR_CONFIG.springTuning,
			...springTuning,
		};
		this.state.setSpringTuning(this.config.springTuning);
	}

	setMotionBlur(motionBlur: number) {
		this.config.motionBlur = Math.max(0, motionBlur);
		this.visuals.container.filters =
			this.config.motionBlur > 0 ? [this.visuals.cursorMotionBlurFilter] : null;
		if (this.config.motionBlur <= 0) {
			this.visuals.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			this.visuals.cursorMotionBlurFilter.kernelSize = 5;
			this.visuals.cursorMotionBlurFilter.offset = 0;
		}
	}

	setFilterResolution(resolution: number) {
		const filterResolution = Math.max(1, resolution);
		this.visuals.cursorMotionBlurFilter.resolution = filterResolution;
		this.visuals.customCursorShadowFilter.resolution = filterResolution;
		for (const filter of Object.values(this.visuals.cursorShadowFilters)) {
			filter.resolution = filterResolution;
		}
	}

	setClickBounce(clickBounce: number) {
		this.config.clickBounce = Math.max(0, clickBounce);
	}

	setClickEffect(clickEffect: CursorClickEffectStyle) {
		this.config.clickEffect = clickEffect;
	}

	setClickEffectColor(clickEffectColor: string) {
		this.config.clickEffectColor = normalizeCursorClickEffectColor(clickEffectColor);
	}

	setClickEffectScale(clickEffectScale: number) {
		this.config.clickEffectScale = clamp(clickEffectScale, 0.5, 2);
	}

	setClickEffectOpacity(clickEffectOpacity: number) {
		this.config.clickEffectOpacity = clamp(clickEffectOpacity, 0, 1);
	}

	setClickEffectDurationMs(clickEffectDurationMs: number) {
		this.config.clickEffectDurationMs = clamp(clickEffectDurationMs, 120, 1200);
	}

	setClickBounceDuration(clickBounceDuration: number) {
		this.config.clickBounceDuration = clamp(clickBounceDuration, 60, 500);
	}

	setSway(sway: number) {
		this.config.sway = clamp(sway, 0, 2);
	}

	setIdleHideSettings(settings: CursorIdleHideSettings) {
		this.config.idleHide = normalizeCursorIdleHideSettings(settings);
	}

	setStyle(style: CursorStyle) {
		this.config.style = style;
		applyCursorVisualStyle(this.visuals, style);
	}

	getSmoothedCursorSnapshot(): {
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null {
		if (!this.visuals.container.visible || !this.cursorVisible) {
			return null;
		}

		return {
			cx: this.state.x,
			cy: this.state.y,
			trail: this.state.trail.map((point) => ({ cx: point.x, cy: point.y })),
		};
	}

	update(
		samples: CursorTelemetryPoint[],
		timeMs: number,
		viewport: CursorViewportRect,
		visible: boolean,
		freeze = false,
		previousFrameTimeMs?: number | null,
	): void {
		if (samples.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
			this.visuals.container.visible = false;
			this.cursorVisible = false;
			this.visuals.clickRingGraphics.clear();
			this.lastRenderedPoint = null;
			this.lastRenderedTimeMs = null;
			this.swayRotation = 0;
			resetSpringState(this.swaySpring, 0);
			this.visuals.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			this.visuals.customCursorShadowSprite.visible = false;
			this.visuals.customCursorSprite.visible = false;
			for (const shadowSprite of Object.values(this.visuals.cursorShadowSprites)) {
				shadowSprite.visible = false;
			}
			for (const sprite of Object.values(this.visuals.cursorSprites)) {
				sprite.visible = false;
			}
			return;
		}

		const rawSamples = samples;
		samples = prepareCinematicCursorTelemetry(
			samples,
			this.config.smoothingFactor,
			this.config.springTuning,
		);
		const target = interpolateCursorPosition(samples, timeMs);
		if (!target) {
			this.visuals.container.visible = false;
			this.cursorVisible = false;
			this.visuals.clickRingGraphics.clear();
			return;
		}

		const projectedTarget = projectCursorPositionToViewport(target, viewport.sourceCrop);

		const h =
			this.config.dotRadius *
			getCursorViewportScale(viewport.width, this.config.minViewportScale);
		const { cursorType, clickSample, isPressed, clickBounceProgress, clickProgress } =
			getCursorVisualState(
				samples,
				timeMs,
				this.config.clickBounceDuration,
				this.config.clickEffectDurationMs,
				this.config.style,
				this.config.clickBounce,
				this.config.clickEffect,
			);
		const projectedClickSample = clickSample
			? projectCursorPositionToViewport(
					isPressed && this.config.clickEffect !== "burst" ? target : clickSample,
					viewport.sourceCrop,
				)
			: null;
		let clickEffectPx =
			projectedClickSample && projectedClickSample.visible
				? viewport.x + projectedClickSample.cx * viewport.width
				: viewport.x + projectedTarget.cx * viewport.width;
		let clickEffectPy =
			projectedClickSample && projectedClickSample.visible
				? viewport.y + projectedClickSample.cy * viewport.height
				: viewport.y + projectedTarget.cy * viewport.height;
		const shouldShowCursorSprite = visible && projectedTarget.visible;
		const shouldDrawClickEffect =
			this.config.clickEffect !== "none" &&
			clickProgress > 0 &&
			Boolean(projectedClickSample?.visible);

		if (!shouldShowCursorSprite && !shouldDrawClickEffect) {
			this.visuals.container.visible = false;
			this.cursorVisible = false;
			this.visuals.clickRingGraphics.clear();
			this.visuals.customCursorShadowSprite.visible = false;
			this.visuals.customCursorSprite.visible = false;
			for (const shadowSprite of Object.values(this.visuals.cursorShadowSprites)) {
				shadowSprite.visible = false;
			}
			for (const sprite of Object.values(this.visuals.cursorSprites)) {
				sprite.visible = false;
			}
			this.lastRenderedPoint = null;
			this.lastRenderedTimeMs = null;
			this.swayRotation = 0;
			resetSpringState(this.swaySpring, 0);
			this.visuals.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			return;
		}

		this.visuals.container.visible = true;
		this.visuals.container.alpha = getCursorIdleOpacity(
			rawSamples,
			timeMs,
			this.config.idleHide,
		);
		this.cursorVisible = shouldShowCursorSprite;

		let px = viewport.x + projectedTarget.cx * viewport.width;
		let py = viewport.y + projectedTarget.cy * viewport.height;
		let shouldFreezeCursorMotion = true;

		if (shouldShowCursorSprite) {
			const sameFrameTime =
				this.lastRenderedTimeMs !== null &&
				Math.abs(this.lastRenderedTimeMs - timeMs) < 0.0001;
			const hasTimeDiscontinuity =
				this.lastRenderedTimeMs !== null &&
				Math.abs(timeMs - this.lastRenderedTimeMs) > CURSOR_TIME_DISCONTINUITY_MS;
			shouldFreezeCursorMotion = freeze || hasTimeDiscontinuity;

			if (shouldFreezeCursorMotion) {
				if (!sameFrameTime || !this.lastRenderedPoint) {
					this.state.snapTo(projectedTarget.cx, projectedTarget.cy, timeMs);
				}
			} else {
				this.state.update(projectedTarget.cx, projectedTarget.cy, timeMs);
			}

			px = viewport.x + this.state.x * viewport.width;
			py = viewport.y + this.state.y * viewport.height;
		} else {
			this.visuals.customCursorShadowSprite.visible = false;
			this.visuals.customCursorSprite.visible = false;
			for (const shadowSprite of Object.values(this.visuals.cursorShadowSprites)) {
				shadowSprite.visible = false;
			}
			for (const sprite of Object.values(this.visuals.cursorSprites)) {
				sprite.visible = false;
			}
		}

		const bounceScale = Math.max(
			0.72,
			1 - Math.sin(clickBounceProgress * Math.PI) * (0.08 * this.config.clickBounce),
		);
		const scaledH = h * getCursorStyleSizeMultiplier(this.config.style);
		const swayRotation = this.updateCursorSway(px, py, timeMs, shouldFreezeCursorMotion);

		if (isPressed && this.config.clickEffect !== "burst") {
			clickEffectPx = px;
			clickEffectPy = py;
		}
		drawClickEffectGraphics(
			this.visuals.clickRingGraphics,
			this.config.clickEffect,
			clickEffectPx,
			clickEffectPy,
			scaledH,
			clickProgress,
			this.config.clickEffectScale,
			this.config.clickEffectOpacity,
			this.config.clickEffectColor,
		);

		const spriteKey = (
			cursorType in this.visuals.cursorSprites ? cursorType : "arrow"
		) as CursorAssetKey;

		if (shouldShowCursorSprite && isStatefulCursorStyle(this.config.style)) {
			this.visuals.customCursorShadowSprite.visible = false;
			this.visuals.customCursorSprite.visible = false;

			const asset = getStatefulCursorAsset(this.config.style, spriteKey);
			const shadowSprite =
				this.visuals.cursorShadowSprites[spriteKey] ??
				this.visuals.cursorShadowSprites.arrow!;
			const sprite =
				this.visuals.cursorSprites[spriteKey] ?? this.visuals.cursorSprites.arrow!;

			for (const [key, currentShadowSprite] of Object.entries(
				this.visuals.cursorShadowSprites,
			) as Array<[CursorAssetKey, Sprite]>) {
				currentShadowSprite.visible =
					key === spriteKey && !hasBakedCursorShadow(this.config.style, asset);
			}

			for (const [key, currentSprite] of Object.entries(this.visuals.cursorSprites) as Array<
				[CursorAssetKey, Sprite]
			>) {
				currentSprite.visible = key === spriteKey;
			}

			if (shadowSprite) {
				shadowSprite.height = scaledH * bounceScale;
				shadowSprite.width = scaledH * bounceScale * asset.aspectRatio;
				shadowSprite.position.set(px + CURSOR_SHADOW_OFFSET_X, py + CURSOR_SHADOW_OFFSET_Y);
				shadowSprite.rotation = swayRotation;
			}

			if (sprite) {
				sprite.alpha = this.config.dotAlpha;
				sprite.height = scaledH * bounceScale;
				sprite.width = scaledH * bounceScale * asset.aspectRatio;
				sprite.position.set(px, py);
				sprite.rotation = swayRotation;
			}
		} else if (shouldShowCursorSprite) {
			for (const currentShadowSprite of Object.values(this.visuals.cursorShadowSprites)) {
				currentShadowSprite.visible = false;
			}

			for (const currentSprite of Object.values(this.visuals.cursorSprites)) {
				currentSprite.visible = false;
			}

			const asset = isSingleCursorStyle(this.config.style)
				? getCursorStyleAsset(this.config.style)
				: getCursorPackStyleAsset(this.config.style, spriteKey);
			const showSeparateShadow = !hasBakedCursorShadow(this.config.style, asset);
			this.visuals.customCursorShadowSprite.texture = asset.texture;
			this.visuals.customCursorShadowSprite.anchor.set(asset.anchorX, asset.anchorY);
			this.visuals.customCursorShadowSprite.visible = showSeparateShadow;
			if (showSeparateShadow) {
				this.visuals.customCursorShadowSprite.height = scaledH * bounceScale;
				this.visuals.customCursorShadowSprite.width =
					scaledH * bounceScale * asset.aspectRatio;
				this.visuals.customCursorShadowSprite.position.set(
					px + CURSOR_SHADOW_OFFSET_X,
					py + CURSOR_SHADOW_OFFSET_Y,
				);
				this.visuals.customCursorShadowSprite.rotation = swayRotation;
			}

			this.visuals.customCursorSprite.texture = asset.texture;
			this.visuals.customCursorSprite.anchor.set(asset.anchorX, asset.anchorY);
			this.visuals.customCursorSprite.visible = true;
			this.visuals.customCursorSprite.alpha = this.config.dotAlpha;
			this.visuals.customCursorSprite.height = scaledH * bounceScale;
			this.visuals.customCursorSprite.width = scaledH * bounceScale * asset.aspectRatio;
			this.visuals.customCursorSprite.position.set(px, py);
			this.visuals.customCursorSprite.rotation = swayRotation;
		}

		if (shouldFreezeCursorMotion && previousFrameTimeMs !== undefined) {
			const blur = computeCursorFrameBlur(
				samples,
				timeMs,
				previousFrameTimeMs,
				viewport,
				this.config.motionBlur,
				CURSOR_DIRECTIONAL_BLUR_STRENGTH,
			);
			this.visuals.cursorMotionBlurFilter.velocity = blur.velocity;
			this.visuals.cursorMotionBlurFilter.kernelSize = blur.kernelSize;
			this.visuals.cursorMotionBlurFilter.offset = blur.offset;
		} else {
			this.applyCursorMotionBlur(px, py, timeMs, shouldFreezeCursorMotion);
		}
		this.lastRenderedPoint = shouldShowCursorSprite ? { px, py } : null;
		this.lastRenderedTimeMs = timeMs;
	}

	private updateCursorSway(px: number, py: number, timeMs: number, freeze: boolean) {
		const deltaMs =
			this.lastRenderedTimeMs === null || freeze
				? 1000 / 60
				: Math.max(1, timeMs - this.lastRenderedTimeMs);
		const targetRotation =
			!freeze && this.lastRenderedPoint && this.lastRenderedTimeMs !== null
				? computeCursorSwayRotation(
						px - this.lastRenderedPoint.px,
						py - this.lastRenderedPoint.py,
						timeMs - this.lastRenderedTimeMs,
						this.config.sway,
					)
				: 0;

		this.swayRotation = stepSpringValue(
			this.swaySpring,
			targetRotation,
			deltaMs,
			getCursorSwaySpringConfig(this.config.smoothingFactor, this.config.springTuning),
		);

		if (Math.abs(this.swayRotation) < 0.0001 && targetRotation === 0) {
			this.swayRotation = 0;
		}

		return this.swayRotation;
	}

	private applyCursorMotionBlur(px: number, py: number, timeMs: number, freeze: boolean) {
		if (
			freeze ||
			this.config.motionBlur <= 0 ||
			!this.lastRenderedPoint ||
			this.lastRenderedTimeMs === null
		) {
			this.visuals.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			this.visuals.cursorMotionBlurFilter.kernelSize = 5;
			this.visuals.cursorMotionBlurFilter.offset = 0;
			return;
		}

		const deltaMs = Math.max(1, timeMs - this.lastRenderedTimeMs);
		const dx = px - this.lastRenderedPoint.px;
		const dy = py - this.lastRenderedPoint.py;
		const blur = computeDirectionalMotionBlur(
			{ x: dx, y: dy },
			this.config.motionBlur,
			deltaMs / 1000,
			CURSOR_DIRECTIONAL_BLUR_STRENGTH,
		);

		this.visuals.cursorMotionBlurFilter.velocity = blur.velocity;
		this.visuals.cursorMotionBlurFilter.kernelSize = blur.kernelSize;
		this.visuals.cursorMotionBlurFilter.offset = blur.offset;
	}

	reset(): void {
		this.state.reset();
		this.visuals.clickRingGraphics.clear();
		this.cursorVisible = false;
		for (const shadowSprite of Object.values(this.visuals.cursorShadowSprites)) {
			shadowSprite.visible = false;
			shadowSprite.scale.set(1);
		}
		this.visuals.customCursorShadowSprite.visible = false;
		this.visuals.customCursorShadowSprite.scale.set(1);
		for (const sprite of Object.values(this.visuals.cursorSprites)) {
			sprite.visible = false;
			sprite.scale.set(1);
		}
		this.visuals.customCursorSprite.visible = false;
		this.visuals.customCursorSprite.scale.set(1);
		this.visuals.container.visible = false;
		this.lastRenderedPoint = null;
		this.lastRenderedTimeMs = null;
		this.swayRotation = 0;
		resetSpringState(this.swaySpring, 0);
		this.visuals.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
		this.visuals.cursorMotionBlurFilter.kernelSize = 5;
		this.visuals.cursorMotionBlurFilter.offset = 0;
	}

	destroy(): void {
		this.visuals.clickRingGraphics.destroy();
		this.visuals.customCursorShadowFilter.destroy();
		for (const shadowFilter of Object.values(this.visuals.cursorShadowFilters)) {
			shadowFilter.destroy();
		}
		this.visuals.cursorMotionBlurFilter.destroy();
		this.visuals.container.destroy({ children: true });
	}
}
