export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export type ZoomMode = "auto" | "manual";

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	depth: ZoomDepth;
	focus: ZoomFocus;
	mode?: ZoomMode;
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?:
		| "move"
		| "click"
		| "double-click"
		| "right-click"
		| "middle-click"
		| "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

export interface CursorVisualSettings {
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	clickBounceDuration: number;
	clickEffect: CursorClickEffectStyle;
	clickEffectColor: string;
	clickEffectScale: number;
	clickEffectOpacity: number;
	clickEffectDurationMs: number;
	sway: number;
	style: CursorStyle;
}

export type CursorStyle = "macos" | "tahoe" | "tahoe-inverted" | "dot" | "figma" | (string & {}); // extension-contributed cursor styles
export const DEFAULT_CURSOR_STYLE: CursorStyle = "tahoe";

export type CursorClickEffectStyle = "none" | "spotlight" | "ripple" | "echo";
export const DEFAULT_CURSOR_CLICK_EFFECT: CursorClickEffectStyle = "none";
export const DEFAULT_CURSOR_CLICK_EFFECT_COLOR = "#2563EB";
export const DEFAULT_CURSOR_CLICK_EFFECT_SCALE = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_OPACITY = 1;
export const DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS = 600;

export function normalizeCursorClickEffectStyle(
	value: unknown,
	fallback: CursorClickEffectStyle = DEFAULT_CURSOR_CLICK_EFFECT,
): CursorClickEffectStyle {
	if (value === "burst") {
		return "echo";
	}

	return value === "none" || value === "spotlight" || value === "ripple" || value === "echo"
		? value
		: fallback;
}

export function normalizeCursorClickEffectColor(
	value: unknown,
	fallback: string = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
): string {
	if (typeof value !== "string") {
		return fallback;
	}

	const trimmed = value.trim();
	if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
		return fallback;
	}

	if (trimmed.length === 4) {
		const [red, green, blue] = trimmed.slice(1).split("");
		return `#${red}${red}${green}${green}${blue}${blue}`.toUpperCase();
	}

	return trimmed.toUpperCase();
}

export type EditorEffectSection =
	| "scene"
	| "cursor"
	| "captions"
	| "caption"
	| "webcam"
	| "settings"
	| "zoom"
	| "frame"
	| "crop"
	| "extensions"
	| "clip"
	| "audio"
	| `ext:${string}`;

export type ZoomTransitionEasing = "recordly" | "glide" | "smooth" | "snappy" | "linear";

export type WebcamCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WebcamPositionPreset =
	| WebcamCorner
	| "top-center"
	| "center-left"
	| "center"
	| "center-right"
	| "bottom-center"
	| "custom";

export interface WebcamOverlaySettings {
	enabled: boolean;
	sourcePath: string | null;
	timeOffsetMs: number;
	mirror: boolean;
	cropRegion: CropRegion;
	corner: WebcamCorner;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	size: number;
	width: number;
	height: number;
	reactToZoom: boolean;
	cornerRadius: number;
	shadow: number;
	margin: number;
}

export const DEFAULT_CURSOR_SIZE = 3.0;
export const DEFAULT_CURSOR_SMOOTHING = 0.67;
export const DEFAULT_CURSOR_MOTION_BLUR = 0.4;
export const DEFAULT_CURSOR_CLICK_BOUNCE = 2.5;
export const DEFAULT_CURSOR_CLICK_BOUNCE_DURATION = 350;
export const DEFAULT_CURSOR_SWAY = 0.4;
export const DEFAULT_ZOOM_SMOOTHNESS = 0.5;
export const DEFAULT_ZOOM_MOTION_BLUR = 0.35;
export interface ZoomMotionBlurTuning {
	panVelocityThreshold: number;
	zoomVelocityThreshold: number;
	maxDirectionalBlurPx: number;
	maxRadialBlurStrength: number;
	panResponsePerSecond: number;
	zoomResponsePerSecond: number;
	zoomSafeZoneRadiusPx: number;
}

