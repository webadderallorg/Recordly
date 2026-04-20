import {
	type CursorStyle,
	type CursorTelemetryPoint,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_STYLE,
} from "../../types";

export type CursorAssetKey = NonNullable<CursorTelemetryPoint["cursorType"]>;
export type StatefulCursorStyle = Extract<CursorStyle, "tahoe" | "mono">;
export type SingleCursorStyle = Extract<CursorStyle, "dot" | "figma">;
export type CursorPackStyle = Exclude<CursorStyle, StatefulCursorStyle | SingleCursorStyle>;
export type CursorPackVariant = "default" | "pointer";

export type LoadedCursorAsset = {
	texture: import("pixi.js").Texture;
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

export interface CursorRenderConfig {
	dotRadius: number;
	dotColor: number;
	dotAlpha: number;
	trailLength: number;
	smoothingFactor: number;
	motionBlur: number;
	clickBounce: number;
	clickBounceDuration: number;
	sway: number;
	style: CursorStyle;
}

export const DEFAULT_CURSOR_CONFIG: CursorRenderConfig = {
	dotRadius: 28,
	dotColor: 0xffffff,
	dotAlpha: 0.95,
	trailLength: 0,
	smoothingFactor: 0.18,
	motionBlur: 0,
	clickBounce: 1,
	clickBounceDuration: DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	sway: 0,
	style: DEFAULT_CURSOR_STYLE,
};

export const REFERENCE_WIDTH = 1920;
export const MIN_CURSOR_VIEWPORT_SCALE = 0.55;
export const CLICK_RING_FADE_MS = 600;
export const CURSOR_MOTION_BLUR_BASE_MULTIPLIER = 0.08;
export const CURSOR_TIME_DISCONTINUITY_MS = 100;
export const CURSOR_SWAY_SMOOTHING_MULTIPLIER = 0.7;
export const CURSOR_SWAY_SMOOTHING_OFFSET = 0.18;
export const CURSOR_SVG_DROP_SHADOW_FILTER =
	"drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.35))";
export const CURSOR_SHADOW_COLOR = 0x000000;
export const CURSOR_SHADOW_ALPHA = 0.35;
export const CURSOR_SHADOW_OFFSET_X = 0;
export const CURSOR_SHADOW_OFFSET_Y = 2;
export const CURSOR_SHADOW_BLUR = 3;
export const CURSOR_SHADOW_PADDING = 12;

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

export const DEFAULT_CURSOR_PACK_ANCHOR = { x: 0.08, y: 0.08 } as const;
export const CURSOR_PACK_POINTER_TYPES = new Set<CursorAssetKey>([
	"pointer",
	"open-hand",
	"closed-hand",
]);
export const BUILTIN_CURSOR_PACK_SOURCES: Record<string, CursorPackSource> = {};

export function clampCursorValue(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function isStatefulCursorStyle(style: CursorStyle): style is StatefulCursorStyle {
	return style === "tahoe" || style === "mono";
}

export function isSingleCursorStyle(style: CursorStyle): style is SingleCursorStyle {
	return style === "dot" || style === "figma";
}

export function resolveCursorPackVariant(cursorType: CursorAssetKey): CursorPackVariant {
	return CURSOR_PACK_POINTER_TYPES.has(cursorType) ? "pointer" : "default";
}