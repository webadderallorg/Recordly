import { BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { CursorTelemetryPoint } from "../../types";
import { computeCursorSwayRotation } from "../cursorSway";
import { type CursorViewportRect, projectCursorPositionToViewport } from "../cursorViewport";
import {
	createSpringState,
	getCursorSpringConfig,
	resetSpringState,
	stepSpringValue,
} from "../motionSmoothing";
import {
	getAvailableCursorKeys,
	getCursorAsset,
	getCursorPackStyleAsset,
	getCursorStyleAsset,
	getStatefulCursorAsset,
	isSingleCursorStyle,
} from "./assets";
import { SmoothedCursorState } from "./smoothedState";
import {
	clampCursorValue,
	CURSOR_MOTION_BLUR_BASE_MULTIPLIER,
	CURSOR_SHADOW_ALPHA,
	CURSOR_SHADOW_BLUR,
	CURSOR_SHADOW_COLOR,
	CURSOR_SHADOW_OFFSET_X,
	CURSOR_SHADOW_OFFSET_Y,
	CURSOR_SHADOW_PADDING,
	CURSOR_SWAY_SMOOTHING_MULTIPLIER,
	CURSOR_SWAY_SMOOTHING_OFFSET,
	CURSOR_TIME_DISCONTINUITY_MS,
	type CursorAssetKey,
	type CursorRenderConfig,
	DEFAULT_CURSOR_CONFIG,
	isStatefulCursorStyle,
} from "./shared";
import {
	getCursorVisualState,
	getCursorViewportScale,
	interpolateCursorPosition,
} from "./telemetry";

function getCursorSwaySpringConfig(smoothingFactor: number) {
	const baseConfig = getCursorSpringConfig(
		Math.min(
			2,
			Math.max(
				0.15,
				smoothingFactor * CURSOR_SWAY_SMOOTHING_MULTIPLIER + CURSOR_SWAY_SMOOTHING_OFFSET,
			),
		),
	);

	return {
		...baseConfig,
		damping: baseConfig.damping * 0.9,
		mass: Math.max(0.55, baseConfig.mass * 0.8),
		restDelta: 0.0005,
		restSpeed: 0.02,
	};
}

export class PixiCursorOverlay {
	public readonly container: Container;
	private clickRingGraphics: Graphics;
	private customCursorShadowSprite: Sprite;
	private customCursorShadowFilter: BlurFilter;
	private customCursorSprite: Sprite;
	private cursorShadowSprites: Partial<Record<CursorAssetKey, Sprite>>;
	private cursorShadowFilters: Partial<Record<CursorAssetKey, BlurFilter>>;
	private cursorSprites: Partial<Record<CursorAssetKey, Sprite>>;
	private cursorMotionBlurFilter: MotionBlurFilter;
	private state: SmoothedCursorState;
	private config: CursorRenderConfig;
	private lastRenderedPoint: { px: number; py: number } | null = null;
	private lastRenderedTimeMs: number | null = null;
	private swayRotation = 0;
	private swaySpring = createSpringState(0);

	constructor(config: Partial<CursorRenderConfig> = {}) {
		this.config = { ...DEFAULT_CURSOR_CONFIG, ...config };
		this.state = new SmoothedCursorState(this.config);

		this.container = new Container();
		this.container.label = "cursor-overlay";

		this.clickRingGraphics = new Graphics();
		const initialCustomAsset = getCursorStyleAsset("figma");
		this.customCursorShadowSprite = new Sprite(initialCustomAsset.texture);
		this.customCursorShadowSprite.anchor.set(initialCustomAsset.anchorX, initialCustomAsset.anchorY);
		this.customCursorShadowSprite.visible = false;
		this.customCursorShadowSprite.tint = CURSOR_SHADOW_COLOR;
		this.customCursorShadowSprite.alpha = CURSOR_SHADOW_ALPHA;
		this.customCursorShadowFilter = new BlurFilter();
		this.customCursorShadowFilter.blur = CURSOR_SHADOW_BLUR;
		this.customCursorShadowFilter.quality = 4;
		this.customCursorShadowFilter.padding = CURSOR_SHADOW_PADDING;
		this.customCursorShadowSprite.filters = [this.customCursorShadowFilter];

		this.customCursorSprite = new Sprite(initialCustomAsset.texture);
		this.customCursorSprite.anchor.set(initialCustomAsset.anchorX, initialCustomAsset.anchorY);
		this.customCursorSprite.visible = false;
		this.cursorShadowSprites = {};
		this.cursorShadowFilters = {};
		this.cursorSprites = {};

		for (const key of getAvailableCursorKeys()) {
			const asset = getCursorAsset(key);
			const shadowSprite = new Sprite(asset.texture);
			shadowSprite.anchor.set(asset.anchorX, asset.anchorY);
			shadowSprite.visible = false;
			shadowSprite.tint = CURSOR_SHADOW_COLOR;
			shadowSprite.alpha = CURSOR_SHADOW_ALPHA;
			const shadowFilter = new BlurFilter();
			shadowFilter.blur = CURSOR_SHADOW_BLUR;
			shadowFilter.quality = 4;
			shadowFilter.padding = CURSOR_SHADOW_PADDING;
			shadowSprite.filters = [shadowFilter];
			this.cursorShadowSprites[key] = shadowSprite;
			this.cursorShadowFilters[key] = shadowFilter;

			const sprite = new Sprite(asset.texture);
			sprite.anchor.set(asset.anchorX, asset.anchorY);
			sprite.visible = false;
			this.cursorSprites[key] = sprite;
		}

		this.cursorMotionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
		this.container.filters = null;
		this.container.addChild(
			this.clickRingGraphics,
			this.customCursorShadowSprite,
			...Object.values(this.cursorShadowSprites),
			this.customCursorSprite,
			...Object.values(this.cursorSprites),
		);

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

	setMotionBlur(motionBlur: number) {
		this.config.motionBlur = Math.max(0, motionBlur);
		this.container.filters = this.config.motionBlur > 0 ? [this.cursorMotionBlurFilter] : null;
		if (this.config.motionBlur <= 0) {
			this.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			this.cursorMotionBlurFilter.kernelSize = 5;
			this.cursorMotionBlurFilter.offset = 0;
		}
	}

	setClickBounce(clickBounce: number) {
		this.config.clickBounce = Math.max(0, clickBounce);
	}

	setClickBounceDuration(clickBounceDuration: number) {
		this.config.clickBounceDuration = clampCursorValue(clickBounceDuration, 60, 500);
	}

	setSway(sway: number) {
		this.config.sway = clampCursorValue(sway, 0, 2);
	}

	setStyle(style: CursorRenderConfig["style"]) {
		this.config.style = style;
		if (isStatefulCursorStyle(style)) {
			for (const key of getAvailableCursorKeys()) {
				const asset = getStatefulCursorAsset(style, key);
				const shadowSprite = this.cursorShadowSprites[key];
				const sprite = this.cursorSprites[key];
				shadowSprite?.anchor.set(asset.anchorX, asset.anchorY);
				if (shadowSprite) {
					shadowSprite.texture = asset.texture;
				}
				sprite?.anchor.set(asset.anchorX, asset.anchorY);
				if (sprite) {
					sprite.texture = asset.texture;
				}
			}
			return;
		}

		const asset = isSingleCursorStyle(style)
			? getCursorStyleAsset(style)
			: getCursorPackStyleAsset(style, "arrow");
		this.customCursorShadowSprite.texture = asset.texture;
		this.customCursorShadowSprite.anchor.set(asset.anchorX, asset.anchorY);
		this.customCursorSprite.texture = asset.texture;
		this.customCursorSprite.anchor.set(asset.anchorX, asset.anchorY);
	}

	getSmoothedCursorSnapshot(): {
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null {
		if (!this.container.visible) {
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
	): void {
		if (!visible || samples.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
			this.container.visible = false;
			this.lastRenderedPoint = null;
			this.lastRenderedTimeMs = null;
			this.swayRotation = 0;
			resetSpringState(this.swaySpring, 0);
			this.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			return;
		}

		const target = interpolateCursorPosition(samples, timeMs);
		if (!target) {
			this.container.visible = false;
			return;
		}

		const projectedTarget = projectCursorPositionToViewport(target, viewport.sourceCrop);
		if (!projectedTarget.visible) {
			this.container.visible = false;
			this.lastRenderedPoint = null;
			this.lastRenderedTimeMs = null;
			this.swayRotation = 0;
			resetSpringState(this.swaySpring, 0);
			this.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			return;
		}

		const sameFrameTime =
			this.lastRenderedTimeMs !== null && Math.abs(this.lastRenderedTimeMs - timeMs) < 0.0001;
		const hasTimeDiscontinuity =
			this.lastRenderedTimeMs !== null &&
			Math.abs(timeMs - this.lastRenderedTimeMs) > CURSOR_TIME_DISCONTINUITY_MS;
		const shouldFreezeCursorMotion = freeze || hasTimeDiscontinuity;

		if (shouldFreezeCursorMotion) {
			if (!sameFrameTime || !this.lastRenderedPoint) {
				this.state.snapTo(projectedTarget.cx, projectedTarget.cy, timeMs);
			}
		} else {
			this.state.update(projectedTarget.cx, projectedTarget.cy, timeMs);
		}
		this.container.visible = true;

		const px = viewport.x + this.state.x * viewport.width;
		const py = viewport.y + this.state.y * viewport.height;
		const h = this.config.dotRadius * getCursorViewportScale(viewport);
		const { cursorType, clickBounceProgress } = getCursorVisualState(
			samples,
			timeMs,
			this.config.clickBounceDuration,
		);
		const bounceScale = Math.max(
			0.72,
			1 - Math.sin(clickBounceProgress * Math.PI) * (0.08 * this.config.clickBounce),
		);
		const swayRotation = this.updateCursorSway(px, py, timeMs, shouldFreezeCursorMotion);

		this.clickRingGraphics.clear();

		const spriteKey = ((cursorType && this.cursorSprites[cursorType as CursorAssetKey])
			? cursorType
			: "arrow") as CursorAssetKey;

		if (isStatefulCursorStyle(this.config.style)) {
			this.customCursorShadowSprite.visible = false;
			this.customCursorSprite.visible = false;

			const asset = getStatefulCursorAsset(this.config.style, spriteKey);
			const shadowSprite = this.cursorShadowSprites[spriteKey] ?? this.cursorShadowSprites.arrow!;
			const sprite = this.cursorSprites[spriteKey] ?? this.cursorSprites.arrow!;

			for (const [key, currentShadowSprite] of Object.entries(this.cursorShadowSprites) as Array<
				[CursorAssetKey, Sprite]
			>) {
				currentShadowSprite.visible = key === spriteKey;
			}

			for (const [key, currentSprite] of Object.entries(this.cursorSprites) as Array<
				[CursorAssetKey, Sprite]
			>) {
				currentSprite.visible = key === spriteKey;
			}

			shadowSprite.height = h * bounceScale;
			shadowSprite.width = h * bounceScale * asset.aspectRatio;
			shadowSprite.position.set(px + CURSOR_SHADOW_OFFSET_X, py + CURSOR_SHADOW_OFFSET_Y);
			shadowSprite.rotation = swayRotation;

			sprite.alpha = this.config.dotAlpha;
			sprite.height = h * bounceScale;
			sprite.width = h * bounceScale * asset.aspectRatio;
			sprite.position.set(px, py);
			sprite.rotation = swayRotation;
		} else {
			for (const currentShadowSprite of Object.values(this.cursorShadowSprites)) {
				currentShadowSprite.visible = false;
			}

			for (const currentSprite of Object.values(this.cursorSprites)) {
				currentSprite.visible = false;
			}

			const asset = isSingleCursorStyle(this.config.style)
				? getCursorStyleAsset(this.config.style)
				: getCursorPackStyleAsset(this.config.style, spriteKey);
			const showSeparateShadow = this.config.style !== "figma";
			this.customCursorShadowSprite.texture = asset.texture;
			this.customCursorShadowSprite.anchor.set(asset.anchorX, asset.anchorY);
			this.customCursorShadowSprite.visible = showSeparateShadow;
			if (showSeparateShadow) {
				this.customCursorShadowSprite.height = h * bounceScale;
				this.customCursorShadowSprite.width = h * bounceScale * asset.aspectRatio;
				this.customCursorShadowSprite.position.set(
					px + CURSOR_SHADOW_OFFSET_X,
					py + CURSOR_SHADOW_OFFSET_Y,
				);
				this.customCursorShadowSprite.rotation = swayRotation;
			}

			this.customCursorSprite.texture = asset.texture;
			this.customCursorSprite.anchor.set(asset.anchorX, asset.anchorY);
			this.customCursorSprite.visible = true;
			this.customCursorSprite.alpha = this.config.dotAlpha;
			this.customCursorSprite.height = h * bounceScale;
			this.customCursorSprite.width = h * bounceScale * asset.aspectRatio;
			this.customCursorSprite.position.set(px, py);
			this.customCursorSprite.rotation = swayRotation;
		}

		this.applyCursorMotionBlur(px, py, timeMs, shouldFreezeCursorMotion);
		this.lastRenderedPoint = { px, py };
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
			getCursorSwaySpringConfig(this.config.smoothingFactor),
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
			this.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
			this.cursorMotionBlurFilter.kernelSize = 5;
			this.cursorMotionBlurFilter.offset = 0;
			return;
		}

		const deltaMs = Math.max(1, timeMs - this.lastRenderedTimeMs);
		const dx = px - this.lastRenderedPoint.px;
		const dy = py - this.lastRenderedPoint.py;
		const velocityScale = (1000 / deltaMs) * this.config.motionBlur * CURSOR_MOTION_BLUR_BASE_MULTIPLIER;
		const velocity = {
			x: dx * velocityScale,
			y: dy * velocityScale,
		};
		const magnitude = Math.hypot(velocity.x, velocity.y);

		this.cursorMotionBlurFilter.velocity = magnitude > 0.05 ? velocity : { x: 0, y: 0 };
		this.cursorMotionBlurFilter.kernelSize = magnitude > 3 ? 9 : magnitude > 1 ? 7 : 5;
		this.cursorMotionBlurFilter.offset = magnitude > 0.5 ? -0.25 : 0;
	}

	reset(): void {
		this.state.reset();
		this.clickRingGraphics.clear();
		for (const shadowSprite of Object.values(this.cursorShadowSprites)) {
			shadowSprite.visible = false;
			shadowSprite.scale.set(1);
		}
		this.customCursorShadowSprite.visible = false;
		this.customCursorShadowSprite.scale.set(1);
		for (const sprite of Object.values(this.cursorSprites)) {
			sprite.visible = false;
			sprite.scale.set(1);
		}
		this.customCursorSprite.visible = false;
		this.customCursorSprite.scale.set(1);
		this.container.visible = false;
		this.lastRenderedPoint = null;
		this.lastRenderedTimeMs = null;
		this.swayRotation = 0;
		resetSpringState(this.swaySpring, 0);
		this.cursorMotionBlurFilter.velocity = { x: 0, y: 0 };
		this.cursorMotionBlurFilter.kernelSize = 5;
		this.cursorMotionBlurFilter.offset = 0;
	}

	destroy(): void {
		this.clickRingGraphics.destroy();
		this.customCursorShadowFilter.destroy();
		for (const shadowFilter of Object.values(this.cursorShadowFilters)) {
			shadowFilter.destroy();
		}
		this.cursorMotionBlurFilter.destroy();
		this.container.destroy({ children: true });
	}
}