export const DEFAULT_ZOOM_MOTION_BLUR_TUNING: ZoomMotionBlurTuning = {
	panVelocityThreshold: 0,
	zoomVelocityThreshold: 0,
	maxDirectionalBlurPx: 41.8,
	maxRadialBlurStrength: 1,
	panResponsePerSecond: 11,
	zoomResponsePerSecond: 9,
	zoomSafeZoneRadiusPx: 6,
};
export const DEFAULT_ZOOM_IN_DURATION_MS = 1522.575;
export const DEFAULT_ZOOM_IN_OVERLAP_MS = 500;
export const DEFAULT_ZOOM_OUT_DURATION_MS = 1015.05;
export const DEFAULT_CONNECTED_ZOOM_GAP_MS = 1500;
export const DEFAULT_CONNECTED_ZOOM_DURATION_MS = 1000;
export const DEFAULT_ZOOM_IN_EASING: ZoomTransitionEasing = "recordly";
export const DEFAULT_ZOOM_OUT_EASING: ZoomTransitionEasing = "recordly";
export const DEFAULT_CONNECTED_ZOOM_EASING: ZoomTransitionEasing = "glide";
export const DEFAULT_WEBCAM_SIZE = 40;
export const DEFAULT_WEBCAM_REACT_TO_ZOOM = true;
export const DEFAULT_WEBCAM_CORNER_RADIUS = 90;
export const DEFAULT_WEBCAM_SHADOW = 0.67;
export const DEFAULT_WEBCAM_MARGIN = 24;
export const DEFAULT_WEBCAM_POSITION_PRESET: WebcamPositionPreset = "bottom-right";
export const DEFAULT_WEBCAM_POSITION_X = 1;
export const DEFAULT_WEBCAM_POSITION_Y = 1;
export const DEFAULT_WEBCAM_TIME_OFFSET_MS = 0;

export const DEFAULT_WEBCAM_OVERLAY: WebcamOverlaySettings = {
	enabled: false,
	sourcePath: null,
	timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
	mirror: true,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	corner: "bottom-right",
	positionPreset: DEFAULT_WEBCAM_POSITION_PRESET,
	positionX: DEFAULT_WEBCAM_POSITION_X,
	positionY: DEFAULT_WEBCAM_POSITION_Y,
	size: DEFAULT_WEBCAM_SIZE,
	width: DEFAULT_WEBCAM_SIZE,
	height: DEFAULT_WEBCAM_SIZE,
	reactToZoom: DEFAULT_WEBCAM_REACT_TO_ZOOM,
	cornerRadius: DEFAULT_WEBCAM_CORNER_RADIUS,
	shadow: DEFAULT_WEBCAM_SHADOW,
	margin: DEFAULT_WEBCAM_MARGIN,
};

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export interface ClipRegion {
	id: string;
	/** Position of the clip on the edited timeline. */
	startMs: number;
	endMs: number;
	/**
	 * Start position in the original media. Older projects omit this field;
	 * in that case the timeline start is also the source start.
	 */
	sourceStartMs?: number;
	speed: number;
	muted?: boolean;
	showSourceAudio?: boolean;
}

export function getClipSourceStartMs(clip: ClipRegion): number {
	const sourceStartMs = Number.isFinite(clip.sourceStartMs)
		? Math.round(clip.sourceStartMs as number)
		: Math.round(clip.startMs);
	return Math.max(0, sourceStartMs);
}

export function getClipDisplayDurationMs(clip: ClipRegion): number {
	return Math.max(0, Math.round(clip.endMs) - Math.round(clip.startMs));
}

export function getClipSourceEndMs(clip: ClipRegion): number {
	const displayDurationMs = getClipDisplayDurationMs(clip);
	const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	return Math.round(getClipSourceStartMs(clip) + displayDurationMs * speed);
}

/**
 * Apply a timeline move/resize without changing the source material on a move.
 * Resizing the left edge trims from (or restores) the source start, while a
 * pure drag only changes the edited-timeline coordinates.
 */
export function updateClipTimelineSpan(
	clip: ClipRegion,
	span: { start: number; end: number },
): ClipRegion {
	const startMs = Math.round(Number.isFinite(span.start) ? span.start : clip.startMs);
	const endMs = Math.max(
		startMs + 1,
		Math.round(Number.isFinite(span.end) ? span.end : clip.endMs),
	);
	const startDelta = startMs - clip.startMs;
	const endDelta = endMs - clip.endMs;
	const isMove = Math.abs(startDelta - endDelta) < 1;
	const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceStartMs = getClipSourceStartMs(clip);
	const nextSourceStartMs = isMove ? sourceStartMs : sourceStartMs + startDelta * speed;

	return {
		...clip,
		startMs,
		endMs,
		sourceStartMs: Math.max(0, Math.round(nextSourceStartMs)),
	};
}

export function getTimelineDurationMs(clips: ClipRegion[], sourceDurationMs: number): number {
	const baseDurationMs = Math.max(0, Math.round(sourceDurationMs));
	if (clips.length === 0) {
		return baseDurationMs;
	}

	// Once a clip has been reflowed, its timeline position is no longer its
	// source position. In that mode the visible timeline ends at the last
	// edited clip instead of retaining the original source tail.
	if (clips.some((clip) => getClipSourceStartMs(clip) !== Math.round(clip.startMs))) {
		return clips.reduce(
			(durationMs, clip) => Math.max(durationMs, Math.max(0, Math.round(clip.endMs))),
			0,
		);
	}

	return clips.reduce(
		(durationMs, clip) => Math.max(durationMs, Math.max(0, Math.round(clip.endMs))),
		baseDurationMs,
	);
}

