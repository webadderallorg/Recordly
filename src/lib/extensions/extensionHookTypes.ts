export interface RenderHookContext {
	width: number;
	height: number;
	timeMs: number;
	durationMs: number;
	cursor: { cx: number; cy: number; interactionType?: string } | null;
	smoothedCursor?: {
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null;
	ctx: CanvasRenderingContext2D;
	videoLayout?: {
		maskRect: { x: number; y: number; width: number; height: number };
		borderRadius: number;
		padding: number;
	};
	zoom?: {
		scale: number;
		focusX: number;
		focusY: number;
		progress: number;
	};
	sceneTransform?: {
		scale: number;
		x: number;
		y: number;
	};
	shadow?: {
		enabled: boolean;
		intensity: number;
	};
	getPixelColor(x: number, y: number): { r: number; g: number; b: number; a: number };
	getAverageSceneColor(): { r: number; g: number; b: number; a: number };
	getEdgeAverageColor(edgeWidth?: number): { r: number; g: number; b: number; a: number };
	getDominantColors(count?: number): Array<{ r: number; g: number; b: number; frequency: number }>;
}

export type RenderHookPhase =
	| "background"
	| "post-video"
	| "post-zoom"
	| "post-cursor"
	| "post-webcam"
	| "post-annotations"
	| "final";

export type RenderHookFn = (ctx: RenderHookContext) => void;

export interface CursorEffectContext {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType: "click" | "double-click" | "right-click" | "mouseup";
	width: number;
	height: number;
	ctx: CanvasRenderingContext2D;
	elapsedMs: number;
	zoom?: {
		scale: number;
		focusX: number;
		focusY: number;
		progress: number;
	};
	sceneTransform?: {
		scale: number;
		x: number;
		y: number;
	};
	videoLayout?: {
		maskRect: { x: number; y: number; width: number; height: number };
		borderRadius: number;
		padding: number;
	};
}

export type CursorEffectFn = (ctx: CursorEffectContext) => boolean;

export type ExtensionEventType =
	| "playback:timeupdate"
	| "playback:play"
	| "playback:pause"
	| "cursor:click"
	| "cursor:move"
	| "timeline:region-added"
	| "timeline:region-removed"
	| "export:start"
	| "export:frame"
	| "export:complete";

export interface ExtensionEvent {
	type: ExtensionEventType;
	timeMs?: number;
	data?: unknown;
}

export type ExtensionEventHandler = (event: ExtensionEvent) => void;

export interface ExtensionSettingField {
	id: string;
	label: string;
	type: "toggle" | "slider" | "select" | "color" | "text";
	defaultValue: unknown;
	min?: number;
	max?: number;
	step?: number;
	options?: { label: string; value: string }[];
}

export interface ExtensionSettingsPanel {
	id: string;
	label: string;
	icon?: string;
	parentSection?: string;
	fields: ExtensionSettingField[];
}