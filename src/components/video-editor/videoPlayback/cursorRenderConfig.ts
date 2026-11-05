import { Texture } from "pixi.js";
import boldOutlineArrowUrl from "@/assets/cursors/bold-outline/arrow.svg";
import boldOutlinePointerUrl from "@/assets/cursors/bold-outline/pointer.svg";
import { DEFAULT_CURSOR_IDLE_HIDE, type CursorIdleHideSettings } from "./cursorIdleVisibility";
import {
	type CursorClickEffectStyle,
	type CursorStyle,
	type CursorTelemetryPoint,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_CLICK_EFFECT,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	DEFAULT_CURSOR_STYLE,
} from "../types";
import { type CursorSpringTuning, getCursorSpringConfig } from "./motionSmoothing";

export type CursorAssetKey = NonNullable<CursorTelemetryPoint["cursorType"]>;

export type StatefulCursorStyle = Extract<
	CursorStyle,
	| "macos"
	| "tahoe"
	| "tahoe-inverted"
	| "windows11"
	| "bee"
	| "catppuccin-pink"
	| "breezex"
	| "pixel-hand"
>;

export type SingleCursorStyle = Extract<CursorStyle, "dot" | "figma">;

export type CursorPackStyle = Exclude<CursorStyle, StatefulCursorStyle | SingleCursorStyle>;

export type CursorPackVariant = "default" | "pointer";

export type LoadedCursorAsset = {
	texture: Texture;
	image: HTMLImageElement;
	aspectRatio: number;
	anchorX: number;
	anchorY: number;
};

export type LoadedCursorPackAssets = Record<CursorPackVariant, LoadedCursorAsset>;

export type CursorPackSource = {
	defaultUrl: string;
	pointerUrl: string;
	defaultAnchor: { x: number; y: number };
	pointerAnchor: { x: number; y: number };
};

export type NativeCursorAtlasEntry = {
	cursorType: CursorAssetKey;
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	anchorX: number;
	anchorY: number;
	aspectRatio: number;
};

export type NativeCursorAtlas = {
	style: CursorStyle;
	width: number;
	height: number;
	dataUrl: string;
	entries: NativeCursorAtlasEntry[];
};

/**
 * Configuration for cursor rendering.
 */
export interface CursorRenderConfig {
	idleHide: CursorIdleHideSettings;
	/** Base cursor height in pixels (at reference width of 1920px) */
	dotRadius: number;
	/** Minimum viewport scale applied to cursor sizing. */
	minViewportScale: number;
	/** Cursor fill color (hex number for PixiJS) */
	dotColor: number;
	/** Cursor opacity (0–1) */
	dotAlpha: number;
	/** Unused, kept for interface compatibility */
	trailLength: number;
	/** Smoothing factor for cursor interpolation (0–1, lower = smoother/slower) */
	smoothingFactor: number;
	/** Optional multipliers applied on top of the derived cursor spring config. */
	springTuning: CursorSpringTuning;
	/** Directional cursor motion blur amount. */
	motionBlur: number;
	/** Click bounce multiplier. */
	clickBounce: number;
	/** Click bounce duration in milliseconds. */
	clickBounceDuration: number;
	/** Click effect graphics rendered around the pointer. */
	clickEffect: CursorClickEffectStyle;
	/** Click effect base color. */
	clickEffectColor: string;
	/** Click effect size multiplier. */
	clickEffectScale: number;
	/** Click effect opacity multiplier. */
	clickEffectOpacity: number;
	/** Click effect duration in milliseconds. */
	clickEffectDurationMs: number;
	/** Cursor sway multiplier. */
	sway: number;
	/** Cursor visual style. */
	style: CursorStyle;
}

export const MIN_CURSOR_VIEWPORT_SCALE = 0;

export // Keep the cursor visually responsive while sharing the camera's frame-rate
// normalization, kernel, and directional offset formula.
const CURSOR_DIRECTIONAL_BLUR_STRENGTH = 2;

export const CURSOR_TIME_DISCONTINUITY_MS = 100;