export function sortClipRegions(clips: ClipRegion[]): ClipRegion[] {
	return [...clips].sort((left, right) => left.startMs - right.startMs);
}

export function sortClipRegionsBySource(clips: ClipRegion[]): ClipRegion[] {
	return [...clips].sort((left, right) => {
		const sourceStartDelta = getClipSourceStartMs(left) - getClipSourceStartMs(right);
		return sourceStartDelta !== 0 ? sourceStartDelta : left.startMs - right.startMs;
	});
}

function getSafeClipSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

function clampToNearestClipBoundary(
	timeMs: number,
	clips: ClipRegion[],
	kind: "timeline" | "source",
) {
	let nearestTimeMs = Math.round(timeMs);
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const clip of clips) {
		const sourceStartMs = getClipSourceStartMs(clip);
		const sourceEndMs = getClipSourceEndMs(clip);
		const boundaries =
			kind === "timeline"
				? [
						{ timeMs: clip.startMs, mappedMs: sourceStartMs },
						{ timeMs: clip.endMs, mappedMs: sourceEndMs },
					]
				: [
						{ timeMs: sourceStartMs, mappedMs: clip.startMs },
						{ timeMs: sourceEndMs, mappedMs: clip.endMs },
					];

		for (const boundary of boundaries) {
			const distance = Math.abs(timeMs - boundary.timeMs);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestTimeMs = Math.round(boundary.mappedMs);
			}
		}
	}

	return nearestTimeMs;
}

export function mapTimelineTimeToSourceTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const sortedClips = sortClipRegions(clips);

	for (const clip of sortedClips) {
		if (roundedTimeMs < clip.startMs || roundedTimeMs > clip.endMs) {
			continue;
		}

		return Math.round(
			getClipSourceStartMs(clip) + (roundedTimeMs - clip.startMs) * getSafeClipSpeed(clip),
		);
	}

	if (sortedClips.length === 0) {
		return roundedTimeMs;
	}

	return clampToNearestClipBoundary(roundedTimeMs, sortedClips, "timeline");
}

export function mapSourceTimeToTimelineTime(timeMs: number, clips: ClipRegion[]): number {
	const roundedTimeMs = Math.round(timeMs);
	const sortedClips = sortClipRegionsBySource(clips);

	for (const clip of sortedClips) {
		const sourceStartMs = getClipSourceStartMs(clip);
		const sourceEndMs = getClipSourceEndMs(clip);
		if (roundedTimeMs < sourceStartMs || roundedTimeMs > sourceEndMs) {
			continue;
		}

		return Math.round(clip.startMs + (roundedTimeMs - sourceStartMs) / getSafeClipSpeed(clip));
	}

	if (sortedClips.length === 0) {
		return roundedTimeMs;
	}

	return clampToNearestClipBoundary(roundedTimeMs, sortedClips, "source");
}

export function findClipAtTimelineTime(timeMs: number, clips: ClipRegion[]): ClipRegion | null {
	const roundedTimeMs = Math.round(timeMs);
	return (
		sortClipRegions(clips).find(
			(clip) => roundedTimeMs >= clip.startMs && roundedTimeMs < clip.endMs,
		) ?? null
	);
}

export function extendAutoFullTrackClip(
	clips: ClipRegion[],
	autoClipId: string | null,
	previousAutoEndMs: number | null,
	nextTotalDurationMs: number,
): ClipRegion[] | null {
	if (
		!autoClipId ||
		!Number.isFinite(previousAutoEndMs) ||
		!Number.isFinite(nextTotalDurationMs) ||
		nextTotalDurationMs <= (previousAutoEndMs ?? 0) ||
		clips.length !== 1
	) {
		return null;
	}

	const [clip] = clips;
	if (
		clip.id !== autoClipId ||
		clip.startMs !== 0 ||
		getClipSourceStartMs(clip) !== 0 ||
		clip.speed !== 1 ||
		clip.endMs !== previousAutoEndMs
	) {
		return null;
	}

	return [{ ...clip, endMs: nextTotalDurationMs }];
}