export const CURSOR_SWAY_SMOOTHING_MULTIPLIER = 0.7;

export const CURSOR_SWAY_SMOOTHING_OFFSET = 0.18;

export const CURSOR_SVG_DROP_SHADOW_FILTER = "drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.35))";

export const CURSOR_SHADOW_COLOR = 0x000000;

export const CURSOR_SHADOW_ALPHA = 0.35;

export const CURSOR_SHADOW_OFFSET_X = 0;

export const CURSOR_SHADOW_OFFSET_Y = 2;

export const CURSOR_SHADOW_BLUR = 3;

export const CURSOR_SHADOW_PADDING = 12;

export const DEFAULT_CURSOR_CONFIG: CursorRenderConfig = {
	idleHide: DEFAULT_CURSOR_IDLE_HIDE,
	dotRadius: 28,
	minViewportScale: MIN_CURSOR_VIEWPORT_SCALE,
	dotColor: 0xffffff,
	dotAlpha: 0.95,
	trailLength: 0,
	smoothingFactor: 0.18,
	springTuning: {
		stiffnessMultiplier: 1,
		dampingMultiplier: 1,
		massMultiplier: 1,
	},
	motionBlur: 0,
	clickBounce: 1,
	clickBounceDuration: DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	clickEffect: DEFAULT_CURSOR_CLICK_EFFECT,
	clickEffectColor: DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	clickEffectScale: DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	clickEffectOpacity: DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	clickEffectDurationMs: DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	sway: 0,
	style: DEFAULT_CURSOR_STYLE,
};

export const SUPPORTED_CURSOR_KEYS: CursorAssetKey[] = [
	"arrow",
	"text",
	"pointer",
	"crosshair",
	"open-hand",
	"closed-hand",
	"resize-ew",
	"resize-ns",
	"not-allowed",
];

export const CURSOR_PACK_POINTER_TYPES = new Set<CursorAssetKey>([
	"pointer",
	"open-hand",
	"closed-hand",
]);

export const BUILTIN_CURSOR_PACK_SOURCES: Record<string, CursorPackSource> = {
	"bold-outline": {
		defaultUrl: boldOutlineArrowUrl,
		pointerUrl: boldOutlinePointerUrl,
		// Tip positions relative to each SVG's tightly cropped viewBox.
		defaultAnchor: { x: 2 / 32, y: 2 / 41 },
		pointerAnchor: { x: 6.443454 / 43, y: 2.234231 / 40.5 },
	},
};

export function isStatefulCursorStyle(style: CursorStyle): style is StatefulCursorStyle {
	return (
		style === "macos" ||
		style === "tahoe" ||
		style === "tahoe-inverted" ||
		style === "windows11" ||
		style === "bee" ||
		style === "catppuccin-pink" ||
		style === "breezex" ||
		style === "pixel-hand"
	);
}

export function isSingleCursorStyle(style: CursorStyle): style is SingleCursorStyle {
	return style === "dot" || style === "figma";
}

export function hasBakedCursorShadow(style: CursorStyle): boolean {
	return (
		isSingleCursorStyle(style) ||
		style === "bee" ||
		style === "catppuccin-pink" ||
		style === "breezex" ||
		style === "pixel-hand"
	);
}

export function resolveCursorPackVariant(cursorType: CursorAssetKey): CursorPackVariant {
	return CURSOR_PACK_POINTER_TYPES.has(cursorType) ? "pointer" : "default";
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function getCursorSwaySpringConfig(
	smoothingFactor: number,
	springTuning: CursorSpringTuning,
) {
	const baseConfig = getCursorSpringConfig(
		Math.min(
			2,
			Math.max(
				0.15,
				smoothingFactor * CURSOR_SWAY_SMOOTHING_MULTIPLIER + CURSOR_SWAY_SMOOTHING_OFFSET,
			),
		),
		springTuning,
	);

	return {
		...baseConfig,
		damping: baseConfig.damping * 0.9,
		mass: Math.max(0.55, baseConfig.mass * 0.8),
		restDelta: 0.0005,
		restSpeed: 0.02,
	};
}