/** Convert clip regions (kept segments) to trim regions (gaps to remove). */
export function clipsToTrims(clips: ClipRegion[], totalDurationMs: number): TrimRegion[] {
	if (clips.length === 0) return [];
	const sorted = sortClipRegionsBySource(clips);
	const trims: TrimRegion[] = [];
	let cursor = 0;
	let trimId = 1;
	for (const clip of sorted) {
		const sourceStartMs = getClipSourceStartMs(clip);
		const sourceEndMs = getClipSourceEndMs(clip);
		if (sourceStartMs > cursor) {
			trims.push({ id: `trim-gap-${trimId++}`, startMs: cursor, endMs: sourceStartMs });
		}
		cursor = Math.max(cursor, sourceEndMs);
	}
	if (cursor < totalDurationMs) {
		trims.push({ id: `trim-gap-${trimId++}`, startMs: cursor, endMs: totalDurationMs });
	}
	return trims;
}

/** Convert legacy trim regions to clip regions (complement). */
export function trimsToClips(trims: TrimRegion[], totalDurationMs: number): ClipRegion[] {
	if (trims.length === 0) return [{ id: "clip-1", startMs: 0, endMs: totalDurationMs, speed: 1 }];
	const sorted = [...trims].sort((a, b) => a.startMs - b.startMs);
	const clips: ClipRegion[] = [];
	let cursor = 0;
	let clipId = 1;
	for (const trim of sorted) {
		if (trim.startMs > cursor) {
			clips.push({ id: `clip-${clipId++}`, startMs: cursor, endMs: trim.startMs, speed: 1 });
		}
		cursor = trim.endMs;
	}
	if (cursor < totalDurationMs) {
		clips.push({ id: `clip-${clipId++}`, startMs: cursor, endMs: totalDurationMs, speed: 1 });
	}
	return clips;
}

export type AnnotationType = "text" | "image" | "figure" | "blur";
export const BLUR_ANNOTATION_STRENGTH = 20;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
	borderRadius: number;
}

function getDefaultAnnotationFontFamily() {
	return '"SF Pro Display", "SF Pro Text", Helvetica, sans-serif';
}

export function getDefaultCaptionFontFamily() {
	return '"SF Pro Text", "SF Pro Display", Helvetica, sans-serif';
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	trackIndex?: number;
	figureData?: FigureData;
	blurIntensity?: number;
	blurColor?: string;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: getDefaultAnnotationFontFamily(),
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
	borderRadius: 8,
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#2563EB",
	strokeWidth: 4,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export const ADVANCED_VERTICAL_PADDING_MAX = 250;

export interface Padding {
	top: number;
	bottom: number;
	left: number;
	right: number;
	linked?: boolean;
}

export const DEFAULT_PADDING: Padding = {
	top: 20,
	bottom: 20,
	left: 20,
	right: 20,
	linked: true,
};
export type {
	SourceAudioTrackSetting,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";

export interface AudioRegion {
	id: string;
	startMs: number;
	endMs: number;
	audioPath: string;
	volume: number;
	normalize?: boolean;
	trackIndex?: number;
}

export interface CaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: CaptionCueWord[];
}

export interface CaptionCueWord {
	text: string;
	startMs: number;
	endMs: number;
	leadingSpace?: boolean;
}

export type AutoCaptionAnimation = "none" | "fade" | "rise" | "pop";

export interface AutoCaptionSettings {
	enabled: boolean;
	/** Show the hover ghost on the timeline caption track for click-to-add. */
	timelineQuickAdd: boolean;
	language: string;
	fontFamily: string;
	fontSize: number;
	bottomOffset: number;
	maxWidth: number;
	maxRows: number;
	animationStyle: AutoCaptionAnimation;
	boxRadius: number;
	textColor: string;
	inactiveTextColor: string;
	backgroundOpacity: number;
}

export const DEFAULT_AUTO_CAPTION_SETTINGS: AutoCaptionSettings = {
	enabled: false,
	timelineQuickAdd: true,
	language: "auto",
	fontFamily: getDefaultCaptionFontFamily(),
	fontSize: 30,
	bottomOffset: 3,
	maxWidth: 62,
	maxRows: 1,
	animationStyle: "fade",
	boxRadius: 17.5,
	textColor: "#FFFFFF",
	inactiveTextColor: "#A3A3A3",
	backgroundOpacity: 0.9,
};

export type PlaybackSpeed = 0.25 | 0.5 | 0.75 | 1.25 | 1.5 | 1.75 | 2;

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: PlaybackSpeed;
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;
export const DEFAULT_AUTO_ZOOM_DEPTH: ZoomDepth = 2;

export function clampFocusToDepth(focus: ZoomFocus, _depth: ZoomDepth): ZoomFocus {
	return {
		cx: clamp(focus.cx, 0, 1),
		cy: clamp(focus.cy, 0, 1),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}
